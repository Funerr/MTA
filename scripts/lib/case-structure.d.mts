/** scripts/lib/case-structure.mjs 的类型声明：用例结构共享层（项目域组织）。 */

export declare const EXECUTION_PROJECTS: readonly string[];
export declare const CASES_ROOT: string;
export declare const EXAMPLES_ROOT: string;
export declare const PROJECT_DECLARATION_FILE: string;

export declare interface ScaffoldModule {
  dir: string;
  label: string;
}
export declare const SCAFFOLD_MODULES: readonly ScaffoldModule[];
export declare const MODULE_LABELS: ReadonlyMap<string, string>;

export declare class CaseStructureError extends Error {}

export declare interface ProjectDeclaration {
  platform: string;
  devices: string[];
}
export declare interface ProjectInfo extends ProjectDeclaration {
  name: string;
  dirPosix: string;
}
export declare interface DeviceBinding {
  alias: string;
  platform: string;
  idEnv: string;
}
export declare interface CaseTreeNode {
  name: string;
  label: string;
  path: string;
  platform: string;
  devices: string[];
  children: CaseTreeNode[];
  cases: { stem: string; file: string }[];
}
export declare interface ResolvedTarget {
  project: ProjectInfo;
  kind: 'project' | 'module' | 'scope' | 'case';
  scope: string;
  files: string[];
}

export declare function isCaseSegmentName(name: string): boolean;
export declare function caseFileStem(filename: string): string | undefined;
export declare function assertCasePathNaming(relativePosixPath: string): void;
export declare function parseProjectDeclaration(
  source: string,
  label?: string,
): ProjectDeclaration;
export declare function loadProjectDeclarations(repoRoot: string): ProjectInfo[];
export declare function parseCaseDeviceRequirements(source: string): string[] | undefined;
export declare function parseBindingAliases(
  spec: string | undefined,
  defaultSpec: string,
): DeviceBinding[];
export declare function validateDeviceRequirements(input: {
  platform: string;
  caseDevices?: string[];
  projectDevices?: string[];
  bindingAliases?: DeviceBinding[];
}): string[];
export declare function listScopeCaseFiles(repoRoot: string, scopeDirPosix: string): string[];
export declare function buildCaseTree(repoRoot: string): CaseTreeNode[];
export declare function resolveNamespaceTarget(
  target: string,
  repoRoot: string,
  declarations?: ProjectInfo[],
): ResolvedTarget;
export declare function inferExamplesProject(posixPath: string): string | undefined;
export declare function executionProjectOf(
  posixPath: string,
  declarations: readonly ProjectInfo[],
): string | undefined;
