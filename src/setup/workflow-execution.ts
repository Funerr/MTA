import { collectWorkflowDocument, createProjectRuntime, runWorkflowDocument, type NodeDefinition, type StepResultHandler } from '@midscene/test';
import { loadTestProject } from '@midscene/test/config';
import { captureScreenshotFromAgent } from '../experience/runtime/adapters';

/** MTA 工作流执行适配：只装配公开 Runtime/Runner，不解释或调度步骤。 */
export async function executeProjectWorkflow(input: {
  configPath: string;
  workflowPath: string;
  platform: 'android' | 'harmony';
  deviceId: string;
  signal: AbortSignal;
  report(message: string): void;
  onStep?: StepResultHandler;
  onScreenshot?(stepIndex: number, png: Uint8Array): Promise<void>;
  loadProject?: typeof loadTestProject;
}) {
  input.signal.throwIfAborted();
  const loaded = await (input.loadProject ?? loadTestProject)(input.configPath);
  const project = loaded.projects.find((item) => item.name === input.platform);
  if (!project?.setup) throw new Error(`执行项目 ${input.platform} 缺少 setup`);
  const env = { ...process.env, [input.platform === 'android' ? 'ANDROID_DEVICE_ID' : 'HARMONY_DEVICE_ID']: input.deviceId };
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal.reason);
  input.signal.addEventListener('abort', abort, { once: true });
  if (input.signal.aborted) abort();
  const pending = new Set<Promise<unknown>>();
  // 仅观测底层 execute 是否结束；派发、输入校验、超时仍由 Midscene 管理。
  const wrapped = new Map<string, NodeDefinition<any, any, any>>();
  const resolveNode = (name: string) => {
    let node = wrapped.get(name);
    if (!node) {
      const original = project.nodes.require(name);
      node = { ...original, execute(execution) {
        controller.signal.throwIfAborted();
        const operation = Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return original.execute(execution);
        });
        pending.add(operation);
        void operation.then(() => pending.delete(operation), () => pending.delete(operation));
        return operation;
      } };
      wrapped.set(name, node);
    }
    return node;
  };
  const runtime = createProjectRuntime({
    project,
    signal: controller.signal,
    setup: { ...project.setup, setup: (context) => project.setup!.setup({ ...context, env }) },
  });
  let success = false;
  let runtimeStarted = false;
  try {
    const document = collectWorkflowDocument({ projectId: project.projectId, projectName: project.name, sourcePath: input.workflowPath, absolutePath: input.workflowPath }, {
      resolveNode: (name) => project.nodes.get(name), variables: project.variables, env,
    });
    controller.signal.throwIfAborted();
    runtimeStarted = true;
    const started = await runtime.start();
    if (!runtime.canRun) throw started.setupError ?? new Error('项目 setup 失败');
    const screenshot = async (stepIndex: number) => {
      const context = runtime.context as unknown as { agent?: Parameters<typeof captureScreenshotFromAgent>[0] };
      if (!context?.agent) throw new Error('项目上下文缺少截图能力');
      const png = await captureScreenshotFromAgent(context.agent)();
      await input.onScreenshot?.(stepIndex, png);
    };
    controller.signal.throwIfAborted();
    input.report('框架会话已建立，重新获取当前画面');
    await screenshot(-1);
    controller.signal.throwIfAborted();
    const result = await runWorkflowDocument(document, {
      project, projectContext: runtime.context, resolveNode,
      signal: controller.signal, retry: 0, defaultTimeoutMs: loaded.test.testTimeout,
      onStepStart: (info) => { input.report(`框架步骤：${info.node}（开始事件不代表动作完成）`); },
      onStepResult: async (info, step) => {
        await input.onStep?.(info, step);
        if (step.status === 'failed') controller.abort(step.error ?? new Error('步骤失败，停止后续派发'));
        if (!controller.signal.aborted && info.scope === 'case' && step.phase === 'steps') {
          await screenshot(step.stepIndex);
        }
      },
    });
    success = result.document.status === 'success' && result.cases.every((item) => item.status === 'success');
    return result;
  } finally {
    input.signal.removeEventListener('abort', abort);
    if (pending.size) input.report('停止中：等待底层在途调用结束后释放会话');
    await Promise.allSettled([...pending]);
    const finished = runtimeStarted ? await runtime.finish(success ? 'success' : 'failed') : undefined;
    if (finished?.teardownErrors?.length) throw new Error('框架会话释放失败，设备控制权未知');
  }
}
