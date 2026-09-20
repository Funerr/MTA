// 编写工作台前端构建：esbuild 打包 preact+htm 应用到 web/dist。
// 仅做转译打包，类型检查由 tsc -p src/workbench/web/tsconfig.json 负责。
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const webRoot = fileURLToPath(new URL('../src/workbench/web', import.meta.url));
const outDir = join(webRoot, 'dist');

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(webRoot, 'src/main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: join(outDir, 'app.js'),
  sourcemap: false,
  logLevel: 'info',
});

for (const file of ['index.html', 'styles.css']) {
  copyFileSync(join(webRoot, file), join(outDir, file));
}
