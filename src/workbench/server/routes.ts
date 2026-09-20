import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { HttpError, type WorkbenchRouteHandler } from './app';
import type { WorkbenchConfig } from './config';
import { DocumentStore } from '../core/document-store';
import { compileGenerationIntoVariant } from '../core/generate/compile';
import { runStaticChecks } from '../core/validation/static';
import {
  buildCardView,
  cardViewToYaml,
  deleteStep,
  insertStep,
  updateCardNodeInput,
} from '../core/cards/mapping';
import { confirmDocument, exportDocument, contentDigest } from '../core/delivery/delivery';
import { touchWorkflow } from '../core/document';
import YAML from 'yaml';
import { loadProjectGenerationContext } from '../core/generate/context';
import { generatePlatformWorkflow } from '../core/generate/generate';
import { ModelCaseOutputSchema } from '../core/generate/schema';
import { mergeGeneratedCases, type MergeCaseInput } from '../core/generate/merge';
import type { AuthoringPlatform } from '../core/document';
import { applyImport } from '../core/import/apply';
import { parseExcelCases } from '../core/import/excel';
import { parseMarkdownCases } from '../core/import/markdown';
import { parseTextCases } from '../core/import/text';
import type { ImportKind, ImportParseResult } from '../core/import/types';
import {
  effectiveAuthoring,
  validateAuthoring,
  type ModelConfigStore,
  type StoredModelConfig,
} from './model-config';
import type { Workspace } from './workspace';
import type { AuthoringDocument, SourceDocument } from '../core/document';
import type { TaskRegistry, WorkbenchTask } from './tasks';
import type { DeviceService, WorkbenchPlatform } from '../core/devices/device-service';
import type { VerifyService } from './verify-service';
import { evidenceSummary } from '../core/verify/evidence';

export interface WorkbenchRouteContext {
  config: WorkbenchConfig;
  workspace: Workspace;
  modelConfig: ModelConfigStore;
  documents: DocumentStore;
  tasks: TaskRegistry;
  devices: DeviceService;
  verify: VerifyService;
}

/** 任务对象的对外形态：始终包含进度与终态。 */
const taskView = (task: WorkbenchTask) => ({
  id: task.id,
  kind: task.kind,
  status: task.status,
  createdAt: task.createdAt,
  endedAt: task.endedAt,
  progress: task.progress,
  result: task.result,
  error: task.error,
});

/** API 路由表：键为 `METHOD /api/path`，支持 `:param` 段。 */
export function createRouteTable(
  context: WorkbenchRouteContext,
): Record<string, WorkbenchRouteHandler> {
  return {
    'GET /api/health': async () => ({
      name: 'mta-workbench',
      ok: true,
      version: 1,
    }),

    'GET /api/model-config': async () => context.modelConfig.describe(),

    'PUT /api/model-config': async ({ body }) => {
      if (!body || typeof body !== 'object') {
        throw new HttpError(400, '缺少模型配置请求体');
      }
      const payload = body as { authoring?: unknown };
      const stored: StoredModelConfig =
        payload.authoring === null || payload.authoring === undefined
          ? { authoring: null }
          : { authoring: validateAuthoringInput(payload.authoring) };
      await context.modelConfig.save(stored);
      return context.modelConfig.describe();
    },

    'GET /api/documents': async () => ({
      documents: await context.documents.list(),
    }),

    'POST /api/documents': async ({ body }) => {
      const payload = (body ?? {}) as { name?: unknown };
      if (typeof payload.name !== 'string' || !payload.name.trim()) {
        throw new HttpError(400, '文档名称不能为空');
      }
      return { document: await context.documents.create(payload.name) };
    },

    'GET /api/documents/:id': async ({ params }) => ({
      document: await context.documents.load(params.id!),
    }),

    'PUT /api/documents/:id': async ({ params, body }) => {
      const payload = (body ?? {}) as {
        document?: unknown;
        baseSaveVersion?: unknown;
      };
      if (!payload.document || typeof payload.document !== 'object') {
        throw new HttpError(400, '缺少 document 字段');
      }
      if (
        typeof payload.baseSaveVersion !== 'number' ||
        !Number.isInteger(payload.baseSaveVersion)
      ) {
        throw new HttpError(400, '缺少 baseSaveVersion（整数）');
      }
      const incoming = payload.document as AuthoringDocument;
      if (incoming.id !== params.id) {
        throw new HttpError(400, '文档 ID 与路径不一致');
      }
      const previous = await context.documents.load(params.id!);
      for (const platform of ['android', 'harmony'] as const) {
        const variant = incoming.variants[platform];
        if (!variant) continue;
        const changed = contentDigest(incoming, platform) !== contentDigest(previous, platform);
        variant.confirm = changed ? { status: 'unconfirmed' } : previous.variants[platform]?.confirm ?? { status: 'unconfirmed' };
        variant.validation = changed ? undefined : previous.variants[platform]?.validation;
        variant.evidence = previous.variants[platform]?.evidence ?? [];
      }
      const saved = await context.documents.save(
        incoming,
        payload.baseSaveVersion,
      );
      return { document: saved };
    },

    'POST /api/documents/:id/issues/:issueId/resolve': async ({ params, body }) => {
      const payload = (body ?? {}) as { baseSaveVersion?: unknown; resolution?: unknown };
      if (
        typeof payload.baseSaveVersion !== 'number' ||
        !Number.isInteger(payload.baseSaveVersion)
      ) {
        throw new HttpError(400, '缺少 baseSaveVersion（整数）');
      }
      const document = await context.documents.load(params.id!);
      const issue = document.issues.find((item) => item.id === params.issueId);
      if (!issue) throw new HttpError(404, `问题不存在：${params.issueId}`);
      if (issue.resolvedAt) return { document, issue };
      const resolved: typeof issue = {
        ...issue,
        resolvedAt: new Date().toISOString(),
        resolution:
          typeof payload.resolution === 'string' && payload.resolution.trim()
            ? payload.resolution.trim()
            : '用户已核对并确认该问题不影响验收要求',
      };
      document.issues = document.issues.map((item) =>
        item.id === params.issueId ? resolved : item,
      );
      const saved = await context.documents.save(
        document,
        payload.baseSaveVersion,
      );
      return { document: saved, issue: resolved };
    },

    'POST /api/documents/:id/confirm': async ({ params, body }) => {
      const payload = (body ?? {}) as { platform?: unknown; baseSaveVersion?: unknown };
      if (!Number.isInteger(payload.baseSaveVersion)) throw new HttpError(400, '缺少 baseSaveVersion');
      return confirmDocument({ documents: context.documents, workspace: context.workspace, documentId: params.id!,
        platform: validatePlatform(payload.platform), baseSaveVersion: payload.baseSaveVersion as number,
        configPath: join(context.config.projectRoot, 'midscene.config.ts') });
    },
    'POST /api/documents/:id/export': async ({ params, body }) => {
      const payload = (body ?? {}) as { baseSaveVersion?: unknown };
      if (!Number.isInteger(payload.baseSaveVersion)) throw new HttpError(400, '缺少 baseSaveVersion');
      return exportDocument({ documents: context.documents, workspace: context.workspace, projectRoot: context.config.projectRoot,
        documentId: params.id!, baseSaveVersion: payload.baseSaveVersion as number });
    },

    'DELETE /api/documents/:id': async ({ params }) => {
      await context.documents.delete(params.id!);
      return { ok: true };
    },

    'GET /api/devices': async ({ query }) => {
      const platformParam = query.get('platform');
      const platforms: WorkbenchPlatform[] =
        platformParam === 'android' || platformParam === 'harmony'
          ? [platformParam]
          : ['android', 'harmony'];
      const snapshot: Record<
        string,
        { devices: unknown[]; bound: unknown; error?: string }
      > = {};
      for (const platform of platforms) {
        try {
          snapshot[platform] = {
            devices: await context.devices.list(platform),
            bound: context.devices.bindingOf(platform),
          };
        } catch (error) {
          snapshot[platform] = {
            devices: [],
            bound: context.devices.bindingOf(platform),
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      const interrupted = await context.devices.interruptedBindings();
      return { platforms: snapshot, interrupted };
    },

    'POST /api/devices/bind': async ({ body }) => {
      const payload = (body ?? {}) as { platform?: unknown; deviceId?: unknown };
      const platform =
        payload.platform === 'android' || payload.platform === 'harmony'
          ? payload.platform
          : undefined;
      if (!platform) throw new HttpError(400, 'platform 必须是 android 或 harmony');
      if (typeof payload.deviceId !== 'string') {
        throw new HttpError(400, '必须显式指定 deviceId；不自动选择设备');
      }
      return { binding: await context.devices.bind(platform, payload.deviceId) };
    },

    'POST /api/devices/release': async ({ body }) => {
      const payload = (body ?? {}) as { platform?: unknown };
      const platform =
        payload.platform === 'android' || payload.platform === 'harmony'
          ? payload.platform
          : undefined;
      if (!platform) throw new HttpError(400, 'platform 必须是 android 或 harmony');
      if (context.verify.status(platform)[0]?.active) throw new HttpError(409, '设备任务未释放控制权，请先停止并等待结束');
      await context.devices.release(platform);
      return { ok: true };
    },

    'POST /api/documents/:id/verify': async ({ params, body }) => {
      const payload = (body ?? {}) as {
        platform?: unknown;
        caseId?: unknown;
        actionIds?: unknown;
        baseSaveVersion?: unknown;
      };
      const platform = validatePlatform(payload.platform);
      if (typeof payload.caseId !== 'string' || !payload.caseId) {
        throw new HttpError(400, '缺少 caseId');
      }
      if (
        typeof payload.baseSaveVersion !== 'number' ||
        !Number.isInteger(payload.baseSaveVersion)
      ) {
        throw new HttpError(400, '缺少 baseSaveVersion（整数）');
      }
      const actionIds =
        Array.isArray(payload.actionIds) &&
        payload.actionIds.every((id) => typeof id === 'string')
          ? (payload.actionIds as string[])
          : undefined;

      // 文档存在性先行检查（更清晰的 404）
      await context.documents.load(params.id!);
      const task = context.verify.start(params.id!, {
        platform,
        caseId: payload.caseId,
        actionIds,
        baseSaveVersion: payload.baseSaveVersion,
      });
      return { task: taskView(task) };
    },

    'POST /api/verify/stop': async ({ body }) => {
      const payload = (body ?? {}) as { platform?: unknown };
      const platform = validatePlatform(payload.platform);
      context.verify.stop(platform);
      return {
        status: context.verify.status(platform)[0],
      };
    },

    'GET /api/verify/status': async ({ query }) => {
      const platformParam = query.get('platform');
      const platform =
        platformParam === 'android' || platformParam === 'harmony'
          ? platformParam
          : undefined;
      return {
        platforms: context.verify.status(platform),
        interrupted: context.verify.listInterrupted(),
        interruptedDeviceBindings: await context.devices.interruptedBindings(),
      };
    },

    'GET /api/documents/:id/evidence-summary/:platform': async ({ params }) => {
      const platform = validatePlatform(params.platform);
      const document = await context.documents.load(params.id!);
      const variant = document.variants[platform];
      if (!variant) throw new HttpError(400, `文档未启用 ${platform} 平台变体`);
      return {
        summary: evidenceSummary(document, variant, context.devices.bindingOf(platform)?.deviceId),
        evidence: variant.evidence.map((record) => ({
          ...record,
          screenshotUrl: record.screenshotFile
            ? `./api/evidence/${record.screenshotFile.replace(/^evidence\//, '')}`
            : undefined,
        })),
      };
    },

    'GET /api/tasks': async () => ({
      tasks: context.tasks.list().map(taskView),
    }),

    'GET /api/tasks/:id': async ({ params }) => ({
      task: taskView(context.tasks.get(params.id!)),
    }),

    'POST /api/tasks/:id/cancel': async ({ params }) => ({
      task: taskView(context.tasks.cancel(params.id!)),
    }),

    'POST /api/documents/:id/generate': async ({ params, body }) => {
      const payload = (body ?? {}) as {
        platform?: unknown;
        baseSaveVersion?: unknown;
        caseIds?: unknown;
      };
      const platform = validatePlatform(payload.platform);
      const caseIds =
        Array.isArray(payload.caseIds) && payload.caseIds.every((id) => typeof id === 'string')
          ? (payload.caseIds as string[])
          : undefined;
      if (caseIds && caseIds.length === 0) {
        throw new HttpError(400, 'caseIds 为空数组时请省略该字段（整体生成）');
      }
      if (
        typeof payload.baseSaveVersion !== 'number' ||
        !Number.isInteger(payload.baseSaveVersion)
      ) {
        throw new HttpError(400, '缺少 baseSaveVersion（整数）');
      }

      const document = await context.documents.load(params.id!);
      const variant = document.variants[platform];
      if (!variant) {
        throw new HttpError(400, `文档未启用 ${platform} 平台变体；请先在“平台与应用上下文”中启用`);
      }
      const storedModel = await context.modelConfig.load();
      const authoringEndpoint = effectiveAuthoring(storedModel);
      if (!authoringEndpoint) {
        throw new HttpError(
          400,
          '生成模型未配置：请设置 MIDSCENE_MODEL_BASE_URL / MIDSCENE_MODEL_NAME（.env），或在 model-config 中自定义',
        );
      }
      const baseSaveVersion = payload.baseSaveVersion;

      const task = context.tasks.start(
        caseIds ? `generate:${platform}:partial` : `generate:${platform}`,
        async ({ signal, report }) => {
          report('加载项目规则与 Node 参考');
          const genContext = await loadProjectGenerationContext(
            context.config.projectRoot,
            platform,
          );
          const targetCount = caseIds
            ? document.cases.filter((c) => caseIds.includes(c.id)).length
            : document.cases.length;
          report(
            `调用模型生成（${targetCount} 条用例${genContext.missing.length ? `；缺少项目引用：${genContext.missing.join('、')}` : ''}）`,
          );
          const outcome = await generatePlatformWorkflow({
            endpoint: authoringEndpoint,
            context: genContext,
            document,
            platform,
            variant,
            caseIds,
            signal,
          });
          if (!outcome.ok) throw outcome.error;
          signal.throwIfAborted();

          // 迟到响应保护：保存遇到 409（生成期间有人工编辑）时不覆盖，
          // 把生成结果作为待合并差异返回，由用户选择合并内容。
          const serializeOutputs = () =>
            outcome.ok
              ? outcome.output.cases.map((generated) => ({
                  caseId: generated.caseId,
                  workflowYaml: generated.workflowYaml,
                  coverage: generated.coverage,
                  actionMapping: generated.actionMapping,
                  rewrites: generated.rewrites,
                  issues: generated.issues,
                }))
              : [];

          try {
            if (caseIds || variant.workflow.yaml.trim()) {
              return { conflict: true, baseSaveVersion, message: '生成结果待审阅；对照当前内容选择要合并的用例，未自动覆盖已有工作流。', outputs: serializeOutputs() };
            }
            report('编译并合并平台工作流');
            const compileReport = compileGenerationIntoVariant({
              document,
              variant,
              output: outcome.output,
            });
            const saved = await context.documents.save(document, baseSaveVersion);
            return {
              document: saved,
              conflict: false,
              partial: false,
              caseStatuses: compileReport.caseStatuses,
              mergedCaseCount: compileReport.mergedCaseCount,
              flaggedExpectations: compileReport.flaggedExpectations,
              notes: outcome.ok ? outcome.output.notes ?? [] : [],
            };
          } catch (error) {
            if (error instanceof HttpError && error.status === 409) {
              return {
                conflict: true,
                baseSaveVersion,
                message:
                  '生成期间文档被人工修改，未覆盖现有内容；请查看差异后选择要合并的用例。',
                outputs: serializeOutputs(),
              };
            }
            throw error;
          }
        },
      );
      return { task: taskView(task) };
    },

    'POST /api/documents/:id/merge-generated': async ({ params, body }) => {
      const payload = (body ?? {}) as {
        platform?: unknown;
        baseSaveVersion?: unknown;
        cases?: unknown;
      };
      const platform = validatePlatform(payload.platform);
      if (
        typeof payload.baseSaveVersion !== 'number' ||
        !Number.isInteger(payload.baseSaveVersion)
      ) {
        throw new HttpError(400, '缺少 baseSaveVersion（整数）');
      }
      if (!Array.isArray(payload.cases) || payload.cases.length === 0) {
        throw new HttpError(400, '缺少 cases 数组');
      }
      const document = await context.documents.load(params.id!);
      const variant = document.variants[platform];
      if (!variant) throw new HttpError(400, `文档未启用 ${platform} 平台变体`);

      const incoming: MergeCaseInput[] = [];
      for (const raw of payload.cases) {
        if (!raw || typeof raw !== 'object') {
          throw new HttpError(400, 'cases 内含非法条目');
        }
        const parsed = ModelCaseOutputSchema.safeParse(raw);
        if (!parsed.success) throw new HttpError(400, '合并条目结构无效');
        incoming.push(parsed.data);
      }
      if (document.saveVersion !== payload.baseSaveVersion) throw new HttpError(409, '文档已修改，请刷新差异后合并');

      const report = mergeGeneratedCases({ document, variant, cases: incoming });
      const saved = await context.documents.save(
        document,
        payload.baseSaveVersion,
      );
      return { document: saved, report };
    },

    'GET /api/documents/:id/workflow-cards/:platform': async ({ params }) => {
      const platform = validatePlatform(params.platform);
      const document = await context.documents.load(params.id!);
      const variant = document.variants[platform];
      if (!variant) throw new HttpError(400, `文档未启用 ${platform} 平台变体`);
      if (!variant.workflow.yaml.trim()) {
        return { cards: [], rawBlocks: [], lifecycleSections: [], empty: true };
      }
      const result = buildCardView(variant.workflow.yaml);
      if (!result.ok) {
        throw new HttpError(500, `工作流无法投影为卡片：${result.error}`);
      }
      const { view } = result;
      return {
        empty: false,
        cards: view.cards,
        rawBlocks: view.rawBlocks,
        lifecycleSections: view.lifecycleSections,
        invalidBuffer: variant.workflow.invalidYamlBuffer ?? null,
      };
    },

    'POST /api/documents/:id/workflow-card-edit': async ({ params, body }) => {
      const payload = (body ?? {}) as {
        platform?: unknown;
        baseSaveVersion?: unknown;
        edit?: unknown;
      };
      const platform = validatePlatform(payload.platform);
      if (
        typeof payload.baseSaveVersion !== 'number' ||
        !Number.isInteger(payload.baseSaveVersion)
      ) {
        throw new HttpError(400, '缺少 baseSaveVersion（整数）');
      }
      const document = await context.documents.load(params.id!);
      const variant = document.variants[platform];
      if (!variant) throw new HttpError(400, `文档未启用 ${platform} 平台变体`);
      if (!variant.workflow.yaml.trim()) {
        throw new HttpError(400, '工作流为空，请先生成或编写 YAML');
      }

      const result = buildCardView(variant.workflow.yaml);
      if (!result.ok) {
        throw new HttpError(400, `工作流无法解析为卡片：${result.error}`);
      }
      const yamlDocument = result.view.document;

      const edit = (payload.edit ?? {}) as Record<string, unknown>;
      const caseIndex = edit.caseIndex;
      const stepIndex = edit.stepIndex;
      if (typeof caseIndex !== 'number' || !Number.isInteger(caseIndex)) {
        throw new HttpError(400, 'edit.caseIndex 必须是整数');
      }
      switch (edit.kind) {
        case 'updateInput': {
          if (typeof stepIndex !== 'number') {
            throw new HttpError(400, 'edit.stepIndex 必须是整数');
          }
          updateCardNodeInput(yamlDocument, caseIndex, stepIndex, edit.input);
          break;
        }
        case 'insert': {
          const after = edit.afterStepIndex;
          if (typeof after !== 'number') {
            throw new HttpError(400, 'edit.afterStepIndex 必须是整数');
          }
          if (typeof edit.node !== 'string' || !edit.node.trim()) {
            throw new HttpError(400, 'edit.node 不能为空');
          }
          const actionId =
            typeof edit.actionId === 'string' && edit.actionId.trim()
              ? edit.actionId.trim()
              : undefined;
          insertStep(
            yamlDocument,
            caseIndex,
            after,
            edit.node.trim(),
            edit.input ?? {},
            actionId,
          );
          break;
        }
        case 'delete': {
          if (typeof stepIndex !== 'number') {
            throw new HttpError(400, 'edit.stepIndex 必须是整数');
          }
          if (!deleteStep(yamlDocument, caseIndex, stepIndex)) {
            throw new HttpError(400, `步骤 ${stepIndex} 不存在`);
          }
          break;
        }
        default:
          throw new HttpError(400, `未知编辑类型：${String(edit.kind)}`);
      }

      variant.workflow.yaml = cardViewToYaml(yamlDocument);
      variant.workflow.invalidYamlBuffer = undefined;
      touchWorkflow(variant);
      const saved = await context.documents.save(
        document,
        payload.baseSaveVersion,
      );
      return { document: saved };
    },

    'PUT /api/documents/:id/workflow-yaml': async ({ params, body }) => {
      const payload = (body ?? {}) as {
        platform?: unknown;
        baseSaveVersion?: unknown;
        yaml?: unknown;
      };
      const platform = validatePlatform(payload.platform);
      if (typeof payload.yaml !== 'string') {
        throw new HttpError(400, '缺少 yaml 文本');
      }
      if (
        typeof payload.baseSaveVersion !== 'number' ||
        !Number.isInteger(payload.baseSaveVersion)
      ) {
        throw new HttpError(400, '缺少 baseSaveVersion（整数）');
      }
      const document = await context.documents.load(params.id!);
      const variant = document.variants[platform];
      if (!variant) throw new HttpError(400, `文档未启用 ${platform} 平台变体`);

      const parsed = YAML.parseDocument(payload.yaml);
      if (parsed.errors.length > 0) {
        const first = parsed.errors[0]!;
        const linePos = (first as unknown as { linePos?: { line: number; col: number }[] }).linePos?.[0];
        // 语法错误：保留为候选缓冲区，不替换当前文档；未同步前阻止确认与导出。
        variant.workflow.invalidYamlBuffer = payload.yaml;
        const saved = await context.documents.save(
          document,
          payload.baseSaveVersion,
        );
        return {
          document: saved,
          accepted: false,
          error: {
            message: first.message,
            line: linePos?.line,
            column: linePos?.col,
          },
        };
      }

      variant.workflow.yaml = payload.yaml;
      variant.workflow.invalidYamlBuffer = undefined;
      touchWorkflow(variant);
      const saved = await context.documents.save(
        document,
        payload.baseSaveVersion,
      );
      return { document: saved, accepted: true };
    },

    'POST /api/documents/:id/validate': async ({ params, body }) => {
      const payload = (body ?? {}) as { platform?: unknown };
      const platform = validatePlatform(payload.platform);
      const document = await context.documents.load(params.id!);
      const variant = document.variants[platform];
      if (!variant) {
        throw new HttpError(400, `文档未启用 ${platform} 平台变体`);
      }

      const validation = await runStaticChecks({
        configPath: join(context.config.projectRoot, 'midscene.config.ts'),
        document,
        platform,
        variant,
      });

      // 状态推进：静态检查在无未解决问题且覆盖完整时把
      // unvalidated / needs_clarification 推进为 ready（关键疑点由用户
      // 解决后才算澄清）；unsupported 与覆盖缺口不因此清除；
      // ready 在检查退化为不通过时回到 unvalidated。
      const statuses = { ...(variant.caseStatuses ?? {}) };
      for (const businessCase of document.cases) {
        if (businessCase.status === 'ready' && !validation.allPassed) {
          businessCase.status = 'unvalidated';
        } else if (
          (businessCase.status === 'unvalidated' ||
            businessCase.status === 'needs_clarification') &&
          validation.allPassed &&
          !variant.needsUpdate &&
          variant.workflow.basedOnBusinessRevision === document.businessRevision
        ) {
          const hasOpenIssue = document.issues.some(
            (issue) => !issue.resolvedAt && (!issue.caseId || issue.caseId === businessCase.id),
          );
          const caseExpectationIds = new Set(
            businessCase.expectations.map((expectation) => expectation.id),
          );
          const hasUncovered = variant.coverage.some(
            (entry) =>
              caseExpectationIds.has(entry.expectationId) &&
              (!entry.covered || entry.caseIndex === undefined),
          );
          if (!hasOpenIssue && !hasUncovered) businessCase.status = 'ready';
        }
        // 同步平台变体的状态镜像，交付与核查以同一份为准。
        statuses[businessCase.id] = businessCase.status;
      }
      variant.caseStatuses = statuses;

      variant.validation = {
        checkedAt: new Date().toISOString(),
        allPassed: validation.allPassed,
        layers: {
          yaml: validation.yaml,
          nodeInputs: validation.nodeInputs,
          coverage: validation.coverage,
          evidencePaths: validation.evidencePaths,
        },
      };

      const saved = await context.documents.save(
        document,
        document.saveVersion,
      );
      return { document: saved, validation };
    },

    'POST /api/import/preview': async ({ body }) => {
      const payload = (body ?? {}) as {
        kind?: unknown;
        content?: unknown;
        contentBase64?: unknown;
      };
      const kind = validateImportKind(payload.kind);
      const { result } = await parseImportInput(kind, payload);
      return { result };
    },

    'POST /api/documents/:id/import': async ({ params, body }) => {
      const payload = (body ?? {}) as {
        kind?: unknown;
        name?: unknown;
        content?: unknown;
        contentBase64?: unknown;
        baseSaveVersion?: unknown;
      };
      const kind = validateImportKind(payload.kind);
      const name =
        typeof payload.name === 'string' && payload.name.trim()
          ? payload.name.trim()
          : defaultSourceName(kind);
      if (
        typeof payload.baseSaveVersion !== 'number' ||
        !Number.isInteger(payload.baseSaveVersion)
      ) {
        throw new HttpError(400, '缺少 baseSaveVersion（整数）');
      }

      const document = await context.documents.load(params.id!);
      const { result, raw } = await parseImportInput(kind, payload);

      const sourceId = `src-${randomBytes(4).toString('hex')}`;
      const safeName = name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80);
      const file = `uploads/${sourceId}-${safeName}`;
      if (typeof raw === 'string') {
        await context.workspace.writeText(file, raw);
      } else {
        await context.workspace.writeBinary(file, raw);
      }
      const source: SourceDocument = {
        id: sourceId,
        kind,
        name,
        file,
        importedAt: new Date().toISOString(),
      };
      const report = applyImport(document, result, source);

      const saved = await context.documents.save(
        document,
        payload.baseSaveVersion,
      );
      return { document: saved, result, report };
    },
  };
}

/**
 * 统一解析入口：文本类直接解析；Excel 以 base64 提供，返回原始字节
 * 供上传留档。
 */
async function parseImportInput(
  kind: ImportKind,
  payload: { content?: unknown; contentBase64?: unknown },
): Promise<{ result: ImportParseResult; raw: string | Uint8Array }> {
  if (kind === 'excel') {
    if (typeof payload.contentBase64 !== 'string' || !payload.contentBase64) {
      throw new HttpError(400, 'Excel 导入需要 contentBase64 字段');
    }
    const buffer = Buffer.from(payload.contentBase64, 'base64');
    return { result: await parseExcelCases(buffer), raw: buffer };
  }
  const content = requireContent(payload.content);
  return {
    result: kind === 'markdown' ? parseMarkdownCases(content) : parseTextCases(content, kind),
    raw: content,
  };
}

function validatePlatform(platform: unknown): AuthoringPlatform {
  if (platform === 'android' || platform === 'harmony') return platform;
  throw new HttpError(400, `不支持的平台：${String(platform)}`);
}

/** SSE 事件流：任务快照 + 后续更新，终态后关闭。 */
export function createStreamRoutes(
  context: WorkbenchRouteContext,
): Record<
  string,
  (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void
> {
  return {
    'GET /api/evidence/:documentId/:file': (_req, res, params) => {
      void (async () => {
        try {
          if (!/^[a-zA-Z0-9_-]+$/.test(params.documentId!) || !/^[a-zA-Z0-9_-]+\.png$/.test(params.file!)) throw new Error('非法证据路径');
          const bytes = await readFile(context.workspace.resolve(`evidence/${params.documentId}/${params.file}`));
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); res.end(bytes);
        } catch { res.writeHead(404); res.end(); }
      })();
    },
    'GET /api/tasks/:id/events': (req, res, params) => {
      let task: WorkbenchTask;
      try {
        task = context.tasks.get(params.id!);
      } catch (error) {
        res.writeHead(error instanceof HttpError ? error.status : 500, {
          'content-type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      const send = (snapshot: WorkbenchTask) => {
        res.write(`data: ${JSON.stringify(taskView(snapshot))}\n\n`);
      };
      send(task);
      if (task.status !== 'running') {
        res.end();
        return;
      }
      const unsubscribe = context.tasks.subscribe(task.id, (updated) => {
        send(updated);
        if (updated.status !== 'running') res.end();
      });
      req.on('close', unsubscribe);
    },
  };
}

function validateImportKind(kind: unknown): ImportKind {
  if (kind === 'paste' || kind === 'text' || kind === 'markdown' || kind === 'excel') {
    return kind;
  }
  throw new HttpError(400, `不支持的导入类型：${String(kind)}`);
}

function requireContent(content: unknown): string {
  if (typeof content !== 'string' || !content.trim()) {
    throw new HttpError(400, '导入内容不能为空');
  }
  return content;
}

function defaultSourceName(kind: ImportKind): string {
  if (kind === 'paste') return `粘贴片段 ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
  if (kind === 'excel') return `Excel 导入 ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
  return `导入 ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
}


function validateAuthoringInput(input: unknown): {
  baseUrl: string;
  apiKey: string;
  model: string;
} {
  if (!input || typeof input !== 'object') {
    throw new HttpError(400, 'authoring 配置结构非法');
  }
  const record = input as Record<string, unknown>;
  return validateAuthoring({
    baseUrl: record.baseUrl,
    apiKey: record.apiKey,
    model: record.model,
  });
}
