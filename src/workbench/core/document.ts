/**
 * 编写文档模型：一个文档保存三类内容——原始来源、结构化业务用例、
 * 每个平台的工作流变体。字段覆盖 case-to-yaml 转换交付契约的草稿
 * 模型（导出时再映射为契约的 snake_case 交付形态）。
 *
 * 本模块是纯数据与纯函数，不依赖 Node 专属 API，前端可直接复用。
 */

export const AUTHORING_DOCUMENT_FORMAT_VERSION = 1;

export const CASE_LEVELS = ['level1', 'level2', 'level3'] as const;
export type CaseLevel = (typeof CASE_LEVELS)[number];

export const AUTHORING_PLATFORMS = ['android', 'harmony'] as const;
export type AuthoringPlatform = (typeof AUTHORING_PLATFORMS)[number];

/** 转换就绪度，沿用转换交付契约的状态。draft 表示尚未生成。 */
export type AuthoringCaseStatus =
  | 'draft'
  | 'ready'
  | 'needs_clarification'
  | 'unsupported'
  | 'unvalidated';

export type SourceKind = 'manual' | 'paste' | 'text' | 'markdown' | 'excel';

/** 上传/粘贴的源文件登记。原文内容保存在工作区 uploads/ 下。 */
export interface SourceDocument {
  readonly id: string;
  readonly kind: SourceKind;
  readonly name: string;
  /** 工作区内相对路径（uploads/<id>-<name>）；manual 无文件。 */
  readonly file?: string;
  readonly importedAt: string;
}

/** 草稿用例中的来源定位：指向某 SourceDocument 的范围与片段。 */
export interface SourceRef {
  readonly sourceId: string;
  /** 工作表/单元格范围，或行范围（如 "L3-L8"）。 */
  readonly range?: string;
  /** 原文片段（保留原文）。 */
  readonly excerpt?: string;
}

export interface Precondition {
  /** 稳定 ID：分配后不变。 */
  readonly id: string;
  text: string;
  /** external=显式外部条件；workflow=需要实际准备步骤。 */
  satisfaction: 'external' | 'workflow';
}

export interface BusinessAction {
  /** 稳定 ID：分配后不变。 */
  readonly id: string;
  /** 操作意图。 */
  text: string;
  /** 必须保留的交互要求（原文明确的交互方式等）。 */
  mustPreserve?: string;
  /** 允许的 UI 适配说明。 */
  allowedAdaptation?: string;
}

export type ExpectationEvidenceKind =
  | 'visual'
  | 'state-change'
  | 'shell'
  | 'report'
  | 'unverified';

export interface Expectation {
  /** 稳定 ID：分配后不变。 */
  readonly id: string;
  /** 必须成立的业务结果（保持精确，不放宽）。 */
  text: string;
  /** 关联步骤 ID；缺省表示整条用例的预期。 */
  actionId?: string;
  evidenceKind: ExpectationEvidenceKind;
  /** 可接受变化说明。 */
  acceptableChange?: string;
}

export type RewriteBasis = 'user-request' | 'explicit-goal' | 'pending-suggestion';

/** 实质性改写记录：原文、改写、理由、依据。 */
export interface Rewrite {
  readonly id: string;
  readonly caseId: string;
  /** 受影响字段（如 actions/act-1/text）。 */
  readonly field: string;
  readonly original: string;
  readonly rewritten: string;
  readonly reason: string;
  readonly basis: RewriteBasis;
  readonly at: string;
}

export interface Issue {
  readonly id: string;
  readonly caseId?: string;
  /** 受影响字段。 */
  readonly field?: string;
  readonly message: string;
  /** 所需信息或缺失能力。 */
  readonly needed?: string;
  /** 用户确认解决的时间；存在即不再阻塞就绪判定。 */
  resolvedAt?: string;
  /** 解决说明（如：已核实断言保留原预期 / 补充了包名）。 */
  resolution?: string;
}

export interface BusinessCase {
  readonly id: string;
  /** 原编号；可能为空或与其他用例重复。 */
  sourceId: string;
  name: string;
  goal: string;
  level: CaseLevel;
  preconditions: Precondition[];
  /** 显式声明无前置条件，避免反复提示缺失。 */
  noPreconditionsDeclared: boolean;
  data?: string;
  deviceRoles?: string;
  actions: BusinessAction[];
  expectations: Expectation[];
  sourceRefs: SourceRef[];
  status: AuthoringCaseStatus;
}

/** 来源预期 → 平台执行内容的覆盖映射。 */
export interface CoverageMapping {
  readonly expectationId: string;
  readonly covered: boolean;
  /** 导出 case 索引（零基）与步骤索引（零基）及 Node 名。 */
  readonly caseIndex?: number;
  readonly stepIndex?: number;
  readonly node?: string;
  readonly reason?: string;
}

export interface AppContext {
  /** 应用包名；未知为空，禁止猜测。 */
  packageName: string;
  /** 入口/启动说明。 */
  entryHint?: string;
}

/** 平台确认状态：绑定内容修订；修订前进后确认失效。 */
export interface PlatformConfirmState {
  status: 'unconfirmed' | 'confirmed';
  confirmedAt?: string;
  /** 确认时的工作流修订号。 */
  confirmedWorkflowRevision?: number;
  /** 确认时的业务修订号。 */
  confirmedBusinessRevision?: number;
  /** 确认时的内容摘要（不可变快照 ID）。 */
  snapshotId?: string;
  /** 确认时的内容摘要文本。 */
  summary?: string;
}

/** 分层静态检查结果（由 /validate 刷新，随文档保存）。 */
export interface VariantValidation {
  readonly checkedAt: string;
  readonly allPassed: boolean;
  readonly layers: {
    yaml: { status: string; issues: readonly unknown[] };
    nodeInputs: { status: string; issues: readonly unknown[] };
    coverage: { status: string; issues: readonly unknown[] };
    evidencePaths: { status: string; issues: readonly unknown[] };
  };
}

/** 设备核查证据：绑定步骤/预期、平台、设备、时间与内容版本。 */
export interface EvidenceRecord {
  readonly id: string;
  readonly goalId: string;
  readonly caseId: string;
  readonly actionId?: string;
  readonly expectationIds: readonly string[];
  readonly platform: AuthoringPlatform;
  /** 精确设备绑定（采集时的设备 ID）。 */
  readonly deviceId: string;
  readonly capturedAt: string;
  /** 采集时的工作流修订与业务修订。 */
  readonly workflowRevision: number;
  readonly businessRevision: number;
  /** 采集时该用例前置动作快照（失效传播用）。 */
  readonly actionSnapshot: readonly { id: string; text: string }[];
  readonly preconditionPath?: readonly string[];
  readonly frameworkReport?: string;
  readonly appContextSnapshot?: string;
  readonly target: string;
  readonly observation: string;
  /** observed-pass：观察成立；observed-fail：不成立；unknown：未能确认。 */
  readonly status: 'observed-pass' | 'observed-fail' | 'unknown';
  /** 工作区内截图相对路径。 */
  readonly screenshotFile?: string;
  /** 现场说明与局限（动作成功不等于业务生效）。 */
  readonly notes?: string;
}

export interface PlatformWorkflowVariant {
  readonly platform: AuthoringPlatform;
  appContext: AppContext;
  /**
   * 平台执行工作流。yaml 保留注释与未知结构；invalidYamlBuffer
   * 在人工编辑出现语法错误时暂存候选文本，未同步前阻止确认。
   */
  workflow: {
    revision: number;
    /** 该工作流编译自哪个业务修订。 */
    basedOnBusinessRevision: number;
    yaml: string;
    invalidYamlBuffer?: string;
    /** YAML cases 顺序对应的业务用例 ID（合并/局部替换的定位依据）。 */
    mergedCaseIds?: string[];
    /** 最近一次工作流修订时间。 */
    updatedAt?: string;
  };
  coverage: CoverageMapping[];
  caseStatuses?: Record<string, AuthoringCaseStatus>;
  /** 最近一次分层静态检查；未检查为 undefined。 */
  validation?: VariantValidation;
  /** 设备核查证据（按采集时间追加；失效状态按需计算）。 */
  evidence: EvidenceRecord[];
  confirm: PlatformConfirmState;
  /** 业务要求变化后待更新标记。 */
  needsUpdate: boolean;
}

export interface AuthoringDocument {
  readonly formatVersion: typeof AUTHORING_DOCUMENT_FORMAT_VERSION;
  readonly id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** 业务内容修订号；任何业务字段变化时递增。 */
  businessRevision: number;
  /** 保存版本号；每次落盘递增，用于并发写冲突检测。 */
  saveVersion: number;
  sources: SourceDocument[];
  cases: BusinessCase[];
  rewrites: Rewrite[];
  issues: Issue[];
  variants: Partial<Record<AuthoringPlatform, PlatformWorkflowVariant>>;
}

// ---------------------------------------------------------------------------
// 稳定 ID 分配：前缀 + 递增序号，避免删除后重用。

export function allocateStableId(
  prefix: string,
  taken: Iterable<string>,
): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

export function caseIdsOf(document: AuthoringDocument): string[] {
  return document.cases.map((c) => c.id);
}

// ---------------------------------------------------------------------------
// 修订推进。

export class DocumentMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentMutationError';
  }
}

/**
 * 业务内容变更：递增业务修订，并把所有平台变体标记待更新。
 * 仅平台操作变化不应调用此函数（用 touchWorkflow）。
 */
export function touchBusiness(
  document: AuthoringDocument,
  now = new Date().toISOString(),
): void {
  document.businessRevision += 1;
  document.updatedAt = now;
  for (const variant of Object.values(document.variants)) {
    if (!variant) continue;
    variant.needsUpdate = true;
    variant.validation = undefined;
    variant.confirm = { status: 'unconfirmed' };
  }
}

/** 平台工作流内容变更：递增工作流修订；确认若存在则视为过期。 */
export function touchWorkflow(
  variant: PlatformWorkflowVariant,
  now = new Date().toISOString(),
): void {
  variant.validation = undefined;
  variant.confirm = { status: 'unconfirmed' };
  variant.workflow.revision += 1;
  variant.workflow.updatedAt = now;
  variant.needsUpdate = false;
}

/** 确认是否仍然有效：修订号必须与当前一致。 */
export function confirmStillValid(variant: PlatformWorkflowVariant): boolean {
  return (
    variant.confirm.status === 'confirmed' &&
    variant.confirm.confirmedWorkflowRevision === variant.workflow.revision &&
    variant.confirm.confirmedBusinessRevision !== undefined
  );
}

// ---------------------------------------------------------------------------
// 缺失提示：进入生成前突出关键字段缺失；允许显式声明无前置条件。

export interface CaseGap {
  /** 受影响字段（'name' | 'actions/act-2' 等形式）。 */
  readonly field: string;
  readonly message: string;
}

export function describeCaseGaps(caseItem: BusinessCase): CaseGap[] {
  const gaps: CaseGap[] = [];
  if (!caseItem.name.trim()) {
    gaps.push({ field: 'name', message: '用例名称缺失' });
  }
  if (!caseItem.goal.trim()) {
    gaps.push({ field: 'goal', message: '测试目的缺失' });
  }
  if (caseItem.actions.length === 0) {
    gaps.push({ field: 'actions', message: '至少需要一个操作步骤' });
  }
  for (const action of caseItem.actions) {
    if (!action.text.trim()) {
      gaps.push({
        field: `actions/${action.id}`,
        message: `步骤 ${action.id} 内容为空`,
      });
    }
  }
  if (caseItem.expectations.length === 0) {
    gaps.push({ field: 'expectations', message: '至少需要一个预期结果' });
  }
  for (const expectation of caseItem.expectations) {
    if (!expectation.text.trim()) {
      gaps.push({
        field: `expectations/${expectation.id}`,
        message: `预期 ${expectation.id} 内容为空`,
      });
    }
  }
  if (!caseItem.noPreconditionsDeclared && caseItem.preconditions.length === 0) {
    gaps.push({
      field: 'preconditions',
      message: '前置条件未说明；若无前置条件请勾选“声明无前置条件”',
    });
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// 构造与容错加载。

export function createEmptyDocument(
  id: string,
  name: string,
  now = new Date().toISOString(),
): AuthoringDocument {
  return {
    formatVersion: AUTHORING_DOCUMENT_FORMAT_VERSION,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    businessRevision: 1,
    saveVersion: 1,
    sources: [],
    cases: [],
    rewrites: [],
    issues: [],
    variants: {},
  };
}

export function createVariant(
  platform: AuthoringPlatform,
  businessRevision: number,
  yaml = '',
): PlatformWorkflowVariant {
  return {
    platform,
    appContext: { packageName: '' },
    workflow: {
      revision: 1,
      basedOnBusinessRevision: businessRevision,
      yaml,
    },
    coverage: [],
    evidence: [],
    confirm: { status: 'unconfirmed' },
    needsUpdate: true,
  };
}

/** 保存前的结构校验；问题以异常抛出（由路由转 400/409）。 */
export function assertDocumentInvariants(document: AuthoringDocument): void {
  if (document.formatVersion !== AUTHORING_DOCUMENT_FORMAT_VERSION) {
    throw new DocumentMutationError(
      `不支持的编写文档版本：${document.formatVersion}`,
    );
  }
  const ids = new Set<string>();
  const duplicated = new Set<string>();
  for (const caseItem of document.cases) {
    for (const id of collectCaseStableIds(caseItem)) {
      if (ids.has(id)) duplicated.add(id);
      ids.add(id);
    }
  }
  if (duplicated.size > 0) {
    throw new DocumentMutationError(
      `稳定 ID 重复：${[...duplicated].join(', ')}`,
    );
  }
  for (const caseItem of document.cases) {
    const actionIds = new Set(caseItem.actions.map((a) => a.id));
    for (const expectation of caseItem.expectations) {
      if (
        expectation.actionId !== undefined &&
        !actionIds.has(expectation.actionId)
      ) {
        throw new DocumentMutationError(
          `用例 ${caseItem.id} 的预期 ${expectation.id} 关联了不存在的步骤 ${expectation.actionId}`,
        );
      }
    }
  }
  for (const [platform, variant] of Object.entries(document.variants)) {
    if (!variant) continue;
    if (variant.platform !== platform) {
      throw new DocumentMutationError(
        `平台变体键 ${platform} 与其 platform 字段 ${variant.platform} 不一致`,
      );
    }
  }
}

function collectCaseStableIds(caseItem: BusinessCase): string[] {
  return [
    caseItem.id,
    ...caseItem.preconditions.map((p) => p.id),
    ...caseItem.actions.map((a) => a.id),
    ...caseItem.expectations.map((e) => e.id),
  ];
}

/** 容错加载：字段缺失/类型不符时回退默认值，而不是整体失败。 */
export function normalizeDocument(raw: unknown): AuthoringDocument {
  const source = (raw ?? {}) as Partial<AuthoringDocument> & Record<string, unknown>;
  const id = typeof source.id === 'string' && source.id ? source.id : 'd-unknown';
  const now = new Date().toISOString();
  const document: AuthoringDocument = {
    formatVersion: AUTHORING_DOCUMENT_FORMAT_VERSION,
    id,
    name: typeof source.name === 'string' ? source.name : '未命名文档',
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : now,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : now,
    businessRevision:
      typeof source.businessRevision === 'number' && source.businessRevision >= 1
        ? source.businessRevision
        : 1,
    saveVersion:
      typeof source.saveVersion === 'number' && source.saveVersion >= 1
        ? source.saveVersion
        : 1,
    sources: Array.isArray(source.sources) ? (source.sources as SourceDocument[]) : [],
    cases: Array.isArray(source.cases) ? (source.cases as BusinessCase[]) : [],
    rewrites: Array.isArray(source.rewrites) ? (source.rewrites as Rewrite[]) : [],
    issues: Array.isArray(source.issues) ? (source.issues as Issue[]) : [],
    variants:
      source.variants && typeof source.variants === 'object'
        ? (source.variants as AuthoringDocument['variants'])
        : {},
  };
  return document;
}
