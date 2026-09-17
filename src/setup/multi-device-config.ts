/** 多设备协作项目的别名、平台与设备 ID 环境引用。模块导入只解析声明，不连接设备。 */

export const MULTI_DEVICE_BINDINGS_ENV = 'MULTI_DEVICE_BINDINGS';

/** 未配置时的默认声明：别名在配置加载期确定，设备 ID 在 setup 期解析。 */
export const DEFAULT_MULTI_DEVICE_BINDINGS_SPEC =
  'phone1:android:MULTI_DEVICE_PHONE1_ID,phone2:harmony:MULTI_DEVICE_PHONE2_ID';

export const MULTI_DEVICE_PLATFORMS = ['android', 'harmony'] as const;

export type MultiDevicePlatform = (typeof MULTI_DEVICE_PLATFORMS)[number];

export interface MultiDeviceBinding {
  readonly alias: string;
  readonly platform: MultiDevicePlatform;
  readonly idEnv: string;
}

export interface ResolvedMultiDeviceTarget extends MultiDeviceBinding {
  readonly id: string;
}

export class MultiDeviceConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MultiDeviceConfigError';
  }
}

const ALIAS_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ALIASES = new Set(['device', 'wait']);

function isPlatform(value: string): value is MultiDevicePlatform {
  return (MULTI_DEVICE_PLATFORMS as readonly string[]).includes(value);
}

export function parseMultiDeviceBindings(
  spec: string,
): readonly MultiDeviceBinding[] {
  const entries = spec
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length < 2) {
    throw new MultiDeviceConfigError(
      '多设备协作项目至少需要两台设备声明，格式为 alias:platform:ENV_VAR。',
    );
  }

  const bindings: MultiDeviceBinding[] = [];
  const seenAliases = new Set<string>();

  for (const entry of entries) {
    const parts = entry.split(':');
    if (parts.length !== 3) {
      throw new MultiDeviceConfigError(
        `设备声明格式无效：${entry}。应为 alias:platform:ENV_VAR。`,
      );
    }
    const [aliasRaw, platformRaw, idEnvRaw] = parts;
    const alias = aliasRaw.trim();
    const platform = platformRaw.trim();
    const idEnv = idEnvRaw.trim();

    if (!ALIAS_PATTERN.test(alias)) {
      throw new MultiDeviceConfigError(
        `设备别名无效：${alias}。须以字母开头，仅含字母、数字或下划线。`,
      );
    }
    if (RESERVED_ALIASES.has(alias)) {
      throw new MultiDeviceConfigError(
        `设备别名 ${alias} 为保留名，请改用其他别名。`,
      );
    }
    if (!isPlatform(platform)) {
      throw new MultiDeviceConfigError(
        `设备 ${alias} 的平台无效：${platform}。仅支持 android 或 harmony。`,
      );
    }
    if (!ENV_NAME_PATTERN.test(idEnv)) {
      throw new MultiDeviceConfigError(
        `设备 ${alias} 的设备 ID 环境变量名无效：${idEnv}。`,
      );
    }
    if (seenAliases.has(alias)) {
      throw new MultiDeviceConfigError(`设备别名重复：${alias}。`);
    }
    seenAliases.add(alias);
    bindings.push({ alias, platform, idEnv });
  }

  return bindings;
}

export function loadMultiDeviceBindings(
  env: NodeJS.ProcessEnv = process.env,
): readonly MultiDeviceBinding[] {
  const raw = env[MULTI_DEVICE_BINDINGS_ENV];
  const spec =
    raw === undefined || raw.trim().length === 0
      ? DEFAULT_MULTI_DEVICE_BINDINGS_SPEC
      : raw;
  return parseMultiDeviceBindings(spec);
}

export function resolveMultiDeviceTargets(
  bindings: readonly MultiDeviceBinding[],
  env: NodeJS.ProcessEnv,
): readonly ResolvedMultiDeviceTarget[] {
  const resolved: ResolvedMultiDeviceTarget[] = bindings.map((binding) => {
    const id = env[binding.idEnv]?.trim();
    if (!id) {
      throw new MultiDeviceConfigError(
        `设备别名 ${binding.alias} 缺少显式设备标识：环境变量 ${binding.idEnv} 未设置或为空。`,
      );
    }
    return { ...binding, id };
  });

  const seen = new Map<string, string>();
  for (const target of resolved) {
    const key = `${target.platform}:${target.id}`;
    const previous = seen.get(key);
    if (previous) {
      throw new MultiDeviceConfigError(
        `同一物理设备被重复绑定：${previous} 与 ${target.alias} 均指向 ${target.platform} 设备 ${target.id}。`,
      );
    }
    seen.set(key, target.alias);
  }

  return resolved;
}
