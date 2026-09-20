import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { api, type DocumentSummary } from '../api';

export function DocumentsView(props: { onOpen: (id: string) => void }) {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const refresh = () => {
    api
      .listDocuments()
      .then((result) => setDocuments(result.documents))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  };

  useEffect(refresh, []);

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    api
      .createDocument(name)
      .then((result) => props.onOpen(result.document.id))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  };

  const remove = (id: string) => {
    if (!confirm('确定删除该编写文档？此操作不可恢复。')) return;
    api.deleteDocument(id).then(refresh).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  return html`
    <main class="page">
      <section class="panel">
        <h2>编写文档</h2>
        ${error ? html`<p class="err">${error}</p>` : null}
        <div class="row">
          <input
            type="text"
            placeholder="新文档名称，如：设置模块用例"
            value=${newName}
            onInput=${(event: Event) =>
              setNewName((event.target as HTMLInputElement).value)}
          />
          <button class="primary" onClick=${create}>新建文档</button>
        </div>
        ${documents === null
          ? html`<p class="muted">加载中…</p>`
          : documents.length === 0
            ? html`<p class="muted">还没有编写文档。新建一个开始录入用例。</p>`
            : html`
                <table class="list-table">
                  <thead>
                    <tr>
                      <th>名称</th><th>用例数</th><th>平台</th><th>更新时间</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${documents.map(
                      (doc) => html`
                        <tr key=${doc.id}>
                          <td>
                            <a
                              href="#"
                              onClick=${(event: MouseEvent) => {
                                event.preventDefault();
                                props.onOpen(doc.id);
                              }}
                            >${doc.name}</a>
                          </td>
                          <td>${doc.caseCount}</td>
                          <td>${doc.platforms.join(' / ') || '—'}</td>
                          <td class="muted">${doc.updatedAt.slice(0, 19).replace('T', ' ')}</td>
                          <td>
                            <button onClick=${() => remove(doc.id)}>删除</button>
                          </td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              `}
      </section>
    </main>
  `;
}
