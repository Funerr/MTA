import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import type { NodeExecutionContext } from '@midscene/test';
import { defineTestProject } from '@midscene/test/config';
import { createMidsceneNodes } from '@midscene/test/midscene';
import { AndroidAgent } from '@midscene/android';
import {
  androidProjectSetup,
  type AndroidProjectContext,
} from './src/setup/android';
import { frameworkNodes } from './src/nodes';

loadEnv({ path: fileURLToPath(new URL('.env', import.meta.url)) });

const getAgent = ({
  context,
}: NodeExecutionContext<unknown, AndroidProjectContext>) => context.agent;

// 原生 Nodes：aiAct / aiAssert / launch / terminate / runAdbShell / back /
// home / recentApps 等，参数与错误契约全部保留 Midscene 原生定义。
const androidNodes = createMidsceneNodes<AndroidProjectContext>({
  agentClass: AndroidAgent,
  getAgent,
});

export default defineTestProject<AndroidProjectContext>({
  // 首期单执行项目、串行执行：一个项目一个设备会话，并发为 1。
  test: { maxConcurrency: 1 },
  projects: [
    {
      name: 'android',
      setup: androidProjectSetup,
      // 业务用例仅从使用方目录 cases/ 发现；框架测试与夹具不进入业务发现范围。
      files: {
        include: ['cases/**/*.{yaml,yml}'],
        exclude: ['tests/**/*.{yaml,yml}'],
      },
    },
  ],
  nodes: [...androidNodes, ...frameworkNodes],
});
