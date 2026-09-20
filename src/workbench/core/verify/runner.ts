import type { StepRunResult } from '@midscene/test';
import type { VerificationGoal } from './goals';

/** 只解释框架结果，不执行动作；核查调度统一由 Midscene Runner 承担。 */
export function goalObservation(goal: VerificationGoal, steps: ReadonlyMap<number, StepRunResult>) {
  const results = goal.assertionIndices.map((index) => steps.get(index));
  const supported = results.length > 0 && results.every((step) => step?.node === 'aiAssert');
  const passed = supported && results.every((step) => step?.status === 'success');
  return {
    status: passed ? 'observed-pass' as const : 'unknown' as const,
    observation: passed ? goal.observations.join('\n') : '证据不足：未完成全部明确的结果断言；请查看框架报告',
    notes: '仅证明所选关键点，不代表完整用例验收。',
  };
}
