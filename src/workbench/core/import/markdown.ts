import { Marked } from 'marked';
import { parseTextCases } from './text';
import {
  emptyResult,
  type ImportedCaseDraft,
  type ImportParseResult,
} from './types';
import type { CaseLevel } from '../document';

/**
 * Markdown 解析：标题分节交给文本解析器复用同一套标签规则；
 * 表格按表头关键字映射到用例字段。空白预期单元格不向下填充；
 * 代码块等无法表达用例的结构进入未转换清单。
 */

const marked = new Marked();

interface ColumnMapping {
  sourceId?: number;
  name?: number;
  goal?: number;
  preconditions?: number;
  actions?: number;
  expectations?: number;
  level?: number;
  data?: number;
}

const HEADER_PATTERNS: readonly [RegExp, keyof ColumnMapping][] = [
  [/^(?:用例\s*)?(?:编号|ID|id|序号|No\.?)$/, 'sourceId'],
  [/^(?:用例\s*)?(?:名称|标题|用例名)$/, 'name'],
  [/^(?:测试\s*)?(?:目的|目标)$/, 'goal'],
  [/^(?:前置条件|前置|前提|环境)$/, 'preconditions'],
  [/^(?:操作步骤|操作|步骤|动作)$/, 'actions'],
  [/^(?:预期结果|预期|期望结果|结果|验收标准)$/, 'expectations'],
  [/^(?:等级|级别|优先级)$/, 'level'],
  [/^(?:测试数据|数据)$/, 'data'],
];

export function parseMarkdownCases(markdown: string): ImportParseResult {
  const result = emptyResult('markdown');
  const tokens = marked.lexer(markdown);

  const seenSourceIds = new Map<string, number>();
  let segmentLines: string[] = [];
  let tableIndex = 0;

  const flushSegment = () => {
    if (segmentLines.length === 0) return;
    const segmentResult = parseTextCases(segmentLines.join('\n'), 'text');
    for (const draft of segmentResult.cases) {
      recordSourceId(draft.sourceId, seenSourceIds, result);
      result.cases.push(draft);
    }
    result.issues.push(...segmentResult.issues);
    result.unconverted.push(...segmentResult.unconverted);
    segmentLines = [];
  };

  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        flushSegment();
        segmentLines.push(
          (token as { text: string }).text.replace(/\s+/g, ' ').trim(),
        );
        break;
      }
      case 'table': {
        flushSegment();
        tableIndex += 1;
        parseTable(token as never, tableIndex, seenSourceIds, result);
        break;
      }
      case 'code': {
        flushSegment();
        result.unconverted.push({
          excerpt: (token as { raw: string }).raw.trim().slice(0, 300),
          reason: '代码块不参与用例解析',
        });
        break;
      }
      case 'space':
      case 'hr':
        break;
      default: {
        const raw = (token as { raw?: string; text?: string }).raw
          ?? (token as { text?: string }).text
          ?? '';
        for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
          const trimmed = line.trim();
          if (trimmed) segmentLines.push(trimmed);
        }
        break;
      }
    }
  }
  flushSegment();

  if (result.cases.length === 0 && result.unconverted.length === 0 && markdown.trim()) {
    result.unconverted.push({
      excerpt: markdown.trim().slice(0, 500),
      reason: '未识别出任何用例结构',
    });
  }

  return result;
}

function parseTable(
  token: unknown,
  tableIndex: number,
  seenSourceIds: Map<string, number>,
  result: ImportParseResult,
): void {
  const table = token as {
    header: unknown[];
    rows: unknown[][];
  };
  const mapping: ColumnMapping = {};
  table.header.forEach((headerCell, index) => {
    const normalized = cellText(headerCell);
    for (const [pattern, field] of HEADER_PATTERNS) {
      if (pattern.test(normalized) && mapping[field] === undefined) {
        mapping[field] = index;
        break;
      }
    }
  });

  if (mapping.sourceId === undefined && mapping.name === undefined) {
    result.unconverted.push({
      excerpt: `| ${table.header.join(' | ')} |`,
      reason: `表 ${tableIndex} 缺少可识别的编号/名称表头`,
    });
    return;
  }

  table.rows.forEach((row, rowIndex) => {
    const cell = (field: keyof ColumnMapping): string => {
      const index = mapping[field];
      return index === undefined ? '' : cellText(row[index]);
    };
    const rowNumber = rowIndex + 2; // 含表头的 1 基行号
    const range = `表${tableIndex}/第${rowNumber}行`;

    const sourceId = cell('sourceId');
    const name = cell('name');
    const actions = splitCell(cell('actions'));
    const expectationTexts = splitCell(cell('expectations'));
    const levelRaw = cell('level');

    if (!sourceId && !name && actions.length === 0 && expectationTexts.length === 0) {
      result.unconverted.push({
        excerpt: `| ${row.join(' | ')} |`.slice(0, 200),
        reason: '整行关键字段为空',
        range,
      });
      return;
    }

    let level: CaseLevel = 'level2';
    if (levelRaw) {
      if (/^[123]$/.test(levelRaw) || /^level[123]$/i.test(levelRaw)) {
        level = `level${levelRaw.replace(/^level/i, '')}` as CaseLevel;
      } else {
        result.issues.push({
          message: `等级“${levelRaw}”无法识别，按默认 level2 处理`,
          range,
        });
      }
    }

    if (!expectationTexts.length && cell('expectations') === '') {
      result.issues.push({
        message: `用例 ${sourceId || name || range} 的预期单元格为空，未从上一行填充`,
        range,
      });
    }

    let expectations: ImportedCaseDraft['expectations'] = expectationTexts.map(
      (text) => ({ text }),
    );
    if (
      actions.length > 0 &&
      expectations.length === actions.length &&
      expectations.length > 0
    ) {
      expectations = expectations.map((item, index) => ({
        ...item,
        actionIndex: index,
      }));
      result.issues.push({
        message: `用例 ${sourceId || name} 的预期与步骤数量一致，已按顺序关联`,
        range,
      });
    }

    recordSourceId(sourceId, seenSourceIds, result);

    result.cases.push({
      sourceId,
      name,
      goal: cell('goal'),
      preconditions: splitCell(cell('preconditions')),
      actions,
      expectations,
      level,
      sourceRange: range,
      excerpt: `| ${row.map(cellText).join(' | ')} |`,
      data: cell('data') || undefined,
    });
  });
}

function recordSourceId(
  sourceId: string,
  seenSourceIds: Map<string, number>,
  result: ImportParseResult,
): void {
  if (!sourceId) return;
  const seen = seenSourceIds.get(sourceId) ?? 0;
  if (seen > 0) {
    result.issues.push({
      message: `编号 ${sourceId} 重复（第 ${seen + 1} 次出现）；已分配独立内部标识`,
    });
  }
  seenSourceIds.set(sourceId, seen + 1);
}

/** marked 18 的表格单元格是 token 对象（{ text, tokens }），取纯文本。 */
function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string') return cell.trim();
  if (typeof cell === 'object' && 'text' in (cell as Record<string, unknown>)) {
    return String((cell as { text: unknown }).text ?? '').trim();
  }
  return String(cell).trim();
}

function splitCell(value: string): string[] {
  if (!value) return [];
  return value
    .split(/<br\s*\/?>|[；;\n]/i)
    .map((item) =>
      item
        .replace(/^\s*(?:\d{1,3}\s*[.、)）]|[-*•·])\s*/, '')
        .trim(),
    )
    .filter(Boolean);
}
