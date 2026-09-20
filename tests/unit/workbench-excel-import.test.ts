import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseExcelCases } from '../../src/workbench/core/import/excel';

// Excel 导入夹具在测试内用 ExcelJS 生成（二进制不宜入库存档），
// 覆盖：合并单元格、跨行用例、空白预期、重号、公式缓存缺失。

async function buildFixtureWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('设置模块');
  sheet.addRow(['编号', '名称', '前置条件', '操作步骤', '预期结果', '等级']);
  sheet.addRow([
    'TC-201',
    '打开设置',
    '设备已解锁',
    '1. 打开设置\n2. 查看蓝牙开关',
    '设置页面显示\n蓝牙开关可见',
    'level1',
  ]);
  sheet.addRow(['TC-202', '调节音量', '设备已解锁', '1. 播放音频', '音量面板出现', 'level2']);
  sheet.addRow(['TC-202', '调节音量', '设备已解锁', '2. 按音量增大键', '音量值增加', 'level2']);
  sheet.addRow(['TC-202', '重号演示', '', '1. 打开相机', '', '']);
  sheet.addRow(['TC-203', '', '', '1. 打开关于页面', '关于页面显示', '']);
  sheet.addRow(['TC-204', '', '', '1. 打开存储页面', '存储页面显示', '']);

  // 跨行用例：编号/名称/前置条件 纵向合并
  sheet.mergeCells('A3:A4');
  sheet.mergeCells('B3:B4');
  sheet.mergeCells('C3:C4');

  // 公式：一个带缓存值，一个缺缓存
  sheet.getCell('B6').value = { formula: '"公式"&"用例"', result: '公式用例' };
  sheet.getCell('B7').value = { formula: '"无"&"缓存"' };

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}

describe('Excel 导入：合并单元格/跨行/空白预期/重号/公式缓存', () => {
  it('按合并块组装跨行用例，不静默填充、不丢用例', async () => {
    const buffer = await buildFixtureWorkbook();
    const result = await parseExcelCases(buffer);

    // 5 条用例：TC-201、TC-202（合并块）、TC-202（重号）、TC-203、TC-204
    expect(result.cases).toHaveLength(5);

    const first = result.cases[0]!;
    expect(first.sourceId).toBe('TC-201');
    expect(first.actions).toEqual(['打开设置', '查看蓝牙开关']);
    expect(first.expectations).toEqual([
      { text: '设置页面显示', actionIndex: 0 },
      { text: '蓝牙开关可见', actionIndex: 1 },
    ]);
    expect(first.level).toBe('level1');
    expect(first.sourceRange).toBe('设置模块!R2');

    // 跨行用例：合并块把两行的步骤/预期拼成一条
    const crossRow = result.cases[1]!;
    expect(crossRow.sourceId).toBe('TC-202');
    expect(crossRow.name).toBe('调节音量');
    expect(crossRow.sourceRange).toBe('设置模块!R3:R4');
    expect(crossRow.actions).toEqual(['播放音频', '按音量增大键']);
    expect(crossRow.expectations).toEqual([
      { text: '音量面板出现', actionIndex: 0 },
      { text: '音量值增加', actionIndex: 1 },
    ]);
    // 合并的前置条件去重为一条
    expect(crossRow.preconditions).toEqual(['设备已解锁']);

    // 重号：保留原编号并记录问题
    const duplicated = result.cases.filter((c) => c.sourceId === 'TC-202');
    expect(duplicated).toHaveLength(2);
    expect(result.issues.some((issue) => issue.message.includes('TC-202 重复'))).toBe(true);

    // 空白预期：不从上一条填充，记录问题
    expect(duplicated[1]!.expectations).toEqual([]);
    expect(result.issues.some((issue) => issue.message.includes('未从上一行填充'))).toBe(true);

    // 公式缓存可用：名称带缓存值
    const withCache = result.cases.find((c) => c.sourceId === 'TC-203')!;
    expect(withCache.name).toContain('公式用例');

    // 公式缓存缺失：标记待澄清，用例不丢失
    const missingCache = result.cases.find((c) => c.sourceId === 'TC-204')!;
    expect(missingCache).toBeTruthy();
    expect(result.issues.some((issue) => issue.message.includes('公式缓存缺失'))).toBe(true);
  });

  it('无法解析的内容进入未转换清单而不是抛错', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('空表').addRow(['随便', '表头']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await parseExcelCases(buffer);
    expect(result.cases).toHaveLength(0);
    expect(result.unconverted.length).toBeGreaterThan(0);
  });
});
