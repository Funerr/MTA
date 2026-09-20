import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Workspace } from '../../src/workbench/server/workspace';
import { DocumentStore } from '../../src/workbench/core/document-store';
import { createVariant, touchWorkflow, type BusinessCase } from '../../src/workbench/core/document';
import { confirmDocument, exportDocument } from '../../src/workbench/core/delivery/delivery';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const configPath = join(process.cwd(), 'midscene.config.ts');
async function fixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'mta-delivery-')); dirs.push(projectRoot);
  const workspace = new Workspace(join(projectRoot, 'workspace')); const documents = new DocumentStore(workspace);
  const document = await documents.create('交付测试');
  const businessCase: BusinessCase = { id: 'case1', sourceId: 'TC1', name: '设置', goal: '验证设置', level: 'level1', preconditions: [], noPreconditionsDeclared: true, actions: [{ id: 'a1', text: '打开设置' }], expectations: [{ id: 'e1', text: '设置可见', actionId: 'a1', evidenceKind: 'visual' }], sourceRefs: [], status: 'unvalidated' };
  document.cases = [businessCase, { ...structuredClone(businessCase), id: 'case2', actions: [{ id: 'a2', text: '未知动作' }], expectations: [{ id: 'e2', text: '未知预期', evidenceKind: 'unverified' }], status: 'needs_clarification' }];
  const variant = createVariant('android', document.businessRevision, 'cases:\n  - name: 设置\n    steps:\n      - aiAssert: 设置可见\n');
  variant.appContext.packageName = 'com.android.settings'; variant.needsUpdate = false; variant.workflow.mergedCaseIds = ['case1'];
  variant.coverage = [{ expectationId: 'e1', covered: true, caseIndex: 0, stepIndex: 0, node: 'aiAssert' }];
  document.variants.android = variant;
  document.variants.harmony = createVariant('harmony', document.businessRevision);
  const saved = await documents.save(document, document.saveVersion);
  return { projectRoot, workspace, documents, documentId: document.id, baseSaveVersion: saved.saveVersion, platform: 'android' as const, configPath, saved };
}

describe('确认快照与平台交付', () => {
  it('部分确认导出仅包含就绪平台用例，记录排除项且不写 cases', async () => {
    const f = await fixture(); const confirmation = await confirmDocument(f);
    expect(confirmation.eligibility.map((item) => item.included)).toEqual([true, false]);
    const result = await exportDocument({ ...f, baseSaveVersion: confirmation.document.saveVersion });
    expect(result.files).toContain('workflow.android.yaml'); expect(result.files).not.toContain('workflow.harmony.yaml');
    const exported = new Workspace(result.directory);
    const report = await exported.readJson<any>('conversion-report.json');
    expect(report.platforms.android.excluded).toBe(1); expect(report.platforms.harmony.ready).toBe(0);
    expect(report.full_execution).toBe('not_run'); expect(readdirSync(f.projectRoot)).not.toContain('cases');
  });
  it('未确认仅导出草稿，不生成空执行文件', async () => {
    const result = await exportDocument(await fixture());
    expect(result.files.filter((file) => file.endsWith('.yaml'))).toEqual([]);
  });
  it('确认后编辑保留旧快照，旧确认不得导出新内容', async () => {
    const f = await fixture(); const confirmation = await confirmDocument(f);
    const snapshotId = confirmation.document.variants.android!.confirm.snapshotId!;
    const snapshot = await f.workspace.readText(`snapshots/${f.documentId}/${snapshotId}.json`);
    const changed = structuredClone(confirmation.document); changed.variants.android!.workflow.yaml += '# 人工修改\n';
    // 即使调用方未推进 revision，也不能沿用旧确认。
    const saved = await f.documents.save(changed, changed.saveVersion);
    await expect(exportDocument({ ...f, baseSaveVersion: saved.saveVersion })).rejects.toMatchObject({ status: 409 });
    expect(await f.workspace.readText(`snapshots/${f.documentId}/${snapshotId}.json`)).toBe(snapshot);
    touchWorkflow(saved.variants.android!); expect(saved.variants.android!.confirm.status).toBe('unconfirmed');
  });
  it('同版本并发写只有一个成功，旧版本确认被拒绝', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([f.documents.save(structuredClone(f.saved), f.baseSaveVersion), f.documents.save(structuredClone(f.saved), f.baseSaveVersion)]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    await expect(confirmDocument(f)).rejects.toMatchObject({ status: 409 });
  });
});
