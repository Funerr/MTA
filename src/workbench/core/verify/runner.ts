import type { StepRunResult } from '@midscene/test';
import type { VerificationGoal } from './goals';

/** 只解释框架结果，不执行动作；核查调度统一由 Midscene Runner 承担。 */
export function goalObservation(goal: VerificationGoal, steps: ReadonlyMap<number, StepRunResult>) {
  const results = goal.assertionIndices.map((index) => steps.get(index));
  const supported = results.length > 0 && results.every((step) => step?.node === 'aiAssert');
  const passed = supported && results.every((step) => step?.status === 'success');
  let observation: string;
  if (passed) {
    observation = goal.observations.join('\n');
  } else {
    // 区分缺口成因：未到达（执行中断）、断言失败、覆盖步骤不是断言节点，
    // 避免一律提示“未完成全部断言”造成误读。
    const missing = results.filter((step) => !step).length;
    const failed = results.filter((step) => step && step.status !== 'success').length;
    const unsupported = results.filter((step) => step && step.node !== 'aiAssert').length;
    const causes = [
      missing > 0 ? `本轮执行未到达 ${missing} 项断言（用例可能提前中断）` : null,
      failed > 0 ? `${failed} 项结果断言未通过` : null,
      unsupported > 0 ? `${unsupported} 项覆盖步骤未使用结果断言节点` : null,
    ].filter((cause): cause is string => cause !== null);
    observation = causes.length
      ? `证据不足：${causes.join('；')}；请查看框架报告`
      : '证据不足：未完成全部明确的结果断言；请查看框架报告';
  }
  return {
    status: passed ? 'observed-pass' as const : 'unknown' as const,
    observation,
    notes: '仅证明所选关键点，不代表完整用例验收。',
  };
}
