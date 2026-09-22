/** 知识条目：索引声明触发词与正文文件，正文懒加载。 */

export interface KnowledgeIndexEntry {
  /** 稳定标识，进入注入标记 `[knowledge:<id>]`。 */
  readonly id: string;
  /** 触发词；对 instruction 做子串匹配（ASCII 不区分大小写）。 */
  readonly triggers: readonly string[];
  /** 正文文件路径，相对知识根目录；不得越界。 */
  readonly file: string;
}

export interface KnowledgeIndex {
  readonly entries: readonly KnowledgeIndexEntry[];
}
