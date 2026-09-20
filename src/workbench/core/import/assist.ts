import { z } from 'zod/v4';
import type { AuthoringModelConfig } from '../../server/model-config';
import { chatJson, ModelCallError, type ChatMessage } from '../model/client';
import type { ImportKind, ImportParseResult } from './types';
import type { CaseLevel } from '../document';

/**
 * 模型识别兜底：规则解析未识别出用例结构（或识别结果没有任何步骤）时，
 * 把原文交给编写模型整理为结构化用例草稿。识别结果必须整体标注
 * viaModel 并写入"人工核对"问题，导入后走与手写用例相同的确认流程；
 * 模型失败不阻塞导入，回退保留规则解析结果。
 */

const MODEL_INPUT_MAX_CHARS = 20_000;

const ModelExpectationSchema = z.union([
  z.string(),
  z.object({
    text: z.string(),
    actionIndex: z.number().int().nonnegative().optional(),
  }),
]);

const ModelDraftSchema = z.object({
  sourceId: z.string().catch(''),
  name: z.string().catch(''),
  goal: z.string().catch(''),
  preconditions: z.array(z.string()).catch([]),
  actions: z.array(z.string()).catch([]),
  expectations: z.array(ModelExpectationSchema).catch([]),
  level: z.enum(['level1', 'level2', 'level3']).catch('level2'),
  data: z.string().optional(),
});

const ModelExtractionSchema = z.object({
  // 顶层形状严格：整体输出跑偏时报结构契约错误，而不是静默当成 0 条。
  cases: z.array(ModelDraftSchema),
  notes: z.array(z.string()).catch([]),
});

const SYSTEM_PROMPT = [
  '你是 MTA 用例工作台的用例结构识别引擎：把用户粘贴的任意格式测试用例文本整理为结构化用例草稿。',
  '输入可能是"编号：/名称："标签段落、编号步骤列表、表格、自然语言段落或它们的混合；不要因格式不同而拒绝。',
  '',
  '## 输出契约',
  '只输出一个 JSON 对象：',
  '{"cases":[{"sourceId":"原文用例编号，缺失则为空字符串","name":"用例名称（缺失时从内容提炼短语）","goal":"测试目的，缺失留空","preconditions":["前置条件，缺失为空数组"],"actions":["操作步骤，保持原文措辞与顺序"],"expectations":[{"text":"预期结果原文","actionIndex":0}],"level":"level1|level2|level3","data":"测试数据，缺失留空"}],"notes":["识别说明（可选）"]}',
  '',
  '## 硬性要求',
  '- 忠实原文：步骤与预期保持用户原文措辞与粒度，不合并、不拆分、不改写、不补充。',
  '- 不虚构：文本中没有的信息留空；无法判断是否属于用例的内容不要生造结构。',
  '- 预期关联：能判断对应步骤时填 actionIndex（零基）；属于整条用例的预期省略 actionIndex。字符串形式的预期视为整条用例级。',
  '- level 缺省 level2；只有原文明确给出优先级时才映射 level1/level3。',
  '- 用例边界：一段内容描述多个独立场景时按语义拆为多条；同一条用例内的编号步骤保持为 actions。',
  '- 文本完全不是测试用例时返回 {"cases":[],"notes":["原因"]}，不要强行拆分。',
].join('\n');

/**
 * 识别兜底判定与执行：结构缺失时调用模型；端点未配置或调用失败时
 * 原样返回规则结果并追加可操作的问题说明。
 */
export async function assistImportResult(
  kind: ImportKind,
  content: string,
  deterministic: ImportParseResult,
  endpoint: AuthoringModelConfig | null,
): Promise<ImportParseResult> {
  // Excel 内容是二进制工作簿，不走文本识别。
  if (kind === 'excel') return deterministic;
  if (!needsModelAssist(deterministic)) return deterministic;

  if (!endpoint) {
    deterministic.issues.push({
      message:
        '未识别出用例结构；在“模型配置”中设置编写模型（或 MIDSCENE_MODEL_* 环境变量）后，可自动用模型识别粘贴内容',
    });
    return deterministic;
  }

  try {
    return await extractCasesWithModel(endpoint, content, kind);
  } catch (error) {
    const message =
      error instanceof ModelCallError ? error.message : String(error);
    deterministic.issues.push({
      message: `模型识别失败：${message}；已保留规则解析结果`,
    });
    return deterministic;
  }
}

/**
 * 结构缺失判定：没有任何用例，或所有用例都没有步骤（规则解析把
 * 步骤行错切进名称/未转换清单时，识别结果同样不可用）。
 */
export function needsModelAssist(result: ImportParseResult): boolean {
  return (
    result.cases.length === 0 ||
    result.cases.every((draft) => draft.actions.length === 0)
  );
}

export async function extractCasesWithModel(
  endpoint: AuthoringModelConfig,
  content: string,
  kind: ImportKind,
  options?: { signal?: AbortSignal },
): Promise<ImportParseResult> {
  const truncated = content.length > MODEL_INPUT_MAX_CHARS;
  const user = [
    `导入类型：${kind}`,
    truncated ? '（内容过长，已截断；截断之后的内容未参与识别）' : '',
    '',
    '原始内容：',
    content.slice(0, MODEL_INPUT_MAX_CHARS),
  ]
    .filter(Boolean)
    .join('\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];

  const raw = await chatJson<unknown>(endpoint, { messages, signal: options?.signal });
  const parsed = ModelExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ModelCallError(
      'invalid-response',
      `模型识别输出不符合结构契约：${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
        .slice(0, 5)
        .join('；')}`,
    );
  }

  const excerpt = content.slice(0, 4000);
  const cases = parsed.data.cases
    .map((draft, index) => normalizeDraft(draft, index, excerpt))
    .filter((draft) => draft !== null);

  return {
    kind,
    cases,
    issues: [
      {
        message: '导入内容由编写模型识别生成；请逐条人工核对步骤与预期后再进入生成',
      },
    ],
    unconverted: [],
    viaModel: true,
    modelNotes: parsed.data.notes,
  };
}

function normalizeDraft(
  draft: z.infer<typeof ModelDraftSchema>,
  index: number,
  excerpt: string,
): ImportParseResult['cases'][number] | null {
  const actions = draft.actions.map((text) => text.trim()).filter(Boolean);
  const name = draft.name.trim();
  const goal = draft.goal.trim();
  // 名称、目的、步骤全空的条目是模型噪声，直接丢弃。
  if (!name && !goal && actions.length === 0) return null;

  const expectations = draft.expectations
    .map((item) => {
      const text = (typeof item === 'string' ? item : item.text).trim();
      if (!text) return null;
      const actionIndex =
        typeof item === 'object' &&
        item.actionIndex !== undefined &&
        item.actionIndex < actions.length
          ? item.actionIndex
          : undefined;
      return { text, actionIndex };
    })
    .filter((item) => item !== null);

  return {
    sourceId: draft.sourceId.trim() || `AI-${String(index + 1).padStart(2, '0')}`,
    name,
    goal,
    preconditions: draft.preconditions.map((text) => text.trim()).filter(Boolean),
    actions,
    expectations,
    level: draft.level as CaseLevel,
    sourceRange: '模型识别',
    excerpt,
    data: draft.data?.trim() || undefined,
  };
}
