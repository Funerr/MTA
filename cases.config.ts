/** 测试集只选择工作流；执行仍由官方 Midscene Runner 负责。 */
export type ExecutionProject = 'android' | 'harmony' | 'multi-device';

export function caseFiles(project: ExecutionProject, suite = process.env.MTA_SUITE ?? 'full') {
  const directories: Record<string, string> = {
    full: 'level{1,2,3}',
    smoke: 'level1',
    level1: 'level1',
    level2: 'level2',
    level3: 'level3',
  };
  if (!Object.hasOwn(directories, suite)) {
    throw new Error(`未知 MTA_SUITE: ${suite}；可选 full、smoke、level1、level2、level3`);
  }
  return {
    include: [`cases/${directories[suite]}/**/*.${project}.{yaml,yml}`],
    exclude: ['tests/**/*.{yaml,yml}', 'examples/**/*.{yaml,yml}'],
  };
}
