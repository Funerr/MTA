/** scripts/run-case.mjs 的类型声明：统一执行入口的纯函数面（实现保持裸 Node 可运行）。 */

export declare class RunCaseError extends Error {}

export declare interface ParsedCaseFlags {
  verbose: boolean;
  noOpen: boolean;
  all: boolean;
  newProject?: string;
  platform?: string;
}
export declare interface ParsedCaseArgs {
  targets: string[];
  passthrough: string[];
  flags: ParsedCaseFlags;
}

export declare interface CaseExecutionGroup {
  root: 'cases' | 'examples';
  project: string;
  files: string[];
}

export declare function parseArgs(argv: readonly string[]): ParsedCaseArgs;

export declare function resolvePlan(options: {
  targets: readonly string[];
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  fileExists?: (path: string) => boolean;
  readText?: (path: string) => string;
}): { groups: CaseExecutionGroup[]; deviceRequirements: string[] };

export declare function buildCommandArgs(
  group: Pick<CaseExecutionGroup, 'root' | 'project'>,
  passthrough?: readonly string[],
): string[];

export declare function parseAdbDevices(output: string): { id: string; state: string }[];
export declare function parseHdcTargets(output: string): { id: string }[];

export declare function collectSelfCheckIssues(input: {
  platforms: readonly string[];
  deviceRequirements?: readonly string[];
  env?: NodeJS.ProcessEnv;
  run?: (command: string, args: readonly string[]) => { ok: boolean; output: string };
}): string[];

export declare function classifyProgressLine(line: string): 'progress' | 'detail' | 'quiet';
export declare function reportPathFrom(lines: readonly string[]): string | undefined;

export declare function scaffoldProject(input: {
  repoRoot?: string;
  name: string;
  /** 缺失时运行时报错并列出可选平台（显式失败，不给默认值）。 */
  platform?: string;
}): { projectDir: string; modules: string[] };
