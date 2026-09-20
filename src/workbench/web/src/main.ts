import { render } from 'preact';
import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { Topbar } from './views/topbar';
import { EditorView } from './views/editor';

type Route = { kind: 'home' } | { kind: 'doc'; id: string };

function parseHash(): Route {
  const hash = location.hash.replace(/^#/, '');
  const match = /^\/doc\/([A-Za-z0-9_-]+)$/.exec(hash);
  return match ? { kind: 'doc', id: match[1]! } : { kind: 'home' };
}

const HERO_STEPS = [
  { no: 1, title: '录入用例', desc: '手写「步骤 + 预期」，或导入 Excel / Markdown / 文本' },
  { no: 2, title: '生成工作流', desc: '按项目规则生成 Android / HarmonyOS 工作流' },
  { no: 3, title: '检查与编辑', desc: '分层静态检查；步骤卡片与 YAML 双向同步' },
  { no: 4, title: '设备核查', desc: '绑定真机核查关键页面，证据可追溯' },
  { no: 5, title: '确认导出', desc: '确认修订后导出就绪工作流与转换记录' },
] as const;

function App() {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const open = (id: string) => {
    location.hash = `#/doc/${id}`;
    setRoute({ kind: 'doc', id });
  };
  const goHome = () => {
    location.hash = '#/';
    setRoute({ kind: 'home' });
  };

  return html`
    <${Topbar} activeDocId=${route.kind === 'doc' ? route.id : null} onOpen=${open} onHome=${goHome} />
    ${route.kind === 'doc'
      ? html`<${EditorView} key=${route.id} docId=${route.id} onOpen=${open} />`
      : html`<main class="workspace">
          <div class="hero">
            <h2>从业务用例到可执行工作流，一页完成</h2>
            <p class="hero-sub">
              录入、模型转换、分层检查、真机核查与人工确认——保留原文、来源与改写依据。
            </p>
            <div class="hero-steps">
              ${HERO_STEPS.map(
                (step) => html`
                  <div class="hero-step" key=${step.no}>
                    <span class="no">${step.no}</span>
                    <b>${step.title}</b>
                    <span>${step.desc}</span>
                  </div>
                `,
              )}
            </div>
          </div>
          <div class="card" style="margin-top:16px">
            <h3>开始</h3>
            <p class="muted">
              在顶部选择或新建用例集；全链路（录入 → 生成 → 检查 → 核查 → 导出）在同一页完成。
            </p>
          </div>
        </main>`}
  `;
}

render(html`<${App} />`, document.getElementById('app')!);
