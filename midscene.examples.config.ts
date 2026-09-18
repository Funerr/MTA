import { defineTestProject } from '@midscene/test/config';
import config from './midscene.config';

// 演示须显式选择执行项目；经验演示使用 midscene.experience.config.ts。
export default defineTestProject({
  ...config,
  projects: config.projects!.map((project) => ({
    ...project,
    files: {
      include: [`examples/${project.name}/**/*.{yaml,yml}`],
      exclude: ['tests/**/*.{yaml,yml}'],
    },
  })),
});
