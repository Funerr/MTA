import { fileURLToPath } from 'node:url';
import { createWorkbenchApp } from './server/app';
import { loadWorkbenchConfig } from './server/config';
import { DocumentStore } from './core/document-store';
import { log } from './server/log';
import { ModelConfigStore } from './server/model-config';
import { createRouteTable, createStreamRoutes, type WorkbenchRouteContext } from './server/routes';
import { TaskRegistry } from './server/tasks';
import { DeviceService } from './core/devices/device-service';
import { VerifyService } from './server/verify-service';
import { Workspace } from './server/workspace';

const webDistDir = fileURLToPath(new URL('./web/dist', import.meta.url));

async function main(): Promise<void> {
  const config = loadWorkbenchConfig();
  const workspace = new Workspace(config.dataDir);
  await workspace.ensureDir('.');

  const baseContext = {
    config,
    workspace,
    modelConfig: new ModelConfigStore(workspace),
    documents: new DocumentStore(workspace),
    tasks: new TaskRegistry(),
    devices: new DeviceService({}, workspace),
  };
  const routeContext: WorkbenchRouteContext = {
    ...baseContext,
    verify: new VerifyService(baseContext),
  };
  const app = createWorkbenchApp({
    config,
    routes: createRouteTable(routeContext),
    streamRoutes: createStreamRoutes(routeContext),
    webDistDir,
  });

  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(config.port, config.host, () => resolve());
  });

  log(
    'info',
    `MTA 用例编写工作台已启动：http://${config.host}:${config.port}（Ctrl+C 停止）`,
  );

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    log('info', '正在关闭工作台…');
    void app.close().then(
      () => process.exit(0),
      (error) => {
        log('error', '关闭失败', { message: String(error) });
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if ((error as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
    log('error', `端口被占用：${message}；可通过 MTA_WORKBENCH_PORT 换端口。`);
  } else {
    log('error', `启动失败：${message}`);
  }
  process.exit(1);
});
