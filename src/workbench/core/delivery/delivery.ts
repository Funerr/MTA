import { createHash, randomUUID } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import { HttpError } from '../../server/app';
import { Workspace } from '../../server/workspace';
import type { DocumentStore } from '../document-store';
import { describeCaseGaps, type AuthoringDocument, type AuthoringPlatform } from '../document';
import { runStaticChecks, type LayeredValidation } from '../validation/static';

export function contentDigest(document: AuthoringDocument, platform: AuthoringPlatform): string {
  const variant = document.variants[platform];
  return createHash('sha256').update(JSON.stringify({ cases: document.cases, sources: document.sources, issues: document.issues,
    rewrites: document.rewrites, businessRevision: document.businessRevision, platform,
    appContext: variant?.appContext, workflow: variant?.workflow, coverage: variant?.coverage,
    needsUpdate: variant?.needsUpdate, caseStatuses: variant?.caseStatuses })).digest('hex');
}

interface Eligibility { id: string; included: boolean; reason?: string; validation?: LayeredValidation }
interface Snapshot {
  digest: string; platform: AuthoringPlatform; document: AuthoringDocument;
  eligibility: Eligibility[]; workflowYaml?: string; createdAt: string;
}

async function prepare(document: AuthoringDocument, platform: AuthoringPlatform, configPath: string) {
  const variant = document.variants[platform];
  if (!variant) throw new HttpError(400, '平台变体不存在');
  const eligibility: Eligibility[] = [];
  const parsed = YAML.parseDocument(variant.workflow.yaml);
  const sequence = parsed.get('cases', true);
  for (const item of document.cases) {
    const index = variant.workflow.mergedCaseIds?.indexOf(item.id) ?? -1;
    const status = variant.caseStatuses?.[item.id] ?? item.status;
    const gaps = describeCaseGaps(item);
    let reason = variant.workflow.invalidYamlBuffer !== undefined ? 'YAML 尚未同步'
      : variant.needsUpdate || variant.workflow.basedOnBusinessRevision !== document.businessRevision ? '工作流待更新'
      : !variant.appContext.packageName.trim() ? '应用包名缺失'
      : gaps.length ? gaps.map((gap) => gap.message).join('；')
      : document.issues.some((issue) => !issue.resolvedAt && (!issue.caseId || issue.caseId === item.id)) ? '存在待澄清问题'
      : status === 'unsupported' || status === 'needs_clarification' ? status
      : parsed.errors.length || !YAML.isSeq(sequence) || index < 0 || !sequence.items[index] ? '工作流或用例映射缺失' : undefined;
    if (reason) { eligibility.push({ id: item.id, included: false, reason }); continue; }
    const single = parsed.clone();
    (single.get('cases', true) as YAML.YAMLSeq).items = [(single.get('cases', true) as YAML.YAMLSeq).items[index]!];
    const scoped = structuredClone(document);
    scoped.cases = [structuredClone(item)];
    const scopedVariant = scoped.variants[platform]!;
    scopedVariant.workflow.yaml = single.toString();
    scopedVariant.coverage = variant.coverage.filter((entry) => item.expectations.some((expected) => expected.id === entry.expectationId)).map((entry) => ({ ...entry, caseIndex: entry.caseIndex === index ? 0 : -1 }));
    const validation = await runStaticChecks({ document: scoped, variant: scopedVariant, platform, configPath });
    eligibility.push({ id: item.id, included: validation.allPassed, validation, reason: validation.allPassed ? undefined : '静态检查未通过' });
  }
  const included = eligibility.filter((item) => item.included).map((item) => item.id);
  let workflowYaml: string | undefined;
  if (included.length && YAML.isSeq(sequence)) {
    const indices = included.map((id) => variant.workflow.mergedCaseIds!.indexOf(id));
    sequence.items = indices.map((index) => sequence.items[index]!);
    workflowYaml = parsed.toString();
  }
  return { eligibility, workflowYaml };
}

export async function confirmDocument(input: { documents: DocumentStore; workspace: Workspace; documentId: string; baseSaveVersion: number; platform: AuthoringPlatform; configPath: string }) {
  const document = await input.documents.load(input.documentId);
  if (document.saveVersion !== input.baseSaveVersion) throw new HttpError(409, '文档已修改，请刷新后确认');
  const prepared = await prepare(document, input.platform, input.configPath);
  const variant = document.variants[input.platform]!;
  if (variant.workflow.invalidYamlBuffer !== undefined) throw new HttpError(400, 'YAML 未同步，不能确认');
  if (!prepared.eligibility.some((item) => item.included)) throw new HttpError(400, '没有可确认的就绪用例；可导出草稿及排除记录');
  const digest = contentDigest(document, input.platform);
  const snapshotId = randomUUID();
  const snapshot: Snapshot = { digest, platform: input.platform, document: structuredClone(document), ...prepared, createdAt: new Date().toISOString() };
  await input.workspace.ensureDir(`snapshots/${document.id}`);
  await writeFile(input.workspace.resolve(`snapshots/${document.id}/${snapshotId}.json`), JSON.stringify(snapshot, null, 2), { flag: 'wx' });
  variant.confirm = { status: 'confirmed', snapshotId, summary: digest, confirmedAt: snapshot.createdAt,
    confirmedWorkflowRevision: variant.workflow.revision, confirmedBusinessRevision: document.businessRevision };
  return { document: await input.documents.save(document, input.baseSaveVersion), eligibility: prepared.eligibility };
}

export async function exportDocument(input: { documents: DocumentStore; workspace: Workspace; projectRoot: string; documentId: string; baseSaveVersion: number }) {
  const document = await input.documents.load(input.documentId);
  if (document.saveVersion !== input.baseSaveVersion) throw new HttpError(409, '文档已修改，请刷新后导出');
  const directory = join(input.projectRoot, 'artifacts', 'case-to-yaml', `${document.id}-${randomUUID()}`);
  const output = new Workspace(directory);
  const files: string[] = [];
  const reports: Record<string, unknown> = {};
  for (const platform of ['android', 'harmony'] as const) {
    const variant = document.variants[platform];
    if (!variant) continue;
    let snapshot: Snapshot | undefined;
    if (variant.confirm.status === 'confirmed' && variant.confirm.snapshotId && /^[a-f0-9-]+$/.test(variant.confirm.snapshotId)) {
      snapshot = await input.workspace.readJson<Snapshot>(`snapshots/${document.id}/${variant.confirm.snapshotId}.json`);
      if (snapshot.digest !== contentDigest(document, platform) || snapshot.platform !== platform) throw new HttpError(409, `${platform} 已修改，必须重新确认后导出执行文件`);
    }
    const eligibility = snapshot?.eligibility ?? document.cases.map((item) => ({ id: item.id, included: false, reason: '当前版本未确认' }));
    if (snapshot?.workflowYaml) {
      const file = `workflow.${platform}.yaml`; await output.writeText(file, snapshot.workflowYaml); files.push(file);
    }
    const included = eligibility.filter((item) => item.included).map((item) => item.id);
    reports[platform] = { target_project: platform, cases: eligibility.map((item) => ({ ...item, status: item.included ? 'ready' : (variant.caseStatuses?.[item.id] ?? 'unvalidated') })), total: eligibility.length,
      ready: included.length, excluded: eligibility.length - included.length,
      coverage: variant.coverage.map((entry) => {
        const id = variant.workflow.mergedCaseIds?.[entry.caseIndex ?? -1];
        const index = id ? included.indexOf(id) : -1;
        return { source_expectation_id: entry.expectationId, draft_expectation_id: entry.expectationId,
          case_index: index >= 0 ? index : undefined, step_index: index >= 0 ? entry.stepIndex : undefined,
          node: entry.node, covered: entry.covered && index >= 0, reason: index < 0 ? '所属用例未纳入执行导出' : entry.reason };
      }), validation: { scope: 'YAML、Node 输入、预期覆盖、证据路径', device_executed: false, model_executed: false, cases: eligibility }, snapshot_id: variant.confirm.snapshotId };
  }
  const draft = { format_version: 1, cases: document.cases.map((item) => ({ id: item.id, source_id: item.sourceId, name: item.name, level: item.level,
    source_refs: item.sourceRefs, goal: item.goal, preconditions: item.preconditions, data: item.data, device_roles: item.deviceRoles,
    actions: item.actions.map((action) => ({ id: action.id, text: action.text, must_preserve: action.mustPreserve, allowed_adaptation: action.allowedAdaptation })),
    expectations: item.expectations.map((expected) => ({ id: expected.id, text: expected.text, action_id: expected.actionId, evidence_kind: expected.evidenceKind, acceptable_change: expected.acceptableChange })),
    rewrites: document.rewrites.filter((entry) => entry.caseId === item.id), issues: document.issues.filter((entry) => !entry.caseId || entry.caseId === item.id), status: item.status === 'draft' ? 'unvalidated' : item.status })) };
  await output.writeJson('draft.json', draft); files.push('draft.json');
  await output.writeJson('authoring-document.json', document); files.push('authoring-document.json');
  for (const source of document.sources) if (source.file) {
    const file = `sources/${source.id}${source.file.slice(source.file.lastIndexOf('.'))}`;
    await output.writeBinary(file, await readFile(input.workspace.resolve(source.file))); files.push(file);
  }
  for (const variant of Object.values(document.variants)) for (const evidence of variant?.evidence ?? []) {
    for (const file of [evidence.screenshotFile, evidence.frameworkReport]) if (file && !files.includes(file)) {
      await output.writeBinary(file, await readFile(input.workspace.resolve(file))); files.push(file);
    }
  }
  files.push('conversion-report.json');
  await output.writeJson('conversion-report.json', { format_version: 1, sources: document.sources, platforms: reports, rewrites: document.rewrites, artifacts: files, full_execution: 'not_run' });
  return { directory, files, platforms: reports };
}
