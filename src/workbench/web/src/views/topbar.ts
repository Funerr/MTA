import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { api, type DocumentSummary } from '../api';

/** 顶部导航：品牌、用例集选择与新建、生成模型状态。 */
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

  useEffect(() => {
    api
      .listDocuments()
      .then((result) => setDocuments(result.documents))
      .catch(() => setDocuments([]));
  }, [props.activeDocId]);

  useEffect(() => {
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
  }, []);

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
      <span class=${`badge ${modelLabel.tone}`}>${modelLabel.text}</span>
    </header>
  `;
}
