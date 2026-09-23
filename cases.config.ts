/** 测试集只选择工作流；执行仍由官方 Midscene Runner 负责。 */
import { fileURLToPath } from 'node:url';
import {
  CASES_ROOT,
  EXAMPLES_ROOT,
  executionProjectOf,
  inferExamplesProject,
  loadProjectDeclarations,
} from './scripts/lib/case-structure.mjs';

export type ExecutionProject = 'android' | 'harmony' | 'multi-device';

const repoRootDefault = fileURLToPath(new URL('.', import.meta.url));

export interface CaseFileSelection {
  include: string[];
  exclude: string[];
}

const BASE_EXCLUDE = ['tests/**/*.{yaml,yml}', 'examples/**/*.{yaml,yml}'];
const PROJECT_DECLARATION_EXCLUDE = `${CASES_ROOT}/*/project.yaml`;

/**
 * 官方选择校验要求 include 非空；该项目平台无声明用例时使用保留的
 * 空集合哨兵模式（不匹配任何仓库内路径），由入口侧 --project 保证该项目不会执行。
 */
const NO_MATCHED_FILES_PATTERN = '__mta_no_matched_files__/*.yaml';

/** level/smoke 分级维度已退役：显式给出时必须报错并指引统一入口，不做静默翻译。 */
function assertNoRetiredSuiteEnv(env: NodeJS.ProcessEnv = process.env): void {
  const suite = env.MTA_SUITE;
  if (suite !== undefined && suite !== '') {
    throw new Error(
      `MTA_SUITE（level/smoke 分级）已退役（收到 ${suite}）；请用 pnpm case <项目>[/<大模块>[/<特性>]] 按项目结构选择执行范围`,
    );
  }
}

/**
 * 统一入口（`pnpm case`）传入的显式文件清单：JSON 数组字符串、POSIX 相对路径。
 * 该变量是入口的内部契约，不进文档与 Skill；设置后覆盖目录发现。
 */
export function explicitCaseFiles(env: NodeJS.ProcessEnv = process.env): string[] | undefined {
  const raw = env.MTA_CASE_FILES;
  if (raw === undefined || raw === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`MTA_CASE_FILES 不是合法 JSON：${raw}`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error(
      'MTA_CASE_FILES 必须为非空 JSON 字符串数组（POSIX 相对路径），如 ["cases/EV760/system/display/adjust-brightness.yaml"]',
    );
  }
  return parsed;
}

/**
 * 显式清单只保留归属该执行项目的文件：业务根按项目声明（project.yaml）归属，
 * 演示根沿用后缀/目录推断；归属无法确定的文件报错，不静默丢弃。
 * 未匹配项目得到空集合哨兵，由入口侧 --project 保证该项目不会执行。
 */
export function explicitCaseFileSelection(
  project: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { root?: string } = {},
): CaseFileSelection | undefined {
  const files = explicitCaseFiles(env);
  if (!files) return undefined;
  const root = options.root ?? repoRootDefault;
  const declarations = loadProjectDeclarations(root);
  const include: string[] = [];
  for (const file of files) {
    const [rootName] = file.split('/');
    let owner: string | undefined;
    if (rootName === CASES_ROOT) {
      owner = executionProjectOf(file, declarations);
      if (owner === undefined) {
        throw new Error(
          `无法确定用例归属：${file}；业务用例需位于 cases/<项目>/ 下且项目有 project.yaml 声明`,
        );
      }
    } else if (rootName === EXAMPLES_ROOT) {
      owner = inferExamplesProject(file);
      if (owner === undefined) {
        throw new Error(`无法推断演示用例的执行项目：${file}；请位于 examples/<项目>/ 目录或带平台后缀`);
      }
    } else {
      throw new Error(`用例必须位于 cases/ 或 examples/ 之内：${file}`);
    }
    if (owner === project) include.push(file);
  }
  return {
    include: include.length > 0 ? include : [NO_MATCHED_FILES_PATTERN],
    exclude: [],
  };
}

/**
 * 按项目声明发现业务用例：仅收集声明为该执行平台的项目目录，
 * 文件名后缀与 level 目录不参与选择（语义已退役）。
 * 统一入口传入显式清单时以清单收窄执行范围（未给出的用例不得执行）。
 */
export function caseFiles(
  project: ExecutionProject,
  options: { root?: string } = {},
): CaseFileSelection {
  assertNoRetiredSuiteEnv();
  const root = options.root ?? repoRootDefault;
  const explicit = explicitCaseFileSelection(project, process.env, { root });
  if (explicit) return explicit;
  const declarations = loadProjectDeclarations(root);
  const names = declarations
    .filter((entry) => entry.platform === project)
    .map((entry) => entry.name);
  if (names.length === 0) {
    return {
      include: [NO_MATCHED_FILES_PATTERN],
      exclude: [PROJECT_DECLARATION_EXCLUDE, ...BASE_EXCLUDE],
    };
  }
  return {
    include: names.map((name) => `${CASES_ROOT}/${name}/**/*.{yaml,yml}`),
    exclude: [PROJECT_DECLARATION_EXCLUDE, ...BASE_EXCLUDE],
  };
}
