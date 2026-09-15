## 1. 工程与依赖

- [x] 1.1 核对官方 Android 模板、Midscene 包导出和资源接口，锁定兼容版本；以版本记录、官方来源及类型一致为完成依据。
- [x] 1.2 整合框架必要工程文件并保留 openspec/，配置安装、框架测试、类型检查、Node 参考和官方 CLI 接入脚本；验证 pnpm install 与类型检查通过。
- [x] 1.3 建立 setup/nodes、Experience 占位和使用方 cases/ 目录，隔离 tests/fixtures/；检查文件清单无业务 YAML 交付且测试夹具不进入默认业务发现范围。
- [x] 1.4 提供 .env.example 与忽略规则；验证配置加载和 Node 参考生成不需要设备或真实密钥，不产生外部调用。

## 2. Android 与 Node 接入

- [x] 2.1 实现设备选择和执行期环境检查；用设备枚举边界替身验证指定目标、唯一设备、多设备、离线/未授权及 ADB 失败行为。
- [x] 2.2 实现原生设备/Agent 初始化、context 和 teardown；验证正常清理、部分初始化失败、异常保留和不双重释放。
- [x] 2.3 注册原生 Nodes 并配置单设备串行项目；加载实际 Midscene 定义验证 aiAct/aiAssert 参数契约及参考生成。
- [x] 2.4 实现 device.prepare 与 device.recover 的严格输入和原生 Home 调用；验证合法输入、非法字段、调用次数及失败传播，不加入业务状态处理。

## 3. 框架验收与说明

- [x] 3.1 用实际锁定 Midscene 包及受控边界替身验证 Node 注册、生命周期、取消/失败传播和原生报告关联；交付测试结果并明确替身覆盖范围。
- [x] 3.2 在无设备/密钥条件下运行 pnpm install --frozen-lockfile、pnpm run typecheck、pnpm run nodes 和框架测试；记录结果，检查没有业务用例执行前提。
- [x] 3.3 审查代码仅接入原生 Agent/Runner/Planner/动作/报告且无 Experience 实现；以导入与注册检查为完成依据。
- [x] 3.4 完成框架接入文档及验收记录，说明使用方负责用例与业务判断；可选设备连接/截图检查单列记录，不以未完成业务流程阻塞本 Change。
