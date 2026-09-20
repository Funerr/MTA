import { emptyResult, type ImportedCaseDraft, type ImportParseResult } from './types';
import type { CaseLevel } from '../document';

/**
 * 整段粘贴 / 纯文本解析：标签式结构解析，保守策略——
 * 识别不了的段落进入未转换清单，不猜测、不虚构结构。
 *
 * 支持的形态：
 * - “编号：TC-001” 等标签行开启一条用例；
 * - 行首裸编号（“TC-001 打开设置”，空行后出现）开启一条用例；
 * - 名称/目的/前置条件/步骤/预期/数据/等级 标签段；
 * - 步骤/预期段内允许编号、多行续写与跨段文本。
 */

const LABEL_CASE_ID = /^(?:用例\s*)?(?:编号|ID|id|序号)\s*[：:]\s*(\S+)\s*$/;

const ID_INLINE =
  /^((?:TC|tc|Tc|CASE|case)[-#]?\d{1,5}|\d{1,4}(?:\.\d{1,3})*)\s*[.、)）]?\s+(.+)$/;

const SECTION_LABELS: readonly [RegExp, string][] = [
  [/^(?:用例\s*)?(?:名称|标题)\s*[：:]/, 'name'],
  [/^(?:测试\s*)?(?:目的|目标)\s*[：:]/, 'goal'],
  [/^(?:前置条件|前置|前提|环境要求)\s*[：:]/, 'preconditions'],
  [/^(?:操作步骤|操作|步骤|动作)\s*[：:]/, 'actions'],
  [/^(?:预期结果|预期|期望结果|结果)\s*[：:]/, 'expectations'],
  [/^(?:测试数据|数据)\s*[：:]/, 'data'],
  [/^(?:等级|优先级|级别)\s*[：:]/, 'level'],
];

const LIST_PREFIX = /^\s*(?:\d{1,3}\s*[.、)）]|[-*•·]|[a-zA-Z]\))\s*/;

const STEP_REF = /^步骤\s*(\d{1,3})\s*[：:]\s*(.*)$/;

const LEVEL_TOKEN = /^(?:level\s*([1-3])|[pP]([0-3]))$/;

const EXCERPT_MAX_CHARS = 4000;

export function parseTextCases(
  text: string,
  kind: 'paste' | 'text' = 'text',
): ImportParseResult {
  const result = emptyResult(kind);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  const seenSourceIds = new Map<string, number>();

  const state: { current: CaseBuilder | null } = { current: null };
  const sawEmptyExpectations = new Set<CaseBuilder>();
  let section: 'none' | 'preconditions' | 'actions' | 'expectations' = 'none';
  let lastLineBlank = true;

  const startCase = (sourceId: string, name: string, startLine: number, boundaryLine: string) => {
    flushCase();
    const builder = new CaseBuilder(sourceId, name, startLine);
    builder.excerptLines.push(boundaryLine);
    builder.endLine = startLine;
    state.current = builder;
    const seen = seenSourceIds.get(sourceId) ?? 0;
    if (seen > 0) {
      result.issues.push({
        message: `编号 ${sourceId} 重复（第 ${seen + 1} 次出现）；已分配独立内部标识`,
        range: `L${startLine}`,
      });
    }
    seenSourceIds.set(sourceId, seen + 1);
    section = 'none';
  };

  const flushCase = () => {
    const current = state.current;
    if (!current) return;
    if (sawEmptyExpectations.has(current) && current.expectations.length === 0) {
      result.issues.push({
        message: `用例 ${current.sourceId} 存在空的预期段，未从上一条用例填充`,
        range: `L${current.startLine}-L${current.endLine}`,
      });
    }
    const draft = current.build(result);
    if (draft) result.cases.push(draft);
    sawEmptyExpectations.delete(current);
    state.current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i]!;
    const line = rawLine.trim();
    const lineNumber = i + 1;

    if (!line) {
      lastLineBlank = true;
      section = 'none';
      continue;
    }

    // 用例边界 1：编号标签行
    const idLabel = LABEL_CASE_ID.exec(line);
    if (idLabel) {
      startCase(idLabel[1]!, '', lineNumber, line);
      lastLineBlank = false;
      continue;
    }

    // 用例边界 2：空行后的裸编号行
    if (!state.current || (lastLineBlank && section === 'none')) {
      const inline = ID_INLINE.exec(line);
      if (inline) {
        startCase(inline[1]!, inline[2]!.trim(), lineNumber, line);
        lastLineBlank = false;
        continue;
      }
    }

    // 段落标签
    const label = SECTION_LABELS.find(([pattern]) => pattern.test(line));
    if (label && state.current) {
      const current = state.current;
      current.excerptLines.push(line);
      current.endLine = lineNumber;
      const value = line.slice(line.indexOf('：') >= 0 ? line.indexOf('：') + 1 : line.indexOf(':') + 1).trim();
      const field = label[1];
      if (field === 'name') current.name = value || current.name;
      else if (field === 'goal') current.goal = value;
      else if (field === 'preconditions') {
        current.preconditions.push(...splitItems(value));
        section = 'preconditions';
      } else if (field === 'actions') {
        if (value) current.actions.push(stripListPrefix(value));
        section = 'actions';
      } else if (field === 'expectations') {
        if (value) current.expectations.push(stripListPrefix(value));
        else sawEmptyExpectations.add(current);
        section = 'expectations';
      } else if (field === 'data') current.data = value;
      else if (field === 'level') {
        const token = LEVEL_TOKEN.exec(value);
        if (token) {
          current.level = (`level${token[1] ?? token[2]}` as CaseLevel);
        } else {
          result.issues.push({
            message: `等级“${value}”无法识别，按默认 level2 处理`,
            range: `L${lineNumber}`,
          });
        }
      }
      lastLineBlank = false;
      continue;
    }
    if (label && !state.current) {
      result.unconverted.push({
        excerpt: line.slice(0, 200),
        reason: '标签段落出现在任何用例编号之前',
        range: `L${lineNumber}`,
      });
      continue;
    }

    // 段内续行
    const current = state.current;
    if (current && (section === 'actions' || section === 'expectations' || section === 'preconditions')) {
      current.excerptLines.push(line);
      current.endLine = lineNumber;
      if (section === 'actions') {
        if (LIST_PREFIX.test(rawLine) || !current.actions.length) {
          current.actions.push(stripListPrefix(line));
        } else {
          current.actions[current.actions.length - 1] += ` ${line}`;
        }
      } else if (section === 'expectations') {
        const stepRef = STEP_REF.exec(line);
        if (stepRef) {
          current.expectations.push(stripListPrefix(stepRef[2]!));
          current.expectationStepRefs.push(Number(stepRef[1]) - 1);
        } else if (LIST_PREFIX.test(rawLine) || !current.expectations.length) {
          current.expectations.push(stripListPrefix(line));
          current.expectationStepRefs.push(undefined);
        } else {
          current.expectations[current.expectations.length - 1] += ` ${line}`;
        }
      } else {
        if (LIST_PREFIX.test(rawLine) || !current.preconditions.length) {
          current.preconditions.push(stripListPrefix(line));
        } else {
          current.preconditions[current.preconditions.length - 1] += ` ${line}`;
        }
      }
      lastLineBlank = false;
      continue;
    }

    // 无法归属的行
    result.unconverted.push({
      excerpt: line.slice(0, 200),
      reason: current ? '无法识别的段落（缺少标签或用例边界）' : '未识别用例结构（缺少编号或标签）',
      range: `L${lineNumber}`,
    });
    lastLineBlank = false;
  }

  flushCase();

  // 完全没有识别出用例时，未转换清单折叠为整段一条（行级定位失去意义）。
  if (result.cases.length === 0 && lines.some((l) => l.trim())) {
    result.unconverted = [
      {
        excerpt: text.trim().slice(0, 500),
        reason: '未识别出任何用例结构；可改用模型转换或调整格式',
      },
    ];
  }

  return result;
}

class CaseBuilder {
  name: string;
  goal = '';
  preconditions: string[] = [];
  actions: string[] = [];
  expectations: string[] = [];
  expectationStepRefs: (number | undefined)[] = [];
  level: CaseLevel = 'level2';
  data?: string;
  excerptLines: string[] = [];
  readonly startLine: number;
  endLine: number;
  readonly sourceId: string;

  constructor(sourceId: string, name: string, startLine: number) {
    this.sourceId = sourceId;
    this.name = name;
    this.startLine = startLine;
    this.endLine = startLine;
  }

  build(result: ImportParseResult): ImportedCaseDraft | null {
    const excerpt = this.excerptLines.join('\n').slice(0, EXCERPT_MAX_CHARS);

    const droppedExpectations = this.expectations
      .map((text) => text.trim())
      .filter((text) => !text).length;
    const expectations = this.expectations
      .map((text, index) => ({ text: text.trim(), ref: this.expectationStepRefs[index] }))
      .filter((item) => item.text)
      .map((item) => ({ text: item.text, actionIndex: item.ref }));
    if (droppedExpectations > 0) {
      result.issues.push({
        message: `用例 ${this.sourceId} 存在 ${droppedExpectations} 条空预期，已忽略（不从上一条填充）`,
        range: `L${this.startLine}-L${this.endLine}`,
      });
    }

    // 预期与步骤数量一致且未显式关联时按顺序关联，并记录推断依据。
    let mapped: ImportedCaseDraft['expectations'] = expectations;
    if (
      this.actions.length > 0 &&
      expectations.length === this.actions.length &&
      expectations.every((item) => item.actionIndex === undefined)
    ) {
      mapped = expectations.map((item, index) => ({ ...item, actionIndex: index }));
      result.issues.push({
        message: `用例 ${this.sourceId} 的预期数量与步骤一致，已按顺序一一关联`,
        range: `L${this.startLine}-L${this.endLine}`,
      });
    }

    if (!this.name && !this.goal && this.actions.length === 0) {
      result.unconverted.push({
        excerpt: excerpt.slice(0, 200) || this.sourceId,
        reason: '用例缺少名称、目的与步骤，无法形成草稿',
        range: `L${this.startLine}-L${this.endLine}`,
      });
      return null;
    }

    return {
      sourceId: this.sourceId,
      name: this.name,
      goal: this.goal,
      preconditions: this.preconditions.map((p) => p.trim()).filter(Boolean),
      actions: this.actions.map((a) => a.trim()).filter(Boolean),
      expectations: mapped.filter((e) => e.text.trim()),
      level: this.level,
      sourceRange: `L${this.startLine}-L${this.endLine}`,
      excerpt,
      data: this.data,
    };
  }
}

function stripListPrefix(line: string): string {
  return line.replace(LIST_PREFIX, '').trim();
}

function splitItems(value: string): string[] {
  const items = value
    .split(/[；;]|(?:<br\s*\/?>)|(?:\n)/i)
    .map((item) => stripListPrefix(item.trim()))
    .filter(Boolean);
  return items.length > 0 ? items : value.trim() ? [value.trim()] : [];
}
