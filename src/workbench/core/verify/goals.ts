import YAML from 'yaml';
import { buildCardView } from '../cards/mapping';
import type { AuthoringDocument, AuthoringPlatform, PlatformWorkflowVariant } from '../document';

export interface VerificationGoal {
  readonly id: string;
  readonly caseId: string;
  readonly actionId?: string;
  readonly expectationIds: readonly string[];
  readonly target: string;
  /** 原工作流路径，仅展示与证据关联，绝不作为 Agent 提示派发。 */
  readonly preconditionPath: readonly string[];
  readonly observations: readonly string[];
  readonly stepIndices: readonly number[];
  readonly assertionIndices: readonly number[];
  readonly endStepIndex: number;
  readonly blockedReason?: string;
}

/** 编写层裁剪顺序工作流；保留原节点、输入及生命周期，由框架执行。 */
export function deriveVerificationGoals(input: {
  document: AuthoringDocument;
  platform: AuthoringPlatform;
  variant: PlatformWorkflowVariant;
  caseId: string;
  actionIds?: readonly string[];
}): { goals: VerificationGoal[]; issues: string[]; workflowYaml?: string } {
  const { document, variant } = input;
  const fail = (message: string) => ({ goals: [], issues: [message] });
  const businessCase = document.cases.find((item) => item.id === input.caseId);
  if (!businessCase) return fail('业务用例不存在');
  if (variant.workflow.invalidYamlBuffer !== undefined) return fail('存在未同步的 YAML 缓冲区');
  if (variant.needsUpdate || variant.workflow.basedOnBusinessRevision !== document.businessRevision) return fail('业务内容已变化，请先更新工作流');
  if (!businessCase.noPreconditionsDeclared && !businessCase.preconditions.length) return fail('前置条件未明确');
  const openIssues = document.issues.filter((issue) => !issue.resolvedAt && (!issue.caseId || issue.caseId === input.caseId));
  if (openIssues.length) return fail(`存在待澄清问题：${openIssues.map((issue) => issue.message).join('；')}`);
  const view = buildCardView(variant.workflow.yaml);
  if (!view.ok) return fail(view.error);
  const caseIndex = variant.workflow.mergedCaseIds?.indexOf(input.caseId) ?? -1;
  if (caseIndex < 0) return fail('用例与工作流映射缺失，无法确定核查范围');
  const cases = view.view.document.get('cases', true);
  if (!YAML.isSeq(cases) || !YAML.isMap(cases.items[caseIndex])) return fail('用例映射已失效');
  const caseNode = cases.items[caseIndex] as YAML.YAMLMap;
  const steps = caseNode.get('steps', true);
  if (!YAML.isSeq(steps)) return fail('工作流缺少步骤');
  const selected = input.actionIds ?? businessCase.actions.map((action) => action.id);
  if (!selected.length || selected.some((id) => !businessCase.actions.some((action) => action.id === id))) return fail('核查步骤为空或不存在');
  const goals: VerificationGoal[] = [];
  for (const action of businessCase.actions.filter((item) => selected.includes(item.id))) {
    const cards = view.view.cards.filter((card) => card.caseIndex === caseIndex && card.actionId === action.id);
    if (!cards.length) return fail(`步骤 ${action.id} 尚未映射，无法确定核查范围`);
    const indices = cards.flatMap((card) => card.nodes.map((node) => node.stepIndex));
    const expectations = businessCase.expectations.filter((item) => item.actionId === action.id);
    const coverage = expectations.map((item) => variant.coverage.find((entry) => entry.expectationId === item.id));
    if (coverage.some((entry) => !entry?.covered || entry.caseIndex !== caseIndex || entry.stepIndex === undefined || entry.stepIndex >= steps.items.length)) return fail('预期覆盖映射缺失或失效');
    const assertionIndices = coverage.map((entry) => entry!.stepIndex!);
    const endStepIndex = Math.max(...indices, ...assertionIndices);
    goals.push({ id: `g-${input.caseId}-${action.id}`, caseId: input.caseId, actionId: action.id,
      expectationIds: expectations.map((item) => item.id), target: action.text,
      preconditionPath: steps.items.slice(0, Math.min(...indices)).map((node) => YAML.stringify(node)),
      observations: expectations.map((item) => item.text), stepIndices: indices, assertionIndices, endStepIndex });
  }
  const caseExpectations = businessCase.expectations.filter((item) => !item.actionId);
  if (!input.actionIds && caseExpectations.length) {
    const coverage = caseExpectations.map((item) => variant.coverage.find((entry) => entry.expectationId === item.id));
    if (coverage.some((entry) => !entry?.covered || entry.caseIndex !== caseIndex || entry.stepIndex === undefined || entry.stepIndex >= steps.items.length)) return fail('用例级预期映射缺失');
    goals.push({ id: `g-${input.caseId}-case`, caseId: input.caseId, target: businessCase.name,
      expectationIds: caseExpectations.map((item) => item.id), observations: caseExpectations.map((item) => item.text),
      preconditionPath: steps.items.map((node) => YAML.stringify(node)), stepIndices: [],
      assertionIndices: coverage.map((entry) => entry!.stepIndex!), endStepIndex: steps.items.length - 1 });
  }
  const last = input.actionIds ? Math.max(...goals.map((goal) => goal.endStepIndex)) : steps.items.length - 1;
  if (input.actionIds && view.view.rawBlocks.some((block) => block.caseIndex === caseIndex && (block.stepIndex ?? 0) <= last)) return fail('所选范围含无法确定依赖的结构，请明确核查工作流');
  steps.items = steps.items.slice(0, last + 1);
  cases.items = [caseNode];
  try { view.view.document.toJS(); } catch { return fail('裁剪后存在跨用例引用，无法确定依赖'); }
  return { goals, issues: [], workflowYaml: view.view.document.toString() };
}
