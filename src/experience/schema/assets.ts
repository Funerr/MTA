import { z } from 'zod/v4';
import { SHA256_HEX_PATTERN } from './patterns';
import { sha256Hex } from './json';

/**
 * v1 支持的图片 MIME 类型。取证截图统一为 PNG；
 * 后续扩展（如 WebP）属于协议变更，须更新规格而不是静默放行。
 */
export const SUPPORTED_IMAGE_MIME_TYPES = ['image/png'] as const;

/** 签名参数只允许纯 JSON 标量，保证可规范化序列化与跨实现一致。 */
const signatureParamValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

/**
 * 内容寻址资产引用。文件路径由摘要推导（`assets/<digest>.png`），
 * 引用本身不携带路径，杜绝父目录跳转或绝对路径进入资产表。
 */
export const assetRefSchema = z.strictObject({
  digest: z
    .string()
    .regex(SHA256_HEX_PATTERN, '资产摘要必须是 64 位小写十六进制 sha256'),
  byteSize: z.number().int().positive('资产字节大小必须是正整数'),
  mimeType: z.enum(SUPPORTED_IMAGE_MIME_TYPES),
});
export type AssetRef = z.infer<typeof assetRefSchema>;

/** 带原始尺寸的图片证据；坐标与 bbox 均绑定该像素空间。 */
export const imageEvidenceSchema = z.strictObject({
  asset: assetRefSchema,
  width: z.number().int().positive('图片宽度必须是正整数'),
  height: z.number().int().positive('图片高度必须是正整数'),
});
export type ImageEvidence = z.infer<typeof imageEvidenceSchema>;

/**
 * 视觉内容签名（供 matcher 相似性使用），与完整性摘要（sha256）职责不同，
 * 不得混淆：signature 表达“内容像什么”，digest 证明“字节没变”。
 */
export const imageSignatureSchema = z.strictObject({
  algorithm: z.string().min(1, '签名算法不能为空'),
  version: z.string().min(1, '签名版本不能为空'),
  params: z.record(z.string(), signatureParamValueSchema),
  value: z.string().min(1, '签名值不能为空'),
});
export type ImageSignature = z.infer<typeof imageSignatureSchema>;

/** 屏幕级视觉证据：截图引用 + 内容签名。动作前后、入口与终态共用该结构。 */
export const screenEvidenceSchema = z.strictObject({
  screenshot: imageEvidenceSchema,
  signature: imageSignatureSchema,
});
export type ScreenEvidence = z.infer<typeof screenEvidenceSchema>;

/** 由字节内容计算资产摘要（内容寻址写入与读取校验共用）。 */
export function computeAssetDigest(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}
