import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { api, type ImportParseResultView } from '../api';
import { Badge } from '../ui';

type ImportKind = 'paste' | 'markdown' | 'text' | 'excel';

const KIND_OPTIONS: { value: ImportKind; label: string }[] = [
  { value: 'paste', label: '粘贴文本' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: '纯文本' },
  { value: 'excel', label: 'Excel (.xlsx)' },
];

/** 紧凑导入卡：默认展开，类型 + 内容 + 两个动作，解析结果单行摘要可展开。 */
export function ImportPanel(props: {
  docId: string;
  baseSaveVersion: number;
  onImported: (document: unknown) => void;
}) {
  const [kind, setKind] = useState<ImportKind>('paste');
  const [content, setContent] = useState('');
  const [base64, setBase64] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportParseResultView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);

  const payload = () =>
    kind === 'excel' ? { kind, contentBase64: base64 } : { kind, content };
  const hasContent = kind === 'excel' ? Boolean(base64) : content.trim().length > 0;

  const runPreview = () => {
    if (!hasContent) return;
    setBusy(true);
    setError(null);
    api
      .previewImport(payload())
      .then(({ result }) => setPreview(result))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setBusy(false));
  };

  const apply = () => {
    if (!hasContent) return;
    setBusy(true);
    setError(null);
    api
      .applyImport(props.docId, {
        ...payload(),
        name: fileName.trim() || undefined,
        baseSaveVersion: props.baseSaveVersion,
      })
      .then((response) => {
        setPreview(null);
        setContent('');
        setBase64('');
        setFileName('');
        setReport(
          `已导入 ${response.report.addedCases} 条用例、问题 ${response.report.addedIssues} 条、未转换 ${response.report.unconverted} 段`,
        );
        props.onImported(response.document);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setBusy(false));
  };

  const readFile = (file: File) => {
    setFileName(file.name);
    setPreview(null);
    if (file.name.match(/\.xlsx$/i)) {
      setKind('excel');
      setContent('');
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? '');
        setBase64(text.slice(text.indexOf(',') + 1));
      };
      reader.readAsDataURL(file);
      return;
    }
    setKind(file.name.match(/\.md|\.markdown$/i) ? 'markdown' : 'text');
    setBase64('');
    const reader = new FileReader();
    reader.onload = () => setContent(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  return html`
    <div class="card import-card">
      <div class="row" style="flex-wrap:nowrap">
        <select
          style="width:auto"
          value=${kind}
          onChange=${(event: Event) => {
            setKind((event.target as HTMLSelectElement).value as ImportKind);
            setPreview(null);
          }}
        >
          ${KIND_OPTIONS.map(
            (option) => html`<option value=${option.value}>${option.label}</option>`,
          )}
        </select>
        <input type="file" accept=".md,.txt,.markdown,.xlsx" onChange=${(event: Event) => {
          const file = (event.target as HTMLInputElement).files?.[0];
          if (file) readFile(file);
        }} />
        ${kind === 'excel'
          ? html`<span class="muted" style="font-size:12.5px;flex:1">
              ${base64 ? `已读取 ${fileName || 'xlsx'}` : '选择文件后可预览解析'}
            </span>`
          : null}
        <span class="spacer"></span>
        <button disabled=${busy || !hasContent} onClick=${runPreview}>预览解析</button>
        <button class="primary" disabled=${busy || !hasContent} onClick=${apply}>
          导入用例
        </button>
      </div>

      ${kind !== 'excel'
        ? html`<textarea
            class="import-textarea"
            rows="4"
            value=${content}
            placeholder=${kind === 'markdown'
              ? '粘贴 Markdown（支持表格、标题分节）'
              : '直接粘贴用例文本即可：编号步骤、标签段落或自然语言描述都能识别'}
            onInput=${(event: Event) =>
              setContent((event.target as HTMLTextAreaElement).value)}
          ></textarea>
          <p class="muted" style="font-size:12px;margin:2px 0 0">
            无法按固定结构识别时会自动改用编写模型整理（在“模型配置”中设置），识别结果导入后请人工核对。
          </p>`
        : null}

      ${busy ? Badge({ tone: 'muted', text: '解析中…（模型识别可能需要数十秒）' }) : null}
      ${error ? html`<p class="err">${error}</p>` : null}
      ${report ? html`<p class="ok">${report}</p>` : null}

      ${preview
        ? html`
            <div class="import-preview">
              <div class="row">
                ${Badge({
                  tone: preview.cases.length ? 'ok' : 'warn',
                  text: `${preview.cases.length} 条用例`,
                })}
                ${preview.viaModel ? Badge({ tone: 'ok', text: '模型识别' }) : null}
                ${preview.issues.length
                  ? Badge({ tone: 'warn', text: `${preview.issues.length} 个问题` })
                  : null}
                ${preview.unconverted.length
                  ? Badge({ tone: 'err', text: `${preview.unconverted.length} 段未转换` })
                  : null}
              </div>
              ${preview.cases.map(
                (draft, index) => html`
                  <div class="row" key=${index} style="font-size:13px;margin:4px 0">
                    <code>${draft.sourceRange}</code>
                    <strong>${draft.sourceId ? `${draft.sourceId} · ` : ''}${draft.name || '（未命名）'}</strong>
                    <span class="muted">
                      ${draft.actions.length} 步 · ${draft.expectations.length} 预期 · ${draft.level}
                    </span>
                  </div>
                `,
              )}
              ${preview.modelNotes?.length
                ? html`<p class="muted" style="font-size:12.5px;margin:4px 0">
                    识别说明：${preview.modelNotes.join('；')}
                  </p>`
                : null}
              ${preview.issues.length || preview.unconverted.length
                ? html`
                    <details>
                      <summary>问题与未转换明细</summary>
                      <ul class="muted" style="font-size:12.5px">
                        ${preview.issues.map(
                          (issue, index) => html`
                            <li key=${`i${index}`}>
                              ${issue.range ? `[${issue.range}] ` : ''}${issue.message}
                            </li>
                          `,
                        )}
                        ${preview.unconverted.map(
                          (block, index) => html`
                            <li key=${`u${index}`}>
                              <span class="warn">${block.reason}</span>
                              ${block.range ? `（${block.range}）` : ''}
                            </li>
                          `,
                        )}
                      </ul>
                    </details>
                  `
                : null}
            </div>
          `
        : null}
    </div>
  `;
}
