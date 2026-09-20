import { chmod, writeFile } from 'node:fs/promises';
import { HttpError } from './app';
import { log } from './log';
import type { Workspace } from './workspace';

/**
 * 模型配置与密钥管理：密钥仅保存在服务端本地文件（0600），
 * 任何 API 响应、日志和导出都只能出现掩码形式。
 *
 * 两个模型角色：
 * - authoring：编写/转换用 OpenAI 兼容对话模型（本服务直接调用）。
 * - 设备视觉模型：复用 Midscene 的 MIDSCENE_MODEL_* 环境变量，
 *   工作台只展示配置状态，不复制密钥。
 */

const MODEL_CONFIG_FILE = 'model-config.json';

export interface AuthoringModelConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** 模型厂商/系列，用于调整请求参数（如 GLM 不支持 response_format）。 */
  readonly family?: string;
}

export interface StoredModelConfig {
  readonly authoring: AuthoringModelConfig | null;
}

/** 可安全返回前端的形态：绝不包含完整 apiKey。 */
export interface MaskedModelConfig {
  readonly authoring: {
    readonly baseUrl: string;
    readonly model: string;
    readonly apiKeyMasked: string;
    readonly family?: string;
  } | null;
  readonly deviceVision: {
    readonly configured: boolean;
    readonly model: string | null;
  };
  /**
   * 实际生效的编写/生成模型：优先工作台自定义配置，
   * 否则复用 Midscene 的多模态模型环境配置（MIDSCENE_MODEL_*）。
   */
  readonly effective: {
    readonly source: 'custom' | 'midscene-env';
    readonly model: string;
  } | null;
}

/**
 * 解析实际生效的编写模型端点：stored 优先，缺省回退到
 * MIDSCENE_MODEL_*（与设备视觉同一套多模态模型配置）。
 * 都不存在时返回 null，由调用方给出可操作提示。
 */
export function effectiveAuthoring(
  stored: StoredModelConfig,
  env: NodeJS.ProcessEnv = process.env,
): AuthoringModelConfig | null {
  if (stored.authoring) return stored.authoring;
  const baseUrl = env.MIDSCENE_MODEL_BASE_URL?.trim();
  const apiKey = env.MIDSCENE_MODEL_API_KEY?.trim();
  const model = env.MIDSCENE_MODEL_NAME?.trim();
  if (!baseUrl || !model) return null;
  const family = env.MIDSCENE_MODEL_FAMILY?.trim() || undefined;
  return { baseUrl, apiKey: apiKey ?? '', model, family };
}

export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '***';
  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

export class ModelConfigStore {
  constructor(private readonly workspace: Workspace) {}

  async load(): Promise<StoredModelConfig> {
    try {
      const raw = await this.workspace.readJson<Partial<StoredModelConfig>>(
        MODEL_CONFIG_FILE,
      );
      return normalizeStored(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return { authoring: null };
      }
      throw error;
    }
  }

  async save(config: StoredModelConfig): Promise<void> {
    const target = this.workspace.resolve(MODEL_CONFIG_FILE);
    await this.workspace.writeJson(MODEL_CONFIG_FILE, normalizeStored(config));
    await chmod(target, 0o600).catch(() => {
      // 非 POSIX 环境（如 Windows）没有 0600；文件仍留在用户本机目录。
    });
    log('info', '模型配置已更新', {
      model: config.authoring?.model,
      apiKey: config.authoring ? maskApiKey(config.authoring.apiKey) : undefined,
    });
  }

  /** 供 API 返回；掩码后无完整密钥。 */
  async describe(env: NodeJS.ProcessEnv = process.env): Promise<MaskedModelConfig> {
    const stored = await this.load();
    const effective = effectiveAuthoring(stored, env);
    return {
      authoring: stored.authoring
        ? {
            baseUrl: stored.authoring.baseUrl,
            model: stored.authoring.model,
            apiKeyMasked: maskApiKey(stored.authoring.apiKey),
            family: stored.authoring.family,
          }
        : null,
      deviceVision: {
        configured: Boolean(
          env.MIDSCENE_MODEL_BASE_URL && env.MIDSCENE_MODEL_API_KEY && env.MIDSCENE_MODEL_NAME,
        ),
        model: env.MIDSCENE_MODEL_NAME ?? null,
      },
      effective: effective ? { source: stored.authoring ? 'custom' : 'midscene-env', model: effective.model } : null,
    };
  }
}

function normalizeStored(raw: Partial<StoredModelConfig>): StoredModelConfig {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(500, '模型配置文件结构非法');
  }
  if (raw.authoring === null || raw.authoring === undefined) {
    return { authoring: null };
  }
  const { baseUrl, apiKey, model, family } = raw.authoring as AuthoringModelConfig;
  return { authoring: { ...validateAuthoring({ baseUrl, apiKey, model }), family } };
}

/** 校验外部提交的编写模型配置；非法输入返回 400。 */
export function validateAuthoring(input: {
  baseUrl?: unknown;
  apiKey?: unknown;
  model?: unknown;
}): AuthoringModelConfig {
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : '';
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey : '';
  const model = typeof input.model === 'string' ? input.model.trim() : '';

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new HttpError(400, '编写模型 baseUrl 必须是合法 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, '编写模型 baseUrl 仅支持 http/https');
  }
  if (!model) {
    throw new HttpError(400, '编写模型名称不能为空');
  }
  return { baseUrl, apiKey, model };
}
