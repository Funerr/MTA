# experiences/

经验资产的运行时存放目录（由 `src/experience/` 的文件 Store 管理）。

## 布局

```
experiences/
  index.json        # 索引快照：Experience/Variant/修订/状态/统计与事件账本
  assets/
    <sha256>.png    # 内容寻址图片（截图、目标与上下文裁剪），不可变
```

- 空目录代表空 Store；运行期由 Store 原子发布（先写资产，再替换索引）。
- 首期单进程单写者；不做跨进程锁或掉电持久性承诺。
- 本目录下的运行动态数据不入版本管理（见根 `.gitignore`）；受控示例资产位于 `tests/fixtures/experience-example/`。
- `midscene_run/` 下的原生运行报告不是经验资产，两者严格分离。

字段契约与读取说明见 [docs/experience-assets.md](../docs/experience-assets.md)。
