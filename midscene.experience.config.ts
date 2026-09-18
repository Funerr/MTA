import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import type { NodeExecutionContext } from '@midscene/test';
import { defineTestProject } from '@midscene/test/config';
import { createMidsceneNodes } from '@midscene/test/midscene';
import { HarmonyAgent } from '@midscene/harmony';
import {
  createHarmonyExperienceProjectSetup,
  type HarmonyExperienceProjectContext,
} from './src/setup/harmony-experience';
import {
  frameworkNodes,
  type DeviceLifecycleProjectContext,
} from './src/nodes';
import {
  loadExperienceIntegrationConfig,
  wrapMidsceneNodesWithExperience,
} from './src/experience/integration';

loadEnv({ path: fileURLToPath(new URL('.env', import.meta.url)) });

const getHarmonyAgent = ({
  context,
}: NodeExecutionContext<unknown, HarmonyExperienceProjectContext>) => context.agent;

const experienceIntegration = loadExperienceIntegrationConfig();

const harmonyNodes = wrapMidsceneNodesWithExperience(
  createMidsceneNodes<HarmonyExperienceProjectContext>({
    agentClass: HarmonyAgent,
    getAgent: getHarmonyAgent,
  }),
  experienceIntegration,
);

// 经验学习环境配置（基于实际设备信息）
const experienceEnvironment = {
  platform: 'harmony' as const,
  model: 'HUAWEI MatePad 11.5\'\'S',
  systemBuild: '6.1.0.135',
  resolution: { width: 2560, height: 1600 }, // MatePad 11.5''S 标准分辨率
  orientation: 'portrait' as const,
  language: 'zh',
  theme: 'light',
  executionCompatVersion: '1.0.0',
};

// 经验动作策略：登记可重放目标
const experienceActionPolicy = {
  version: '1.0.0',
  targets: [
    {
      prompt: '点击主屏幕上的时钟或时间显示区域',
      repeatableFromCurrentState: true,
    },
  ],
};

export default defineTestProject<DeviceLifecycleProjectContext>({
  test: { maxConcurrency: 1 },
  projects: [
    {
      name: 'harmony-experience',
      setup: createHarmonyExperienceProjectSetup({
        experienceEnvironment,
        experienceActionPolicy,
        experienceStoreRoot: '.midscene/experience-store',
      }),
      files: {
        include: ['examples/harmony-experience/**/*.{yaml,yml}'],
        exclude: ['tests/**/*.{yaml,yml}'],
      },
      nodes: harmonyNodes,
    },
  ],
  nodes: [...frameworkNodes],
});