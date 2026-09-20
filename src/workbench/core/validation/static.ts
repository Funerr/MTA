import {
  collectWorkflowDocument,
  NodeInputValidationError,
  type NodeDefinition,
} from '@midscene/test';

/** 注册表的最小结构面：与引擎同一份 NodeDefinition。 */
interface NodeRegistryLike {
  get(name: string): NodeDefinition | undefined;
}
import { loadTestProject } from '@midscene/test/config';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AuthoringDocument,
  AuthoringPlatform,
  PlatformWorkflowVariant,
} from '../document';

/**
 * 分层静态检查：YAML 解析 / Node 输入契约 / 预期覆盖 / 证据路径。
 * 全程复用纯收集与输入校验入口（见 docs/workbench-contracts.md），
 * 不启动 setup、不连接设备、不调用模型。
 *
 * 每层独立报告 passed/failed/not_run；只有四层全部通过且无缺口，
 * 用例才允许进入“ready”（仍需人工确认后才可导出）。
 */

export type LayerStatus = 'passed' | 'failed' | 'not_run';

export interface ValidationLayer {
  readonly status: LayerStatus;
  readonly issues: readonly ValidationIssue[];
}

export interface ValidationIssue {
  readonly message: string;
  readonly caseIndex?: number;
  readonly stepIndex?: number;
  readonly node?: string;
  readonly expectationId?: string;
}

export interface LayeredValidation {
  readonly yaml: ValidationLayer;
  readonly nodeInputs: ValidationLayer;
  readonly coverage: ValidationLayer;
  readonly evidencePaths: ValidationLayer;
  /** 全部通过时为 true；任何一层未通过或存在缺口则为 false。 */
  readonly allPassed: boolean;
}

/** loadTestProject 需要导入 TS 配置，按配置路径缓存一次。 */
const projectCache = new Map<string, Promise<Awaited<ReturnType<typeof loadTestProject>>>>();

async function loadProjectCached(configPath: string) {
  let cached = projectCache.get(configPath);
  if (!cached) {
    cached = loadTestProject(configPath);
    cached.catch(() => projectCache.delete(configPath));
    projectCache.set(configPath, cached);
  }
  return cached;
}

export interface StaticCheckOptions {
  configPath: string;
  document: AuthoringDocument;
  platform: AuthoringPlatform;
  variant: PlatformWorkflowVariant;
}

export async function runStaticChecks(
  options: StaticCheckOptions,
): Promise<LayeredValidation> {
  const { document, platform, variant, configPath } = options;

  // 层 1：YAML 解析与工作流结构（经 collectWorkflowDocument，纯文件+CPU）。
  if (!variant.workflow.yaml.trim()) {
    return notRunAll('平台工作流为空，尚未生成');
  }
  if (variant.workflow.invalidYamlBuffer !== undefined) {
    return notRunAll('存在未同步的无效 YAML 缓冲区，先修正后再检查');
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'mta-workbench-validate-'));
  let yamlLayer: ValidationLayer;
  let collectedSteps: readonly {
    node: string;
    input: Record<string, unknown>;
    caseIndex: number;
    stepIndex: number;
  }[] = [];
  let registry: NodeRegistryLike | undefined;

  try {
    const absolutePath = join(tempDir, 'workflow.workbench-check.yaml');
    writeFileSync(absolutePath, variant.workflow.yaml, 'utf8');

    const loaded = await loadProjectCached(configPath);
    const project = loaded.projects.find((p) => p.name === platform);
    if (!project) {
      return notRunAll(`执行项目 ${platform} 不在 ${configPath} 中`);
    }
    registry = project.nodes as unknown as NodeRegistryLike;

    try {
      const doc = collectWorkflowDocument(
        {
          projectId: `workbench-${platform}`,
          sourcePath: absolutePath,
          absolutePath,
        },
        { resolveNode: (name) => project.nodes.get(name), variables: project.variables, env: {} },
      );
      const steps: {
        node: string;
        input: Record<string, unknown>;
        caseIndex: number;
        stepIndex: number;
      }[] = [];
      doc.cases.forEach((collectedCase, caseIndex) => {
        collectedCase.definition.steps.forEach((step, stepIndex) => {
          steps.push({ node: step.node, input: step.input, caseIndex, stepIndex });
        });
      });
      for (const lifecycle of [doc.lifecycle.beforeAll, doc.lifecycle.beforeEach, doc.lifecycle.afterEach, doc.lifecycle.afterAll]) {
        lifecycle.forEach((step, stepIndex) => steps.push({ node: step.node, input: step.input, caseIndex: -1, stepIndex }));
      }
      collectedSteps = steps;
      yamlLayer = { status: 'passed', issues: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yamlLayer = {
        status: 'failed',
        issues: [{ message }],
      };
    }

    // 层 2：Node 输入契约（与引擎一致的 safeParseAsync，不执行）。
    let nodeLayer: ValidationLayer;
    if (yamlLayer.status !== 'passed') {
      nodeLayer = { status: 'not_run', issues: [] };
    } else {
      const issues: ValidationIssue[] = [];
      for (const step of collectedSteps) {
        const node: NodeDefinition | undefined = registry!.get(step.node);
        if (!node) continue; // collect 阶段已拒未知节点
        const schema = node.inputSchema;
        if (!schema) continue;
        const result = await schema.safeParseAsync(step.input);
        if (!result.success) {
          issues.push({
            message: NodeInputValidationError.fromZod(step.node, result.error).message,
            caseIndex: step.caseIndex,
            stepIndex: step.stepIndex,
            node: step.node,
          });
        }
      }
      nodeLayer = {
        status: issues.length === 0 ? 'passed' : 'failed',
        issues,
      };
    }

    // 层 3：预期覆盖。
    const coverageIssues: ValidationIssue[] = [];
    for (const businessCase of document.cases) {
      for (const expectation of businessCase.expectations) {
        const entry = variant.coverage.find(
          (c) => c.expectationId === expectation.id,
        );
        if (!entry) {
          coverageIssues.push({
            message: `预期缺少覆盖映射`,
            expectationId: expectation.id,
          });
        } else if (entry.covered && !collectedSteps.some((step) => step.caseIndex === entry.caseIndex && step.stepIndex === entry.stepIndex && step.node === entry.node)) {
          coverageIssues.push({ message: '覆盖映射未指向当前工作流节点', expectationId: expectation.id });
        } else if (!entry.covered) {
          coverageIssues.push({
            message: `预期未被覆盖：${entry.reason ?? '未说明原因'}`,
            expectationId: expectation.id,
          });
        }
      }
    }
    const coverageLayer: ValidationLayer = {
      status: coverageIssues.length === 0 ? 'passed' : 'failed',
      issues: coverageIssues,
    };

    // 层 4：证据路径可用性（按断言节点类型核对证据类型）。
    const evidenceIssues: ValidationIssue[] = [];
    for (const businessCase of document.cases) {
      for (const expectation of businessCase.expectations) {
        const entry = variant.coverage.find(
          (c) => c.expectationId === expectation.id,
        );
        if (!entry?.covered) continue;
        const needed = evidenceGap(expectation.evidenceKind, entry.node, platform);
        if (needed) {
          evidenceIssues.push({
            message: needed,
            expectationId: expectation.id,
          });
        }
      }
    }
    const evidenceLayer: ValidationLayer = {
      status: evidenceIssues.length === 0 ? 'passed' : 'failed',
      issues: evidenceIssues,
    };

    const allPassed =
      yamlLayer.status === 'passed' &&
      nodeLayer.status === 'passed' &&
      coverageLayer.status === 'passed' &&
      evidenceLayer.status === 'passed';

    return { yaml: yamlLayer, nodeInputs: nodeLayer, coverage: coverageLayer, evidencePaths: evidenceLayer, allPassed };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function evidenceGap(
  evidenceKind: string,
  node: string | undefined,
  platform: AuthoringPlatform,
): string | undefined {
  if (evidenceKind === 'state-change') {
    return '状态变化类断言缺少已验证的数据读取/传递/比较路径；保留草稿，不进入就绪导出';
  }
  if (evidenceKind === 'visual') {
    return node === 'aiAssert' ? undefined : `界面可见预期应映射到 aiAssert，当前为 ${node ?? '（无节点）'}`;
  }
  if (evidenceKind === 'shell') {
    const shellNode = platform === 'android' ? 'runAdbShell' : 'runHdcShell';
    return node === shellNode ? undefined : `Shell 证据应映射到 ${shellNode}，当前为 ${node ?? '（无节点）'}`;
  }
  if (evidenceKind === 'report') {
    return node === 'recordToReport' ? undefined : `报告证据应映射到 recordToReport，当前为 ${node ?? '（无节点）'}`;
  }
  return '证据路径未定（unverified），请先明确证据类型';
}

function notRunAll(reason: string): LayeredValidation {
  const layer: ValidationLayer = { status: 'not_run', issues: [{ message: reason }] };
  return {
    yaml: layer,
    nodeInputs: { status: 'not_run', issues: [] },
    coverage: { status: 'not_run', issues: [] },
    evidencePaths: { status: 'not_run', issues: [] },
    allPassed: false,
  };
}
