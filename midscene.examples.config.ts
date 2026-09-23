import { defineTestProject } from '@midscene/test/config';
import config from './midscene.config';
import { explicitCaseFileSelection } from './cases.config';

// 演示须显式选择执行项目；经验演示使用 midscene.experience.config.ts。
// 单文件入口（pnpm case）传入的显式清单同样在此生效：按平台后缀覆盖演示目录选择。
export default defineTestProject({
  ...config,
  projects: config.projects!.map((project) => ({
    ...project,
    files:
      explicitCaseFileSelection(project.name) ?? {
        include: [`examples/${project.name}/**/*.{yaml,yml}`],
        exclude: ['tests/**/*.{yaml,yml}'],
      },
  })),
});
