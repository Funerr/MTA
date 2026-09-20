import ExcelJS from 'exceljs';
import { emptyResult, type ImportedCaseDraft, type ImportParseResult } from './types';
import type { CaseLevel } from '../document';

/**
 * Excel 导入：按表头关键字映射用例字段。
 * - 合并单元格仅在明确合并范围内继承值；空白单元格不向下填充。
 * - 公式保留公式文本与可用缓存值；缓存缺失或错误值标记待澄清。
 * - 重号编号保留原编号并记录问题，分配独立内部标识。
 */

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

const LIST_PREFIX = /^\s*(?:\d{1,3}\s*[.、)）]|[-*•·]|[a-zA-Z]\))\s*/;

interface CellView {
  text: string;
  /** 公式或缓存可疑时为真，进入待澄清。 */
  suspicious: boolean;
  formulaNote?: string;
}

export async function parseExcelCases(
  buffer: Buffer,
): Promise<ImportParseResult> {
  const result = emptyResult('excel');
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs 自带旧版 Buffer 类型声明，与本仓库 @types/node 的泛型 Buffer
    // 不完全一致；此处仅做类型桥接，运行时仍是同一个对象。
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch (error) {
    result.issues.push({
      message: `无法读取 xlsx 文件：${error instanceof Error ? error.message : String(error)}`,
    });
    return result;
  }

  const seenSourceIds = new Map<string, number>();

  workbook.eachSheet((sheet, sheetIndex) => {
    parseSheet(sheet, sheetIndex + 1, seenSourceIds, result);
  });

  if (result.cases.length === 0 && result.unconverted.length === 0) {
    result.unconverted.push({
      excerpt: `共 ${workbook.worksheets.length} 个工作表`,
      reason: '未识别出任何用例（缺少可识别的表头或数据行）',
    });
  }
  return result;
}

function parseSheet(
  sheet: ExcelJS.Worksheet,
  sheetIndex: number,
  seenSourceIds: Map<string, number>,
  result: ImportParseResult,
): void {
  const rowCount = sheet.rowCount;
  if (rowCount === 0) return;

  // 合并单元格：范围内继承左上角值。
  const merged = new Map<string, string>();
  for (const mergeRef of sheet.model.merges ?? []) {
    const range = mergeRange(mergeRef);
    if (!range) continue;
    const master = cellView(sheet.getCell(range.top, range.left));
    for (let row = range.top; row <= range.bottom; row += 1) {
      for (let col = range.left; col <= range.right; col += 1) {
        merged.set(`${row}:${col}`, master.text);
      }
    }
  }

  const readCell = (row: number, col: number): CellView => {
    const mergeKey = `${row}:${col}`;
    if (merged.has(mergeKey)) {
      return { text: merged.get(mergeKey)!, suspicious: false };
    }
    return cellView(sheet.getCell(row, col));
  };

  // 表头行：首个包含已知关键字的行。
  let headerRow = 0;
  let mapping: ColumnMapping = {};
  const maxCol = sheet.columnCount;
  for (let row = 1; row <= Math.min(rowCount, 10); row += 1) {
    const candidate: ColumnMapping = {};
    for (let col = 1; col <= maxCol; col += 1) {
      const header = readCell(row, col).text.trim();
      if (!header) continue;
      for (const [pattern, field] of HEADER_PATTERNS) {
        if (pattern.test(header) && candidate[field] === undefined) {
          candidate[field] = col;
          break;
        }
      }
    }
    if (candidate.sourceId !== undefined || candidate.name !== undefined) {
      headerRow = row;
      mapping = candidate;
      break;
    }
  }

  if (headerRow === 0) {
    if (sheet.actualRowCount === 0) return;
    result.unconverted.push({
      excerpt: sheet.name,
      reason: `工作表 ${sheet.name} 缺少可识别的编号/名称表头`,
      range: `表${sheetIndex}`,
    });
    return;
  }

  // 跨行用例：编号列的纵向合并范围把多行组成一条用例块，
  // 块内各行步骤/预期按行序拼接；合并单元格外的空单元格不继承值。
  const sourceIdCol = mapping.sourceId;
  const blockSpans = new Map<number, { top: number; bottom: number }>();
  if (sourceIdCol !== undefined) {
    for (const mergeRef of sheet.model.merges ?? []) {
      const range = mergeRange(mergeRef);
      if (!range || range.left !== sourceIdCol || range.right !== sourceIdCol) continue;
      if (range.bottom <= range.top) continue;
      for (let row = range.top; row <= range.bottom; row += 1) {
        blockSpans.set(row, { top: range.top, bottom: range.bottom });
      }
    }
  }

  const consumed = new Set<number>();
  for (let row = headerRow + 1; row <= rowCount; row += 1) {
    if (consumed.has(row)) continue;
    const span = blockSpans.get(row) ?? { top: row, bottom: row };
    for (let r = span.top; r <= span.bottom; r += 1) consumed.add(r);

    const rows: number[] = [];
    for (let r = span.top; r <= span.bottom; r += 1) rows.push(r);
    const range =
      span.bottom > span.top ? `${sheet.name}!R${span.top}:R${span.bottom}` : `${sheet.name}!R${row}`;

    const cell = (field: keyof ColumnMapping): CellView => {
      const col = mapping[field];
      return col === undefined ? { text: '', suspicious: false } : readCell(row, col);
    };
    const blockCell = (field: keyof ColumnMapping): { views: CellView[] } => {
      const col = mapping[field];
      if (col === undefined) return { views: [] };
      const views: CellView[] = [];
      for (const r of rows) views.push(readCell(r, col));
      return { views };
    };

    const sourceIdView = cell('sourceId');
    const nameView = cell('name');

    // 块内所有关键单元格为空则整块跳过（完全空行/空块）。
    const blockAllEmpty = ['sourceId', 'name', 'goal', 'preconditions', 'actions', 'expectations']
      .every((field) =>
        blockCell(field as keyof ColumnMapping).views.every((view) => view.text.trim() === ''),
      );
    if (blockAllEmpty) continue;

    const joinBlock = (field: keyof ColumnMapping): string[] => {
      const lines: string[] = [];
      for (const view of blockCell(field).views) {
        for (const line of splitLines(view.text)) {
          // 合并继承会把母单元格文本复制到块内每一行，重复文本只保留一次。
          if (!lines.includes(line)) lines.push(line);
        }
      }
      return lines;
    };

    const actions = joinBlock('actions');
    const expectationText = joinBlock('expectations');

    const suspiciousNotes = [
      ...blockCell('sourceId').views,
      ...blockCell('name').views,
    ]
      .filter((view) => view.suspicious)
      .map((view) => view.formulaNote)
      .filter(Boolean);
    if (suspiciousNotes.length) {
      result.issues.push({
        message: `行块 ${range} 存在公式缓存缺失或错误值（${suspiciousNotes.join('；')}），相关内容待澄清`,
        range,
      });
    }

    let level: CaseLevel = 'level2';
    const levelRaw = cell('level').text.trim();
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

    if (expectationText.length === 0) {
      result.issues.push({
        message: `用例 ${sourceIdView.text.trim() || nameView.text.trim() || range} 的预期单元格为空，未从上一行填充`,
        range,
      });
    }

    let expectations: ImportedCaseDraft['expectations'] = expectationText.map(
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
        message: `用例 ${sourceIdView.text.trim() || nameView.text.trim()} 的预期与步骤数量一致，已按顺序关联`,
        range,
      });
    }

    const sourceId = sourceIdView.text.trim();
    const seen = seenSourceIds.get(sourceId) ?? 0;
    if (sourceId && seen > 0) {
      result.issues.push({
        message: `编号 ${sourceId} 重复（第 ${seen + 1} 次出现）；已分配独立内部标识`,
        range,
      });
    }
    if (sourceId) seenSourceIds.set(sourceId, seen + 1);

    const excerpt = rows
      .map((r) =>
        ['sourceId', 'name', 'goal', 'preconditions', 'actions', 'expectations', 'level', 'data']
          .map((field) => {
            const col = mapping[field as keyof ColumnMapping];
            return col === undefined ? '' : readCell(r, col).text.trim();
          })
          .filter(Boolean)
          .join(' | '),
      )
      .filter(Boolean)
      .join('\n');

    if (!sourceId && !nameView.text.trim() && actions.length === 0 && expectations.length === 0) {
      result.unconverted.push({
        excerpt: excerpt.slice(0, 200),
        reason: '整行关键字段为空',
        range,
      });
      continue;
    }

    result.cases.push({
      sourceId,
      name: nameView.text.trim(),
      goal: cell('goal').text.trim(),
      preconditions: joinBlock('preconditions'),
      actions,
      expectations,
      level,
      sourceRange: range,
      excerpt,
      data: cell('data').text.trim() || undefined,
    });
  }
}

function cellView(cell: ExcelJS.Cell): CellView {
  const value = cell.value;
  if (value === null || value === undefined || value === '') {
    return { text: '', suspicious: false };
  }
  if (typeof value === 'object' && 'formula' in (value as unknown as Record<string, unknown>)) {
    const formulaCell = value as { formula?: string; result?: unknown };
    const formulaText = formulaCell.formula ? `=${formulaCell.formula}` : '=…';
    const cached = formulaCell.result;
    if (cached === undefined || cached === null) {
      return {
        text: formulaText,
        suspicious: true,
        formulaNote: '公式缓存缺失',
      };
    }
    if (
      typeof cached === 'object' &&
      cached !== null &&
      'error' in (cached as Record<string, unknown>)
    ) {
      return {
        text: formulaText,
        suspicious: true,
        formulaNote: `公式缓存为错误值 ${(cached as { error?: unknown }).error ?? ''}`.trim(),
      };
    }
    return { text: `${stringifyValue(cached)}（${formulaText}）`, suspicious: false };
  }
  if (typeof value === 'object' && 'richText' in (value as unknown as Record<string, unknown>)) {
    const parts = (value as { richText: { text: string }[] }).richText;
    return { text: parts.map((part) => part.text).join(''), suspicious: false };
  }
  return { text: stringifyValue(value), suspicious: false };
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value instanceof Date) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  return String(value);
}

function mergeRange(ref: string):
  | { top: number; left: number; bottom: number; right: number }
  | undefined {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
  if (!match) return undefined;
  const left = colToNumber(match[1]!);
  const right = colToNumber(match[3]!);
  const top = Number(match[2]);
  const bottom = Number(match[4]);
  return { top, left, bottom, right };
}

function colToNumber(col: string): number {
  let n = 0;
  for (const char of col) n = n * 26 + (char.charCodeAt(0) - 64);
  return n;
}

function splitLines(value: string): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n|[；;]/)
    .map((item) => item.replace(LIST_PREFIX, '').trim())
    .filter(Boolean);
}
