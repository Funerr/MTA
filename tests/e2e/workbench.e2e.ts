import { test, expect, type Page } from '@playwright/test';

const baseURL = process.env.MTA_E2E_BASE_URL!;

async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForSelector('.topbar .brand');
}

test.describe.serial('MTA 工作台 E2E', () => {
  let docId: string;

  // ─── 场景 A：首页与导航 ────────────────────────────────────────

  test('首页加载：hero 区域、品牌与模型 badge 可见', async ({ page }) => {
    await page.goto(baseURL);
    await waitForAppReady(page);

    await expect(page.locator('.brand')).toHaveText('MTA 用例工作台');
    await expect(page.locator('.hero h2')).toContainText('从业务用例到可执行工作流');
    await expect(page.locator('.hero-step')).toHaveCount(5);
    // global-setup 预设了 mock 模型，badge 应显示模型名
    await expect(page.locator('.topbar .badge')).toHaveText('生成模型 mock-glm-4');
  });

  // ─── 场景 B：文档 CRUD ────────────────────────────────────────

  test('新建文档并跳转到编辑器', async ({ page }) => {
    await page.goto(baseURL);
    await waitForAppReady(page);

    await page.click('button:has-text("＋ 新建")');
    await page.waitForURL(/#\/doc\//);
    const hash = new URL(page.url()).hash;
    docId = hash.replace('#/doc/', '');
    expect(docId).toBeTruthy();

    await expect(page.locator('.editor-workspace')).toBeVisible();
    await expect(page.locator('input.title')).toBeVisible();
  });

  test('编辑文档名称并保存', async ({ page }) => {
    await page.goto(`${baseURL}#/doc/${docId}`);
    await page.waitForSelector('.editor-workspace');

    const nameInput = page.locator('input.title');
    await nameInput.clear();
    await nameInput.fill('蓝牙与 Wi-Fi 功能验证');

    await page.click('button:has-text("保存")');
    await expect(page.locator('.badge-ok')).toHaveText('已保存');

    await page.reload();
    await page.waitForSelector('.editor-workspace');
    await expect(page.locator('input.title')).toHaveValue('蓝牙与 Wi-Fi 功能验证');
  });

  test('回到首页后文档出现在下拉列表中', async ({ page }) => {
    await page.goto(baseURL);
    await waitForAppReady(page);

    await expect(
      page.locator('select.doc-select option', { hasText: '蓝牙与 Wi-Fi 功能验证' }),
    ).toHaveCount(1);
  });

  // ─── 场景 C：模型配置（已有预设，验证 badge） ─────────────────

  test('模型配置已预设并显示在顶部栏', async ({ page }) => {
    await page.goto(`${baseURL}#/doc/${docId}`);
    await page.waitForSelector('.editor-workspace');
    await expect(page.locator('.topbar .badge')).toHaveText('生成模型 mock-glm-4');
  });

  // ─── 场景 D：自然语言导入用例（AI 识别） ──────────────────────

  test('粘贴自然语言文本，AI 识别并导入用例', async ({ page }) => {
    await page.goto(`${baseURL}#/doc/${docId}`);
    await page.waitForSelector('.editor-workspace');
    await page.click('.step-pill:has-text("用例与导入")');

    await page.locator('.import-card select').selectOption('paste');

    // 自然语言测试用例——不使用标签格式，靠 AI 能力识别结构
    const naturalCases = [
      '在手机上打开系统设置，找到蓝牙选项，点击进入蓝牙页面，打开蓝牙开关。检查蓝牙开关是否正常变为开启状态。',
      '',
      '打开系统设置里的 Wi-Fi 页面，选择一个可用的无线网络进行连接，等待连接成功后确认状态栏显示已连接。',
    ].join('\n');
    await page.locator('.import-textarea').fill(naturalCases);

    // 预览解析——确定性解析无法识别，触发 AI 模型兜底
    await page.locator('.import-card button:has-text("预览解析")').click();
    await page.waitForSelector('.import-preview');

    // AI 识别结果应显示 viaModel 标记
    await expect(page.locator('.import-preview')).toContainText('模型识别');

    // 导入用例
    await page.locator('.import-card button:has-text("导入用例")').click();
    await page.waitForSelector('.case-library');

    // mock 模型返回蓝牙相关用例
    await expect(page.locator('.case-library .case-list-item')).toHaveCount(1);
    await expect(page.locator('.case-library')).toContainText('验证蓝牙开关功能');
  });

  // ─── 场景 E：启用变体 ─────────────────────────────────────────

  test('启用 Android 变体并保存', async ({ page }) => {
    await page.goto(`${baseURL}#/doc/${docId}`);
    await page.waitForSelector('.editor-workspace');
    await page.click('.step-pill:has-text("生成与检查")');

    const androidSection = page.locator('fieldset:has(legend:has-text("Android"))');

    const enableBtn = androidSection.locator('button:has-text("启用")');
    if (await enableBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await enableBtn.click();
    }

    await expect(androidSection.locator('input[placeholder]').first()).toBeVisible();

    await page.click('button:has-text("保存")');
    await expect(page.locator('.badge-ok')).toHaveText('已保存');
  });

  // ─── 场景 F：工作流编辑 ───────────────────────────────────────

  test('YAML 模式：输入合法 YAML 并保存', async ({ page }) => {
    await page.goto(`${baseURL}#/doc/${docId}`);
    await page.waitForSelector('.editor-workspace');
    await page.click('.step-pill:has-text("工作流编辑")');

    await page.waitForSelector('.tab:has-text("YAML")', { timeout: 5_000 });
    await page.click('.tab:has-text("YAML")');

    const validYaml = [
      'cases:',
      '  - name: 验证蓝牙开关功能',
      '    steps:',
      '      - device.prepare:',
      '          target: home',
      '      - aiAct: 打开系统设置',
      '      - aiAct: 进入蓝牙页面',
      '      - aiAct: 打开蓝牙开关',
      '      - aiAssert: 蓝牙状态变为已开启',
    ].join('\n');

    await page.locator('textarea.yaml-editor').fill(validYaml);
    await page.click('button:has-text("保存 YAML")');
    await expect(page.locator('p.err')).not.toBeVisible();
  });

  test('YAML 模式：输入非法 YAML 显示语法错误', async ({ page }) => {
    await page.goto(`${baseURL}#/doc/${docId}`);
    await page.waitForSelector('.editor-workspace');
    await page.click('.step-pill:has-text("工作流编辑")');
    await page.click('.tab:has-text("YAML")');

    await page.locator('textarea.yaml-editor').fill('cases: [ 非法 YAML');
    await page.click('button:has-text("保存 YAML")');
    await expect(page.locator('p.err').first()).toBeVisible();
  });

  test('卡片模式：切换到卡片视图', async ({ page }) => {
    await page.goto(`${baseURL}#/doc/${docId}`);
    await page.waitForSelector('.editor-workspace');
    await page.click('.step-pill:has-text("工作流编辑")');

    await page.click('.tab:has-text("YAML")');
    await page.locator('textarea.yaml-editor').fill([
      'cases:',
      '  - name: 验证蓝牙开关功能',
      '    steps:',
      '      - aiAct: 打开系统设置',
      '      - aiAssert: 蓝牙开关可见',
    ].join('\n'));
    await page.click('button:has-text("保存 YAML")');

    await page.click('.tab:has-text("步骤卡片")');
    await expect(page.locator('.panel').first()).toBeVisible();
  });

  // ─── 场景 G：阶段导航 ─────────────────────────────────────────

  test('底部导航按钮可切换阶段', async ({ page }) => {
    await page.goto(`${baseURL}#/doc/${docId}`);
    await page.waitForSelector('.editor-workspace');

    const nextBtn = page.locator('button:has-text("下一步")');
    const prevBtn = page.locator('button:has-text("上一步")');

    await expect(nextBtn).toBeVisible();

    await nextBtn.click();
    await expect(page.locator('.step-pill.active')).toContainText('生成与检查');

    await prevBtn.click();
    await expect(page.locator('.step-pill.active')).toContainText('用例与导入');
  });

  // ─── 场景 H：确认与导出 ───────────────────────────────────────

  test('确认修订与导出按钮可见', async ({ page }) => {
    await page.goto(`${baseURL}#/doc/${docId}`);
    await page.waitForSelector('.editor-workspace');
    await page.click('.step-pill:has-text("确认导出")');

    await expect(page.locator('button:has-text("确认")').first()).toBeVisible();
    await expect(page.locator('button:has-text("导出")').first()).toBeVisible();
  });
});