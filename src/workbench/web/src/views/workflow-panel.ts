import { html } from 'htm/preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import {
  AUTHORING_PLATFORMS,
  type AuthoringDocument,
  type AuthoringPlatform,
} from '../../../core/document';
import { Badge } from '../ui';

/**
 * 工作流编辑：卡片（默认）/ YAML / 原文三视图。
 * 卡片经服务端确定性投影生成；超出卡片能力的结构显示为原始块，
 * 只能通过 YAML 编辑修改；语法错误的 YAML 进入未同步缓冲区。
 */

type CardViewData = Awaited<ReturnType<typeof api.getWorkflowCards>>;
type Mode = 'cards' | 'yaml' | 'source';

export function WorkflowPanel(props: {
  doc: AuthoringDocument;
  baseSaveVersion: number;
  /** 受控平台：传入时隐藏内部切换器（单页工作台共用一个平台选择）。 */
  platform?: AuthoringPlatform;
  onDocumentSaved: (document: AuthoringDocument) => void;
}) {
  const { doc } = props;
  const [internalPlatform, setInternalPlatform] = useState<AuthoringPlatform>('android');
  const platform = props.platform ?? internalPlatform;
  const setPlatform = (p: AuthoringPlatform) => setInternalPlatform(p);
  const [mode, setMode] = useState<Mode>('cards');
  const [view, setView] = useState<CardViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yamlDraft, setYamlDraft] = useState<string | null>(null);
  const [yamlError, setYamlError] = useState<string | null>(null);

  const variant = doc.variants[platform];

  const refresh = useCallback(() => {
    if (!variant) {
      setView(null);
      return;
    }
    api
      .getWorkflowCards(doc.id, platform)
      .then((result) => {
        setView(result);
        setError(null);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, [doc.id, platform, variant]);

  useEffect(refresh, [refresh]);
  useEffect(() => {
    setYamlDraft(variant?.workflow.yaml ?? null);
    setYamlError(null);
  }, [variant?.workflow.yaml, platform]);

  const applyEdit = async (
    edit: Parameters<typeof api.cardEdit>[1]['edit'],
  ) => {
    try {
      setError(null);
      const { document } = await api.cardEdit(doc.id, {
        platform,
        baseSaveVersion: props.baseSaveVersion,
        edit,
      });
      props.onDocumentSaved(document);
    } catch (reason) {
      setError(
        reason instanceof ApiError ? reason.message : String(reason),
      );
    }
  };

  const saveYaml = async () => {
    if (yamlDraft === null) return;
    setYamlError(null);
    try {
      const response = await api.putWorkflowYaml(doc.id, {
        platform,
        baseSaveVersion: props.baseSaveVersion,
        yaml: yamlDraft,
      });
      props.onDocumentSaved(response.document);
      if (!response.accepted && response.error) {
        setYamlError(
          `语法错误（第 ${response.error.line ?? '?'} 行，列 ${response.error.column ?? '?'}）：${response.error.message}。` +
            '当前编辑保留在未同步缓冲区，不会替换卡片视图对应的工作流，也无法确认导出。',
        );
      }
    } catch (reason) {
      setYamlError(reason instanceof ApiError ? reason.message : String(reason));
    }
  };

  if (!variant) {
    return html`
      <div class="panel">
        <p class="muted">请先在“生成与检查”中启用 ${platform === 'android' ? 'Android' : 'HarmonyOS'} 变体。</p>
      </div>
    `;
  }

  return html`
    <div class="panel">
      <div class="row">
        ${props.platform
          ? null
          : AUTHORING_PLATFORMS.map(
              (p) => html`
                <button
                  class=${platform === p ? 'tab active' : 'tab'}
                  onClick=${() => setPlatform(p)}
                >${p === 'android' ? 'Android' : 'HarmonyOS'}</button>
              `,
            )}
        <span class="spacer"></span>
        ${mode === 'cards'
          ? Badge({ tone: 'muted', text: `卡片（工作流 r${variant.workflow.revision}）` })
          : null}
        ${variant.needsUpdate
          ? Badge({ tone: 'warn', text: '业务已变化，待重新生成' })
          : null}
        ${variant.workflow.invalidYamlBuffer !== undefined
          ? Badge({ tone: 'err', text: 'YAML 未同步' })
          : null}
      </div>

      ${variant.workflow.invalidYamlBuffer !== undefined
        ? html`
            <p class="err">
              存在未通过解析的 YAML 编辑（视图未同步）。请在 YAML 视图中修正并保存；
              修正前不能确认或导出该平台工作流。
            </p>
          `
        : null}

      <div class="row tabs">
        <button class=${mode === 'cards' ? 'tab active' : 'tab'} onClick=${() => setMode('cards')}>步骤卡片</button>
        <button class=${mode === 'yaml' ? 'tab active' : 'tab'} onClick=${() => setMode('yaml')}>YAML</button>
        <button class=${mode === 'source' ? 'tab active' : 'tab'} onClick=${() => setMode('source')}>原文</button>
      </div>

      ${error ? html`<p class="err">${error}</p>` : null}

      ${mode === 'cards'
        ? view?.empty
          ? html`<p class="muted">工作流为空；请先在“平台与应用上下文”生成工作流，或直接在 YAML 视图编写。</p>`
          : view
            ? html`
                ${view.cards.map(
                  (card) => html`
                    <${CardItem}
                      key=${card.id}
                      card=${card}
                      doc=${doc}
                      onEdit=${applyEdit}
                    />
                  `,
                )}
                ${view.rawBlocks.length
                  ? html`
                      <fieldset class="fieldset">
                        <legend>原始块（超出卡片能力，保留原文）</legend>
                        ${view.rawBlocks.map(
                          (block) => html`
                            <div class="item-block" key=${block.id}>
                              <p class="warn">${block.reason}</p>
                              <pre class="excerpt">${block.text}</pre>
                            </div>
                          `,
                        )}
                        <p class="muted">原始块请在 YAML 视图中编辑；此处不会丢失或虚构卡片语义。</p>
                      </fieldset>
                    `
                  : null}
              `
            : html`<p class="muted">加载卡片…</p>`
        : null}

      ${mode === 'yaml'
        ? html`
            <textarea
              class="yaml-editor"
              rows="24"
              value=${yamlDraft ?? ''}
              onInput=${(event: Event) =>
                setYamlDraft((event.target as HTMLTextAreaElement).value)}
            ></textarea>
            <div class="row">
              <button class="primary" onClick=${saveYaml}>保存 YAML</button>
              <span class="muted">
                保存合法 YAML 会替换工作流并推进修订；语法错误会保留为未同步缓冲区。
              </span>
            </div>
            ${yamlError ? html`<p class="err">${yamlError}</p>` : null}
          `
        : null}

      ${mode === 'source'
        ? html`
            ${doc.cases.length === 0
              ? html`<p class="muted">文档中还没有业务用例。</p>`
              : doc.cases.map(
                  (caseItem) => html`
                    <fieldset class="fieldset" key=${caseItem.id}>
                      <legend>${caseItem.sourceId ? `${caseItem.sourceId} · ` : ''}${caseItem.name || caseItem.id}</legend>
                      <ol>
                        ${caseItem.actions.map(
                          (action, index) => html`<li key=${action.id}>${action.text}${action.mustPreserve ? `（必须保留：${action.mustPreserve}）` : ''}</li>`,
                        )}
                      </ol>
                      <ul>
                        ${caseItem.expectations.map(
                          (expectation) => html`
                            <li key=${expectation.id}>
                              ${expectation.text}
                              ${expectation.actionId
                                ? `（步骤 ${caseItem.actions.findIndex((a) => a.id === expectation.actionId) + 1}）`
                                : '（整条用例）'}
                            </li>
                          `,
                        )}
                      </ul>
                      ${caseItem.sourceRefs.map(
                        (ref, index) => html`
                          <details key=${index}>
                            <summary>来源原文（${ref.range ?? '无范围'}）</summary>
                            <pre class="excerpt">${ref.excerpt ?? ''}</pre>
                          </details>
                        `,
                      )}
                    </fieldset>
                  `,
                )}
          `
        : null}
    </div>
  `;
}

function CardItem(props: {
  card: NonNullable<CardViewData>['cards'][number];
  doc: AuthoringDocument;
  onEdit: (edit: Parameters<typeof api.cardEdit>[1]['edit']) => Promise<void>;
}) {
  const { card, doc } = props;
  const [jsonDrafts, setJsonDrafts] = useState<Record<number, string>>({});

  const actionText = card.actionId
    ? doc.cases
        .find((c) => c.id === card.caseName || true)
        ?.actions.find((a) => a.id === card.actionId)?.text
    : undefined;

  const inputEditor = (
    node: NonNullable<CardViewData>['cards'][number]['nodes'][number],
  ) => {
    const commit = (input: unknown) =>
      void props.onEdit({
        kind: 'updateInput',
        caseIndex: card.caseIndex,
        stepIndex: node.stepIndex,
        input,
      });

    if (typeof node.input === 'string') {
      return html`
        <${InlineTextInput}
          key=${node.stepIndex}
          value=${node.input}
          onCommit=${commit}
        />
      `;
    }
    const draft = jsonDrafts[node.stepIndex] ?? JSON.stringify(node.input, null, 2);
    return html`
      <div class="json-editor">
        <textarea
          rows="3"
          value=${draft}
          onInput=${(event: Event) =>
            setJsonDrafts((prev) => ({
              ...prev,
              [node.stepIndex]: (event.target as HTMLTextAreaElement).value,
            }))}
        ></textarea>
        <button
          onClick=${() => {
            try {
              commit(JSON.parse(draft));
            } catch {
              setJsonDrafts((prev) => ({ ...prev }));
            }
          }}
        >应用输入</button>
        <span class="muted">JSON 编辑；$ 元数据自动保留</span>
      </div>
    `;
  };

  return html`
    <fieldset class="fieldset">
      <legend>
        ${card.actionId
          ? `业务步骤 ${card.actionId}${actionText ? `：${actionText}` : ''}`
          : '独立步骤（准备/收尾）'}
      </legend>
      ${card.nodes.map((node) => html`
        <div class="item-block" key=${node.stepIndex}>
          <div class="row">
            ${Badge({ tone: 'muted', text: node.node })}
            <code class="muted">step ${node.stepIndex}</code>
            ${node.meta
              ? html`<code class="muted">$ ${JSON.stringify(node.meta)}</code>`
              : null}
            <span class="spacer"></span>
            <button
              onClick=${() =>
                void props.onEdit({
                  kind: 'delete',
                  caseIndex: card.caseIndex,
                  stepIndex: node.stepIndex,
                })}
            >删除</button>
          </div>
          ${inputEditor(node)}
        </div>
      `)}
      <${AddStepRow}
        caseIndex=${card.caseIndex}
        afterStepIndex=${card.nodes[card.nodes.length - 1]!.stepIndex}
        actionId=${card.actionId}
        onEdit=${props.onEdit}
      />
    </fieldset>
  `;
}

function AddStepRow(props: {
  caseIndex: number;
  afterStepIndex: number;
  actionId?: string;
  onEdit: (edit: Parameters<typeof api.cardEdit>[1]['edit']) => Promise<void>;
}) {
  const [node, setNode] = useState('');
  const [input, setInput] = useState('{}');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      setError('输入不是合法 JSON');
      return;
    }
    setError(null);
    void props
      .onEdit({
        kind: 'insert',
        caseIndex: props.caseIndex,
        afterStepIndex: props.afterStepIndex,
        node: node.trim(),
        input: parsed,
        actionId: props.actionId,
      })
      .then(() => {
        setNode('');
        setInput('{}');
      });
  };

  return html`
    <div class="row add-step">
      <input
        type="text"
        placeholder="节点名，如 aiAssert"
        value=${node}
        onInput=${(event: Event) => setNode((event.target as HTMLInputElement).value)}
      />
      <input
        type="text"
        class="json-input"
        placeholder='输入 JSON，如 "页面显示" 或 {"prompt": "..."}'
        value=${input}
        onInput=${(event: Event) => setInput((event.target as HTMLInputElement).value)}
      />
      <button disabled=${!node.trim()} onClick=${add}>在此后添加步骤</button>
      ${error ? html`<span class="err">${error}</span>` : null}
    </div>
  `;
}

function InlineTextInput(props: {
  value: string;
  onCommit: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  return html`
    <div class="row">
      <input
        type="text"
        value=${draft}
        onChange=${(event: Event) => {
          setDraft((event.target as HTMLInputElement).value);
        }}
      />
      <button disabled=${draft === props.value} onClick=${() => props.onCommit(draft)}>
        应用
      </button>
    </div>
  `;
}
