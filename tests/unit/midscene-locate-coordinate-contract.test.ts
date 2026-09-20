import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 锁定依赖契约测试（openspec: fix-midscene-pixel-coordinate-overflow）。
// createLocateResultCodec 未从 @midscene/core 公开入口导出且 exports 禁止深路径
// specifier，这里以文件路径直接加载补丁后的 dist/lib（CJS）与 dist/es（ESM）
// 双副本并对行为做同构断言；依赖升级导致补丁失效时本文件必须失败。
// 深路径文件加载仅允许出现在本契约测试中，不作为业务代码访问先例。

type PreparedSize = { width: number; height: number };
type LocatePixelResult = {
  center: [number, number];
  rect?: { left: number; top: number; width: number; height: number };
};
type LocateCoordinatesConfig = {
  shape: 'point' | 'bbox';
  order?: 'xy' | 'yx';
  normalizedBy?: number;
};
type FactoryModule = {
  createLocateResultCodec: (config: {
    coordinates: LocateCoordinatesConfig;
  }) => {
    toPixelResult: (raw: unknown, ctx: { preparedSize: PreparedSize }) => LocatePixelResult;
  };
};

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const CJS_FACTORY_PATH = `${projectRoot}node_modules/@midscene/core/dist/lib/ai-model/shared/model-locate-result/factory.js`;
const ESM_FACTORY_PATH = `${projectRoot}node_modules/@midscene/core/dist/es/ai-model/shared/model-locate-result/factory.mjs`;

const require_ = createRequire(import.meta.url);
const loadCopies = async (): Promise<Array<[string, FactoryModule]>> => {
  const cjs = require_(CJS_FACTORY_PATH) as FactoryModule;
  const esm = (await import(pathToFileURL(ESM_FACTORY_PATH).href)) as FactoryModule;
  return [
    ['dist/lib (CJS)', cjs],
    ['dist/es (ESM)', esm],
  ];
};

const createDefaultCodec = (factory: FactoryModule) =>
  factory.createLocateResultCodec({
    coordinates: { shape: 'bbox', order: 'xy', normalizedBy: 1000 },
  });

const LANDSCAPE: PreparedSize = { width: 2160, height: 1080 };

describe('midscene locate 坐标契约：像素越界归一化兼容（@midscene/core 补丁）', () => {
  it('双副本均可加载且补丁同步', async () => {
    const copies = await loadCopies();
    expect(copies).toHaveLength(2);
    for (const [, factory] of copies) {
      expect(typeof factory.createLocateResultCodec).toBe('function');
    }
  });

  it('横屏越界像素 bbox 按轴归一化，几何含义保持', async () => {
    for (const [name, factory] of await loadCopies()) {
      const result = createDefaultCodec(factory).toPixelResult([0, 170, 2170, 1080], {
        preparedSize: LANDSCAPE,
      });
      // y 保持原始像素 170（比例 170/1080），右/下边缘 clamp 贴合图像边界。
      expect(result.center).toEqual([1080, 625]);
      expect(result.rect).toEqual({ left: 0, top: 170, width: 2160, height: 910 });
      void name;
    }
  });

  it('歧义带内轻微越界不重写，保持校验失败与重试路径', async () => {
    for (const [, factory] of await loadCopies()) {
      const codec = createDefaultCodec(factory);
      expect(() =>
        codec.toPixelResult([0, 500, 800, 1005], { preparedSize: LANDSCAPE }),
      ).toThrow(/exceed/);
    }
  });

  it('合法归一化 bbox 零影响（回归保护）', async () => {
    for (const [, factory] of await loadCopies()) {
      const result = createDefaultCodec(factory).toPixelResult([100, 200, 300, 400], {
        preparedSize: LANDSCAPE,
      });
      expect(result.center).toEqual([432, 324]);
      // 锁定依赖 rect 语义：right/bottom 为闭区间像素（width = right-left+1）。
      expect(result.rect).toEqual({ left: 216, top: 216, width: 433, height: 217 });
    }
  });

  it('像素协议（未声明 normalizedBy）原样放行，越界仍由校验拒绝', async () => {
    for (const [, factory] of await loadCopies()) {
      const codec = factory.createLocateResultCodec({
        coordinates: { shape: 'bbox', order: 'xy' },
      });
      const result = codec.toPixelResult([0, 170, 2000, 1000], { preparedSize: LANDSCAPE });
      expect(result.center).toEqual([1000, 585]);
      expect(result.rect).toEqual({ left: 0, top: 170, width: 2001, height: 831 });
      expect(() => codec.toPixelResult([0, 170, 2170, 1000], { preparedSize: LANDSCAPE })).toThrow(
        /exceed/,
      );
    }
  });

  it('point 形状与 yx 轴序按各自像素上限逐轴处理', async () => {
    for (const [, factory] of await loadCopies()) {
      const pointCodec = factory.createLocateResultCodec({
        coordinates: { shape: 'point', order: 'yx', normalizedBy: 1000 },
      });
      const point = pointCodec.toPixelResult([900, 1500], { preparedSize: LANDSCAPE });
      expect(point.center).toEqual([1500, 900]);
      expect(point.rect).toBeUndefined();

      const bboxCodec = factory.createLocateResultCodec({
        coordinates: { shape: 'bbox', order: 'yx', normalizedBy: 1000 },
      });
      const bbox = bboxCodec.toPixelResult([100, 900, 700, 1500], { preparedSize: LANDSCAPE });
      expect(bbox.center).toEqual([1200, 400]);
      expect(bbox.rect).toEqual({ left: 900, top: 100, width: 601, height: 601 });
    }
  });

  it('normalizedBy=1 协议下的合法小数坐标不受影响', async () => {
    for (const [, factory] of await loadCopies()) {
      const codec = factory.createLocateResultCodec({
        coordinates: { shape: 'bbox', order: 'xy', normalizedBy: 1 },
      });
      const result = codec.toPixelResult([0.5, 0.4, 0.9, 0.8], { preparedSize: LANDSCAPE });
      expect(result.center).toEqual([1512, 648]);
      expect(result.rect).toEqual({ left: 1080, top: 432, width: 865, height: 433 });
    }
  });
});
