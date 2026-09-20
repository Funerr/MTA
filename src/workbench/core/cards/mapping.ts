import YAML from 'yaml';

/**
 * 步骤卡片 = 平台工作流 YAML 的确定性投影（不做第二轮模型摘要）。
 *
 * - 生成的 YAML 以 `# @step <actionId>` 注释作为业务步骤锚点；
 *   锚点之间连续的节点组成一张卡片（业务步骤 → 多节点）。
 * - 无锚点的节点各自成为独立卡片（准备/收尾动作）。
 * - 超出卡片能力的结构（device.parallel、生命周期段、非单键步骤）
 *   成为原始块：保留原文，只在 YAML 编辑中修改。
 * - 卡片编辑直接回写 YAML Document 的对应节点值，注释与未知结构
 *   不会被重新序列化丢弃。
 */

export interface CardNode {
  /** 在所属用例 steps 内的零基索引（编辑定位用）。 */
  readonly stepIndex: number;
  readonly node: string;
  /** 节点输入（不含 `$` 元数据）。 */
  readonly input: unknown;
  /** 引擎 `$` 元数据（timeout 等），编辑时原样保留。 */
  readonly meta: Record<string, unknown> | null;
}

export interface WorkflowCard {
  /** `c<caseIndex>-s<firstStepIndex>`，随文本重建。 */
  readonly id: string;
  readonly caseIndex: number;
  readonly caseName: string;
  /** 关联的业务步骤 ID（@step 锚点）。 */
  readonly actionId?: string;
  readonly nodes: CardNode[];
}

export interface RawBlock {
  readonly id: string;
  readonly caseIndex: number;
  readonly stepIndex?: number;
  readonly reason: string;
  /** 原文（保留注释与未知结构）。 */
  readonly text: string;
}

export interface CardView {
  readonly cards: readonly WorkflowCard[];
  readonly rawBlocks: readonly RawBlock[];
  readonly document: YAML.Document;
  /** 解析到的顶层生命周期段名（用于原始块提示）。 */
  readonly lifecycleSections: readonly string[];
}

export type CardViewResult = { ok: true; view: CardView } | { ok: false; error: string };

/** 这些结构超出卡片能力，保留为原始块。 */
const RAW_BLOCK_NODES = new Set(['device.parallel']);

export function buildCardView(yamlText: string): CardViewResult {
  let document: YAML.Document;
  try {
    document = YAML.parseDocument(yamlText);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (document.errors.length > 0) {
    return { ok: false, error: document.errors[0]!.message };
  }

  const cards: WorkflowCard[] = [];
  const rawBlocks: RawBlock[] = [];
  const lifecycleSections: string[] = [];

  const root = document.contents;
  if (!root || !YAML.isMap(root)) {
    return { ok: false, error: '工作流顶层不是对象（缺少 cases）' };
  }
  for (const pair of root.items) {
    const key = String(pair.key);
    if (key === 'cases') continue;
    lifecycleSections.push(key);
    rawBlocks.push({
      id: `raw-lifecycle-${key}`,
      caseIndex: -1,
      reason: `生命周期段 ${key} 超出卡片视图，请在 YAML 编辑中修改`,
      text: YAML.stringify(pair.value),
    });
  }

  const casesPair = root.items.find((pair) => String(pair.key) === 'cases');
  if (!casesPair || !casesPair.value || !YAML.isSeq(casesPair.value)) {
    return { ok: false, error: '缺少 cases 数组' };
  }

  casesPair.value.items.forEach((caseItem, caseIndex) => {
    if (!caseItem || !YAML.isMap(caseItem)) {
      rawBlocks.push({
        id: `raw-case-${caseIndex}`,
        caseIndex,
        reason: '用例不是对象，保留原文',
        text: YAML.stringify(caseItem),
      });
      return;
    }
    const namePair = caseItem.items.find((pair) => String(pair.key) === 'name');
    const caseName =
      namePair && namePair.value ? String(namePair.value) : `case#${caseIndex}`;
    const stepsPair = caseItem.items.find((pair) => String(pair.key) === 'steps');
    if (!stepsPair?.value || !YAML.isSeq(stepsPair.value)) {
      rawBlocks.push({
        id: `raw-case-${caseIndex}-steps`,
        caseIndex,
        reason: '用例缺少 steps 数组，保留原文',
        text: YAML.stringify(caseItem),
      });
      return;
    }

    const stepsSeq: YAML.YAMLSeq = stepsPair.value;
    let currentActionId: string | undefined;
    let currentCard: WorkflowCard | undefined;

    stepsSeq.items.forEach((stepItem, stepIndex) => {
      // 首个步骤前的注释落在 seq.commentBefore，其余在 item.commentBefore。
      const anchor = stepAnchor(
        stepIndex === 0 ? { commentBefore: stepsSeq.commentBefore } : stepItem,
      );
      if (anchor !== undefined && anchor !== currentActionId) {
        currentActionId = anchor;
        currentCard = undefined; // 锚点切换，开启新卡片
      }

      if (!stepItem || !YAML.isMap(stepItem) || stepItem.items.length !== 1) {
        currentCard = undefined;
        rawBlocks.push({
          id: `raw-c${caseIndex}-s${stepIndex}`,
          caseIndex,
          stepIndex,
          reason: '步骤不是单键节点结构，保留原文',
          text: YAML.stringify(stepItem),
        });
        return;
      }
      const pair = stepItem.items[0]!;
      const node = String(pair.key);
      if (RAW_BLOCK_NODES.has(node)) {
        currentCard = undefined;
        rawBlocks.push({
          id: `raw-c${caseIndex}-s${stepIndex}`,
          caseIndex,
          stepIndex,
          reason: `${node} 超出卡片能力，保留原文`,
          text: YAML.stringify(stepItem),
        });
        return;
      }

      const { input, meta } = splitMeta(toPlain(pair.value));
      const cardNode: CardNode = { stepIndex, node, input, meta };

      if (currentCard && currentCard.actionId === currentActionId) {
        currentCard.nodes.push(cardNode);
        return;
      }
      currentCard = {
        id: `c${caseIndex}-s${stepIndex}`,
        caseIndex,
        caseName,
        actionId: currentActionId,
        nodes: [cardNode],
      };
      cards.push(currentCard);
    });
  });

  return { ok: true, view: { cards, rawBlocks, document, lifecycleSections } };
}

/** 步骤节点前的 `# @step <id>` 注释锚点。 */
function stepAnchor(stepItem: unknown): string | undefined {
  if (!stepItem || typeof stepItem !== 'object') return undefined;
  const commentBefore = (stepItem as { commentBefore?: unknown }).commentBefore;
  if (typeof commentBefore !== 'string') return undefined;
  for (const line of commentBefore.split('\n')) {
    const match = /^#?\s*@step\s+([A-Za-z0-9_-]+)/.exec(line.trim());
    if (match) return match[1];
  }
  return undefined;
}

function toPlain(node: unknown): unknown {
  if (node && typeof node === 'object' && 'toJSON' in (node as Record<string, unknown>)) {
    return (node as { toJSON(): unknown }).toJSON();
  }
  return node;
}

function splitMeta(input: unknown): {
  input: unknown;
  meta: Record<string, unknown> | null;
} {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    if ('$' in record && record.$ && typeof record.$ === 'object') {
      const { $, ...rest } = record;
      const restKeys = Object.keys(rest);
      return {
        input: restKeys.length > 0 ? rest : {},
        meta: $ as Record<string, unknown>,
      };
    }
  }
  return { input, meta: null };
}

// ---------------------------------------------------------------------------
// 卡片编辑：直接回写 Document 节点，保留注释。

export class CardEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardEditError';
  }
}

function caseStepsSeq(
  document: YAML.Document,
  caseIndex: number,
): YAML.YAMLSeq {
  const root = document.contents;
  if (!root || !YAML.isMap(root)) throw new CardEditError('工作流顶层结构损坏');
  const casesPair = root.items.find((pair) => String(pair.key) === 'cases');
  if (!casesPair?.value || !YAML.isSeq(casesPair.value)) {
    throw new CardEditError('cases 数组缺失');
  }
  const caseItem = casesPair.value.items[caseIndex];
  if (!caseItem || !YAML.isMap(caseItem)) {
    throw new CardEditError(`用例 ${caseIndex} 不是对象`);
  }
  const stepsPair = caseItem.items.find((pair) => String(pair.key) === 'steps');
  if (!stepsPair?.value || !YAML.isSeq(stepsPair.value)) {
    throw new CardEditError(`用例 ${caseIndex} 缺少 steps`);
  }
  return stepsPair.value;
}

function stepPairAt(seq: YAML.YAMLSeq, stepIndex: number): YAML.Pair<unknown, unknown> {
  const stepItem = seq.items[stepIndex];
  if (!stepItem || !YAML.isMap(stepItem) || stepItem.items.length !== 1) {
    throw new CardEditError(`步骤 ${stepIndex} 不是可编辑的单键节点`);
  }
  const pair = stepItem.items[0] as YAML.Pair<unknown, unknown>;
  return pair;
}

/** 更新卡片某节点的输入（不含 `$`；已有 `$` 原样保留）。 */
export function updateCardNodeInput(
  document: YAML.Document,
  caseIndex: number,
  stepIndex: number,
  input: unknown,
): void {
  const seq = caseStepsSeq(document, caseIndex);
  const pair = stepPairAt(seq, stepIndex);
  const node = String(pair.key);
  const existing = toPlain(pair.value);
  const merged =
    existing && typeof existing === 'object' && !Array.isArray(existing) && '$' in existing
      ? { ...(input as Record<string, unknown>), $: (existing as Record<string, unknown>).$ }
      : input;
  pair.value = document.createNode(merged);
}

/** 在指定位置插入步骤；带可选 @step 锚点。返回新步骤索引。 */
export function insertStep(
  document: YAML.Document,
  caseIndex: number,
  afterStepIndex: number,
  node: string,
  input: unknown,
  actionId?: string,
): number {
  const seq = caseStepsSeq(document, caseIndex);
  const stepMap = new YAML.YAMLMap();
  const pair = new YAML.Pair(document.createNode(node), document.createNode(input));
  stepMap.items.push(pair);
  if (actionId) {
    stepMap.commentBefore = ` @step ${actionId}`;
  }
  const insertAt = Math.min(afterStepIndex + 1, seq.items.length);
  seq.items.splice(insertAt, 0, stepMap as never);
  return insertAt;
}

/** 删除步骤；返回是否成功。步骤的注释锚点随节点一并删除。 */
export function deleteStep(
  document: YAML.Document,
  caseIndex: number,
  stepIndex: number,
): boolean {
  const seq = caseStepsSeq(document, caseIndex);
  if (stepIndex < 0 || stepIndex >= seq.items.length) return false;
  seq.items.splice(stepIndex, 1);
  return true;
}

/** 序列化（保留注释与未知结构）。 */
export function cardViewToYaml(document: YAML.Document): string {
  return document.toString({ indent: 2, lineWidth: 0 });
}

/** 生成阶段写入 @step 锚点注释的辅助（compile 使用）。 */
export function stepAnchorComment(actionId: string): string {
  return ` @step ${actionId}`;
}
