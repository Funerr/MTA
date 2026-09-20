import type { CaseLevel } from '../document';

/**
 * 导入解析的统一结果：解析出的用例草稿、解析问题与未转换清单。
 * 规则解析器是确定性代码；语义不明的段落进入未转换清单，交给后续
 * 模型生成阶段处理，不做猜测。规则解析识别不出结构时由调用方
 * （routes）走模型识别兜底（assist.ts），结果整体标记 viaModel。
 */

export type ImportKind = 'paste' | 'text' | 'markdown' | 'excel';

export interface ImportedExpectation {
  text: string;
  /** 关联步骤序号（零基）；缺省表示整条用例。 */
  actionIndex?: number;
}

export interface ImportedCaseDraft {
  sourceId: string;
  name: string;
  goal: string;
  preconditions: string[];
  actions: string[];
  expectations: ImportedExpectation[];
  level: CaseLevel;
  /** 来源定位（行范围或单元格范围）。 */
  sourceRange: string;
  /** 原文片段（保留原文）。 */
  excerpt: string;
  data?: string;
}

export interface ImportIssue {
  message: string;
  /** 相关来源范围（可定位）。 */
  range?: string;
}

export interface UnconvertedBlock {
  /** 原文片段。 */
  excerpt: string;
  /** 未转换原因。 */
  reason: string;
  range?: string;
}

export interface ImportParseResult {
  kind: ImportKind;
  cases: ImportedCaseDraft[];
  issues: ImportIssue[];
  unconverted: UnconvertedBlock[];
  /** true 表示草稿由编写模型识别生成（规则解析未识别出结构时的兜底）。 */
  viaModel?: boolean;
  /** 模型识别的补充说明（可选）。 */
  modelNotes?: string[];
}

export function emptyResult(kind: ImportKind): ImportParseResult {
  return { kind, cases: [], issues: [], unconverted: [] };
}
