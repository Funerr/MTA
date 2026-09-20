import { html } from 'htm/preact';

/** 通用小组件：字段容器、文本输入、下拉。 */

export function Field(props: {
  label: string;
  hint?: string;
  children: unknown;
}) {
  return html`
    <label class="field">
      <span class="field-label">${props.label}</span>
      ${props.children as never}
      ${props.hint ? html`<span class="field-hint warn">${props.hint}</span>` : null}
    </label>
  `;
}

export function TextInput(props: {
  value: string;
  placeholder?: string;
  onInput: (value: string) => void;
}) {
  return html`
    <input
      type="text"
      value=${props.value}
      placeholder=${props.placeholder ?? ''}
      onInput=${(event: Event) =>
        props.onInput((event.target as HTMLInputElement).value)}
    />
  `;
}

export function TextArea(props: {
  value: string;
  rows?: number;
  placeholder?: string;
  onInput: (value: string) => void;
}) {
  return html`
    <textarea
      rows=${props.rows ?? 2}
      placeholder=${props.placeholder ?? ''}
      onInput=${(event: Event) =>
        props.onInput((event.target as HTMLTextAreaElement).value)}
    >${props.value}</textarea>
  `;
}

export function Select(props: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return html`
    <select
      onChange=${(event: Event) =>
        props.onChange((event.target as HTMLSelectElement).value)}
    >
      ${props.options.map(
        (option) => html`
          <option value=${option.value} selected=${option.value === props.value}>
            ${option.label}
          </option>
        `,
      )}
    </select>
  `;
}

export function Badge(props: { tone: 'ok' | 'warn' | 'err' | 'muted'; text: string }) {
  return html`<span class=${`badge badge-${props.tone}`}>${props.text}</span>`;
}
