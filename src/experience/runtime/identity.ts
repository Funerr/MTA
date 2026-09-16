import type { NodeExecutionContext } from '@midscene/test';
import type { RuntimeIdentity } from './types';

/**
 * 从官方 Node 执行上下文提取经验身份。
 * 用例路径、名称与步骤位置参与请求 Key；experienceAct / aiAct 必须使用同一格式，
 * 才能在同一用例位置更换节点名后复用合格资产。
 */
export function identityFromNodeExecution(
  execution: NodeExecutionContext<unknown, unknown>,
): RuntimeIdentity {
  if (execution.scope === 'case') {
    return {
      runId: execution.case.runId,
      caseId: execution.case.caseId,
      casePath: execution.case.sourcePath,
      caseName: execution.case.name,
      stepPath: `${execution.case.phase}[${execution.case.stepIndex}]`,
      attempt: execution.case.attemptIndex,
      projectName: execution.case.projectName,
    };
  }
  return {
    runId: execution.document.documentRunId,
    caseId: execution.document.documentId,
    casePath: execution.document.sourcePath,
    caseName: execution.document.projectName,
    stepPath: `${execution.document.phase}[${execution.document.stepIndex}]`,
    projectName: execution.document.projectName,
  };
}
