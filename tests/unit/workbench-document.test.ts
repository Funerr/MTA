import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '../../src/workbench/server/app';
import { Workspace } from '../../src/workbench/server/workspace';
import {
  allocateStableId,
  assertDocumentInvariants,
  confirmStillValid,
  createEmptyDocument,
  createVariant,
  DocumentMutationError,
  normalizeDocument,
  touchBusiness,
  touchWorkflow,
  type BusinessCase,
} from '../../src/workbench/core/document';
import { DocumentStore } from '../../src/workbench/core/document-store';

let tempRoot: string;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'mta-workbench-doc-'));
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

const sampleCase = (): BusinessCase => ({
  id: 'case1',
  sourceId: 'TC-001',
  name: '打开设置',
  goal: '验证设置入口可用',
  level: 'level1',
  preconditions: [{ id: 'pre1', text: '设备已解锁', satisfaction: 'external' }],
  noPreconditionsDeclared: false,
  actions: [
    { id: 'act1', text: '点击设置图标' },
    { id: 'act2', text: '查看蓝牙开关状态' },
  ],
  expectations: [
    { id: 'exp1', text: '设置页面显示', actionId: 'act1', evidenceKind: 'visual' },
    { id: 'exp2', text: '蓝牙开关存在', actionId: 'act2', evidenceKind: 'visual' },
  ],
  sourceRefs: [{ sourceId: 'src1', range: 'L3-L8', excerpt: 'TC-001 打开设置…' }],
  status: 'draft',
});

describe('编写文档模型：稳定 ID 与修订', () => {
  it('稳定 ID 分配跳过已占用编号', () => {
    expect(allocateStableId('case', [])).toBe('case1');
    expect(allocateStableId('case', ['case1', 'case3'])).toBe('case2');
    expect(allocateStableId('act', ['act1', 'act2'])).toBe('act3');
  });

  it('业务变更递增业务修订并标记平台待更新', () => {
    const document = createEmptyDocument('d-x', '演示');
    document.cases.push(sampleCase());
    document.variants.android = createVariant('android', document.businessRevision, 'a: 1');
    document.variants.harmony = createVariant('harmony', document.businessRevision, 'h: 1');

    const before = document.businessRevision;
    touchBusiness(document, '2026-01-01T00:00:00Z');
    expect(document.businessRevision).toBe(before + 1);
    expect(document.variants.android?.needsUpdate).toBe(true);
    expect(document.variants.harmony?.needsUpdate).toBe(true);
  });

  it('平台工作流变更只影响该平台的修订', () => {
    const document = createEmptyDocument('d-x', '演示');
    document.variants.android = createVariant('android', 1, 'a: 1');
    document.variants.harmony = createVariant('harmony', 1, 'h: 1');

    touchWorkflow(document.variants.android!, '2026-01-02T00:00:00Z');
    expect(document.variants.android?.workflow.revision).toBe(2);
    expect(document.variants.harmony?.workflow.revision).toBe(1);
  });

  it('确认有效性跟随工作流修订', () => {
    const variant = createVariant('android', 1, 'a: 1');
    expect(confirmStillValid(variant)).toBe(false);
    variant.confirm = {
      status: 'confirmed',
      confirmedAt: '2026-01-01T00:00:00Z',
      confirmedWorkflowRevision: 1,
      confirmedBusinessRevision: 1,
      snapshotId: 'snap-1',
      summary: '初始确认',
    };
    expect(confirmStillValid(variant)).toBe(true);
    touchWorkflow(variant);
    expect(confirmStillValid(variant)).toBe(false);
  });

  it('结构校验拒绝重复稳定 ID 与悬空预期关联', () => {
    const document = createEmptyDocument('d-x', '演示');
    const caseA = sampleCase();
    const caseB: BusinessCase = {
      ...sampleCase(),
      id: 'caseB',
      actions: [{ id: 'act1', text: '重复动作 ID' }],
    };
    document.cases.push(caseA, caseB);
    expect(() => assertDocumentInvariants(document)).toThrow(
      DocumentMutationError,
    );

    const document2 = createEmptyDocument('d-y', '演示');
    const broken: BusinessCase = {
      ...sampleCase(),
      expectations: [
        { id: 'exp1', text: '关联不存在步骤', actionId: 'act404', evidenceKind: 'visual' },
      ],
    };
    document2.cases.push(broken);
    expect(() => assertDocumentInvariants(document2)).toThrow(/act404/);
  });

  it('normalizeDocument 对残缺输入回退默认值', () => {
    const document = normalizeDocument({ id: 'd-z', name: 42 });
    expect(document.name).toBe('未命名文档');
    expect(document.businessRevision).toBe(1);
    expect(document.saveVersion).toBe(1);
    expect(document.cases).toEqual([]);
  });
});

describe('DocumentStore：保存恢复与平台互不覆盖', () => {
  let store: DocumentStore;

  beforeAll(() => {
    store = new DocumentStore(new Workspace(join(tempRoot, `ws-${Date.now()}`)));
  });

  it('创建、保存、恢复往返一致', async () => {
    const created = await store.create('往返演示');
    expect(created.cases).toEqual([]);
    expect(created.saveVersion).toBe(1);

    created.cases.push(sampleCase());
    const saved = await store.save(created, created.saveVersion);
    expect(saved.saveVersion).toBe(2);

    const restored = await store.load(created.id);
    expect(restored.cases[0]!.id).toBe('case1');
    expect(restored.cases[0]!.expectations).toHaveLength(2);
    expect(restored.businessRevision).toBe(created.businessRevision);
  });

  it('并发保存基于旧版本被拒绝（409）', async () => {
    const created = await store.create('并发演示');
    const savedOnce = await store.save(created, created.saveVersion);

    // 两个会话都基于 savedOnce 编辑。
    const stale = structuredClone(savedOnce);
    stale.name = '旧会话改名';
    await expect(store.save(stale, savedOnce.saveVersion)).resolves.toBeTruthy();

    const alsoStale = structuredClone(savedOnce);
    alsoStale.name = '更旧会话改名';
    await expect(store.save(alsoStale, savedOnce.saveVersion)).rejects.toThrow(
      HttpError,
    );
  });

  it('两个平台互不覆盖：只改 android 时 harmony 内容与修订不变', async () => {
    const created = await store.create('双平台演示');
    created.variants.android = createVariant('android', 1, '# android 工作流\n');
    created.variants.harmony = createVariant('harmony', 1, '# harmony 工作流\n');
    await store.save(created, created.saveVersion);

    const loaded = await store.load(created.id);
    const android = loaded.variants.android!;
    android.workflow.yaml = '# android 工作流\n- 修改后\n';
    touchWorkflow(android);
    await store.save(loaded, loaded.saveVersion);

    const reloaded = await store.load(created.id);
    expect(reloaded.variants.android?.workflow.yaml).toContain('修改后');
    expect(reloaded.variants.android?.workflow.revision).toBe(2);
    // harmony 的内容与修订保持原样。
    expect(reloaded.variants.harmony?.workflow.yaml).toBe('# harmony 工作流\n');
    expect(reloaded.variants.harmony?.workflow.revision).toBe(1);
  });

  it('列表返回摘要且删除后 404', async () => {
    const created = await store.create('列表演示');
    const summaries = await store.list();
    expect(summaries.some((s) => s.id === created.id)).toBe(true);

    await store.delete(created.id);
    await expect(store.load(created.id)).rejects.toThrow(HttpError);
  });
});
