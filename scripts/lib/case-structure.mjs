// 用例结构共享层：项目域组织（项目 → 大模块 → 特性 → 用例）的命名规范、
// 项目声明（project.yaml）与设备需求（YAML 注释头部）解析。
// 被 scripts/run-case.mjs 与 cases.config.ts 共同使用（跨层一致性由单测约束）。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const EXECUTION_PROJECTS = ['android', 'harmony', 'multi-device'];
export const CASES_ROOT = 'cases';
export const EXAMPLES_ROOT = 'examples';
export const PROJECT_DECLARATION_FILE = 'project.yaml';

/** 新建项目骨架的默认大模块；仅是模板默认值，项目可自由增删。 */
export const SCAFFOLD_MODULES = [
  { dir: 'protocols', label: '通信协议' },
  { dir: 'system', label: '整机' },
  { dir: 'core', label: '三大项' },
  { dir: 'stability', label: '稳定性' },
];

/** 菜单显示用的中文对照标签；其余分组显示目录原名。 */
export const MODULE_LABELS = new Map(SCAFFOLD_MODULES.map((entry) => [entry.dir, entry.label]));

export class CaseStructureError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'CaseStructureError';
  }
}

const SEGMENT_PATTERN = /^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/;
const CASE_FILE_PATTERN = /^([A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)\.ya?ml$/;
const ALIAS_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const NON_ASCII_PATTERN = /[^\x20-\x7e]/;
const DEVICES_COMMENT_PATTERN = /^\s*#\s*devices\s*:\s*(.+?)\s*$/;

export function isCaseSegmentName(name) {
  return SEGMENT_PATTERN.test(name);
}

/** YAML 文件名返回用例名（去扩展名）；不合命名规范返回 undefined。 */
export function caseFileStem(filename) {
  const match = CASE_FILE_PATTERN.exec(filename);
  return match ? match[1] : undefined;
}

/**
 * 业务根（cases/）路径命名规范：每级目录与文件名必须是英文 kebab-case
 * （机型代号如 EV760 允许大写），路径不得含非 ASCII 字符。
 * 输入为 cases/ 根内的 POSIX 相对路径（不含 cases/ 前缀）。
 */
export function assertCasePathNaming(relativePosixPath) {
  const segments = relativePosixPath.split('/').filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (NON_ASCII_PATTERN.test(segment)) {
      throw new CaseStructureError(
        `路径含非 ASCII 字符（中文等）：${relativePosixPath}；请改为英文 kebab-case（如 adjust-brightness.yaml）`,
      );
    }
    const isFile = /\.ya?ml$/i.test(segment);
    const ok = isFile ? caseFileStem(segment) !== undefined : isCaseSegmentName(segment);
    if (!ok) {
      throw new CaseStructureError(
        `路径命名不合规范：${relativePosixPath}；每级需为英文 kebab-case（字母/数字/连字符），用例文件以 .yaml / .yml 结尾`,
      );
    }
  }
}

const projectDeclarationSchema = z.object({
  platform: z.enum(['android', 'harmony', 'multi-device']),
  devices: z
    .array(z.string().regex(ALIAS_PATTERN, '设备别名需以字母开头，仅含字母/数字/下划线（如 DUT1）'))
    .optional(),
});

/** 解析并校验项目声明（project.yaml 文本）。缺失字段/非法取值抛 CaseStructureError。 */
export function parseProjectDeclaration(source, label = PROJECT_DECLARATION_FILE) {
  let parsed;
  try {
    parsed = parseYaml(source);
  } catch (error) {
    throw new CaseStructureError(`${label} 不是合法 YAML：${error.message}`);
  }
  const result = projectDeclarationSchema.safeParse(parsed ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.') || '(根)';
    throw new CaseStructureError(
      `${label} 声明非法（${field}：${issue.message}）；platform 需为 ${EXECUTION_PROJECTS.join(' / ')}，devices 为可选别名列表（如 [DUT1, DUT2]）`,
    );
  }
  const devices = result.data.devices ?? [];
  const duplicated = devices.filter((alias, index) => devices.indexOf(alias) !== index);
  if (duplicated.length > 0) {
    throw new CaseStructureError(`${label} 声明非法：设备别名重复：${[...new Set(duplicated)].join('、')}`);
  }
  return { platform: result.data.platform, devices };
}

/**
 * 扫描 cases/ 下的项目（一级目录）并加载声明。
 * 目录名不合命名规范或缺少 project.yaml 均抛错，不静默跳过。
 */
export function loadProjectDeclarations(repoRoot) {
  const casesDir = join(repoRoot, CASES_ROOT);
  let entries;
  try {
    entries = readdirSync(casesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const declarations = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isCaseSegmentName(entry.name)) {
      throw new CaseStructureError(
        `项目目录命名不合规范：${CASES_ROOT}/${entry.name}；请改为英文 kebab-case（如 EV760）`,
      );
    }
    const declarationPath = join(casesDir, entry.name, PROJECT_DECLARATION_FILE);
    let source;
    try {
      source = readFileSync(declarationPath, 'utf8');
    } catch {
      throw new CaseStructureError(
        `项目声明缺失：${CASES_ROOT}/${entry.name}/${PROJECT_DECLARATION_FILE}；` +
          `每个项目需声明执行平台，可运行 pnpm case --new-project 生成模板`,
      );
    }
    const declaration = parseProjectDeclaration(
      source,
      `${CASES_ROOT}/${entry.name}/${PROJECT_DECLARATION_FILE}`,
    );
    declarations.push({
      name: entry.name,
      platform: declaration.platform,
      devices: declaration.devices,
      dirPosix: `${CASES_ROOT}/${entry.name}`,
    });
  }
  declarations.sort((left, right) => left.name.localeCompare(right.name));
  return declarations;
}

/**
 * 解析用例头部的注释元数据 `# devices: DUT1, DUT2`。
 * 官方 Workflow 解析器对顶层 key 白名单校验，设备需求只能以注释形式声明。
 * 无该注释返回 undefined（声明是可选的）。
 */
export function parseCaseDeviceRequirements(source) {
  for (const line of source.split(/\r?\n/)) {
    const match = DEVICES_COMMENT_PATTERN.exec(line);
    if (!match) continue;
    const aliases = match[1]
      .replace(/^\[|\]$/g, '')
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    for (const alias of aliases) {
      if (!ALIAS_PATTERN.test(alias)) {
        throw new CaseStructureError(
          `devices 注释中的别名非法：${alias}；需以字母开头，仅含字母/数字/下划线（如 DUT1）`,
        );
      }
    }
    return aliases;
  }
  return undefined;
}

/** 解析 MULTI_DEVICE_BINDINGS（alias:platform:ENV_VAR,…）为别名清单；空值返回默认声明的别名。 */
export function parseBindingAliases(spec, defaultSpec) {
  const raw = spec === undefined || spec === '' ? defaultSpec : spec;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const parts = entry.split(':');
      if (parts.length !== 3) {
        throw new CaseStructureError(
          `MULTI_DEVICE_BINDINGS 声明无效：${entry}；应为 alias:platform:ENV_VAR（如 DUT1:android:MULTI_DEVICE_DUT1_ID）`,
        );
      }
      return { alias: parts[0], platform: parts[1], idEnv: parts[2] };
    });
}

/**
 * 设备需求比对（用例头部 ⊆ 项目声明 ⊆ 已绑定别名）。
 * 返回人话问题列表；空数组表示一致。仅协作项目接受设备需求声明。
 */
export function validateDeviceRequirements({ platform, caseDevices, projectDevices = [], bindingAliases = [] }) {
  if (caseDevices === undefined || caseDevices.length === 0) return [];
  if (platform !== 'multi-device') {
    return ['设备需求声明（# devices:）仅用于协作项目（platform: multi-device）；单设备项目删除该注释即可'];
  }
  const bound = new Set(bindingAliases.map((binding) => binding.alias));
  const declared = new Set(projectDevices);
  const problems = [];
  for (const alias of caseDevices) {
    if (!declared.has(alias)) {
      problems.push(`用例需要设备 ${alias}，但项目 project.yaml 的 devices 未声明该别名`);
    }
    if (!bound.has(alias)) {
      problems.push(`用例需要设备 ${alias}，但 MULTI_DEVICE_BINDINGS 未绑定该别名`);
    }
  }
  return problems;
}

function listYamlFiles(absDir) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (entry.name === PROJECT_DECLARATION_FILE) continue;
      const stem = caseFileStem(entry.name);
      if (stem === undefined) {
        // YAML 扩展但命名不合规范：显式报错，不静默跳过（非 ASCII 给出改名指引）。
        if (/\.ya?ml$/i.test(entry.name)) assertCasePathNaming(entry.name);
        continue;
      }
      files.push(abs);
    }
  };
  walk(absDir);
  return files.sort();
}

/** 递归收集范围内的用例文件（*.yaml / *.yml，排除 project.yaml），返回 POSIX 相对路径。 */
export function listScopeCaseFiles(repoRoot, scopeDirPosix) {
  const absDir = join(repoRoot, ...scopeDirPosix.split('/'));
  let stats;
  try {
    stats = statSync(absDir);
  } catch {
    return [];
  }
  if (!stats.isDirectory()) return [];
  return listYamlFiles(absDir).map((abs) => posix.relative(repoRoot, abs).split('\\').join('/'));
}

/** 构建 cases/ 的分组树：项目 → 大模块 → 特性…（深度不限），叶子列出用例文件。 */
export function buildCaseTree(repoRoot) {
  const declarations = loadProjectDeclarations(repoRoot);
  const buildNode = (absDir, dirPosix) => {
    const children = [];
    const cases = [];
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const childPosix = `${dirPosix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!isCaseSegmentName(entry.name)) {
          throw new CaseStructureError(
            `目录命名不合规范：${childPosix}；请改为英文 kebab-case`,
          );
        }
        children.push(buildNode(join(absDir, entry.name), childPosix));
        continue;
      }
      if (entry.name === PROJECT_DECLARATION_FILE) continue;
      const stem = caseFileStem(entry.name);
      if (stem === undefined) {
        if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
          throw new CaseStructureError(
            `用例文件命名不合规范：${childPosix}；请改为英文 kebab-case（如 adjust-brightness.yaml）`,
          );
        }
        continue;
      }
      cases.push({ stem, file: childPosix });
    }
    children.sort((left, right) => left.name.localeCompare(right.name));
    cases.sort((left, right) => left.stem.localeCompare(right.stem));
    const name = dirPosix.split('/').pop();
    return { name, label: MODULE_LABELS.get(name) ?? name, path: dirPosix, children, cases };
  };

  return declarations.map((declaration) => ({
    ...buildNode(join(repoRoot, ...declaration.dirPosix.split('/')), declaration.dirPosix),
    name: declaration.name,
    label: declaration.name,
    platform: declaration.platform,
    devices: declaration.devices,
  }));
}

/**
 * 解析命名空间目标（`<项目>[/<大模块>[/<特性>[/<用例>]]]`，可省略 .yaml，可带 cases/ 前缀）
 * 为用例文件清单。目录层级深度不限：末段先按目录匹配（跑整个范围），
 * 否则按用例名在当前范围内递归唯一匹配。失败抛错并列出可选项。
 */
export function resolveNamespaceTarget(target, repoRoot, declarations = loadProjectDeclarations(repoRoot)) {
  let normalized = target.replace(/^\.\//, '');
  if (normalized.startsWith(`${CASES_ROOT}/`)) normalized = normalized.slice(CASES_ROOT.length + 1);
  normalized = normalized.replace(/\.ya?ml$/, '');
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new CaseStructureError(`目标为空；格式为 <项目>[/<大模块>[/<特性>[/<用例>]]`);
  }
  assertCasePathNaming(segments.join('/'));

  const [projectName, ...rest] = segments;
  const declaration = declarations.find((entry) => entry.name === projectName);
  if (!declaration) {
    const available = declarations.map((entry) => entry.name).join('、') || '(cases/ 下暂无项目)';
    throw new CaseStructureError(`项目不存在：${projectName}；可用项目：${available}`);
  }

  let currentDirPosix = declaration.dirPosix;
  for (const segment of rest) {
    const childDirPosix = `${currentDirPosix}/${segment}`;
    const childAbs = join(repoRoot, ...childDirPosix.split('/'));
    let isDir = false;
    try {
      isDir = statSync(childAbs).isDirectory();
    } catch {
      isDir = false;
    }
    if (isDir) {
      currentDirPosix = childDirPosix;
      continue;
    }
    // 末段允许用例名（去 .yaml 后）在当前范围内递归唯一匹配；非末段必须是目录。
    const matches = listScopeCaseFiles(repoRoot, currentDirPosix).filter(
      (file) => caseFileStem(file.split('/').pop()) === segment,
    );
    if (rest[rest.length - 1] !== segment) {
      const siblings = listChildNames(repoRoot, currentDirPosix);
      throw new CaseStructureError(
        `目标不存在：${target}（${childDirPosix} 不是目录）；可用子级：${siblings.join('、') || '(空)'}`,
      );
    }
    if (matches.length === 0) {
      const siblings = listChildNames(repoRoot, currentDirPosix);
      throw new CaseStructureError(
        `目标不存在：${target}；${currentDirPosix} 下可用：${siblings.join('、') || '(空)'}`,
      );
    }
    if (matches.length > 1) {
      throw new CaseStructureError(
        `目标有歧义：${target}；匹配到多个用例：${matches.join('、')}，请给出更完整路径`,
      );
    }
    return { project: declaration, kind: 'case', scope: currentDirPosix, files: matches };
  }

  const files = listScopeCaseFiles(repoRoot, currentDirPosix);
  if (files.length === 0) {
    throw new CaseStructureError(
      `范围里还没有用例：${currentDirPosix}；把 YAML 用例放入该目录后再运行`,
    );
  }
  const depth = segments.length;
  const kind = depth === 1 ? 'project' : depth === 2 ? 'module' : 'scope';
  return { project: declaration, kind, scope: currentDirPosix, files };
}

function listChildNames(repoRoot, dirPosix) {
  const absDir = join(repoRoot, ...dirPosix.split('/'));
  const names = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      names.push(entry.name);
      continue;
    }
    if (entry.name === PROJECT_DECLARATION_FILE) continue;
    const stem = caseFileStem(entry.name);
    if (stem !== undefined) names.push(stem);
  }
  return names.sort();
}

/**
 * 演示根（examples/）兼容推断：文件后缀或 examples/<执行项目>/ 项目目录。
 * 与既有演示配置的目录发现约定一致；无法推断返回 undefined。
 */
export function inferExamplesProject(posixPath) {
  for (const project of EXECUTION_PROJECTS) {
    if (posixPath.endsWith(`.${project}.yaml`) || posixPath.endsWith(`.${project}.yml`)) {
      return project;
    }
  }
  const [root, firstSegment] = posixPath.split('/');
  if (root === EXAMPLES_ROOT && EXECUTION_PROJECTS.includes(firstSegment)) return firstSegment;
  return undefined;
}

/** 业务根文件归属的执行项目：由所在项目目录的声明决定，文件名后缀不参与。 */
export function executionProjectOf(posixPath, declarations) {
  const [root, projectName] = posixPath.split('/');
  if (root !== CASES_ROOT) return undefined;
  const declaration = declarations.find((entry) => entry.name === projectName);
  return declaration ? declaration.platform : undefined;
}
