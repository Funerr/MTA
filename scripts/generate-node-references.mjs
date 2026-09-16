/**
 * Node 参考生成入口（android/harmony 双执行项目）。
 * 官方 `midscene-test nodes` 在两项目 Nodes 不同时要求 `--project <name>` 选择，
 * 且输出路径固定为 midscene-node-reference.md；这里按项目分别生成并落为
 * midscene-node-reference.<project>.md，避免相互覆盖。
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultReference = join(projectRoot, 'midscene-node-reference.md');
const projects = ['android', 'harmony'];

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
