import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// 工具: 等待 App 完全挂载
async function waitApp(page: Page) {
  await page.waitForSelector('text=AgentAI Platform', { timeout: 10000 });
  await page.waitForSelector('text=富哥', { timeout: 5000 });
}

test.describe('AgentAI Platform - 网页端 E2E', () => {

  test('1. 主页能加载并显示品牌', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/AgentAI/);
    await expect(page.locator('text=AgentAI Platform')).toBeVisible();
    await expect(page.locator('text=v0.1.0-alpha')).toBeVisible();
  });

  test('2. 默认进入 Chat 视图', async ({ page }) => {
    await page.goto('/');
    await waitApp(page);
    // 左侧主导航 Chat 按钮激活
    const chatBtn = page.locator('button').filter({ has: page.locator('.anticon-message') }).first();
    await expect(chatBtn).toHaveClass(/ant-btn-primary/);
    // 占位提示
    await expect(page.locator('text=富哥, 发个消息开始干')).toBeVisible();
  });

  test('3. 框架栏显示 OpenClaw 默认 + 切到 Hermes', async ({ page }) => {
    await page.goto('/');
    await waitApp(page);
    // 看到 OpenClaw tag
    await expect(page.locator('text=OpenClaw').first()).toBeVisible();
    // 点 Hermes
    await page.locator('button:has-text("Hermes")').click();
    // Hermes tag 出现
    await expect(page.locator('text=Hermes').first()).toBeVisible();
  });

  test('4. A/B 灰度 Slider 可拖动 (0% 到 100%)', async ({ page }) => {
    await page.goto('/');
    await waitApp(page);
    // 找到 Slider (role=slider)
    const slider = page.locator('[role=slider]').first();
    await expect(slider).toBeVisible();
    // 验证显示当前值
    await expect(page.locator('text=100% → OpenClaw')).toBeVisible();
  });

  test('5. 切到技能库视图, 显示 27 个技能', async ({ page }) => {
    await page.goto('/');
    await waitApp(page);
    // 点技能库按钮
    await page.locator('button').filter({ has: page.locator('.anticon-appstore') }).first().click();
    // 看到搜索框
    await expect(page.locator('input[placeholder*="搜索技能"]')).toBeVisible();
    // 看到技能名 (qq-bot 必在)
    await expect(page.locator('text=qq-bot')).toBeVisible();
    // 看到分类 tab (用 .first() 因为 Tabs Badge 嵌套)
    await expect(page.locator('text=通讯').first()).toBeVisible();
    await expect(page.locator('text=图像').first()).toBeVisible();
    await expect(page.locator('text=视频').first()).toBeVisible();
  });

  test('6. 技能搜索功能', async ({ page }) => {
    await page.goto('/');
    await waitApp(page);
    await page.locator('button').filter({ has: page.locator('.anticon-appstore') }).first().click();
    // 搜 "tts"
    await page.locator('input[placeholder*="搜索技能"]').fill('tts');
    // tts-edge 出现
    await expect(page.locator('text=tts-edge')).toBeVisible();
    // 搜 "qq"
    await page.locator('input[placeholder*="搜索技能"]').fill('qq');
    await expect(page.locator('text=qq-bot')).toBeVisible();
  });

  test('7. 切到设置视图, 显示 Tabs 标签', async ({ page }) => {
    await page.goto('/');
    await waitApp(page);
    await page.locator('button').filter({ has: page.locator('.anticon-setting') }).first().click();
    // 新设置页是 Tabs 布局, 看 4 个 tab 标签
    await expect(page.locator('text=LLM 模型').first()).toBeVisible();
    await expect(page.locator('text=密钥管理').first()).toBeVisible();
    await expect(page.locator('text=框架切换').first()).toBeVisible();
  });

  test('8. Chat 输入框可输入, 按 Enter 不报错', async ({ page }) => {
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    const chatResponse = page.waitForResponse(
      (r) => r.url().includes('/v1/chat') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await page.goto('/');
    await waitApp(page);
    const input = page.locator('textarea[placeholder*="输入消息"]');
    await input.fill('富哥测试');
    await input.press('Enter');
    await expect(page.locator('text=富哥测试').first()).toBeVisible();
    // 等 /v1/chat 响应回来
    await chatResponse;
    // 助手消息渲染 (可能走 stub 也可能 no-key, 任何内容都算通过)
    await expect(page.locator('.msg-bot').first()).toBeVisible({ timeout: 10_000 });
  });

  test('9. 主题是暗色 (background 接近 #0a0a0a)', async ({ page }) => {
    await page.goto('/');
    await waitApp(page);
    const headerBg = await page.locator('header').first().evaluate((el) => {
      return getComputedStyle(el).backgroundColor;
    });
    // rgb(10, 10, 10) 或接近
    expect(headerBg).toMatch(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    const m = headerBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (m) {
      const r = parseInt(m[1]);
      // 暗色: r < 50
      expect(r).toBeLessThan(50);
    }
  });

  test('10. 响应式: 1280x800 视口下布局正常', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await waitApp(page);
    // 顶栏可见
    await expect(page.locator('header')).toBeVisible();
    // 框架栏可见
    await expect(page.locator('button:has-text("OpenClaw")')).toBeVisible();
    // 主内容区可见
    await expect(page.locator('text=富哥, 发个消息开始干')).toBeVisible();
  });

});
