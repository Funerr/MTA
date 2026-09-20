/** scripts/lib/yaml-guide-regions.mjs 的类型声明，供单元测试与 TS 工程导入。 */

export interface ParsedReferenceNode {
  name: string;
  description: string;
  shorthand: string | null;
  schema: Record<string, any> | null;
}

export declare const GUIDE_PATH: string;
export declare const PROJECTS: readonly string[];

export declare function regionMarker(
  project: string,
  edge: 'start' | 'end',
): string;

export declare function parseNodeReference(
  markdown: string,
): ParsedReferenceNode[];

export declare function buildSingleProjectRegion(
  project: string,
  nodes: ParsedReferenceNode[],
): string;

export declare function buildMultiDeviceRegion(
  nodes: ParsedReferenceNode[],
): string;

export declare function spliceGeneratedRegions(
  guideMarkdown: string,
  regions: Record<string, string>,
): string;

export declare function extractGeneratedRegion(
  guideMarkdown: string,
  project: string,
): string;

export declare function buildGuideRegionsFromReferences(
  referencesByProject: Record<string, string>,
): Record<string, string>;
