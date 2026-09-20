import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * 工作台本地配置：默认回环地址 + 仓库内数据目录。
 * 项目根定位规则与 case-to-yaml Skill 一致：向上查找同时包含
 * ARCHITECTURE.md 与 midscene.config.ts 的目录。
 */

export interface WorkbenchConfig {
  /** 监听地址；默认 127.0.0.1，仅本机访问。 */
  readonly host: string;
  /** 监听端口；默认 7788。 */
  readonly port: number;
  /** MTA 项目根（Node 契约、skill 规则、cases 的定位基准）。 */
  readonly projectRoot: string;
  /** 编写工作区目录（文档、上传、证据、导出全部落在这里）。 */
  readonly dataDir: string;
}

export class WorkbenchConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbenchConfigError';
  }
}

export function findProjectRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (
      existsSync(join(dir, 'ARCHITECTURE.md')) &&
      existsSync(join(dir, 'midscene.config.ts'))
    ) {
      return dir;
    }
    const parent = join(dir, '..');
    if (parent === dir) {
      throw new WorkbenchConfigError(
        `未找到 MTA 项目根（需同时包含 ARCHITECTURE.md 与 midscene.config.ts），起点：${startDir}`,
      );
    }
    dir = parent;
  }
}

export function loadWorkbenchConfig(
  env: NodeJS.ProcessEnv = process.env,
  options?: { startDir?: string; projectRoot?: string },
): WorkbenchConfig {
  const projectRoot = options?.projectRoot
    ?? (env.MTA_WORKBENCH_PROJECT_ROOT
      ? resolveAbsolutePath(env.MTA_WORKBENCH_PROJECT_ROOT, 'MTA_WORKBENCH_PROJECT_ROOT')
      : findProjectRoot(options?.startDir ?? process.cwd()));

  const host = env.MTA_WORKBENCH_HOST?.trim() || '127.0.0.1';

  const portRaw = env.MTA_WORKBENCH_PORT?.trim() || '7788';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new WorkbenchConfigError(
      `MTA_WORKBENCH_PORT 无效：${portRaw}；须为 1-65535 的整数。`,
    );
  }

  const dataDir = env.MTA_WORKBENCH_DATA_DIR?.trim()
    ? resolveAbsolutePath(env.MTA_WORKBENCH_DATA_DIR, 'MTA_WORKBENCH_DATA_DIR')
    : join(projectRoot, 'artifacts', 'workbench');

  return { host, port, projectRoot, dataDir };
}

function resolveAbsolutePath(value: string, envName: string): string {
  if (!isAbsolute(value)) {
    throw new WorkbenchConfigError(
      `${envName} 必须是绝对路径：${value}`,
    );
  }
  return value;
}
