import { z } from 'zod/v4';
import { imageEvidenceSchema, screenEvidenceSchema } from './assets';

/**
 * v1 动作类型只映射原生动作，不新增 VisualTap 等新类型；
 * 出现未支持类型时整链拒绝，禁止静默丢弃该动作后接受残余链。
 */
export const EXPERIENCE_ACTION_TYPES = [
  'Tap',
  'Input',
  'Scroll',
  'LongPress',
  'Back',
  'Home',
] as const;
export type ExperienceActionType = (typeof EXPERIENCE_ACTION_TYPES)[number];

const SCROLL_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
const INPUT_MODES = ['append', 'replace'] as const;

const positiveInt = (description: string) =>
  z.number().int().positive(description);
const nonNegativeInt = (description: string) =>
  z.number().int().min(0, description);

/** 原始目标框，坐标绑定操作前截图的像素空间。 */
export const boundingBoxSchema = z.strictObject({
  x: nonNegativeInt('bbox.x 必须是非负整数'),
  y: nonNegativeInt('bbox.y 必须是非负整数'),
  width: positiveInt('bbox.width 必须是正整数'),
  height: positiveInt('bbox.height 必须是正整数'),
});
export type BoundingBox = z.infer<typeof boundingBoxSchema>;

/**
 * 有目标动作的目标证据：目标图（与 bbox 尺寸一致的裁剪）、上下文图
 * （含扩边的裁剪，扩边比例由 Promotion 记录在资产元数据）、原始目标框、
 * 可选文本提示与局部操作前状态证据。不能仅保存坐标。
 */
export const targetEvidenceSchema = z.strictObject({
  image: imageEvidenceSchema,
  contextImage: imageEvidenceSchema,
  bbox: boundingBoxSchema,
  textHint: z.string().min(1, '目标文本提示不能为空').optional(),
  stateBefore: imageEvidenceSchema.optional(),
});
export type TargetEvidence = z.infer<typeof targetEvidenceSchema>;

/** 动作前后证据：动作派发前后各一次屏幕取证。 */
const beforeSchema = screenEvidenceSchema;
const afterSchema = screenEvidenceSchema;

export const tapActionSchema = z.strictObject({
  type: z.literal('Tap'),
  before: beforeSchema,
  after: afterSchema,
  target: targetEvidenceSchema,
});

/** Input 保存完整输入参数：文本与写入模式。 */
export const inputActionSchema = z.strictObject({
  type: z.literal('Input'),
  before: beforeSchema,
  after: afterSchema,
  target: targetEvidenceSchema,
  params: z.strictObject({
    text: z.string().min(1, '输入文本不能为空'),
    mode: z.enum(INPUT_MODES),
  }),
});

/** Scroll 保存方向、距离（截图像素空间）与投影锚点。 */
export const scrollActionSchema = z.strictObject({
  type: z.literal('Scroll'),
  before: beforeSchema,
  after: afterSchema,
  target: targetEvidenceSchema,
  params: z.strictObject({
    direction: z.enum(SCROLL_DIRECTIONS),
    distancePx: positiveInt('滚动距离必须是正整数像素'),
    anchor: z.strictObject({
      x: nonNegativeInt('锚点 x 必须是非负整数'),
      y: nonNegativeInt('锚点 y 必须是非负整数'),
    }),
  }),
});

/** LongPress 保存按压时长（毫秒）。 */
export const longPressActionSchema = z.strictObject({
  type: z.literal('LongPress'),
  before: beforeSchema,
  after: afterSchema,
  target: targetEvidenceSchema,
  params: z.strictObject({
    durationMs: positiveInt('按压时长必须是正整数毫秒'),
  }),
});

/** Back/Home 为无目标系统导航，不强造目标图，但仍须前后屏幕证据。 */
export const backActionSchema = z.strictObject({
  type: z.literal('Back'),
  before: beforeSchema,
  after: afterSchema,
});
export const homeActionSchema = z.strictObject({
  type: z.literal('Home'),
  before: beforeSchema,
  after: afterSchema,
});

export const experienceActionSchema = z.discriminatedUnion('type', [
  tapActionSchema,
  inputActionSchema,
  scrollActionSchema,
  longPressActionSchema,
  backActionSchema,
  homeActionSchema,
]);
export type ExperienceAction = z.infer<typeof experienceActionSchema>;

function describeAction(actions: readonly ExperienceAction[], index: number) {
  const action = actions[index];
  return `actions[${index}](${action?.type ?? 'unknown'})`;
}

function checkBoundedBox(
  reasons: string[],
  where: string,
  box: BoundingBox,
  width: number,
  height: number,
) {
  if (box.x + box.width > width || box.y + box.height > height) {
    reasons.push(
      `${where}: 目标 bbox (${box.x}, ${box.y}, ${box.width}x${box.height}) 越出操作前截图范围 (${width}x${height})；有向坐标必须能由当前定位重新投影`,
    );
  }
}

/**
 * 动作链语义校验：至少一个动作；每个有目标动作的 bbox、目标图尺寸与
 * 操作前截图空间一致，锚点在界内。返回具体原因列表（空数组表示通过）。
 */
export function validateActionChain(
  actions: readonly ExperienceAction[],
): string[] {
  const reasons: string[] = [];
  if (actions.length === 0) {
    reasons.push('actions: 动作链为空；经验必须至少包含一个动作');
    return reasons;
  }
  actions.forEach((action, index) => {
    const where = describeAction(actions, index);
    const { width, height } = action.before.screenshot;

    if ('target' in action && action.target) {
      checkBoundedBox(reasons, where, action.target.bbox, width, height);
      const { image, contextImage } = action.target;
      if (image.width !== action.target.bbox.width || image.height !== action.target.bbox.height) {
        reasons.push(
          `${where}: 目标图尺寸 (${image.width}x${image.height}) 与原始目标框 (${action.target.bbox.width}x${action.target.bbox.height}) 不一致；图像裁剪必须与 bbox 一致`,
        );
      }
      if (contextImage.width < action.target.bbox.width || contextImage.height < action.target.bbox.height) {
        reasons.push(
          `${where}: 上下文图尺寸 (${contextImage.width}x${contextImage.height}) 小于原始目标框 (${action.target.bbox.width}x${action.target.bbox.height})；上下文裁剪必须覆盖目标`,
        );
      }
    }

    if (action.type === 'Scroll') {
      const { anchor } = action.params;
      if (anchor.x >= width || anchor.y >= height) {
        reasons.push(
          `${where}: 滚动锚点 (${anchor.x}, ${anchor.y}) 越出操作前截图范围 (${width}x${height})`,
        );
      }
    }
  });
  return reasons;
}
