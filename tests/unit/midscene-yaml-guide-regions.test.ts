import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GUIDE_PATH,
  PROJECTS,
  buildGuideRegionsFromReferences,
  buildMultiDeviceRegion,
  extractGeneratedRegion,
  parseNodeReference,
  spliceGeneratedRegions,
} from '../../scripts/lib/yaml-guide-regions.mjs';
import {
  devicePrepareNode,
  deviceRecoverNode,
  deviceWaitUntilNode,
  experienceActNode,
} from '../../src/nodes';
import { DEVICE_PARALLEL_NODE_NAME } from '../../src/nodes/device-parallel';

const projectRoot = process.cwd();

function readProjectFile(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

/**
 * 守护 docs/midscene-yaml-guide.md 的 Node 清单生成区块：
 * 与已提交的 midscene-node-reference.<project>.md 派生内容一致，
 * 且 MTA 自定义 Node 均被清单与能力章节覆盖。自定义 Node 变更后
 * 需重跑 `pnpm run nodes` 刷新参考与指南。
 */
describe('midscene-yaml-guide 生成区块', () => {
  const guide = readProjectFile(GUIDE_PATH);
  const referencesByProject = Object.fromEntries(
    PROJECTS.map((project) => [
      project,
      readProjectFile(`midscene-node-reference.${project}.md`),
    ]),
  );
  const rebuilt = buildGuideRegionsFromReferences(referencesByProject);

  it.each([...PROJECTS])('%s 区块与参考文档派生内容一致', (project) => {
    expect(extractGeneratedRegion(guide, project)).toBe(rebuilt[project]);
  });

  it('区块已生成而非占位', () => {
    for (const project of PROJECTS) {
      expect(rebuilt[project]).not.toContain('待 `pnpm run nodes` 生成');
      expect(rebuilt[project]).toContain('| Node |');
    }
  });

  it('重新拼接幂等，不改动区块外内容', () => {
    expect(spliceGeneratedRegions(guide, rebuilt)).toBe(guide);
  });

  it('单设备项目清单覆盖全部自定义 Node', () => {
    for (const project of ['android', 'harmony'] as const) {
      const region = extractGeneratedRegion(guide, project);
      for (const name of [
        devicePrepareNode.name,
        deviceRecoverNode.name,
        deviceWaitUntilNode.name,
        experienceActNode.name,
      ]) {
        expect(region).toContain(`\`${name}\``);
      }
    }
  });

  it('协作项目清单包含 device.parallel、显式等待与别名化生命周期 Node', () => {
    const region = extractGeneratedRegion(guide, 'multi-device');
    expect(region).toContain(`\`${DEVICE_PARALLEL_NODE_NAME}\``);
    expect(region).toContain('device.waitUntil');
    expect(region).toContain('device.prepare');
    expect(region).toContain('device.recover');
    expect(region).toContain('`wait`');
  });

  it('协作清单按签名折叠别名并保留平台差异', () => {
    const region = buildMultiDeviceRegion(
      parseNodeReference(referencesByProject['multi-device']!),
    );
    // 同名同契约的别名化 Node 折叠为一行 <alias>.<Node>。
    expect(region).toContain('| `<alias>.aiAct` | phone1、phone2 |');
    // 平台特有 shell Node 保持独立行，且不跨平台合并。
    expect(region).toMatch(/\| `<alias>\.runAdbShell` \| phone1 \|/);
    expect(region).toMatch(/\| `<alias>\.runHdcShell` \| phone2 \|/);
    // 平台描述不同的同名 Node 不强行折叠为同一行。
    expect(region).toContain('`phone1.back`');
    expect(region).toContain('`phone2.back`');
  });

  it('指南手写章节声明刷新机制与自定义能力', () => {
    expect(guide).toContain('pnpm run nodes');
    expect(guide).toContain('## 7. 自定义 Node 能力');
    expect(guide).toContain('device.parallel');
    expect(guide).toContain('experienceAct');
  });
});
