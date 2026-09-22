import { html } from 'htm/preact';
import { useEffect, useMemo, useState, useRef } from 'preact/hooks';
import { api, ApiError } from '../api';
import {
  allocateStableId,
  CASE_LEVELS,
  describeCaseGaps,
  touchBusiness,
  touchWorkflow,
  type AuthoringDocument,
  type AuthoringPlatform,
  type BusinessCase,
  type CaseLevel,
  type Expectation,
  type PlatformWorkflowVariant,
} from '../../../core/document';
import { Badge, Field, Select, TextArea, TextInput } from '../ui';
import { ImportPanel } from './import-panel';
import { PlatformSection } from './platform-panel';
import { DeliverySection, VerificationPanel } from './verification-panel';
import { WorkflowPanel } from './workflow-panel';

type SaveState = 'clean' | 'dirty' | 'saving' | 'error' | 'conflict';

/**
 * 跨标签页保存广播：同一用例集被多个标签页打开时，干净的一方自动
 * 采纳最新版本，避免下一次保存出现虚假的版本冲突；脏编辑区不被动覆盖。
 */
const docSyncChannel: BroadcastChannel | null = (() => {
  try {
    return new BroadcastChannel('mta-workbench-doc');
  } catch {
    return null;
  }
})();

const LEVEL_OPTIONS = CASE_LEVELS.map((level) => ({
  value: level,
  label: level,
}));

const EVIDENCE_OPTIONS = [
  { value: 'visual', label: '界面可见' },
  { value: 'state-change', label: '状态变化' },
  { value: 'shell', label: 'Shell 命令' },
  { value: 'report', label: '执行报告' },
  { value: 'unverified', label: '证据路径未定' },
] as const;

/**
 * 单页工作台：录入/导入 → 生成与检查 → 工作流编辑 → 设备核查 → 确认导出
 * 顶部阶段导航切换工作区；面板保持挂载以保留草稿和任务状态，平台选择对 2-5 阶段生效。
 */
export function EditorView(props: { docId: string; onOpen: (id: string) => void }) {
  const [doc, setDoc] = useState<AuthoringDocument | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('clean');
  const [message, setMessage] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<string | null>(null);
  const [platform, setPlatform] = useState<AuthoringPlatform>('android');
  const dirty = useRef(false);
  const [activeStage, setActiveStage] = useState('sec-cases');
  const [caseSearch, setCaseSearch] = useState('');

  useEffect(() => {
    api
      .getDocument(props.docId)
      .then(({ document }) => {
        setDoc(document);
        setBaseVersion(document.saveVersion);
        setSelectedCase(document.cases[0]?.id ?? null);
        if (document.variants.android) setPlatform('android');
        else if (document.variants.harmony) setPlatform('harmony');
      })
      .catch((reason: unknown) =>
        setMessage(reason instanceof Error ? reason.message : String(reason)),
      );
  }, [props.docId]);

  // 其他标签页保存后：干净状态自动采纳最新文档；脏编辑区保持不动。
  useEffect(() => {
    if (!docSyncChannel) return;
    const onSync = (event: MessageEvent) => {
      const data = event.data as { type?: string; id?: string };
      if (data?.type !== 'saved' || data.id !== props.docId) return;
      if (dirty.current) return;
      api
        .getDocument(props.docId)
        .then(({ document }) => {
          if (!dirty.current) applySaved(document);
        })
        .catch(() => undefined);
    };
    docSyncChannel.addEventListener('message', onSync);
    return () => docSyncChannel!.removeEventListener('message', onSync);
  }, [props.docId]);

  const applySaved = (saved: AuthoringDocument) => {
    dirty.current = false;
    setDoc(saved);
    setBaseVersion(saved.saveVersion);
    setSaveState('clean');
    setMessage(null);
  };

  const guardDirty = () => {
    if (dirty.current) {
      setMessage('已有未保存的人工修改，后台结果未覆盖编辑区；请保存或刷新后处理。');
      return true;
    }
    return false;
  };

  const mutate = (mutator: (draft: AuthoringDocument) => void) => {
    setDoc((current) => {
      if (!current) return current;
      const draft = structuredClone(current);
      mutator(draft);
      return draft;
    });
    dirty.current = true;
    setSaveState('dirty');
  };

  const mutateBusiness = (mutator: (draft: AuthoringDocument) => void) => {
    mutate((draft) => {
      mutator(draft);
      touchBusiness(draft);
    });
  };

  const mutateVariant = (
    target: AuthoringPlatform,
    mutator: (variant: PlatformWorkflowVariant) => void,
  ) => {
    mutate((draft) => {
      const variant = draft.variants[target];
      if (!variant) return;
      mutator(variant);
      touchWorkflow(variant);
    });
  };

  const save = async (): Promise<AuthoringDocument | null> => {
    if (!doc || saveState === 'saving') return null;
    setSaveState('saving');
    const attempt = async (base: number) => {
      const { document: saved } = await api.saveDocument(doc, base);
      applySaved(saved);
      docSyncChannel?.postMessage({ type: 'saved', id: saved.id });
      return saved;
    };
    try {
      return await attempt(baseVersion);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        // 单人工作台：多标签页互顶时拉取最新版本号，基于最新基线重试一次，
        // 不再要求用户手动去侧边栏重新打开。
        try {
          const { document: latest } = await api.getDocument(doc.id);
          const saved = await attempt(latest.saveVersion);
          setMessage('检测到其他会话的修改，已基于最新版本保存本次内容。');
          return saved;
        } catch {
          setSaveState('conflict');
          setMessage('文档已被其他会话修改且自动重试失败；请从侧边栏重新打开本文档。');
          return null;
        }
      }
      setSaveState('error');
      setMessage(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
  };

  /**
   * 服务端生成/核查/确认等操作读取的是已落盘文档；执行前确保本地
   * 修改已保存，返回可直接用于 baseSaveVersion 的最新文档。
   */
  const ensureSaved = async (): Promise<AuthoringDocument | null> => {
    if (!doc) return null;
    if (!dirty.current) return doc;
    return save();
  };

  if (!doc) {
    return html`
      <main class="workspace">
        <div class="card empty-state"><span class="empty-symbol">◇</span><h2>${message ? '无法打开用例集' : '正在加载用例集'}</h2><p class="muted">${message ?? '请稍候…'}</p>${message ? html`<p class="muted">从左侧选择已有用例集，或创建新的用例集。</p><a href="#/">返回工作空间 →</a>` : null}</div>
      </main>
    `;
  }

  const currentCase =
    doc.cases.find((c) => c.id === selectedCase) ?? doc.cases[0] ?? null;
  const variant = doc.variants[platform];
  const openIssues = doc.issues.filter((issue) => !issue.resolvedAt);

  // 阶段状态（导航圆点）
  const caseGaps = doc.cases.some((c) => describeCaseGaps(c).length > 0);
  const stageCase: 'ok' | 'warn' | 'idle' =
    doc.cases.length === 0 ? 'idle' : caseGaps || openIssues.length ? 'warn' : 'ok';
  const stageWorkflow: 'ok' | 'warn' | 'err' | 'idle' =
    !variant || !variant.workflow.yaml.trim()
      ? 'idle'
      : variant.needsUpdate || variant.workflow.invalidYamlBuffer !== undefined
        ? 'warn'
        : 'ok';
  const stageCheck: 'ok' | 'err' | 'idle' = !variant?.validation
    ? 'idle'
    : variant.validation.allPassed
      ? 'ok'
      : 'err';
  const evidenceValid = variant?.evidence.filter((record) => record.status === 'observed-pass').length ?? 0;
  const stageVerify: 'ok' | 'idle' = evidenceValid > 0 ? 'ok' : 'idle';
  const stageDelivery: 'ok' | 'idle' = variant?.confirm.status === 'confirmed' ? 'ok' : 'idle';

  const scrollTo = (id: string) => {
    setActiveStage(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const stageNav = [
    { id: 'sec-cases', no: 1, label: '用例与导入', state: stageCase },
    { id: 'sec-workflow', no: 2, label: '生成与检查', state: stageCheck === 'err' ? 'err' : stageWorkflow },
    { id: 'sec-edit', no: 3, label: '工作流编辑', state: 'idle' as const },
    { id: 'sec-verify', no: 4, label: '设备核查', state: stageVerify },
    { id: 'sec-delivery', no: 5, label: '确认导出', state: stageDelivery },
  ];

  return html`
    <main class="workspace editor-workspace">
      <div class="breadcrumb">工作空间 <span>/</span> 用例集 <span>/</span> <b>${doc.name}</b></div>
      <header class="workspace-header">
        <div class="document-heading"><span class="eyebrow">CASE WORKSPACE</span><input type="text" class="title" aria-label="用例集名称" value=${doc.name} onInput=${(event: Event) => mutate((d) => (d.name = (event.target as HTMLInputElement).value))} /></div>
        <span class="header-meta">业务 r${doc.businessRevision} · v${doc.saveVersion}</span>
        ${saveState === 'clean' ? Badge({ tone: 'ok', text: '已保存' }) : null}
        ${saveState === 'dirty' ? Badge({ tone: 'warn', text: '未保存' }) : null}
        ${saveState === 'saving' ? Badge({ tone: 'muted', text: '保存中' }) : null}
        ${saveState === 'error' ? Badge({ tone: 'err', text: '保存失败' }) : null}
        ${saveState === 'conflict' ? Badge({ tone: 'err', text: '版本冲突' }) : null}
        <span class="spacer"></span>
        <button
          class="primary"
          disabled=${saveState === 'saving' || saveState === 'clean'}
          onClick=${save}
        >保存</button>
      </header>

      <div class="workspace-context"><span><b>${doc.cases.length}</b> 条用例 <span class="context-divider">/</span> ${openIssues.length} 项待澄清</span><div class="row"><span class="muted">目标平台</span><div class="segmented">${(['android', 'harmony'] as const).map((p) => html`<button aria-pressed=${platform === p} class=${platform === p ? 'active' : ''} onClick=${() => setPlatform(p)}>${p === 'android' ? 'Android' : 'HarmonyOS'}</button>`)}</div></div></div>
      <nav class="stepper" aria-label="编写阶段">
        ${stageNav.map(
          (stage, index) => html`

            <button class=${`step-pill ${activeStage === stage.id ? 'active' : ''}`} aria-current=${activeStage === stage.id ? 'step' : undefined} onClick=${() => scrollTo(stage.id)}>
              <span class=${`step-dot ${stage.state}`}>${stage.no}</span>
              ${stage.label}
            </button>
          `,
        )}
        ${message
          ? html`<span class=${saveState === 'conflict' || saveState === 'error' ? 'err' : 'muted'} style="margin-left:10px;font-size:12.5px">${message}</span>`
          : null}
      </nav>

      <!-- ① 用例与导入 -->
      <section id="sec-cases" class="section" hidden=${activeStage !== 'sec-cases'}>
        <div class="section-head">
          <span class="section-no">1</span>
          <h2>用例与导入</h2>
          <span class="section-desc">手写或导入，导入内容可预览后再应用。</span>
          <button
            class="primary small"
            onClick=${() =>
              mutateBusiness((draft) => {
                const id = allocateStableId('case', draft.cases.map((c) => c.id));
                draft.cases.push({
                  id,
                  sourceId: '',
                  name: '',
                  goal: '',
                  level: 'level2',
                  preconditions: [],
                  noPreconditionsDeclared: false,
                  actions: [],
                  expectations: [],
                  sourceRefs: [],
                  status: 'draft',
                });
                setSelectedCase(id);
              })}
          >＋ 用例</button>
        </div>
        <${ImportPanel}
          docId=${doc.id}
          baseSaveVersion=${baseVersion}
          onImported=${(saved: AuthoringDocument) => {
            if (guardDirty()) return;
            applySaved(saved);
          }}
        />
        <div class="split">
          <div class="card case-library"><div class="library-heading"><b>用例列表</b><span class="badge">${doc.cases.length}</span></div><input type="text" class="case-search" aria-label="搜索用例" placeholder="搜索名称或编号…" value=${caseSearch} onInput=${(event: Event) => setCaseSearch((event.target as HTMLInputElement).value)} />
            ${doc.cases.length > 0 && !doc.cases.some((c) => `${c.sourceId} ${c.name}`.toLowerCase().includes(caseSearch.toLowerCase())) ? html`<p class="doc-empty muted">没有匹配的用例</p>` : null}
            ${doc.cases.length === 0
              ? html`<p class="muted" style="padding:6px 8px">尚无用例。</p>`
              : doc.cases.filter((c) => `${c.sourceId} ${c.name}`.toLowerCase().includes(caseSearch.toLowerCase())).map(
                  (caseItem) => html`
                    <div
                      key=${caseItem.id}
                      class=${`case-list-item${currentCase?.id === caseItem.id ? ' active' : ''}`}
                      onClick=${() => setSelectedCase(caseItem.id)}
                    >
                      <button class="case-select" aria-pressed=${currentCase?.id === caseItem.id} onClick=${() => setSelectedCase(caseItem.id)}>
                        ${caseItem.sourceId ? `${caseItem.sourceId} · ` : ''}${caseItem.name || `（未命名 ${caseItem.id}）`}
                      </button>
                      ${describeCaseGaps(caseItem).length > 0
                        ? Badge({ tone: 'warn', text: '待补全' })
                        : null}
                      <button
                        class="link-button"
                        onClick=${(event: MouseEvent) => {
                          event.stopPropagation();
                          mutateBusiness((draft) => {
                            draft.cases = draft.cases.filter((c) => c.id !== caseItem.id);
                            if (selectedCase === caseItem.id) {
                              setSelectedCase(draft.cases[0]?.id ?? null);
                            }
                          });
                        }}
                      >删除</button>
                    </div>
                  `,
                )}
          </div>
          <div>
            ${currentCase
              ? html`
                  <${CaseForm}
                    key=${currentCase.id}
                    doc=${doc}
                    caseItem=${currentCase}
                    onMutate=${mutateBusiness}
                  />
                `
              : html`<div class="card"><p class="muted">新增或导入一条用例开始。</p></div>`}
          </div>
        </div>
        ${currentCase
          ? html`<${IssuesPanel}
              doc=${doc}
              caseId=${currentCase.id}
              baseSaveVersion=${baseVersion}
              onDocumentSaved=${(saved: AuthoringDocument) => {
                if (guardDirty()) return;
                applySaved(saved);
              }}
            />`
          : null}
      </section>

      <!-- ② 生成与检查 -->
      <section id="sec-workflow" class="section" hidden=${activeStage !== 'sec-workflow'}>
        <div class="section-head">
          <span class="section-no">2</span>
          <h2>生成与检查</h2>
          <span class="section-desc">生成平台工作流并分层检查</span>

        </div>
        <${PlatformSection}
          key=${platform}
          platform=${platform}
          doc=${doc}
          baseSaveVersion=${baseVersion}
          onMutateBusiness=${mutateBusiness}
          onMutateVariant=${mutateVariant}
          onEnsureSaved=${ensureSaved}
          onDocumentSaved=${(saved: AuthoringDocument) => {
            if (guardDirty()) return;
            applySaved(saved);
          }}
        />
      </section>

      <!-- ③ 工作流编辑 -->
      <section id="sec-edit" class="section" hidden=${activeStage !== 'sec-edit'}>
        <div class="section-head">
          <span class="section-no">3</span>
          <h2>工作流编辑</h2>
          <span class="section-desc">步骤卡片 / YAML / 原文三种视图</span>
        </div>
        <${WorkflowPanel}
          doc=${doc}
          baseSaveVersion=${baseVersion}
          platform=${platform}
          onDocumentSaved=${(saved: AuthoringDocument) => {
            if (guardDirty()) return;
            applySaved(saved);
          }}
        />
      </section>

      <!-- ④ 设备核查 -->
      <section id="sec-verify" class="section" hidden=${activeStage !== 'sec-verify'}>
        <div class="section-head">
          <span class="section-no">4</span>
          <h2>设备核查</h2>
          <span class="section-desc">绑定设备核查关键页面，证据可追溯</span>
        </div>
        <${VerificationPanel}
          doc=${doc}
          platform=${platform}
          onEnsureSaved=${ensureSaved}
          onDocumentSaved=${(saved: AuthoringDocument) => {
            if (guardDirty()) return;
            applySaved(saved);
          }}
        />
      </section>

      <!-- ⑤ 确认导出 -->
      <section id="sec-delivery" class="section" hidden=${activeStage !== 'sec-delivery'}>
        <div class="section-head">
          <span class="section-no">5</span>
          <h2>确认与导出</h2>
          <span class="section-desc">确认修订并导出就绪用例</span>
        </div>
        <${DeliverySection}
          doc=${doc}
          platform=${platform}
          onEnsureSaved=${ensureSaved}
          onDocumentSaved=${(saved: AuthoringDocument) => {
            if (guardDirty()) return;
            applySaved(saved);
          }}
        />
      </section>
      <footer class="stage-footer"><span class="muted">步骤 ${stageNav.findIndex((s) => s.id === activeStage) + 1} / 5 · ${stageNav.find((s) => s.id === activeStage)?.label}</span><div class="row"><button disabled=${activeStage === 'sec-cases'} onClick=${() => scrollTo(stageNav[stageNav.findIndex((s) => s.id === activeStage) - 1]!.id)}>上一步</button><button class="primary" disabled=${activeStage === 'sec-delivery'} onClick=${() => scrollTo(stageNav[stageNav.findIndex((s) => s.id === activeStage) + 1]!.id)}>下一步 →</button></div></footer>
    </main>
  `;
}

function CaseForm(props: {
  doc: AuthoringDocument;
  caseItem: BusinessCase;
  onMutate: (mutator: (draft: AuthoringDocument) => void) => void;
}) {
  const { caseItem, onMutate } = props;
  const gaps = useMemo(() => describeCaseGaps(caseItem), [caseItem]);
  const gapOf = (field: string) => gaps.find((g) => g.field === field)?.message;

  const allStableIds = useMemo(
    () =>
      props.doc.cases.flatMap((c) => [
        c.id,
        ...c.preconditions.map((p) => p.id),
        ...c.actions.map((a) => a.id),
        ...c.expectations.map((e) => e.id),
      ]),
    [props.doc],
  );

  const withCase = (mutator: (draft: BusinessCase) => void) =>
    onMutate((draft) => {
      const target = draft.cases.find((c) => c.id === caseItem.id);
      if (target) mutator(target);
    });

  const stepExpectations = (actionId: string) =>
    caseItem.expectations.filter((e) => e.actionId === actionId);
  const caseLevelExpectations = caseItem.expectations.filter((e) => !e.actionId);

  const addExpectation = (actionId?: string) =>
    withCase((c) =>
      c.expectations.push({
        id: allocateStableId('exp', allStableIds),
        text: '',
        actionId,
        evidenceKind: 'unverified',
      }),
    );

  const removeExpectation = (id: string) =>
    withCase(
      (c) => (c.expectations = c.expectations.filter((e) => e.id !== id)),
    );

  const ExpectationRow = (expectation: Expectation) => html`
    <div class="exp-row" key=${expectation.id}>
      <span class="exp-mark">✓</span>
      <${TextInput}
        value=${expectation.text}
        placeholder="预期结果"
        onInput=${(value: string) =>
          withCase((c) => {
            const target = c.expectations.find((e) => e.id === expectation.id);
            if (target) target.text = value;
          })}
      />
      <select
        class="exp-select"
        value=${expectation.evidenceKind}
        onChange=${(event: Event) =>
          withCase((c) => {
            const target = c.expectations.find((e) => e.id === expectation.id);
            if (target)
              target.evidenceKind = (event.target as HTMLSelectElement)
                .value as Expectation['evidenceKind'];
          })}
      >
        ${EVIDENCE_OPTIONS.map(
          (option) => html`<option value=${option.value}>${option.label}</option>`,
        )}
      </select>
      <button class="small ghost danger" aria-label="删除预期" onClick=${() => removeExpectation(expectation.id)}>×</button>
    </div>
  `;

  return html`
    <div class="card case-form">
      <div class="row" style="flex-wrap:nowrap">
        <input
          type="text"
          class="grow"
          style="flex:1;font-size:15px;font-weight:600"
          aria-label="用例名称"
          placeholder="用例名称"
          value=${caseItem.name}
          onInput=${(event: Event) => withCase((c) => (c.name = (event.target as HTMLInputElement).value))}
        />
        <select
          style="width:auto"
          value=${caseItem.level}
          onChange=${(event: Event) =>
            withCase((c) => (c.level = (event.target as HTMLSelectElement).value as CaseLevel))}
        >
          ${LEVEL_OPTIONS.map((option) => html`<option value=${option.value}>${option.label}</option>`)}
        </select>
      </div>
      ${gapOf('name') ? html`<p class="warn">${gapOf('name')}</p>` : null}
      ${gapOf('goal') || gapOf('actions') || gapOf('expectations')
        ? html`<p class="warn">还需补全：${[gapOf('goal'), gapOf('actions'), gapOf('expectations')].filter(Boolean).join('；')}</p>`
        : null}

      <p class="field-label" style="margin:14px 0 4px">步骤与预期</p>
      ${caseItem.actions.map(
        (action, index) => html`
          <div class="step-card" key=${action.id}>
            <div class="row" style="flex-wrap:nowrap">
              <span class="step-no">${index + 1}.</span>
              <${TextInput}
                value=${action.text}
                placeholder="如：打开系统设置"
                onInput=${(value: string) =>
                  withCase((c) => {
                    const target = c.actions.find((a) => a.id === action.id);
                    if (target) target.text = value;
                  })}
              />
              <button class="small ghost" aria-label="上移步骤" disabled=${index === 0}
                onClick=${() =>
                  withCase((c) => {
                    const i = c.actions.findIndex((a) => a.id === action.id);
                    if (i > 0) {
                      const [item] = c.actions.splice(i, 1);
                      c.actions.splice(i - 1, 0, item!);
                    }
                  })}
              >↑</button>
              <button class="small ghost" aria-label="下移步骤" disabled=${index === caseItem.actions.length - 1}
                onClick=${() =>
                  withCase((c) => {
                    const i = c.actions.findIndex((a) => a.id === action.id);
                    if (i >= 0 && i < c.actions.length - 1) {
                      const [item] = c.actions.splice(i, 1);
                      c.actions.splice(i + 1, 0, item!);
                    }
                  })}
              >↓</button>
              <button class="small ghost danger"
                onClick=${() =>
                  withCase(
                    (c) => {
                      c.actions = c.actions.filter((a) => a.id !== action.id);
                      c.expectations = c.expectations.filter(
                        (e) => e.actionId !== action.id,
                      );
                    },
                  )}
              >删除</button>
            </div>
            ${gapOf(`actions/${action.id}`)
              ? html`<p class="warn">${gapOf(`actions/${action.id}`)}</p>`
              : null}
            <div class="exp-list">
              ${stepExpectations(action.id).map(ExpectationRow)}
              <button class="small ghost" onClick=${() => addExpectation(action.id)}>+ 预期</button>
            </div>
            <details>
              <summary>交互约束</summary>
              <div class="grid-2">
                <${Field} label="必须保留的交互">
                  <${TextInput}
                    value=${action.mustPreserve ?? ''}
                    placeholder="如：长按 2 秒"
                    onInput=${(value: string) =>
                      withCase((c) => {
                        const target = c.actions.find((a) => a.id === action.id);
                        if (target) target.mustPreserve = value || undefined;
                      })}
                  />
                <//>
                <${Field} label="允许的 UI 适配">
                  <${TextInput}
                    value=${action.allowedAdaptation ?? ''}
                    placeholder="可选"
                    onInput=${(value: string) =>
                      withCase((c) => {
                        const target = c.actions.find((a) => a.id === action.id);
                        if (target) target.allowedAdaptation = value || undefined;
                      })}
                  />
                <//>
              </div>
            </details>
          </div>
        `,
      )}
      ${gapOf('preconditions')
        ? html`<p class="warn">${gapOf('preconditions')}</p>`
        : null}
      <button
        onClick=${() =>
          withCase((c) =>
            c.actions.push({ id: allocateStableId('act', allStableIds), text: '' }),
          )}
      >+ 添加步骤</button>

      <p class="field-label" style="margin:14px 0 4px">整条用例的预期（可选）</p>
      <div class="exp-list">
        ${caseLevelExpectations.map(ExpectationRow)}
        <button class="small ghost" onClick=${() => addExpectation(undefined)}>+ 预期</button>
      </div>

      <details open=${!!gapOf('goal') || !!gapOf('preconditions')} style="margin-top:14px">
        <summary><b>用例背景</b>（目的 / 前置条件 / 测试数据）</summary>
        <div class="grid-2" style="margin-top:8px">
          <${Field} label="用例编号（原编号，可空/可重复）">
            <${TextInput}
              value=${caseItem.sourceId}
              placeholder="如 TC-001"
              onInput=${(value: string) => withCase((c) => (c.sourceId = value))}
            />
          <//>
          <${Field} label="测试目的">
            <${TextInput}
              value=${caseItem.goal}
              placeholder="这条用例要验证什么"
              onInput=${(value: string) => withCase((c) => (c.goal = value))}
            />
          <//>
        </div>
        <${Field} label="测试数据">
          <${TextArea}
            value=${caseItem.data ?? ''}
            placeholder="可选，如：已登录账号"
            onInput=${(value: string) => withCase((c) => (c.data = value))}
          />
        <//>
        <${Field} label="设备角色">
          <${TextInput}
            value=${caseItem.deviceRoles ?? ''}
            placeholder="可选"
            onInput=${(value: string) => withCase((c) => (c.deviceRoles = value))}
          />
        <//>
        <fieldset class="fieldset">
          <legend>前置条件</legend>
          <label class="check" for=${`no-precond-${caseItem.id}`}>
            <input
              type="checkbox"
              id=${`no-precond-${caseItem.id}`}
              name="noPreconditionsDeclared"
              checked=${caseItem.noPreconditionsDeclared}
              onChange=${(event: Event) =>
                withCase(
                  (c) =>
                    (c.noPreconditionsDeclared = (event.target as HTMLInputElement).checked),
                )}
            />
            声明无前置条件
          </label>
          ${caseItem.preconditions.map(
            (pre) => html`
              <div class="row item-row" key=${pre.id}>
                <${TextInput}
                  value=${pre.text}
                  placeholder="前置条件描述"
                  onInput=${(value: string) =>
                    withCase((c) => {
                      const target = c.preconditions.find((p) => p.id === pre.id);
                      if (target) target.text = value;
                    })}
                />
                <${Select}
                  value=${pre.satisfaction}
                  options=${[
                    { value: 'external', label: '外部条件' },
                    { value: 'workflow', label: '需要准备步骤' },
                  ]}
                  onChange=${(value: string) =>
                    withCase((c) => {
                      const target = c.preconditions.find((p) => p.id === pre.id);
                      if (target)
                        target.satisfaction = value as 'external' | 'workflow';
                    })}
                />
                <button class="small danger"
                  onClick=${() =>
                    withCase(
                      (c) =>
                        (c.preconditions = c.preconditions.filter(
                          (p) => p.id !== pre.id,
                        )),
                    )}
                >删除</button>
              </div>
            `,
          )}
          <button
            onClick=${() =>
              withCase((c) =>
                c.preconditions.push({
                  id: allocateStableId('pre', allStableIds),
                  text: '',
                  satisfaction: 'external',
                }),
              )}
          >添加前置条件</button>
        </fieldset>
      </details>
    </div>
  `;
}

function IssuesPanel(props: {
  doc: AuthoringDocument;
  caseId: string;
  baseSaveVersion: number;
  onDocumentSaved: (document: AuthoringDocument) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const resolve = async (issueId: string) => {
    try {
      const { document } = await api.resolveIssue(props.doc.id, issueId, {
        baseSaveVersion: props.baseSaveVersion,
      });
      props.onDocumentSaved(document);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const open = props.doc.issues.filter(
    (issue) => !issue.resolvedAt && (!issue.caseId || issue.caseId === props.caseId),
  );
  if (open.length === 0) return null;
  return html`
    <div class="card">
      <h3>问题与待澄清 <span class="badge badge-warn">${open.length} 项未解决</span></h3>
      ${error ? html`<p class="err">${error}</p>` : null}
      ${open.map(
        (issue) => html`
          <div class="item-block" key=${issue.id}>
            <div class="row">
              ${issue.caseId ? Badge({ tone: 'warn', text: issue.caseId }) : Badge({ tone: 'muted', text: '全局' })}
              <span style="flex:1;min-width:0">${issue.message}</span>
              <button class="small primary" onClick=${() => void resolve(issue.id)}>标记已解决</button>
            </div>
            ${issue.needed ? html`<p class="muted">需要：${issue.needed}</p>` : null}
          </div>
        `,
      )}
      ${props.doc.issues.filter((issue) => issue.resolvedAt).length
        ? html`
            <details>
              <summary>已解决（${props.doc.issues.filter((issue) => issue.resolvedAt).length}）</summary>
              ${props.doc.issues
                .filter((issue) => issue.resolvedAt)
                .map(
                  (issue) => html`
                    <p class="muted" key=${issue.id}>
                      ✓ ${issue.message} —— ${issue.resolution ?? ''}
                    </p>
                  `,
                )}
            </details>
          `
        : null}
      <p class="muted">未解决问题会阻止用例就绪与确认；解决后重新运行静态检查。</p>
    </div>
  `;
}
