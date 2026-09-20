/**
 * Playwright global setup：
 * 1. 启动 mock 模型 API 服务器（模拟 AI 识别用例能力）
 * 2. 启动 MTA 工作台服务（指向 mock 模型）
 * 3. 将 baseURL 写入环境变量供测试使用
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');

/**
 * Mock 模型 API：接收 chat/completions 请求，返回结构化用例识别结果。
 * 参考 assist.ts 的 SYSTEM_PROMPT 与 ModelExtractionSchema。
 */
function startMockModelServer(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404);
        res.end();
        return;
      }

      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        // 从请求中提取用户消息，据此返回对应的 mock 识别结果
        let userMessage = '';
        try {
          const parsed = JSON.parse(body);
          const userMsg = parsed.messages?.find((m: { role: string }) => m.role === 'user');
          userMessage = userMsg?.content ?? '';
        } catch { /* ignore */ }

        const mockResult = buildMockExtraction(userMessage);
        const responseBody = JSON.stringify({
          choices: [{ message: { content: JSON.stringify(mockResult) } }],
        });

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(responseBody);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/**
 * 根据用户输入构建 mock 识别结果。
 * 模拟 assist.ts AI 能力：从自然语言中提取用例结构。
 */
function buildMockExtraction(userMessage: string): unknown {
  // 蓝牙相关
  if (userMessage.includes('蓝牙')) {
    return {
      cases: [
        {
          sourceId: '',
          name: '验证蓝牙开关功能',
          goal: '检查蓝牙开关是否正常工作',
          preconditions: [],
          actions: ['打开系统设置', '进入蓝牙页面', '打开蓝牙开关'],
          expectations: ['蓝牙开关可见且可点击', '蓝牙状态变为已开启'],
          level: 'level2',
        },
      ],
      notes: ['从自然语言文本中识别出 1 条用例'],
    };
  }

  // Wi-Fi 相关
  if (userMessage.includes('Wi-Fi') || userMessage.includes('wifi') || userMessage.includes('WiFi')) {
    return {
      cases: [
        {
          sourceId: '',
          name: '验证 Wi-Fi 连接',
          goal: '确认 Wi-Fi 可以正常连接',
          preconditions: [],
          actions: ['打开系统设置', '进入 Wi-Fi 页面', '选择一个可用网络并连接'],
          expectations: ['Wi-Fi 已连接，状态显示为已连接'],
          level: 'level2',
        },
      ],
      notes: ['从自然语言文本中识别出 1 条用例'],
    };
  }

  // 默认：返回空（模拟无法识别）
  return {
    cases: [],
    notes: ['文本中未识别出测试用例结构'],
  };
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'mta-e2e-'));

  // 清除 .env 中的模型配置
  delete process.env.MIDSCENE_MODEL_BASE_URL;
  delete process.env.MIDSCENE_MODEL_API_KEY;
  delete process.env.MIDSCENE_MODEL_NAME;
  delete process.env.MIDSCENE_MODEL_FAMILY;

  // 启动 mock 模型服务器
  const mockModel = await startMockModelServer();
  const mockModelBaseUrl = `http://127.0.0.1:${mockModel.port}/v1`;

  // 动态导入源码
  const { createWorkbenchApp } = await import('../../src/workbench/server/app');
  const { loadWorkbenchConfig } = await import('../../src/workbench/server/config');
  const { ModelConfigStore } = await import('../../src/workbench/server/model-config');
  const { createRouteTable, createStreamRoutes } = await import('../../src/workbench/server/routes');
  const { TaskRegistry } = await import('../../src/workbench/server/tasks');
  const { DeviceService } = await import('../../src/workbench/core/devices/device-service');
  const { VerifyService } = await import('../../src/workbench/server/verify-service');
  const { Workspace } = await import('../../src/workbench/server/workspace');
  const { DocumentStore } = await import('../../src/workbench/core/document-store');

  const dataDir = join(tempRoot, 'data');
  const workspace = new Workspace(dataDir);
  const config = loadWorkbenchConfig(
    { MTA_WORKBENCH_DATA_DIR: dataDir },
    { projectRoot: PROJECT_ROOT },
  );
  const documents = new DocumentStore(workspace);
  const modelConfig = new ModelConfigStore(workspace);
  const tasks = new TaskRegistry();
  const devices = new DeviceService({}, workspace);
  const context = {
    config,
    workspace,
    modelConfig,
    documents,
    tasks,
    devices,
    verify: new VerifyService({ devices, tasks, documents, workspace, modelConfig }),
  };

  // 预设模型配置：指向 mock 模型服务器
  await modelConfig.save({
    authoring: {
      baseUrl: mockModelBaseUrl,
      model: 'mock-glm-4',
      apiKey: 'mock-key',
      family: 'zhipu',
    },
  });

  const webDistDir = join(PROJECT_ROOT, 'src', 'workbench', 'web', 'dist');
  const app = createWorkbenchApp({
    config: { ...config, port: 0 },
    routes: createRouteTable(context),
    streamRoutes: createStreamRoutes(context),
    webDistDir,
  });

  const server: Server = app.server;
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const port = (server.address() as AddressInfo).port;
  const baseURL = `http://127.0.0.1:${port}`;

  process.env.MTA_E2E_BASE_URL = baseURL;
  process.env.MTA_E2E_TEMP_ROOT = tempRoot;

  console.log(`\n  MTA 工作台 E2E 服务已启动：${baseURL}`);
  console.log(`  Mock 模型服务：${mockModelBaseUrl}\n`);

  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await mockModel.close();
    rmSync(tempRoot, { recursive: true, force: true });
  };
}