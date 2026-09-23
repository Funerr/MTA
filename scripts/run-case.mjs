#!/usr/bin/env node
// 统一执行入口：`pnpm case`。无参数进菜单（TTY）或打印范围清单（非 TTY），
// 给出命名空间目标直接执行；执行委托官方 midscene-test CLI，本层只负责
// 「选谁跑、哪个项目、跑前说什么话」，退出码与报告语义与官方 CLI 一致。
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config as loadEnv } from 'dotenv';
import {
  CASES_ROOT,
  EXECUTION_PROJECTS,
  EXAMPLES_ROOT,
  PROJECT_DECLARATION_FILE,
  SCAFFOLD_MODULES,
  inferExamplesProject,
  listScopeCaseFiles,
  loadProjectDeclarations,
  parseBindingAliases,
  parseCaseDeviceRequirements,
  resolveNamespaceTarget,
  validateDeviceRequirements,
  buildCaseTree,
} from './lib/case-structure.mjs';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const CLI_ENTRY = ['node_modules', '@midscene', 'test', 'bin', 'midscene-test'];
const GLOB_METACHARS = /[\[\]{}()*+?!@|\\]/;
// 与 src/setup/multi-device-config.ts 的默认声明保持一致（跨层一致性由单测约束）。
const DEFAULT_MULTI_DEVICE_BINDINGS_SPEC =
  'phone1:android:MULTI_DEVICE_PHONE1_ID,phone2:harmony:MULTI_DEVICE_PHONE2_ID';
const MODEL_ENV_KEYS = [
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_NAME',
  'MIDSCENE_MODEL_FAMILY',
];

const USAGE = `用法：
  pnpm case                                自检 + 菜单（项目 → 大模块 → 特性 → 用例，按编号选择）
  pnpm case <目标> [<目标> ...]             直接执行：EV760 / EV760/system / EV760/system/display/adjust-brightness
  pnpm case examples/<演示目录>/<文件>.yaml  演示文件按既有演示配置执行
  pnpm case --all                          执行全部业务项目的全部用例
  pnpm case --new-project <项目> --platform <android|harmony|multi-device>   新建项目骨架
可选：--verbose（完整官方日志）  --no-open（不自动打开报告）  --result-dir <目录>（透传官方 CLI）`;

export class RunCaseError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'RunCaseError';
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function dirExists(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** 解析命令行：命名空间目标 + 入口自有参数；退役维度（--project/--config/分级）显式报错。 */
export function parseArgs(argv) {
  const targets = [];
  const passthrough = [];
  const flags = { verbose: false, noOpen: false, all: false, newProject: undefined, platform: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--project' || arg === '--config') {
      throw new RunCaseError(
        `${arg} 维度已退役：执行归属由 cases/<项目>/project.yaml 声明决定；` +
          `改用 pnpm case <项目>[/<大模块>[/<特性>]] 选择执行范围`,
      );
    }
    if (arg === '--retired-suite') {
      const name = argv[index + 1] ?? '(未知)';
      throw new RunCaseError(
        `test:cases:${name}（level/smoke 分级）已退役；` +
          `改用 pnpm case <项目>[/<大模块>] 选择执行范围，或 pnpm case 进入菜单`,
      );
    }
    if (arg === '--new-project' || arg === '--platform' || arg === '--result-dir') {
      const value = argv[index + 1];
      if (!value) throw new RunCaseError(`${arg} 需要一个值`);
      if (arg === '--new-project') flags.newProject = value;
      else if (arg === '--platform') {
        if (!EXECUTION_PROJECTS.includes(value)) {
          throw new RunCaseError(`未知执行平台：${value}；可选 ${EXECUTION_PROJECTS.join(' / ')}`);
        }
        flags.platform = value;
      } else passthrough.push(arg, value);
      index += 1;
      continue;
    }
    if (arg === '--verbose') flags.verbose = true;
    else if (arg === '--no-open') flags.noOpen = true;
    else if (arg === '--all') flags.all = true;
    else if (arg.startsWith('--')) passthrough.push(arg);
    else targets.push(arg);
  }
  return { targets, passthrough, flags };
}

function isExamplesTarget(target) {
  return target.startsWith(`${EXAMPLES_ROOT}/`) || target.startsWith(`${EXAMPLES_ROOT}\\`);
}

/**
 * 前置校验与分组（全部在启动任何执行前完成）：
 * 命名空间目标 → 项目声明归属；examples/ 文件目标 → 既有演示推断；
 * 用例头部设备需求与项目声明、MULTI_DEVICE_BINDINGS 比对；按（根 × 执行项目）分组。
 */
export function resolvePlan({
  targets,
  repoRoot: root = repoRoot,
  env = process.env,
  fileExists = isFile,
  readText = (path) => readFileSync(path, 'utf8'),
}) {
  if (targets.length === 0) {
    throw new RunCaseError('未提供执行目标。\n' + USAGE);
  }
  const declarations = loadProjectDeclarations(root);
  const bindingAliases = parseBindingAliases(
    env.MULTI_DEVICE_BINDINGS,
    DEFAULT_MULTI_DEVICE_BINDINGS_SPEC,
  );
  const groups = [];
  const deviceRequirements = new Set();

  const pushGroup = (groupRoot, project, posixPath) => {
    let group = groups.find(
      (candidate) => candidate.root === groupRoot && candidate.project === project,
    );
    if (!group) {
      group = { root: groupRoot, project, files: [] };
      groups.push(group);
    }
    group.files.push(posixPath);
  };

  for (const target of targets) {
    if (isExamplesTarget(target)) {
      const absolute = isAbsolute(target) ? resolve(target) : resolve(root, target);
      const relativePath = relative(root, absolute);
      const posixPath = relativePath.split(sep).join('/');
      if (posixPath.startsWith('..')) {
        throw new RunCaseError(
          `路径不在 MTA 仓库内：${target}；请在仓库内提供 cases/ 或 examples/ 下的 YAML`,
        );
      }
      if (!fileExists(absolute)) {
        throw new RunCaseError(`文件不存在：${target}`);
      }
      if (GLOB_METACHARS.test(posixPath)) {
        throw new RunCaseError(
          `文件路径含 glob 元字符（[]{}()*+?!@|\\），官方文件发现无法安全匹配，请重命名：${posixPath}`,
        );
      }
      const project = inferExamplesProject(posixPath);
      if (project === undefined) {
        throw new RunCaseError(
          `无法推断演示用例的执行项目：${posixPath}；` +
            `请位于 examples/<项目>/ 目录（如 examples/android/）或带平台后缀（如 .android.yaml）`,
        );
      }
      pushGroup(EXAMPLES_ROOT, project, posixPath);
      continue;
    }

    const resolved = resolveNamespaceTarget(target, root, declarations);
    for (const file of resolved.files) {
      const caseDevices = parseCaseDeviceRequirements(
        readText(join(root, ...file.split('/'))),
      );
      const problems = validateDeviceRequirements({
        platform: resolved.project.platform,
        caseDevices,
        projectDevices: resolved.project.devices,
        bindingAliases,
      });
      if (problems.length > 0) {
        throw new RunCaseError(`设备需求未满足：${problems.join('；')}`);
      }
      for (const alias of caseDevices ?? []) deviceRequirements.add(alias);
      for (const alias of resolved.project.devices ?? []) deviceRequirements.add(alias);
      pushGroup(CASES_ROOT, resolved.project.platform, file);
    }
  }
  return { groups, deviceRequirements: [...deviceRequirements] };
}

export function buildCommandArgs(group, passthrough = []) {
  const args = [];
  if (group.root === EXAMPLES_ROOT) args.push('--config', 'midscene.examples.config.ts');
  args.push('--project', group.project, ...passthrough);
  return args;
}

/** adb devices 输出 → [{id, state}]（state 为 device / unauthorized / offline …）。 */
export function parseAdbDevices(output) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('*'))
    .map((line) => {
      const [id, state] = line.split(/\s+/);
      return { id, state };
    });
}

/** hdc list targets 输出 → [{id}]（HDC 枚举不携带授权状态）。 */
export function parseHdcTargets(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('*') && !/^\[empty\]/i.test(line))
    .map((line) => ({ id: line.split(/\s+/)[0] }));
}

/**
 * 前置自检：模型配置、设备连接与调试。每个问题给单一修复动作；
 * 返回问题列表（空数组表示全部就绪）。run 用于注入命令执行（单测可替身）。
 */
export function collectSelfCheckIssues({
  platforms,
  deviceRequirements = [],
  env = process.env,
  run = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.error) return { ok: false, output: '' };
    return { ok: true, output: result.stdout ?? '' };
  },
}) {
  const issues = [];
  const missingModel = MODEL_ENV_KEYS.filter((key) => !env[key]);
  if (missingModel.length > 0) {
    issues.push(`模型未配置（缺 ${missingModel.join('、')}）—— 打开 .env，照 .env.example 填写 MIDSCENE_MODEL_* 四项后回来`);
    return issues;
  }

  if (platforms.includes('android')) {
    const adb = run('adb', ['devices']);
    if (!adb.ok) {
      issues.push('未找到 adb —— 安装 Android platform-tools 并加入 PATH 后重试');
    } else {
      const online = parseAdbDevices(adb.output).filter((device) => device.state === 'device');
      const unauthorized = parseAdbDevices(adb.output).filter(
        (device) => device.state === 'unauthorized',
      );
      const target = env.ANDROID_DEVICE_ID;
      if (unauthorized.length > 0 && online.length === 0) {
        issues.push('手机未授权调试 —— 在手机上允许 USB 调试授权弹窗后重试');
      } else if (target) {
        if (!online.some((device) => device.id === target)) {
          issues.push(`指定的安卓设备不在可用列表（ANDROID_DEVICE_ID=${target}）—— 用 adb devices 核对后修正 .env`);
        }
      } else if (online.length === 0) {
        issues.push('没有可用的安卓设备 —— 用数据线连接手机并开启 USB 调试后重试');
      } else if (online.length > 1) {
        issues.push('多台安卓设备在线 —— 在 .env 设置 ANDROID_DEVICE_ID 指定目标（adb devices 查看 ID）');
      }
    }
  }

  if (platforms.includes('harmony')) {
    const hdcBin = env.HDC_HOME ? join(env.HDC_HOME, 'bin', 'hdc') : 'hdc';
    const hdc = run(hdcBin, ['list', 'targets']);
    if (!hdc.ok) {
      issues.push('未找到 hdc —— 安装 HarmonyOS 工具链，或在 .env 设置 HDC_HOME 后重试');
    } else {
      const targets = parseHdcTargets(hdc.output);
      const target = env.HARMONY_DEVICE_ID;
      if (target) {
        if (!targets.some((device) => device.id === target)) {
          issues.push(`指定的鸿蒙设备不在列表（HARMONY_DEVICE_ID=${target}）—— 用 hdc list targets 核对后修正 .env`);
        }
      } else if (targets.length === 0) {
        issues.push('没有在线的鸿蒙设备 —— 连接设备并开启调试后重试');
      } else if (targets.length > 1) {
        issues.push('多台鸿蒙设备在线 —— 在 .env 设置 HARMONY_DEVICE_ID 指定目标（hdc list targets 查看 ID）');
      }
    }
  }

  if (platforms.includes('multi-device')) {
    let bindings;
    try {
      bindings = parseBindingAliases(env.MULTI_DEVICE_BINDINGS, DEFAULT_MULTI_DEVICE_BINDINGS_SPEC);
    } catch (error) {
      issues.push(error.message);
      bindings = [];
    }
    const bound = new Map(bindings.map((binding) => [binding.alias, binding]));
    for (const alias of deviceRequirements) {
      const binding = bound.get(alias);
      if (!binding) {
        issues.push(
          `未绑定设备 ${alias} —— 在 .env 的 MULTI_DEVICE_BINDINGS 补充 ${alias}:<platform>:<ENV_VAR> 并填写设备 ID`,
        );
        continue;
      }
      if (!env[binding.idEnv]) {
        issues.push(`设备 ${alias} 的 ID 未填写 —— 在 .env 设置 ${binding.idEnv}`);
      }
    }
    if (deviceRequirements.length === 0 && bindings.length > 0) {
      for (const binding of bindings) {
        if (!env[binding.idEnv]) {
          issues.push(`设备 ${binding.alias} 的 ID 未填写 —— 在 .env 设置 ${binding.idEnv}`);
        }
      }
    }
  }

  return issues;
}

/** 进度行分类：progress 直接回显；detail 缓存供失败摘要；quiet 默认不输出（--verbose 全量）。 */
export function classifyProgressLine(line) {
  if (/[✓✗×✕›○●▶]|passed|failed|tests?\s|test files|duration|results|summary|report/i.test(line)) {
    return 'progress';
  }
  if (/error|expected|received|assert|at\s|:line|✗/i.test(line)) return 'detail';
  return 'quiet';
}

function reportPathFrom(lines) {
  for (const line of [...lines].reverse()) {
    const match = line.match(/(\S*midscene_run\/report\S*\.html)/) ?? line.match(/(report\S*\.html)/i);
    if (match) return match[1];
  }
  for (const line of [...lines].reverse()) {
    const match = line.match(/(\S*midscene_run\/report\S*)/);
    if (match) return match[1];
  }
  return undefined;
}

export { reportPathFrom };

function openReport(reportPath) {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', reportPath] : [reportPath];
  const result = spawnSync(opener, args, { stdio: 'ignore' });
  return !result.error;
}

function runGroup(group, { passthrough, verbose = false }) {
  const args = buildCommandArgs(group, passthrough);
  const cli = CLI_ENTRY.join('/');
  console.log(`[run-case] ▶ 执行 ${group.root === EXAMPLES_ROOT ? '演示' : '项目'}组：${group.project}（${group.files.length} 个用例文件）`);
  if (verbose) console.log(`[run-case] ${cli} ${args.join(' ')}`);
  const env = { ...process.env };
  // 清单只传给本组 CLI 进程（内部契约），不继承外部设置。
  delete env.MTA_CASE_FILES;
  delete env.MTA_SUITE;
  env.MTA_CASE_FILES = JSON.stringify(group.files);
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [resolve(repoRoot, ...CLI_ENTRY), ...args], {
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    const buffered = [];
    const seen = [];
    const handleChunk = (chunk) => {
      for (const raw of chunk.toString('utf8').split(/\r?\n/)) {
        if (raw.length === 0) continue;
        seen.push(raw);
        if (verbose) {
          console.log(raw);
          continue;
        }
        const kind = classifyProgressLine(raw);
        if (kind === 'progress') console.log(`  ${raw.trim()}`);
        else buffered.push(raw);
      }
    };
    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);
    child.on('error', (error) => {
      resolvePromise({ status: 1, error, lines: buffered, seen });
    });
    child.on('close', (status) => {
      resolvePromise({ status: status ?? 1, lines: buffered, seen });
    });
  });
}

/** 新建项目骨架：project.yaml 模板 + 四大模块目录（模板默认值，可自由增删）。 */
export function scaffoldProject({ repoRoot: root = repoRoot, name, platform }) {
  if (!/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(name ?? '')) {
    throw new RunCaseError(`项目名不合规范：${name}；请用英文（字母/数字/连字符/点，如 EV760）`);
  }
  if (!EXECUTION_PROJECTS.includes(platform)) {
    throw new RunCaseError(`新建项目需要 --platform ${EXECUTION_PROJECTS.join(' | ')}`);
  }
  const projectDir = join(root, CASES_ROOT, name);
  if (isFile(projectDir) || dirExists(projectDir)) {
    throw new RunCaseError(`项目已存在：${CASES_ROOT}/${name}`);
  }
  mkdirSync(projectDir, { recursive: true });
  for (const module of SCAFFOLD_MODULES) {
    mkdirSync(join(projectDir, module.dir), { recursive: true });
  }
  const template =
    `# MTA 项目声明（cases/${name}/${PROJECT_DECLARATION_FILE}）：执行平台在项目级声明一次，用例文件不带平台后缀。\n` +
    `# platform 可选：${EXECUTION_PROJECTS.join(' | ')}\n` +
    `platform: ${platform}\n` +
    '# devices 为项目所需设备别名（协作项目需要至少两台）；实际绑定在 .env 的 MULTI_DEVICE_BINDINGS 显式声明。\n' +
    '# devices:\n' +
    '#   - DUT1\n' +
    '#   - DUT2\n';
  writeFileSync(join(projectDir, PROJECT_DECLARATION_FILE), template);
  return {
    projectDir,
    modules: SCAFFOLD_MODULES.map((module) => module.dir),
  };
}

function countCases(node) {
  return (
    node.cases.length + node.children.reduce((total, child) => total + countCases(child), 0)
  );
}

function renderTreeLines(nodes, indent = '') {
  const lines = [];
  for (const node of nodes) {
    const count = countCases(node);
    lines.push(`${indent}${node.label}${node.label !== node.name ? `（${node.name}）` : ''}  用例 ${count}`);
    if (node.cases.length > 0) {
      for (const entry of node.cases) lines.push(`${indent}  - ${entry.stem}`);
    }
    lines.push(...renderTreeLines(node.children, `${indent}    `));
  }
  return lines;
}

function promptLine(rl, question) {
  // 行队列消费：question() 会丢弃无人提问时到达的行（脚本化/批量输入必踩），
  // 这里先入队再按提问顺序取出。
  if (rl._mtaLineQueue === undefined) {
    rl._mtaLineQueue = [];
    rl._mtaLineWaiter = null;
    rl.on('line', (line) => {
      if (rl._mtaLineWaiter) {
        const resolveWaiter = rl._mtaLineWaiter;
        rl._mtaLineWaiter = null;
        resolveWaiter(line);
      } else {
        rl._mtaLineQueue.push(line);
      }
    });
  }
  process.stdout.write(question);
  if (rl._mtaLineQueue.length > 0) return Promise.resolve(rl._mtaLineQueue.shift());
  return new Promise((resolvePromise) => {
    rl._mtaLineWaiter = resolvePromise;
  });
}

/** 交互菜单：项目 → 大模块 → 特性 → 用例，编号下钻；0 运行本层全部；b 返回；q 退出。 */
async function runMenu({ root, flags, passthrough, env }) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let stack = [];
  try {
    for (;;) {
      let tree;
      try {
        tree = buildCaseTree(root);
      } catch (error) {
        console.error(`[run-case] ${error.message}`);
        process.exitCode = 1;
        return;
      }
      if (tree.length === 0) {
        console.log(
          '[run-case] cases/ 还没有业务项目 —— 先运行 pnpm case --new-project <项目> --platform <平台> 创建骨架',
        );
        process.exitCode = 1;
        return;
      }
      const scopeNode = stack.reduce(
        (node, index) => (node === null ? tree[index] : node.children[index]),
        null,
      );
      const rows = scopeNode === null ? tree : scopeNode.children;

      const platforms = [...new Set(tree.map((node) => node.platform))];
      const issues = collectSelfCheckIssues({ platforms, env });
      console.log('');
      if (issues.length === 0) {
        console.log('  ✔ 环境就绪（模型已配置，设备可用）');
      } else {
        for (const issue of issues) console.log(`  ✗ ${issue}`);
      }
      const breadcrumb = ['cases', ...breadcrumbNames(tree, stack)].join(' / ');
      console.log(`\n  当前位置：${breadcrumb}`);
      rows.forEach((node, index) => {
        console.log(
          `   ${index + 1}. ${node.label}${node.label !== node.name ? `（${node.name}）` : ''}  用例 ${countCases(node)}  平台 ${node.platform}`,
        );
      });
      const scopeFiles = listScopeCaseFiles(
        root,
        scopeNode ? scopeNode.path : CASES_ROOT,
      );
      if (scopeFiles.length > 0) {
        console.log(`   0. 运行本层全部（${scopeFiles.length} 个用例文件）`);
      }
      console.log('  输入编号下钻（1.2 连级）；0 运行本层全部；b 返回；r 刷新自检；q 退出');
      const answer = (await promptLine(rl, '  > ')).trim();
      if (answer === 'q') return;
      if (answer === 'b') {
        stack.pop();
        continue;
      }
      if (answer === 'r') continue;
      if (answer === '0') {
        if (scopeFiles.length === 0) continue;
        await executeTargets(scopeNode ? [scopeNode.path] : tree.map((node) => node.name), {
          flags,
          passthrough,
          env,
          root,
        });
        continue;
      }
      const indexes = answer.split('.').map((part) => Number.parseInt(part, 10));
      if (indexes.some((value) => !Number.isInteger(value) || value <= 0)) {
        console.log('  输入无效；请输入编号、0、b、r 或 q');
        continue;
      }
      let level = rows;
      const stackAdd = [];
      let valid = true;
      let chosen;
      for (const [position, value] of indexes.entries()) {
        if (value > level.length) {
          valid = false;
          break;
        }
        chosen = level[value - 1];
        if (position < indexes.length - 1) {
          if (chosen.children.length === 0) {
            valid = false;
            break;
          }
          stackAdd.push(value - 1);
          level = chosen.children;
        }
      }
      if (!valid) {
        console.log('  编号超出范围');
        continue;
      }
      stack = [...stack, ...stackAdd];
      if (chosen.children.length > 0) {
        stack.push(indexes[indexes.length - 1] - 1);
        continue;
      }
      if (countCases(chosen) === 0) {
        console.log('  该范围还没有用例');
        continue;
      }
      await executeTargets([chosen.path], { flags, passthrough, env, root });
    }
  } finally {
    rl.close();
  }
}

function breadcrumbNames(tree, stack) {
  const names = [];
  let level = tree;
  for (const index of stack) {
    names.push(level[index].name);
    level = level[index].children;
  }
  return names;
}

async function executeTargets(targets, { flags, passthrough, env, root = repoRoot }) {
  let plan;
  try {
    plan = resolvePlan({ targets, env, repoRoot: root });
  } catch (error) {
    console.error(`[run-case] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  await executePlan(plan, { flags, passthrough, env });
}

async function executePlan(plan, { flags, passthrough, env }) {
  const platforms = [...new Set(plan.groups.map((group) => group.project))];
  const issues = collectSelfCheckIssues({
    platforms,
    deviceRequirements: plan.deviceRequirements,
    env,
  });
  if (issues.length > 0) {
    for (const issue of issues) console.error(`[run-case] ✗ ${issue}`);
    console.error('[run-case] 环境未就绪，已阻止执行；修复后重试');
    process.exitCode = 1;
    return;
  }
  let firstFailure;
  for (const group of plan.groups) {
    const result = await runGroup(group, { passthrough, verbose: flags.verbose });
    if (result.lines && result.lines.length > 0 && result.status !== 0) {
      console.log('  ── 失败详情（尾部）──');
      for (const line of result.lines.slice(-20)) console.log(`  ${line}`);
    }
    const reportPath = reportPathFrom(result.seen ?? []);
    if (reportPath) {
      console.log(`[run-case] 报告：${reportPath}`);
      if (!flags.noOpen && process.stdout.isTTY) {
        const opened = openReport(reportPath);
        console.log(
          opened ? '[run-case] 已在浏览器打开报告' : '[run-case] 报告打开失败，可手动打开上方路径',
        );
      }
    }
    if (result.status !== 0 && firstFailure === undefined) firstFailure = result.status;
  }
  console.log(
    firstFailure === undefined
      ? '[run-case] ✔ 全部通过'
      : `[run-case] ✗ 存在失败（退出码 ${firstFailure}）`,
  );
  if (firstFailure !== undefined) process.exitCode = firstFailure;
}

async function main() {
  // MTA_REPO_ROOT 为内部测试契约：脚本化验证时指向夹具仓库；使用方不需要设置。
  const root = process.env.MTA_REPO_ROOT ?? repoRoot;
  loadEnv({ path: join(root, '.env') });
  if (process.env.MTA_SUITE) {
    console.error(
      `[run-case] MTA_SUITE（level/smoke 分级）已退役（收到 ${process.env.MTA_SUITE}）；` +
        '改用 pnpm case <项目>[/<大模块>] 选择执行范围',
    );
    process.exitCode = 1;
    return;
  }
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[run-case] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const { targets, passthrough, flags } = parsed;

  if (flags.newProject !== undefined) {
    try {
      const created = scaffoldProject({
        repoRoot: root,
        name: flags.newProject,
        platform: flags.platform,
      });
      console.log(
        `[run-case] ✔ 已创建 ${relative(root, created.projectDir)}（${PROJECT_DECLARATION_FILE} + ${created.modules.join(' / ')}）`,
      );
    } catch (error) {
      console.error(`[run-case] ${error.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (flags.all) {
    const declarations = loadProjectDeclarations(root);
    if (declarations.length === 0) {
      console.error(
        '[run-case] cases/ 还没有业务项目 —— 先运行 pnpm case --new-project <项目> --platform <平台> 创建骨架',
      );
      process.exitCode = 1;
      return;
    }
    await executeTargets(declarations.map((entry) => entry.name), {
      flags,
      passthrough,
      env: process.env,
      root,
    });
    return;
  }

  if (targets.length === 0) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      await runMenu({ root, flags, passthrough, env: process.env });
      return;
    }
    // 非交互环境不阻塞：打印范围清单后退出。
    try {
      const tree = buildCaseTree(root);
      if (tree.length === 0) {
        console.log('[run-case] cases/ 还没有业务项目 —— 可先运行 pnpm case --new-project <项目> --platform <平台>');
      } else {
        console.log('[run-case] 可执行范围清单（非交互环境；直接给目标执行，如 pnpm case EV760/system）：');
        for (const line of renderTreeLines(tree)) console.log(`  ${line}`);
      }
    } catch (error) {
      console.error(`[run-case] ${error.message}`);
    }
    process.exitCode = 1;
    return;
  }

  await executeTargets(targets, { flags, passthrough, env: process.env, root });
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main();
}
