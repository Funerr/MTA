import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  DATA_VERSION,
  EVAL_CONFIG_VERSION,
  FIXTURE_ROOT,
  MATCHER_VERSION,
  OUTPUT_ROOT,
  PROTOCOL_VERSION,
  REPRO_COMMAND,
} from './constants';
import { VisualAssertDataError } from './errors';
import { evaluateSample } from './evaluator';
import { computeAllTypeMetrics, computeTypeMetrics, decideGoNoGo } from './metrics';
import { VISUAL_ASSERT_PROTOCOL } from './protocol';
import { loadDataset } from './dataset';
import type {
  ExperimentSummary,
  SampleEvaluation,
  SplitGroup,
} from './types';

export interface ExperimentRun {
  readonly split: SplitGroup | 'all';
  readonly samples: SampleEvaluation[];
  readonly summary: ExperimentSummary;
  readonly errors: VisualAssertDataError[];
}

function toSummary(
  split: SplitGroup | 'all',
  samples: readonly SampleEvaluation[],
): ExperimentSummary {
  return {
    evalConfigVersion: EVAL_CONFIG_VERSION,
    dataVersion: DATA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    matcherConfigVersion: MATCHER_VERSION,
    split,
    sampleCount: samples.length,
    errorCount: samples.filter((sample) => sample.decision === 'error').length,
    overall: computeTypeMetrics(samples),
    byType: computeAllTypeMetrics(samples),
    verdict: decideGoNoGo(samples),
    ocr: {
      enabled: VISUAL_ASSERT_PROTOCOL.ocr.enabled,
      bundledModel: VISUAL_ASSERT_PROTOCOL.ocr.bundledModel,
    },
  };
}

export async function runEvaluation(options: {
  readonly datasetDir: string;
  readonly split?: SplitGroup;
}): Promise<ExperimentRun> {
  const errors: VisualAssertDataError[] = [];
  let loaded;
  try {
    loaded = await loadDataset(options.datasetDir, options.split);
  } catch (error) {
    if (error instanceof VisualAssertDataError) {
      const errorSample: SampleEvaluation = {
        sampleId: error.sampleId ?? 'dataset',
        semanticType: 'open-semantic',
        assertion: '',
        group: options.split ?? 'calibration',
        humanLabel: 'unknown',
        expectedDecision: 'unknown',
        decision: 'error',
        reason: error.message,
        code: error.code,
        latencyMs: 0,
        matcher: {},
      };
      return {
        split: options.split ?? 'all',
        samples: [errorSample],
        summary: toSummary(options.split ?? 'all', [errorSample]),
        errors: [error],
      };
    }
    throw error;
  }

  const samples: SampleEvaluation[] = [];
  for (const sample of loaded.samples) {
    try {
      samples.push(await evaluateSample(sample));
    } catch (error) {
      const wrapped =
        error instanceof VisualAssertDataError
          ? error
          : new VisualAssertDataError(
              'execution-error',
              error instanceof Error ? error.message : String(error),
              sample.record.id,
            );
      errors.push(wrapped);
      samples.push({
        sampleId: sample.record.id,
        semanticType: sample.record.semanticType,
        assertion: sample.record.assertion,
        group: sample.record.group,
        humanLabel: sample.record.humanLabel,
        expectedDecision: sample.record.expectedDecision,
        decision: 'error',
        reason: wrapped.message,
        code: wrapped.code,
        latencyMs: 0,
        matcher: {},
      });
    }
  }

  return {
    split: options.split ?? 'all',
    samples,
    summary: toSummary(options.split ?? 'all', samples),
    errors,
  };
}

function formatRate(value: number | null): string {
  if (value === null) return 'n/a（分母为 0）';
  return `${(value * 100).toFixed(1)}%（${value}）`;
}

export function renderReportMarkdown(runs: {
  readonly calibration: ExperimentRun;
  readonly validation1: ExperimentRun;
  readonly validation2: ExperimentRun;
}): string {
  const v1 = runs.validation1.summary;
  const consistent =
    JSON.stringify(stripTiming(runs.validation1.samples)) ===
    JSON.stringify(stripTiming(runs.validation2.samples));
  const lines = [
    '# 视觉断言经验离线评估报告',
    '',
    `**结论：${v1.verdict.conclusion.toUpperCase()}**`,
    '',
    '本报告只评估有限视觉断言能否在隔离实验中复用历史证据，**不替换原生 `aiAssert`**，也不把结果解释为跨设备统计保证。',
    '',
    '## 1. 预设 go / no-go',
    '',
    `- 协议：\`${VISUAL_ASSERT_PROTOCOL.version}\``,
    `- 误通过门槛：${VISUAL_ASSERT_PROTOCOL.go.falsePassMax}（分母：${VISUAL_ASSERT_PROTOCOL.denominators.falsePass}）`,
    `- 每类覆盖率门槛：≥ ${VISUAL_ASSERT_PROTOCOL.go.minCoverageBySupportedType}（分母：${VISUAL_ASSERT_PROTOCOL.denominators.coverage}）`,
    `- 开放语义：必须全部 unknown`,
    `- 人工 unknown：不得输出 supported / contradicted`,
    `- 数据或执行错误：不得判为有效通过`,
    '',
    '## 2. 配置与数据',
    '',
    `- 评估配置：\`${EVAL_CONFIG_VERSION}\``,
    `- 数据版本：\`${DATA_VERSION}\``,
    `- Matcher：\`${MATCHER_VERSION}\`（校准后冻结，不对验证集逐例改阈值）`,
    `- OCR：关闭（未内置模型；能力不足时 unknown，禁止在线 VLM）`,
    `- 复现命令：\`${REPRO_COMMAND}\``,
    '',
    '## 3. 验证集检查',
    '',
    `- 无数据/执行错误：${v1.verdict.checks.noDataOrExecutionErrors ? '通过' : '失败'}`,
    `- 误通过为零：${v1.verdict.checks.falsePassIsZero ? '通过' : '失败'}（${v1.overall.falsePass} / 分母 ${v1.overall.humanFalse}）`,
    `- 覆盖率门槛：${v1.verdict.checks.coverageMeetsThreshold ? '通过' : '失败'}`,
    `- 开放语义 unknown：${v1.verdict.checks.unsupportedAreUnknown ? '通过' : '失败'}`,
    `- 人工 unknown 保持 unknown：${v1.verdict.checks.unknownLabelsStayUnknown ? '通过' : '失败'}`,
    `- 两次验证决策一致（忽略耗时）：${consistent ? '是' : '否'}`,
    '',
    '### 分类型指标（验证 run-1）',
    '',
    '| 类型 | 样本 | 正例 | 反例 | unknown 标签 | 误通过 | 误拒绝 | 覆盖率 | unknown 率 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const item of v1.byType) {
    lines.push(
      `| ${item.semanticType} | ${item.sampleCount} | ${item.humanTrue} | ${item.humanFalse} | ${item.humanUnknown} | ${item.falsePass} | ${item.falseReject} | ${formatRate(item.coverage)} | ${formatRate(item.unknownRate)} |`,
    );
  }
  lines.push(
    `| all | ${v1.overall.sampleCount} | ${v1.overall.humanTrue} | ${v1.overall.humanFalse} | ${v1.overall.humanUnknown} | ${v1.overall.falsePass} | ${v1.overall.falseReject} | ${formatRate(v1.overall.coverage)} | ${formatRate(v1.overall.unknownRate)} |`,
  );
  lines.push('', `总耗时（验证 run-1）：${v1.overall.totalLatencyMs.toFixed(1)} ms`, '');
  lines.push('## 4. 失败与困难样本', '');
  const failures = runs.validation1.samples.filter(
    (sample) =>
      sample.decision === 'error' ||
      sample.decision !== sample.expectedDecision ||
      (sample.humanLabel === false && sample.decision === 'supported') ||
      (sample.humanLabel === true && sample.decision === 'contradicted'),
  );
  if (failures.length === 0) {
    lines.push('验证集无误通过/误拒绝/执行错误；困难样本（removed / other-page / 开放语义）均保留为 unknown。');
  } else {
    lines.push('| 样本 | 人工 | 期望 | 决策 | 原因 |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const sample of failures) {
      lines.push(
        `| ${sample.sampleId} | ${sample.humanLabel} | ${sample.expectedDecision} | ${sample.decision} | ${sample.reason} |`,
      );
    }
  }
  lines.push('', '## 5. 边界与后续', '');
  if (v1.verdict.conclusion === 'go') {
    lines.push(
      ...v1.verdict.reasons.map((reason) => `- ${reason}`),
      '- go 仅表示：可另开生产化设计 Change 讨论断言资格；**原生 aiAssert 仍是用例通过状态的判断入口**。',
    );
  } else {
    lines.push('- 本次为 no-go。原因：');
    for (const reason of v1.verdict.reasons) lines.push(`  - ${reason}`);
    lines.push(
      '- no-go 也是完整研究结论，不要求实现生产替代。可验证的后续问题：真实设备截图、跨主题/分辨率、以及是否需要独立断言资产（与动作 Store 隔离）。',
    );
  }
  lines.push(
    '',
    '## 6. 校准记录',
    '',
    `- 校准样本 ${runs.calibration.summary.sampleCount} 条，使用冻结 Matcher 阈值，未对验证集逐例调参。`,
    `- 校准覆盖率：${runs.calibration.summary.byType
      .filter((item) => item.semanticType !== 'open-semantic')
      .map((item) => `${item.semanticType}=${formatRate(item.coverage)}`)
      .join('，')}`,
    '- 校准阶段将二态控件远离左边缘，避免 context 扩边被夹紧后位移样本上下文尺寸不一致；这是夹具布局约束，不是验证集阈值特调。',
    '- 合成样本与单一环境（Pixel 8 / 360×640 / light）不构成跨设备统计保证。样本量小，零误通过不能外推。',
    '',
  );
  return `${lines.join('\n')}\n`;
}

export function stripTiming(samples: readonly SampleEvaluation[]): unknown {
  return samples.map((sample) => ({
    sampleId: sample.sampleId,
    decision: sample.decision,
    code: sample.code,
    humanLabel: sample.humanLabel,
    matcher: {
      positive: sample.matcher.positive
        ? { decision: sample.matcher.positive.decision, code: sample.matcher.positive.code }
        : undefined,
      negative: sample.matcher.negative
        ? { decision: sample.matcher.negative.decision, code: sample.matcher.negative.code }
        : undefined,
    },
  }));
}

export async function persistRun(
  outputDir: string,
  name: string,
  run: ExperimentRun,
): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${name}.json`);
  await fs.writeFile(
    filePath,
    `${JSON.stringify(
      {
        split: run.split,
        summary: run.summary,
        samples: run.samples,
        errorMessages: run.errors.map((error) => error.message),
      },
      null,
      2,
    )}\n`,
  );
  return filePath;
}

export async function persistFrozenExperiment(options?: {
  readonly datasetDir: string;
  readonly outputDir: string;
}): Promise<{
  readonly calibration: ExperimentRun;
  readonly validation1: ExperimentRun;
  readonly validation2: ExperimentRun;
  readonly reportPath: string;
}> {
  const datasetDir = options?.datasetDir ?? FIXTURE_ROOT;
  const outputDir = options?.outputDir ?? OUTPUT_ROOT;
  const calibration = await runEvaluation({ datasetDir, split: 'calibration' });
  const validation1 = await runEvaluation({ datasetDir, split: 'validation' });
  const validation2 = await runEvaluation({ datasetDir, split: 'validation' });
  await fs.mkdir(outputDir, { recursive: true });
  await persistRun(outputDir, 'calibration', calibration);
  await persistRun(outputDir, 'validation-run-1', validation1);
  await persistRun(outputDir, 'validation-run-2', validation2);
  const report = renderReportMarkdown({ calibration, validation1, validation2 });
  const reportPath = path.join(outputDir, 'report.md');
  await fs.writeFile(reportPath, report);
  await fs.writeFile(
    path.join(outputDir, 'comparison.json'),
    `${JSON.stringify(
      {
        decisionsEqual: JSON.stringify(stripTiming(validation1.samples)) === JSON.stringify(stripTiming(validation2.samples)),
        countsEqual:
          validation1.summary.overall.supported === validation2.summary.overall.supported &&
          validation1.summary.overall.contradicted === validation2.summary.overall.contradicted &&
          validation1.summary.overall.unknown === validation2.summary.overall.unknown,
        verdict: validation1.summary.verdict,
      },
      null,
      2,
    )}\n`,
  );
  return { calibration, validation1, validation2, reportPath };
}
