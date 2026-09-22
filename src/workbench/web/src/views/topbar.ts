import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type DocumentSummary } from '../api';
import { ModelConfigCard } from './platform-panel';

/** 顶部导航：品牌、用例集选择与新建；右侧模型状态徽标点开编写模型配置浮层。 */
export function Topbar(props: {
  activeDocId: string | null;
  onOpen: (id: string) => void;
  onHome: () => void;
}) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [modelLabel, setModelLabel] = useState<{ text: string; tone: 'ok' | 'warn' | '' }>({
    text: '',
    tone: '',
  });
  const [modelPanelOpen, setModelPanelOpen] = useState(false);
  const modelPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api
      .listDocuments()
      .then((result) => setDocuments(result.documents))
      .catch(() => setDocuments([]));
  }, [props.activeDocId]);

  const refreshModelLabel = () =>
    api
      .getModelConfig()
      .then((config) => {
        if (config.effective) {
          setModelLabel({
            text: `生成模型 ${config.effective.model}`,
            tone: 'ok',
          });
        } else {
          setModelLabel({ text: '生成模型未配置', tone: 'warn' });
        }
      })
      .catch(() => setModelLabel({ text: '生成模型未配置', tone: 'warn' }));

  useEffect(() => {
    refreshModelLabel();
  }, []);

  // 浮层打开期间：点到浮层外或按 Esc 关闭。
  useEffect(() => {
    if (!modelPanelOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        modelPanelRef.current &&
        event.target instanceof Node &&
        !modelPanelRef.current.contains(event.target)
      ) {
        setModelPanelOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModelPanelOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [modelPanelOpen]);

  const create = () => {
    api
      .createDocument('未命名用例集')
      .then((result) => props.onOpen(result.document.id))
      .catch(() => undefined);
  };

  return html`
    <header class="topbar">
      <span class="brand" style="cursor:pointer" onClick=${props.onHome}>
        MTA 用例工作台
      </span>
      <span class="topbar-sep"></span>
      <select
        class="doc-select"
        value=${props.activeDocId ?? ''}
        onChange=${(event: Event) => {
          const id = (event.target as HTMLSelectElement).value;
          if (id) props.onOpen(id);
          else props.onHome();
        }}
      >
        <option value="">选择用例集…</option>
        ${documents.map(
          (doc) => html`
            <option value=${doc.id} selected=${doc.id === props.activeDocId}>
              ${doc.name}（${doc.caseCount} 例）
            </option>
          `,
        )}
      </select>
      <button class="small" onClick=${create} title="新建用例集">＋ 新建</button>
      <span class="spacer"></span>
      <div class="popover-wrap" ref=${modelPanelRef}>
        <button
          class=${`badge badge-button ${modelLabel.tone || 'muted'}`}
          aria-expanded=${modelPanelOpen}
          aria-haspopup="dialog"
          title="配置生成模型"
          onClick=${() => setModelPanelOpen((open) => !open)}
        >${modelLabel.text}</button>
        ${modelPanelOpen
          ? html`<div class="popover model-config" role="dialog" aria-label="生成模型配置">
              <${ModelConfigCard} onConfigured=${refreshModelLabel} />
            </div>`
          : null}
      </div>
    </header>
  `;
}
