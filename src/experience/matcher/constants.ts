/** 匹配器配置与算法版本；变更须重新校准并验收，不得对验证集逐例特调。 */
export const MATCHER_CONFIG_VERSION = 'visual-matcher@1';

/** 夹具数据版本，与 tests/fixtures/visual-matcher 清单一致。 */
export const MATCHER_DATA_VERSION = 'visual-matcher-fixtures@1';

/** 复用 Promotion 锁定的本地解码管线，不新增图像原生依赖。 */
export const MATCHER_IMAGE_PIPELINE_VERSION = 'png-sharp@1';

export const PHASH_ALGORITHM = 'dct-32-8';
export const PHASH_VERSION = '1';
export const PHASH_SIZE = 32;
export const PHASH_HASH_SIZE = 8;

export const NCC_ALGORITHM = 'zncc-gray';
export const NCC_VERSION = '1';

export const SSIM_ALGORITHM = 'ssim-global-gray';
export const SSIM_VERSION = '1';

/** 相邻像素峰合并半径：同一目标的 ±1px 旁瓣，不合并 10px 级重复目标。 */
export const NMS_RADIUS_PX = 2;

/** 首期声明：目标水平/垂直位移不超过截图对应边长的 3%。 */
export const SEARCH_RADIUS_RATIO = 0.03;

export const DEFAULT_CONTEXT_PAD_RATIO = 0.25;

export const MAX_IMAGE_PIXELS = 8_294_400;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_SEARCH_POSITIONS = 250_000;
export const MAX_CANDIDATES = 8;
export const MAX_TEMPLATE_PIXELS = 512 * 512;

/** PNG 魔数。非 PNG 一律按坏图拒绝。 */
export const PNG_MAGIC = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
