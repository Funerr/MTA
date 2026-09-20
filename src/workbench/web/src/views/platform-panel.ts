import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError, type TaskView } from '../api';
import {
  AUTHORING_PLATFORMS,
  type AuthoringDocument,
  type AuthoringPlatform,
  type PlatformWorkflowVariant,
} from '../../../core/document';
import { Badge, Field, Select, TextInput } from '../ui';

/**
 * 平台面板：应用上下文、生成/静态检查入口、工作流与覆盖映射展示。
 * 耗时生成走任务轮询。单页工作台直接使用 PlatformSection（单平台）
 * 与 ModelConfigCard（侧边栏浮层）。
 */

const MODEL_FAMILY_OPTIONS = [
  { value: '', label: '自动检测' },
  { value: 'openai', label: 'OpenAI / 兼容接口' },
  { value: 'zhipu', label: '智谱 GLM' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'qwen', label: '通义千问 Qwen' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'baichuan', label: '百川 Baichuan' },
  { value: 'moonshot', label: 'Moonshot / Kimi' },
  { value: 'spark', label: '讯飞星火 Spark' },
  { value: 'hunyuan', label: '腾讯混元 Hunyuan' },
  { value: 'yi', label: '零一万物 Yi' },
  { value: 'stepfun', label: '阶跃星辰 StepFun' },
  { value: 'anthropic', label: 'Anthropic Claude' },
] as const;

interface GenerateResultDoc {
  document: import('../../../core/document').AuthoringDocument;
  caseStatuses?: Record<string, string>;
  mergedCaseCount?: number;
  flaggedExpectations?: string[];
  notes?: string[];
}

export function PlatformPanel(props: {
  doc: AuthoringDocument;
  baseSaveVersion: number;
  onMutateBusiness: (mutator: (draft: AuthoringDocument) => void) => void;
  onMutateVariant: (
    platform: AuthoringPlatform,
    mutator: (variant: PlatformWorkflowVariant) => void,
  ) => void;
  onDocumentSaved: (document: AuthoringDocument) => void;
}) {
  const { doc } = props;
  return html`
    <div class="panel">
      <${ModelConfigCard} />
      <p class="muted">
        共享业务用例；两个平台分别保存执行内容、检查与确认状态，互不覆盖。
        包名未知时留空，生成阶段会列为待澄清问题，不猜测。
      </p>
      ${AUTHORING_PLATFORMS.map((platform) => html`
        <${PlatformSection}
          key=${platform}
          platform=${platform}
          doc=${props.doc}
          baseSaveVersion=${props.baseSaveVersion}
          onMutateBusiness=${props.onMutateBusiness}
          onMutateVariant=${props.onMutateVariant}
          onDocumentSaved=${props.onDocumentSaved}
        />
      `)}
    </div>
  `;
}

export function ModelConfigCard(props: { onConfigured?: () => void } = {}) {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof api.getModelConfig>> | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [family, setFamily] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getModelConfig()
      .then((result) => {
        setConfig(result);
        setBaseUrl(result.authoring?.baseUrl ?? '');
        setModel(result.authoring?.model ?? '');
        setFamily(result.authoring?.family ?? '');
      })
      .catch((reason: unknown) =>
        setMessage(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  const save = () => {
    setBusy(true);
    setMessage(null);
    api
      .putModelConfig({ baseUrl, model, apiKey, family: family || undefined })
      .then((result) => {
        setConfig(result);
        setApiKey('');
        setMessage('模型配置已保存（密钥仅保存在本机服务端）。');
        props.onConfigured?.();
      })
      .catch((reason: unknown) =>
        setMessage(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setBusy(false));
  };

  return html`
    <fieldset class="fieldset">
      <legend>编写模型配置</legend>
      <p class="muted">
        OpenAI 兼容接口（baseUrl + 模型名 + 密钥）。密钥只保存在服务端，
        不会出现在响应、日志或导出文件中。
        设备视觉模型沿用 .env 的 MIDSCENE_MODEL_* 配置
        ${config?.deviceVision.configured
          ? html`（已配置：${config.deviceVision.model}）`
          : html`（<span class="warn">未配置</span>）`}
      </p>
      <div class="grid-3">
        <${Field} label="Base URL">
          <${TextInput} value=${baseUrl} placeholder="https://api.example.com/v1" onInput=${setBaseUrl} />
        <//>
        <${Field} label="模型名称">
          <${TextInput} value=${model} placeholder="model-name" onInput=${setModel} />
        <//>
        <${Field} label=${config?.authoring ? `API Key（已保存 ${config.authoring.apiKeyMasked}，留空不修改）` : 'API Key'}>
          <${TextInput} value=${apiKey} placeholder=${config?.authoring ? '留空保持不变' : 'sk-…'} onInput=${setApiKey} />
        <//>
      </div>
      <div class="grid-3">
        <${Field} label="模型系列" hint="影响请求参数适配；选"自动检测"会按模型名推断">
          <${Select} value=${family} options=${MODEL_FAMILY_OPTIONS as unknown as { value: string; label: string }[]} onChange=${setFamily} />
        <//>
      </div>
      <div class="row">
        <button class="primary" disabled=${busy} onClick=${save}>保存模型配置</button>
        ${message ? html`<span class="muted">${message}</span>` : null}
      </div>
    </fieldset>
  `;
}

export function PlatformSection(props: {
  platform: AuthoringPlatform;
  doc: AuthoringDocument;
  baseSaveVersion: number;
  onMutateBusiness: (mutator: (draft: AuthoringDocument) => void) => void;
  onMutateVariant: (
    platform: AuthoringPlatform,
    mutator: (variant: PlatformWorkflowVariant) => void,
  ) => void;
  onDocumentSaved: (document: AuthoringDocument) => void;
}) {
  const { platform, doc, baseSaveVersion, onMutateVariant } = props;
  const variant = doc.variants[platform];
  const label = platform === 'android' ? 'Android' : 'HarmonyOS';

  const [task, setTask] = useState<TaskView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [partialIds, setPartialIds] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);

  // 轮询生成任务
  useEffect(() => {
    if (!task || task.status !== 'running') return;
    const timer = setTimeout(() => {
      api
        .getTask(task.id)
        .then(({ task: updated }) => {
          setTask(updated);
          if (updated.status === 'completed' && updated.result?.document) {
            props.onDocumentSaved(
              updated.result.document as AuthoringDocument,
            );
          }
        })
        .catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : String(reason)),
        );
    }, 800);
    return () => clearTimeout(timer);
  }, [task]);

  const generate = (caseIds?: string[]) => {
    setError(null);
    api
      .generateWorkflow(doc.id, { platform, baseSaveVersion, caseIds })
      .then(({ task: started }) => setTask(started))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  };

  const mergeOutput = async (
    output: NonNullable<TaskView['result']>['outputs'] extends (infer T)[] | undefined
      ? T
      : never,
  ) => {
    setMerging(true);
    setError(null);
    try {
      const { document } = await api.mergeGenerated(doc.id, {
        platform,
        baseSaveVersion,
        cases: [
          {
            caseId: output.caseId,
            workflowYaml: output.workflowYaml,
            coverage: output.coverage,
            actionMapping: output.actionMapping,
            rewrites: output.rewrites,
            issues: output.issues,
          },
        ],
      });
      props.onDocumentSaved(document);
      setTask((current) => current?.result ? { ...current, result: { ...current.result, outputs: current.result.outputs?.filter((item) => item.caseId !== output.caseId) } } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMerging(false);
    }
  };

  const cancel = () => {
    if (!task) return;
    api.cancelTask(task.id).then(({ task: updated }) => setTask(updated)).catch(
      (reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
    );
  };

  const validate = () => {
    setValidating(true);
    setError(null);
    api
      .validateWorkflow(doc.id, platform)
      .then((response) => {
        props.onDocumentSaved(response.document);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setValidating(false));
  };

  const layerBadge = (name: string, layer?: { status: string }) => {
    if (!layer) return Badge({ tone: 'muted', text: `${name}：未检查` });
    const tone =
      layer.status === 'passed' ? 'ok' : layer.status === 'failed' ? 'err' : 'warn';
    const text =
      layer.status === 'passed' ? `${name}：通过` : layer.status === 'failed' ? `${name}：未通过` : `${name}：未运行`;
    return Badge({ tone, text });
  };

  return html`
    <fieldset class="fieldset">
      <legend>${label}</legend>
      ${!variant
        ? html`
            <button
              class="primary"
              onClick=${() =>
                props.onMutateBusiness((draft) => {
                  draft.variants[platform] = {
                    platform,
                    appContext: { packageName: '' },
                    workflow: {
                      revision: 1,
                      basedOnBusinessRevision: draft.businessRevision,
                      yaml: '',
                    },
                    coverage: [],
                    evidence: [],
                    confirm: { status: 'unconfirmed' },
                    needsUpdate: true,
                  };
                })}
            >启用${label}变体</button>
          `
        : html`
            <div class="grid-3">
              <${Field} label="应用包名">
                <${TextInput}
                  value=${variant.appContext.packageName}
                  placeholder=${platform === 'android'
                    ? '如 com.android.settings'
                    : '如 com.huawei.hmosApp'}
                  onInput=${(value: string) =>
                    onMutateVariant(platform, (v) => {
                      v.appContext.packageName = value;
                    })}
                />
              <//>
              <${Field} label="入口说明（可选）">
                <${TextInput}
                  value=${variant.appContext.entryHint ?? ''}
                  placeholder="启动方式或入口路径"
                  onInput=${(value: string) =>
                    onMutateVariant(platform, (v) => {
                      v.appContext.entryHint = value || undefined;
                    })}
                />
              <//>
              <${Field} label="状态">
                <div class="row">
                  ${Badge({ tone: 'muted', text: `工作流 r${variant.workflow.revision}` })}
                  ${variant.needsUpdate
                    ? Badge({ tone: 'warn', text: '业务已变化，待重新生成' })
                    : Badge({ tone: 'ok', text: '与业务修订同步' })}
                  ${variant.confirm.status === 'confirmed'
                    ? Badge({ tone: 'ok', text: '已确认' })
                    : Badge({ tone: 'muted', text: '未确认' })}
                </div>
              <//>
            </div>

            <div class="row">
              <button
                class="primary"
                disabled=${task?.status === 'running'}
                onClick=${() => generate()}
              >生成${label}工作流</button>
              <button
                disabled=${validating || !variant.workflow.yaml}
                onClick=${validate}
              >运行静态检查</button>
              ${task?.status === 'running'
                ? html`<button onClick=${cancel}>取消生成</button>`
                : null}
              ${task?.status === 'running' ? Badge({ tone: 'muted', text: '生成中…' }) : null}
            </div>

            ${task
              ? html`
                  <div class="task-progress">
                    ${task.progress.map(
                      (entry, index) => html`<div key=${index} class="muted">· ${entry.message}</div>`,
                    )}
                    ${task.status === 'failed'
                      ? html`<p class="err">生成失败：${task.error}</p>`
                      : null}
                    ${task.status === 'cancelled'
                      ? html`<p class="warn">生成已取消；文档保持原样。</p>`
                      : null}
                    ${task.status === 'completed' && task.result?.conflict
                      ? html`
                          <p class="warn">${task.result.message}</p>
                          <p class="muted">
                            生成期间工作流被人工修改；以下为待合并差异，逐条选择是否合并。
                          </p>
                          ${task.result.outputs?.map(
                            (output, index) => html`
                              <div class="item-block" key=${output.caseId}>
                                <div class="row">
                                  <strong>${output.caseId}</strong>
                                  <button
                                    class="primary"
                                    disabled=${merging}
                                    onClick=${() => void mergeOutput(output)}
                                  >合并该用例</button>
                                </div>
                                <details open><summary>当前工作流（保留人工修改）</summary><pre class="excerpt">${variant.workflow.yaml}</pre></details>
                                <details open><summary>AI 建议片段（合并将替换该用例）</summary><pre class="excerpt">${output.workflowYaml}</pre></details>
                              </div>
                            `,
                          )}
                        `
                      : task.status === 'completed' && task.result
                        ? html`
                            <p class="ok">
                              生成完成${task.result.partial ? `（局部：替换 ${task.result.replaced?.length ?? 0}、追加 ${task.result.appended?.length ?? 0}）` : `：合并 ${task.result.mergedCaseCount ?? 0} 条工作流`}；
                              ${task.result.flaggedExpectations?.length ?? 0} 条预期待人工核对。
                            </p>
                          `
                        : null}
                  </div>
                `
              : null}
            ${error ? html`<p class="err">${error}</p>` : null}

            ${variant.validation
              ? html`
                  <div class="row">
                    ${layerBadge('YAML 解析', variant.validation.layers.yaml)}
                    ${layerBadge('Node 输入', variant.validation.layers.nodeInputs)}
                    ${layerBadge('预期覆盖', variant.validation.layers.coverage)}
                    ${layerBadge('证据路径', variant.validation.layers.evidencePaths)}
                  </div>
                  ${Object.values(variant.validation.layers).some(
                    (layer) => layer.issues.length > 0,
                  )
                    ? html`
                        <ul class="muted">
                          ${Object.entries(variant.validation.layers).flatMap(
                            ([name, layer]) =>
                              layer.issues.map((issue, index) => {
                                const detail = issue as { message?: string };
                                return html`<li key=${`${name}-${index}`}>
                                  [${name}] ${detail.message ?? String(issue)}
                                </li>`;
                              }),
                          )}
                        </ul>
                      `
                    : null}
                `
              : null}

            ${variant.workflow.yaml && doc.cases.length > 0
              ? html`
                  <details>
                    <summary>局部重新生成（选择业务用例）</summary>
                    ${doc.cases.map(
                      (caseItem) => html`
                        <label class="check" key=${caseItem.id}>
                          <input
                            type="checkbox"
                            checked=${partialIds.has(caseItem.id)}
                            onChange=${(event: Event) => {
                              const checked = (event.target as HTMLInputElement).checked;
                              setPartialIds((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(caseItem.id);
                                else next.delete(caseItem.id);
                                return next;
                              });
                            }}
                          />
                          ${caseItem.sourceId ? `${caseItem.sourceId} · ` : ''}${caseItem.name || caseItem.id}
                        </label>
                      `,
                    )}
                    <button
                      disabled=${task?.status === 'running' || partialIds.size === 0}
                      onClick=${() => generate([...partialIds])}
                    >重新生成选中用例（${partialIds.size}）</button>
                  </details>
                `
              : null}

            ${variant.workflow.yaml
              ? html`
                  <${Field} label="执行工作流 YAML（只读；编辑请切换到“工作流编辑”）">
                    <textarea rows="14" readonly value=${variant.workflow.yaml}></textarea>
                  <//>
                  ${variant.coverage.length
                    ? html`
                        <details>
                          <summary>覆盖映射（${variant.coverage.filter((c) => c.covered).length}/${variant.coverage.length} 已覆盖）</summary>
                          <ul class="muted">
                            ${variant.coverage.map((entry, index) => html`
                              <li key=${index}>
                                ${entry.expectationId}：
                                ${entry.covered
                                  ? `case ${entry.caseIndex} / step ${entry.stepIndex} → ${entry.node}`
                                  : `未覆盖（${entry.reason ?? '未说明'}）`}
                              </li>
                            `)}
                          </ul>
                        </details>
                      `
                    : null}
                `
              : html`<p class="muted">尚未生成工作流。</p>`}
          `}
    </fieldset>
  `;
}

export type { GenerateResultDoc };
