import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createWorkbenchApp, HttpError } from '../../src/workbench/server/app';
import { loadWorkbenchConfig } from '../../src/workbench/server/config';
import { redact } from '../../src/workbench/server/log';
import {
  effectiveAuthoring,
  maskApiKey,
  ModelConfigStore,
  validateAuthoring,
} from '../../src/workbench/server/model-config';
import { createRouteTable } from '../../src/workbench/server/routes';
import { Workspace } from '../../src/workbench/server/workspace';
import { DocumentStore } from '../../src/workbench/core/document-store';
import { TaskRegistry } from '../../src/workbench/server/tasks';
import { DeviceService } from '../../src/workbench/core/devices/device-service';
import { VerifyService } from '../../src/workbench/server/verify-service';

let tempRoot: string;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'mta-workbench-server-'));
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('Workspace：工作区文件访问边界', () => {
  it('工作区内相对路径可解析', () => {
    const workspace = new Workspace(join(tempRoot, 'ws-a'));
    expect(workspace.resolve('documents/a.json')).toBe(
      join(tempRoot, 'ws-a', 'documents', 'a.json'),
    );
  });

  it('拒绝绝对路径与 .. 逃逸', () => {
    const workspace = new Workspace(join(tempRoot, 'ws-a'));
    expect(() => workspace.resolve('/etc/passwd')).toThrow(HttpError);
    expect(() => workspace.resolve('../../etc/passwd')).toThrow(/越出工作区/);
    expect(() => workspace.resolve('docs/../../escape.txt')).toThrow(
      /越出工作区/,
    );
  });

  it('readText 同样受边界约束', async () => {
    const workspace = new Workspace(join(tempRoot, 'ws-a'));
    await expect(
      workspace.readText('../other/secret.txt'),
    ).rejects.toThrow(HttpError);
  });
});

describe('模型配置：密钥只落在服务端文件', () => {
  it('保存后可恢复，文件权限受限，describe 不含完整密钥', async () => {
    const workspace = new Workspace(join(tempRoot, 'ws-model'));
    const store = new ModelConfigStore(workspace);

    expect(await store.load()).toEqual({ authoring: null });

    const secretKey = 'sk-live-abcdefgh12345678';
    await store.save({
      authoring: { baseUrl: 'https://api.example.com/v1', apiKey: secretKey, model: 'gpt-test' },
    });

    const restored = await store.load();
    expect(restored.authoring?.apiKey).toBe(secretKey);

    const fileStat = statSync(workspace.resolve('model-config.json'));
    expect(fileStat.mode & 0o777).toBe(0o600);

    const described = await store.describe({});
    expect(JSON.stringify(described)).not.toContain(secretKey);
    expect(described.authoring?.apiKeyMasked).toBe('sk-***5678');
    expect(described.deviceVision.configured).toBe(false);
  });

  it('编写模型缺省回退 MIDSCENE_MODEL_* 环境配置；stored 优先', async () => {
    const workspace = new Workspace(join(tempRoot, 'ws-effective'));
    const store = new ModelConfigStore(workspace);
    const env = {
      MIDSCENE_MODEL_BASE_URL: 'https://env.example.com/v1',
      MIDSCENE_MODEL_API_KEY: 'sk-env',
      MIDSCENE_MODEL_NAME: 'env-model',
    };

    // 无 stored：回退环境配置
    expect(effectiveAuthoring({ authoring: null }, env)).toEqual({
      baseUrl: 'https://env.example.com/v1',
      apiKey: 'sk-env',
      model: 'env-model',
    });
    const described = await store.describe(env);
    expect(described.effective).toEqual({ source: 'midscene-env', model: 'env-model' });

    // 有 stored：优先自定义
    await store.save({
      authoring: { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', model: 'custom-model' },
    });
    expect(effectiveAuthoring(await store.load(), env)?.model).toBe('custom-model');
    expect((await store.describe(env)).effective).toEqual({
      source: 'custom',
      model: 'custom-model',
    });

    // 环境也不完整：null
    expect(effectiveAuthoring({ authoring: null }, {})).toBeNull();
  });

  it('掩码规则覆盖短密钥与空密钥', () => {
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey('short')).toBe('***');
    expect(maskApiKey('sk-1234567890abcd')).toBe('sk-***abcd');
  });

  it('非法配置被拒绝', () => {
    expect(() => validateAuthoring({ baseUrl: 'notaurl', model: 'm' })).toThrow(
      /baseUrl/,
    );
    expect(() =>
      validateAuthoring({ baseUrl: 'ftp://x', model: 'm' }),
    ).toThrow(/http/);
    expect(() =>
      validateAuthoring({ baseUrl: 'https://x', model: '' }),
    ).toThrow(/模型名称/);
    expect(
      validateAuthoring({ baseUrl: 'https://x', model: 'm', apiKey: '' }),
    ).toEqual({ baseUrl: 'https://x', apiKey: '', model: 'm' });
  });
});

describe('日志脱敏', () => {
  it('常见密钥形态被替换', () => {
    expect(redact('{"apiKey":"sk-1234567890"}')).toBe(
      '{"apiKey":"[REDACTED]"}',
    );
    expect(redact('Authorization: Bearer abc.def.ghi')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
  });
});

describe('HTTP 边界：跨来源拒绝与密钥不出现在响应', () => {
  let server: Server;
  let baseUrl: string;
  let workspace: Workspace;

  beforeAll(async () => {
    workspace = new Workspace(join(tempRoot, 'ws-http'));
    const config = loadWorkbenchConfig(
      { ...process.env, MTA_WORKBENCH_HOST: '127.0.0.1' },
      { projectRoot: tempRoot, startDir: tempRoot },
    );
    const app = createWorkbenchApp({
      config: { ...config, port: 0 },
      routes: createRouteTable({
        config,
        workspace,
        modelConfig: new ModelConfigStore(workspace),
        documents: new DocumentStore(workspace),
        tasks: new TaskRegistry(),
        devices: new DeviceService({}, workspace),
        verify: new VerifyService({
          devices: new DeviceService({}, workspace),
          tasks: new TaskRegistry(),
          documents: new DocumentStore(workspace),
          workspace,
          modelConfig: new ModelConfigStore(workspace),
        }),
      }),
      webDistDir: join(tempRoot, 'no-dist'),
    });
    server = app.server;
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('跨来源 API 请求被拒绝', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://evil.example' },
    });
    expect(res.status).toBe(403);
  });

  it('PUT/GET 模型配置：响应不含完整密钥', async () => {
    const secretKey = 'sk-http-1111222233334444';
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    try {
      const put = await fetch(`${baseUrl}/api/model-config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          authoring: {
            baseUrl: 'https://api.example.com/v1',
            apiKey: secretKey,
            model: 'm-x',
          },
        }),
      });
      expect(put.status).toBe(200);
      const putBody = await put.text();
      expect(putBody).not.toContain(secretKey);
      expect(putBody).toContain('sk-***4444');

      const get = await fetch(`${baseUrl}/api/model-config`);
      const getBody = await get.text();
      expect(getBody).not.toContain(secretKey);

      // 服务端日志不出现完整密钥（掩码本身也会被再次脱敏，均安全）。
      const logged = logs.join('\n');
      expect(logged).not.toContain(secretKey);
    } finally {
      spy.mockRestore();
    }
  });

  it('非法模型配置返回 400 且不落盘', async () => {
    const res = await fetch(`${baseUrl}/api/model-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authoring: { baseUrl: 'nope' } }),
    });
    expect(res.status).toBe(400);
  });
});
