import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import type { NodeExecutionContext } from '@midscene/test';
import { defineTestProject } from '@midscene/test/config';
import { createMidsceneNodes } from '@midscene/test/midscene';
import { AndroidAgent } from '@midscene/android';
import { HarmonyAgent } from '@midscene/harmony';
import {
  androidProjectSetup,
  type AndroidProjectContext,
} from './src/setup/android';
import {
  harmonyProjectSetup,
  type HarmonyProjectContext,
} from './src/setup/harmony';
import {
  frameworkNodes,
  type DeviceLifecycleProjectContext,
} from './src/nodes';

loadEnv({ path: fileURLToPath(new URL('.env', import.meta.url)) });

const getAndroidAgent = ({
  context,
}: NodeExecutionContext<unknown, AndroidProjectContext>) => context.agent;

const getHarmonyAgent = ({
  context,
}: NodeExecutionContext<unknown, HarmonyProjectContext>) => context.agent;

// 两平台原生 Nodes 存在大量同名节点（aiAct/launch/home…），不能同时进全局
// nodes；各自在项目本地注册，按平台互不覆盖（项目本地节点按同名覆盖全局节点）。
// 原生 aiAct / aiAssert / launch / terminate / back / home / recentApps 等
// 参数与错误契约全部保留 Midscene 原生定义，android 侧另有 runAdbShell、
// harmony 侧另有 runHdcShell。
const androidNodes = createMidsceneNodes<AndroidProjectContext>({
  agentClass: AndroidAgent,
  getAgent: getAndroidAgent,
});

const harmonyNodes = createMidsceneNodes<HarmonyProjectContext>({
  agentClass: HarmonyAgent,
  getAgent: getHarmonyAgent,
});

export default defineTestProject<DeviceLifecycleProjectContext>({
  // 双执行项目串行执行：一个项目一个设备会话，并发为 1。
  test: { maxConcurrency: 1 },
  projects: [
    {
      name: 'android',
      setup: androidProjectSetup,
      // 业务用例仅从使用方目录 cases/android/ 发现；框架测试与夹具不进入业务发现范围。
      files: {
        include: ['cases/android/**/*.{yaml,yml}'],
        exclude: ['tests/**/*.{yaml,yml}'],
      },
      nodes: androidNodes,
    },
    {
      name: 'harmony',
      setup: harmonyProjectSetup,
      // 业务用例仅从使用方目录 cases/harmony/ 发现；框架测试与夹具不进入业务发现范围。
      files: {
        include: ['cases/harmony/**/*.{yaml,yml}'],
        exclude: ['tests/**/*.{yaml,yml}'],
      },
      nodes: harmonyNodes,
    },
  ],
  // 全局仅保留两平台结构兼容的框架生命周期节点。
  nodes: [...frameworkNodes],
});
