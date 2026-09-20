import { randomBytes } from 'node:crypto';
import { HttpError } from './app';
import type { TaskRegistry, WorkbenchTask } from './tasks';
import type { Workspace } from './workspace';
import type { DocumentStore } from '../core/document-store';
import type { DeviceService, WorkbenchPlatform } from '../core/devices/device-service';
import { deriveVerificationGoals } from '../core/verify/goals';
import { goalObservation } from '../core/verify/runner';
import { executeProjectWorkflow } from '../../setup/workflow-execution';
import type { StepRunResult } from '@midscene/test';
import { join } from 'node:path';
import { chatJson } from '../core/model/client';
import type { AuthoringDocument, EvidenceRecord } from '../core/document';
import { effectiveAuthoring, type ModelConfigStore } from './model-config';
import { log } from './log';

/**
 * 核查服务：同一平台同一时刻只允许一个核查任务（槽位在启动时同步
 * 占用，避免并发启动竞态）；停止后无新派发，在途调用结束前状态为
 * stopping；恢复核查前先重新获取当前画面；服务重启把未完成任务
 * 标记为中断，不自动重放。证据写入平台变体并保存截图；并发冲突时
 * 证据保留在任务结果中，不覆盖人工编辑。
 */

const ACTIVE_MARKER_FILE = 'verify-active.json';

interface InterruptedRecord {
  platform: WorkbenchPlatform;
  documentId: string;
  caseId: string;
  at: string;
}

interface ReservedRun {
  taskId: string;
  state: 'running' | 'stopping' | 'unknown';
  screenshotFile?: string;
  currentTarget?: string;
  controller: AbortController;
  documentId: string;
  caseId: string;
}

export interface VerifyStartInput {
  platform: WorkbenchPlatform;
  caseId: string;
  actionIds?: readonly string[];
  baseSaveVersion: number;
}

export class VerifyService {
  private readonly active = new Map<WorkbenchPlatform, ReservedRun>();
  private markerWrite: Promise<void> = Promise.resolve();
  private readonly ready: Promise<void>;
  private interrupted: InterruptedRecord[] = [];
  private readonly modelConfig: ModelConfigStore;

  constructor(
    private readonly deps: {
      devices: DeviceService;
      tasks: TaskRegistry;
      documents: DocumentStore;
      workspace: Workspace;
      modelConfig: ModelConfigStore;
      config?: { projectRoot: string };
      executeWorkflow?: typeof executeProjectWorkflow;
    },
  ) {
    this.modelConfig = deps.modelConfig;
    this.ready = this.loadInterrupted();
  }

  private async loadInterrupted(): Promise<void> {
    try {
      const raw = await this.deps.workspace.readJson<InterruptedRecord[]>(
        ACTIVE_MARKER_FILE,
      );
      if (Array.isArray(raw)) this.interrupted = raw;
    } catch {
      // 无登记文件：正常。
    }
  }

  status(platform?: WorkbenchPlatform) {
    const platforms: readonly WorkbenchPlatform[] = platform
      ? [platform]
      : ['android', 'harmony'];
    return platforms.map((p) => {
      const entry = this.active.get(p);
      return {
        platform: p,
        active: entry
          ? {
              taskId: entry.taskId,
              runnerState: entry.state,
              screenshotFile: entry.screenshotFile,
              currentTarget: entry.currentTarget,
            }
          : null,
        bound: this.deps.devices.bindingOf(p),
        /** 控制权已释放（无任务且未绑定）才可人工接管。 */
        canTakeover: !this.active.has(p) && !this.deps.devices.bindingOf(p),
      };
    });
  }

  listInterrupted(): readonly InterruptedRecord[] {
    return this.interrupted;
  }

  /** 启动核查任务：绑定检查、互斥检查与目标推导先行。 */
  start(documentId: string, input: VerifyStartInput): WorkbenchTask {
    const { platform } = input;
    if (this.active.has(platform)) {
      const running = this.active.get(platform)!;
      throw new HttpError(
        409,
        `${platform} 已有核查任务${running.taskId ? ` ${running.taskId}` : ''}在运行；同一设备同时只允许一个控制任务`,
      );
    }
    const binding = this.deps.devices.bindingOf(platform);
    if (!binding) {
      throw new HttpError(
        400,
        `尚未绑定 ${platform} 设备；请先显式绑定设备再启动核查`,
      );
    }

    // 同步占用槽位，防止并发启动双双通过互斥检查
    const reserved: ReservedRun = {
      taskId: '',
      state: 'running',
      controller: new AbortController(),
      documentId,
      caseId: input.caseId,
    };
    this.active.set(platform, reserved);

    const task = this.deps.tasks.start(
      `verify:${platform}`,
      async ({ signal, report }) => {
        await this.ready;
        const cancel = () => { reserved.state = 'stopping'; reserved.controller.abort(signal.reason); };
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        try {
          const document = await this.deps.documents.load(documentId);
          if (document.saveVersion !== input.baseSaveVersion) throw new HttpError(409, '文档已修改，请刷新后启动核查');
          const variant = document.variants[platform];
          if (!variant) {
            throw new HttpError(400, `文档未启用 ${platform} 平台变体`);
          }
          if (variant.workflow.invalidYamlBuffer !== undefined) {
            throw new HttpError(400, '存在未同步的 YAML 缓冲区，先修正后再核查');
          }

          const { goals, issues, workflowYaml } = deriveVerificationGoals({
            document,
            platform,
            variant,
            caseId: input.caseId,
            actionIds: input.actionIds,
          });
          for (const issue of issues) report(issue);
          if (goals.length === 0) {
            throw new HttpError(400, `没有可执行的核查目标：${issues.join('；')}`);
          }

          if (!workflowYaml) throw new HttpError(400, '核查范围无法确定');
          reserved.controller.signal.throwIfAborted();
          await this.persistMarker();
          const workflowFile = `verification/${documentId}/${randomBytes(8).toString('hex')}.${platform}.yaml`;
          await this.deps.workspace.writeText(workflowFile, workflowYaml);
          const steps = new Map<number, StepRunResult>();
          const screenshots = new Map<number, Uint8Array>();
          const execution = await (this.deps.executeWorkflow ?? executeProjectWorkflow)({
            configPath: join(this.deps.config?.projectRoot ?? process.cwd(), 'midscene.config.ts'),
            workflowPath: this.deps.workspace.resolve(workflowFile), platform,
            deviceId: binding.deviceId, signal: reserved.controller.signal, report,
            onStep: async (info, step) => {
              if (info.scope === 'case' && step.phase === 'steps') { steps.set(step.stepIndex, step); reserved.currentTarget = goals.find((goal) => goal.endStepIndex >= step.stepIndex)?.target; }
            },
            onScreenshot: async (index, png) => {
              screenshots.set(index, png);
              const file = `evidence/${documentId}/${reserved.taskId}-${index}.png`;
              await this.deps.workspace.writeBinary(file, png); reserved.screenshotFile = file;
            },
          });
          const stopped = reserved.controller.signal.aborted || signal.aborted;
          const frameworkReport = `verification/${documentId}/${randomBytes(8).toString('hex')}.result.json`;
          await this.deps.workspace.writeJson(frameworkReport, execution);

          const runId = randomBytes(4).toString('hex');
          const evidence: EvidenceRecord[] = [];
          for (const goal of goals) {
            const result = goalObservation(goal, steps);
            const screenshot = screenshots.get(goal.endStepIndex);
            let screenshotFile: string | undefined;
            if (screenshot) {
              screenshotFile = `evidence/${documentId}/${runId}-${goal.id}.png`;
              await this.deps.workspace.writeBinary(
                screenshotFile,
                screenshot,
              );
            }
            const businessCase = document.cases.find((c) => c.id === input.caseId);
            evidence.push({
              id: `ev-${randomBytes(4).toString('hex')}`,
              goalId: goal.id,
              caseId: input.caseId,
              actionId: goal.actionId,
              expectationIds: goal.expectationIds,
              platform,
              deviceId: binding.deviceId,
              capturedAt: new Date().toISOString(),
              workflowRevision: variant.workflow.revision,
              businessRevision: document.businessRevision,
              actionSnapshot: (businessCase?.actions ?? []).map((a) => ({
                id: a.id,
                text: a.text,
              })),
              target: goal.target,
              preconditionPath: goal.preconditionPath,
              frameworkReport,
              appContextSnapshot: JSON.stringify(variant.appContext),
              observation: result.observation,
              status: result.status,
              screenshotFile,
              notes: result.notes,
            });
          }

          const suggestions = stopped ? [] : await this.collectSuggestions(document, goals, evidence);

          let saved: AuthoringDocument | undefined;
          let conflict = false;
          try {
            const fresh = await this.deps.documents.load(documentId);
            const freshVariant = fresh.variants[platform];
            if (!freshVariant) throw new HttpError(400, '平台变体不存在');
            freshVariant.evidence = [...freshVariant.evidence, ...evidence];
            saved = await this.deps.documents.save(fresh, input.baseSaveVersion);
          } catch (error) {
            if (error instanceof HttpError && error.status === 409) {
              conflict = true;
              log('warn', '核查证据因文档并发修改暂存于任务结果', {
                documentId,
                platform,
              });
            } else {
              throw error;
            }
          }

          return {
            stopped,
            conflict,
            document: saved,
            evidence,
            evidenceSaved: !conflict,
            suggestions,
          };
        } catch (error) {
          if (error instanceof Error && error.message.includes('控制权未知')) reserved.state = 'unknown';
          throw error;
        } finally {
          signal.removeEventListener('abort', cancel);
          if (reserved.state !== 'unknown') this.active.delete(platform);
          await this.clearMarker();
        }
      },
    );

    reserved.taskId = task.id;
    return task;
  }

  /** 请求停止当前核查：不再派发新动作，等待在途调用结束。 */
  stop(platform: WorkbenchPlatform): void {
    const entry = this.active.get(platform);
    if (!entry) return;
    entry.controller.abort(new Error('用户请求停止核查'));
    entry.state = 'stopping';
  }

  private async collectSuggestions(
    document: AuthoringDocument,
    goals: readonly { id: string; target: string }[],
    evidence: readonly EvidenceRecord[],
  ): Promise<string[]> {
    let stored;
    try {
      stored = await this.modelConfig.load();
    } catch {
      return [];
    }
    const endpoint = effectiveAuthoring(stored);
    if (!endpoint) return [];
    try {
      const result = await chatJson<{ suggestions?: string[] }>(
        endpoint,
        {
          messages: [
            {
              role: 'system',
              content:
                '你是移动端测试工作流评审员。根据设备核查观察，给出对执行工作流的局部修改建议（不放宽业务验收要求）。输出 JSON：{"suggestions":["建议1"]}；没有明确建议时输出空数组。',
            },
            {
              role: 'user',
              content: JSON.stringify({
                caseName: document.cases.find((c) =>
                  evidence.some((e) => e.caseId === c.id),
                )?.name,
                goals: goals.map((g) => ({ id: g.id, target: g.target })),
                observations: evidence.map((e) => ({
                  goal: e.goalId,
                  status: e.status,
                  observation: e.observation,
                })),
              }),
            },
          ],
          timeoutMs: 60_000,
        },
      );
      return (result.suggestions ?? []).slice(0, 5);
    } catch {
      return [];
    }
  }

  private activeRecords(): InterruptedRecord[] {
    return [...this.active.entries()].map(([platform, entry]) => ({
      platform,
      documentId: entry.documentId,
      caseId: entry.caseId,
      at: new Date().toISOString(),
    }));
  }

  private async persistMarker(): Promise<void> {
    this.markerWrite = this.markerWrite.catch(() => undefined).then(() =>
      this.deps.workspace.writeJson(ACTIVE_MARKER_FILE, this.activeRecords()));
    await this.markerWrite;
  }

  private async clearMarker(): Promise<void> {
    await this.persistMarker();
  }
}
