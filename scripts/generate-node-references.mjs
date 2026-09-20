/**
 * Node 参考与 YAML 指南生成区块的生成入口（android / harmony / multi-device 执行项目）。
 * 官方 `midscene-test nodes` 在多项目 Nodes 不同时要求 `--project <name>` 选择，
 * 且输出路径固定为 midscene-node-reference.md；这里按项目分别生成并落为
 * midscene-node-reference.<project>.md，避免相互覆盖。
 * 随后依据三份参考刷新 docs/midscene-yaml-guide.md 的「Node 清单」生成区块，
 * 保证指南中的语法糖与自定义 Node 能力清单随注册表派生产物及时更新。
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GUIDE_PATH,
  buildGuideRegionsFromReferences,
  spliceGeneratedRegions,
} from './lib/yaml-guide-regions.mjs';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultReference = join(projectRoot, 'midscene-node-reference.md');
const projects = ['android', 'harmony', 'multi-device'];

for (const project of projects) {
  const result = spawnSync('midscene-test', ['nodes', '--project', project], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  copyFileSync(
    defaultReference,
    join(projectRoot, `midscene-node-reference.${project}.md`),
  );
}

// 清理官方 CLI 的固定输出，仅保留按平台命名的参考文件。
rmSync(defaultReference, { force: true });

const referencesByProject = Object.fromEntries(
  projects.map((project) => [
    project,
    readFileSync(join(projectRoot, `midscene-node-reference.${project}.md`), 'utf8'),
  ]),
);
const guidePath = join(projectRoot, GUIDE_PATH);
writeFileSync(
  guidePath,
  spliceGeneratedRegions(
    readFileSync(guidePath, 'utf8'),
    buildGuideRegionsFromReferences(referencesByProject),
  ),
  'utf8',
);
