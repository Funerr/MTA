#!/usr/bin/env node
/**
 * 一键初始化入口（simplify-project-init）。
 *
 * 依次执行：Node 版本前提检测 → pnpm 可用性检测 → pnpm install →
 * .env 脚手架 → 环境预检报告 → 下一步指引。
 *
 * 边界：只检测与报告，不替用户安装 Node / pnpm，不替用户选择设备；
 * 前提检测失败在任何安装动作之前非零退出；预检阶段（模型配置空、
 * 工具缺失、设备零台或多台）只报告不失败。裸 Node 标准库实现，
 * 不依赖 node_modules，可在依赖安装前运行；可安全重复执行
 * （.env 不覆盖、pnpm install 天然增量）。
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { satisfiesEnginesNode } from './lib/engines-range.mjs';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const IS_WINDOWS = process.platform === 'win32';

function readEnginesNode() {
  try {
    return JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
      ?.engines?.node;
  } catch {
    return undefined;
  }
}

/** 检测当前 Node 是否满足 engines.node；不满足即非零退出，不替装。 */
function checkNodeVersion() {
  const current = process.versions.node;
  const enginesNode = readEnginesNode();
  const result = satisfiesEnginesNode(current, enginesNode ?? '');
  if (result === null) {
    console.warn(
      `[mta] 无法解析 engines.node 约束“${enginesNode ?? '(缺失)'}”，跳过版本硬校验，交由 pnpm install 的 engines 提示兜底。`,
    );
    return;
  }
  if (!result) {
    console.error(`[mta] Node ${current} 不满足本仓库要求的 ${enginesNode}。`);
    console.error(
      '[mta] 请自行升级 Node 后重新运行本脚本（例如 nvm install --lts && nvm use --lts，或 brew upgrade node，或参考 https://nodejs.org/）。',
    );
    process.exit(1);
  }
  console.log(`[mta] Node ${current} 满足 ${enginesNode}。`);
}

/** 检测 pnpm 是否可调用；缺失即非零退出并给出安装指引，不替装。 */
function checkPnpm() {
  const result = spawnSync('pnpm', ['--version'], {
    encoding: 'utf8',
    shell: IS_WINDOWS,
  });
  if (result.error || result.status !== 0) {
    console.error('[mta] 未检测到可用的 pnpm。');
    console.error(
      '[mta] 请自行安装后重新运行本脚本：corepack enable（Node 自带），或 npm install -g pnpm，或参考 https://pnpm.io/installation。',
    );
    process.exit(1);
  }
  console.log(`[mta] pnpm ${result.stdout.trim()} 可用。`);
}

/** 执行 pnpm install，透传输出与退出码；失败保留原始错误、非零退出。 */
function runInstall() {
  console.log('[mta] 执行 pnpm install（首次安装体积较大、耗时较长，属正常现象）…');
  const result = spawnSync('pnpm', ['install'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: IS_WINDOWS,
  });
  if (result.error) {
    console.error(`[mta] pnpm install 无法启动：${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      `[mta] pnpm install 失败（退出码 ${result.status}，原始错误见上方输出）。解决后重新运行本脚本即可续装。`,
    );
    process.exit(result.status ?? 1);
  }
  console.log('[mta] 依赖安装完成。');
}

/** .env 脚手架：不存在则从 .env.example 复制；已存在则跳过，绝不修改。 */
function scaffoldEnvFile() {
  const target = join(projectRoot, '.env');
  if (existsSync(target)) {
    console.log('[mta] .env 已存在，跳过（不覆盖已有配置）。');
    return;
  }
  copyFileSync(join(projectRoot, '.env.example'), target);
  console.log('[mta] 已从 .env.example 生成 .env。');
  console.log(
    '[mta] 请编辑 .env 填写模型四项配置：MIDSCENE_MODEL_BASE_URL / MIDSCENE_MODEL_API_KEY / MIDSCENE_MODEL_NAME / MIDSCENE_MODEL_FAMILY（说明与可选值来源见 .env.example 头部注释）。',
  );
}

const MODEL_KEYS = [
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_NAME',
  'MIDSCENE_MODEL_FAMILY',
];

/** 解析 .env 的 KEY=VALUE（跳过注释/无效行，剥离成对引号）；文件缺失返回 null。 */
function readEnvValues() {
  try {
    const values = new Map();
    for (const line of readFileSync(join(projectRoot, '.env'), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      values.set(key, value);
    }
    return values;
  } catch {
    return null;
  }
}

/** 只读枚举 adb 设备（不选择）；不可用返回 { available: false }。 */
function listAdbDevices() {
  const result = spawnSync('adb', ['devices'], { encoding: 'utf8', shell: IS_WINDOWS });
  if (result.error || result.status !== 0) return { available: false };
  const devices = [];
  for (const line of result.stdout.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length >= 2 && cols[0] !== 'List') {
      devices.push({ udid: cols[0], state: cols[1] });
    }
  }
  return { available: true, devices };
}

/** 只读枚举 hdc 目标（不选择）；不可用返回 { available: false }。 */
function listHdcTargets() {
  const result = spawnSync('hdc', ['list', 'targets'], {
    encoding: 'utf8',
    shell: IS_WINDOWS,
  });
  if (result.error || result.status !== 0) return { available: false };
  const targets = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('['));
  return { available: true, targets };
}

/** 环境预检报告：模型配置完整性 + adb / hdc 可用性与设备枚举；只报告，不失败。 */
function printPreflight() {
  console.log('[mta] 环境预检（只报告现状，不替你选择设备或写回配置）：');

  const values = readEnvValues();
  console.log('  模型配置（.env）');
  for (const key of MODEL_KEYS) {
    const filled = values !== null && (values.get(key) ?? '') !== '';
    console.log(`    ${key.padEnd(24)} ${filled ? '✓ 已填写' : '✗ 未填写'}`);
  }
  if (values === null) {
    console.log('    → 未找到 .env，请先按上方脚手架提示生成。');
  } else if (MODEL_KEYS.every((key) => (values.get(key) ?? '') === '')) {
    console.log('    → 四项均空：填写说明与可选值来源见 .env.example 头部注释。');
  }

  console.log('  平台工具');
  const adb = listAdbDevices();
  if (!adb.available) {
    console.log('    adb ✗ 不可用（运行 Android 用例需要；请安装 Android platform-tools）');
  } else {
    const online = adb.devices.filter((d) => d.state === 'device');
    console.log(`    adb ✓（已授权在线：${online.length} 台）`);
    for (const device of adb.devices) {
      console.log(`      - ${device.udid} (${device.state})`);
    }
    if (online.length === 0) {
      console.log('      → 未发现已授权在线设备；连接并授权后重跑本脚本查看。');
    } else if (online.length > 1) {
      console.log('      → 多台在线：运行用例前请在 .env 用 ANDROID_DEVICE_ID 显式指定目标。');
    }
  }

  const hdc = listHdcTargets();
  if (!hdc.available) {
    console.log('    hdc ✗ 不可用（仅 HarmonyOS 用例需要；可用 HDC_HOME 指定 hdc 所在目录）');
  } else {
    console.log(`    hdc ✓（在线目标：${hdc.targets.length} 台）`);
    for (const target of hdc.targets) {
      console.log(`      - ${target}`);
    }
    if (hdc.targets.length === 0) {
      console.log('      → 无在线目标；连接鸿蒙设备后重跑本脚本查看。');
    } else if (hdc.targets.length > 1) {
      console.log('      → 多台在线：运行用例前请在 .env 用 HARMONY_DEVICE_ID 显式指定目标。');
    }
  }
}

/** 成功结束前的最小下一步指引。 */
function printNextSteps() {
  console.log('[mta] 下一步：');
  console.log('  1. 编辑 .env，填写模型四项配置（说明见 .env.example 头部注释）。');
  console.log(
    '  2. 新建项目骨架：pnpm case --new-project <项目> --platform <android|harmony|multi-device>；用例 YAML 放入 cases/<项目>/<大模块>/<特性>/，执行平台由 cases/<项目>/project.yaml 声明，文件名不带平台后缀。',
  );
  console.log(
    '  3. 运行用例：pnpm case 进入菜单（环境自检 + 编号下钻），或 pnpm case <项目>/<大模块>/<特性>/<用例> 直接执行。',
  );
}

function main() {
  console.log(`[mta] 初始化开始：${projectRoot}`);
  checkNodeVersion();
  checkPnpm();
  runInstall();
  scaffoldEnvFile();
  printPreflight();
  printNextSteps();
}

main();
