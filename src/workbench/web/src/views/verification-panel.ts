import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { request, api, type TaskView } from '../api';
import type { AuthoringDocument, AuthoringPlatform } from '../../../core/document';
import { evidenceSummary, evidenceStatus } from '../../../core/verify/evidence';

export function VerificationPanel(props: {
  doc: AuthoringDocument;
  /** 受控平台：传入时隐藏内部切换器。 */
  platform?: AuthoringPlatform;
  /** 启动核查读取已落盘文档；本地有未保存修改时先自动保存。 */
  onEnsureSaved?: () => Promise<AuthoringDocument | null>;
  onDocumentSaved(document: AuthoringDocument): void;
}) {
  const [internalPlatform, setInternalPlatform] = useState<AuthoringPlatform>('android');
  const platform = props.platform ?? internalPlatform;
  const setPlatform = (p: AuthoringPlatform) => setInternalPlatform(p);
  const [deviceId, setDeviceId] = useState('');
  const [caseId, setCaseId] = useState(props.doc.cases[0]?.id ?? '');
  const [devices, setDevices] = useState<{ id: string; available: boolean }[]>([]);
  const [binding, setBinding] = useState<string | null>(null);
  const [task, setTask] = useState<TaskView | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [control, setControl] = useState<{ runnerState?: string; currentTarget?: string; screenshotFile?: string } | null>(null);
  const variant = props.doc.variants[platform];
  const invoke = async (work: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const refresh = async () => {
    const result = await request<{ platforms: Record<string, { devices: typeof devices; bound?: { deviceId: string }; error?: string }> }>(`./api/devices?platform=${platform}`);
    setDevices(result.platforms[platform]?.devices ?? []);
    setBinding(result.platforms[platform]?.bound?.deviceId ?? null);
    if (result.platforms[platform]?.error) setMessage(result.platforms[platform]!.error!);
  };
  useEffect(() => { void invoke(refresh); }, [platform]);
  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try {
        const status = await request<{ platforms: { active: typeof control; canTakeover: boolean }[] }>(`./api/verify/status?platform=${platform}`);
        if (disposed) return;
        setControl(status.platforms[0]?.active ?? null);
        if (task?.status === 'running') {
          const result = await api.getTask(task.id);
          if (disposed) return;
          setTask(result.task);
          if (result.task.status !== 'running') {
            if (result.task.result?.document) props.onDocumentSaved(result.task.result.document);
            else if (result.task.error) setMessage(result.task.error);
          }
        }
      } catch (error) { if (!disposed) setMessage(String(error)); }
    };
    void poll(); const timer = setInterval(() => void poll(), 800);
    return () => { disposed = true; clearInterval(timer); };
  }, [platform, task?.id, task?.status]);
  const summary = variant ? evidenceSummary(props.doc, variant, binding ?? undefined) : null;
  return html`<div class="panel">
    ${props.platform ? null : html`<div class="row">${(['android', 'harmony'] as const).map((item) => html`<button class=${platform === item ? 'primary' : ''} onClick=${() => { setPlatform(item); setTask(null); }}>${item === 'android' ? 'Android' : 'HarmonyOS'}</button>`)}</div>`}
    <p>静态检查：${variant?.validation?.allPassed ? '通过' : '待检查或存在缺口'} · 关键点核查：${summary?.valid ?? 0} 条有效记录 · 完整执行：未运行</p>
    <p class="muted">设备执行由现有 MTA 框架完成。请独占使用设备，外部 CLI 占用不受工作台锁保护。</p>
    <div class="row"><select aria-label="在线设备" onChange=${(event: Event) => setDeviceId((event.target as HTMLSelectElement).value)}><option value="">选择设备</option>${devices.map((item) => html`<option value=${item.id} disabled=${!item.available}>${item.id}${item.available ? '' : '（不可用）'}</option>`)}</select>
      <input aria-label="设备 ID" placeholder="显式设备 ID" value=${deviceId} onInput=${(event: Event) => setDeviceId((event.target as HTMLInputElement).value)} />
      <button disabled=${busy || !!control} onClick=${() => void invoke(async () => { await request('./api/devices/bind', { method: 'POST', body: JSON.stringify({ platform, deviceId }) }); await refresh(); })}>绑定设备</button>
      <button disabled=${busy || !!control} onClick=${() => void invoke(async () => { await request('./api/devices/release', { method: 'POST', body: JSON.stringify({ platform }) }); await refresh(); })}>释放 / 人工接管</button>
    </div>
    <p>当前绑定：${binding ?? '未绑定'} · 控制状态：${control?.runnerState ?? '无运行任务'}</p>
    <div class="row"><select aria-label="核查用例" value=${caseId} onChange=${(event: Event) => setCaseId((event.target as HTMLSelectElement).value)}>${props.doc.cases.map((item) => html`<option value=${item.id}>${item.name}</option>`)}</select>
      <button disabled=${busy || !!control || !binding || !variant} onClick=${() => void invoke(async () => {
        const current = props.onEnsureSaved ? await props.onEnsureSaved() : props.doc;
        if (!current) throw new Error('本地修改尚未保存，已取消核查；请重试或先手动保存。');
        const result = await request<{ task: TaskView }>(`./api/documents/${current.id}/verify`, { method: 'POST', body: JSON.stringify({ platform, caseId, baseSaveVersion: current.saveVersion }) });
        setTask(result.task);
      })}>启动关键点核查</button>
      <button disabled=${!control} onClick=${() => void invoke(async () => { await request('./api/verify/stop', { method: 'POST', body: JSON.stringify({ platform }) }); })}>停止</button>
    </div>
    <p class="muted">接管后重新绑定并启动，将先获取新画面；不会自动续跑旧动作。</p>
    ${control?.currentTarget ? html`<p>当前目标：${control.currentTarget}</p>` : null}
    ${control?.screenshotFile ? html`<img alt="当前设备截图" style="max-width:320px;max-height:500px" src=${`./api/${control.screenshotFile}`} />` : null}
    ${task ? html`<p>任务：${task.status}</p><pre class="excerpt">${task.progress.map((item) => item.message).join('\n')}</pre>` : null}
    ${message ? html`<pre class="excerpt" role="status">${message}</pre>` : null}
    <h3>核查证据与缺口</h3>
    ${summary?.perExpectation.map((item) => html`<p>${item.expectationId}：${item.covered ? '已取得有效结果证据' : '证据不足或待复核'}</p>`)}
    ${(() => {
      // 同一核查目标保留多轮记录：最新一轮为当前结论，历史轮次降级展示，
      // 避免旧轮次的“证据不足”被误读为当前状态。
      const records = [...(variant?.evidence ?? [])].sort((a, b) =>
        b.capturedAt.localeCompare(a.capturedAt),
      );
      const goalKey = (record: (typeof records)[number]) =>
        `${record.caseId}:${record.actionId ?? ''}:${record.expectationIds.join(',')}`;
      const latestKey = new Map<string, string>();
      for (const record of records) {
        const key = goalKey(record);
        if (!latestKey.has(key)) latestKey.set(key, record.capturedAt);
      }
      return records.map((record) => {
        const isLatest = latestKey.get(goalKey(record)) === record.capturedAt;
        return html`<div class=${`item-block${isLatest ? '' : ' superseded'}`}><strong>${record.target}</strong>${isLatest ? null : html`<p class="muted">历史轮次（已被更新证据取代）</p>`}<p>${record.platform} · ${record.deviceId} · ${record.capturedAt} · r${record.workflowRevision}</p><p>${evidenceStatus(props.doc, variant!, record, binding ?? undefined).reasons.join('；') || '版本有效'}</p><p>${record.observation}</p><p class="muted">${record.notes}</p>${record.screenshotFile ? html`<img alt=${record.target} style="max-width:320px;max-height:500px" src=${`./api/${record.screenshotFile}`} />` : null}</div>`;
      });
    })()}
  </div>`;
}

/** 确认与导出：绑定当前修订的不可变快照；无就绪内容时仅交付草稿。 */
export function DeliverySection(props: {
  doc: AuthoringDocument;
  platform: AuthoringPlatform;
  /** 确认/导出读取已落盘文档；本地有未保存修改时先自动保存。 */
  onEnsureSaved?: () => Promise<AuthoringDocument | null>;
  onDocumentSaved(document: AuthoringDocument): void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const variant = props.doc.variants[props.platform];
  const ensureSaved = async (): Promise<AuthoringDocument | null> => {
    if (!props.onEnsureSaved) return props.doc;
    return props.onEnsureSaved();
  };
  const invoke = async (work: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return html`<div class="card">
    <div class="delivery-strip">
      <button
        class="primary"
        disabled=${busy || !variant}
        onClick=${() => void invoke(async () => {
          const current = await ensureSaved();
          if (!current) throw new Error('本地修改尚未保存，已取消确认；请重试或先手动保存。');
          const result = await request<{ document: AuthoringDocument }>(
            `./api/documents/${current.id}/confirm`,
            { method: 'POST', body: JSON.stringify({ platform: props.platform, baseSaveVersion: current.saveVersion }) },
          );
          props.onDocumentSaved(result.document);
          setMessage('已确认当前修订，保存不可变快照。');
        })}
      >确认 ${props.platform === 'android' ? 'Android' : 'HarmonyOS'} 修订</button>
      <button
        disabled=${busy}
        onClick=${() => void invoke(async () => {
          const current = await ensureSaved();
          if (!current) throw new Error('本地修改尚未保存，已取消导出；请重试或先手动保存。');
          const result = await request<{ directory: string; files: string[] }>(
            `./api/documents/${current.id}/export`,
            { method: 'POST', body: JSON.stringify({ baseSaveVersion: current.saveVersion }) },
          );
          setMessage(`已交付到 ${result.directory}\n${result.files.join('\n')}\n排除项见 conversion-report.json；完整执行未运行。`);
        })}
      >导出工作流 / 草稿</button>
      ${variant?.confirm.status === 'confirmed'
        ? html`<span class="badge badge-ok">当前修订已确认</span>`
        : html`<span class="badge">待确认（仅就绪用例可确认）</span>`}
      <span class="muted">完整执行仍走既有 test:cases 入口；导出默认写 artifacts/，不写入 cases/。</span>
    </div>
    ${message ? html`<pre class="excerpt" role="status">${message}</pre>` : null}
  </div>`;
}
