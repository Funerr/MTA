import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkbenchConfig } from './config';
import { log, redact } from './log';

/**
 * 工作台 HTTP 服务骨架：本地单用户，仅监听回环地址；
 * API 走 JSON，前端为构建产物静态文件。所有日志经 redact 脱敏。
 */

export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'WorkbenchHttpError';
    this.status = status;
    this.details = details;
  }
}

export type WorkbenchRouteHandler = (request: ApiRequest) => Promise<unknown>;

export interface ApiRequest {
  method: string;
  path: string;
  /** 路由模式 `:name` 捕获的路径参数。 */
  params: Record<string, string>;
  /** 已解析的查询参数（仅键与单值）。 */
  query: URLSearchParams;
  /** JSON 请求体；无 body 时为 undefined。 */
  body: unknown;
  config: WorkbenchConfig;
}

const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** 精确匹配优先，其次按声明顺序尝试 `:param` 模式路由。 */
export function matchRoute<T>(
  routes: Readonly<Record<string, T>>,
  method: string,
  path: string,
): { handler: T; params: Record<string, string> } | undefined {
  const exact = routes[`${method} ${path}`];
  if (exact) return { handler: exact, params: {} };

  const targetSegments = path.split('/').filter(Boolean);
  for (const [key, handler] of Object.entries(routes)) {
    const spaceAt = key.indexOf(' ');
    if (spaceAt < 0 || key.slice(0, spaceAt) !== method) continue;
    const pattern = key.slice(spaceAt + 1);
    if (!pattern.includes('/:')) continue;
    const patternSegments = pattern.split('/').filter(Boolean);
    if (patternSegments.length !== targetSegments.length) continue;

    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < patternSegments.length; i += 1) {
      const p = patternSegments[i]!;
      const t = targetSegments[i]!;
      if (p.startsWith(':')) {
        params[p.slice(1)] = decodeURIComponent(t);
      } else if (p !== t) {
        matched = false;
        break;
      }
    }
    if (matched) return { handler, params };
  }
  return undefined;
}

const STATIC_FILES: Readonly<Record<string, string>> = {
  '': 'index.html',
  'index.html': 'index.html',
  'app.js': 'app.js',
  'styles.css': 'styles.css',
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export interface WorkbenchServer {
  readonly server: Server;
  readonly port: number;
  readonly host: string;
  close(): Promise<void>;
}

export function createWorkbenchApp(options: {
  config: WorkbenchConfig;
  routes: Readonly<Record<string, WorkbenchRouteHandler>>;
  /** SSE 等需要直接持有响应对象的流式路由，键为 `METHOD /api/path`。 */
  streamRoutes?: Readonly<
    Record<string, (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void>
  >;
  webDistDir: string;
}): WorkbenchServer {
  const { config, routes, streamRoutes = {}, webDistDir } = options;

  const sendJson = (res: ServerResponse, status: number, body: unknown) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(payload);
  };

  const sameOrigin = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    if (!origin) return true; // 非浏览器或同源 GET 导航
    try {
      const parsed = new URL(origin);
      const host = req.headers.host ?? '';
      return parsed.host === host;
    } catch {
      return false;
    }
  };

  const hostAllowed = (req: IncomingMessage): boolean => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!host) return false;
    const hostname = host.replace(/:\d+$/, '');
    const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'];
    if (loopback.includes(hostname)) return true;
    // 显式配置的 host 才放行（默认仅回环）。
    return hostname === config.host.toLowerCase();
  };

  const readBody = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) {
        throw new HttpError(413, '请求体过大');
      }
      chunks.push(chunk as Buffer);
    }
    if (chunks.length === 0) return undefined;
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, '请求体不是合法 JSON');
    }
  };

  const serveStatic = async (
    res: ServerResponse,
    pathname: string,
  ): Promise<void> => {
    const fileName = STATIC_FILES[pathname.replace(/^\//, '')];
    if (!fileName) {
      sendJson(res, 404, { error: '未找到资源' });
      return;
    }
    try {
      const content = await readFile(join(webDistDir, fileName));
      const ext = fileName.slice(fileName.lastIndexOf('.'));
      res.writeHead(200, {
        'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(content);
    } catch {
      sendJson(res, 404, { error: '前端资源缺失，请先运行 pnpm workbench:build' });
    }
  };

  const server = createServer(
    (req, res) => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = url.pathname;
        const method = req.method ?? 'GET';
        try {
          if (!hostAllowed(req)) {
            sendJson(res, 403, { error: '拒绝访问：Host 不在允许范围' });
            return;
          }
          const isApi = path === '/api' || path.startsWith('/api/');
          if (isApi && !sameOrigin(req)) {
            sendJson(res, 403, { error: '拒绝访问：跨来源请求' });
            return;
          }
          if (isApi) {
            const streamMatch = matchRoute(streamRoutes, method, path);
            if (streamMatch) {
              streamMatch.handler(req, res, streamMatch.params);
              return;
            }
            const match = matchRoute(routes, method, path);
            if (!match) {
              throw new HttpError(404, `未知接口：${method} ${path}`);
            }
            const body =
              method === 'POST' || method === 'PUT'
                ? await readBody(req)
                : undefined;
            const result = await match.handler({
              method,
              path,
              params: match.params,
              query: url.searchParams,
              body,
              config,
            });
            sendJson(res, 200, result ?? { ok: true });
            return;
          }
          if (method !== 'GET' && method !== 'HEAD') {
            throw new HttpError(405, '仅支持 GET 访问前端资源');
          }
          await serveStatic(res, path);
        } catch (error) {
          if (error instanceof HttpError) {
            log('warn', `${req.method} ${path} -> ${error.status}`, {
              message: error.message,
            });
            sendJson(res, error.status, {
              error: error.message,
              details: error.details,
            });
          } else {
            const message = error instanceof Error ? error.message : String(error);
            log('error', `${req.method} ${path} 处理失败`, {
              message: redact(message),
            });
            sendJson(res, 500, { error: '服务内部错误' });
          }
        }
      })();
    },
  );

  return {
    server,
    host: config.host,
    port: config.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
