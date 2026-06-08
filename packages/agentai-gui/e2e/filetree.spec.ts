/**
 * FileTree E2E - Trae 风格文件树
 * 流程: 打开页面 → 关 Onboarding → 选代码编辑器 → 点「打开文件夹」→ 输入路径 → 看到树 → 点文件 → 右侧打开
 */
import { test, expect } from '@playwright/test';

test.describe('FileTree (Trae 风格)', () => {
  const skipOnboarding = async (page: any) => {
    // 第一次访问清干净
    await page.goto('about:blank');
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    for (let i = 0; i < 8; i++) {
      const modal = page.locator('.ant-modal-body').first();
      if (!(await modal.isVisible({ timeout: 400 }).catch(() => false))) break;

      // Step 1: welcome 「开始 (10 秒)」
      const start = page.locator('button:has-text("开始 (10 秒)")');
      if (await start.isVisible({ timeout: 300 }).catch(() => false)) { await start.click(); await page.waitForTimeout(500); continue; }
      // Step 2: name 填名字
      const nameInput = page.locator('input[placeholder*="小明"]');
      if (await nameInput.isVisible({ timeout: 300 }).catch(() => false)) {
        await nameInput.fill('Tester');
        await page.waitForTimeout(200);
        await page.locator('button:has-text("下一步")').last().click();
        await page.waitForTimeout(500);
        continue;
      }
      // Step 3: useCase
      const useCaseNext = page.locator('button:has-text("下一步")').last();
      if (await useCaseNext.isVisible({ timeout: 300 }).catch(() => false)) { await useCaseNext.click(); await page.waitForTimeout(500); continue; }
      // Step 4: key 「跳过并完成」 (会触发 reload)
      const skipComplete = page.locator('button:has-text("跳过并完成")');
      if (await skipComplete.isVisible({ timeout: 300 }).catch(() => false)) {
        await skipComplete.click();
        await page.waitForTimeout(2500);
        continue;
      }
      break;
    }
    await page.waitForTimeout(1000);
  };

  const goToEditor = async (page: any) => {
    await page.locator('button[title="代码编辑器"]').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
  };

  test('1. 首页能进 Editor 页', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await skipOnboarding(page);
    await goToEditor(page);
    // Editor 区域应显示
    await expect(page.locator('text=打开文件夹').first()).toBeVisible({ timeout: 5000 });
  });

  test('2. 看到「打开文件夹」按钮', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await skipOnboarding(page);
    await goToEditor(page);
    await expect(page.locator('button:has-text("打开文件夹")').first()).toBeVisible({ timeout: 5000 });
  });

  test('3. Open Folder 弹窗列盘符', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await skipOnboarding(page);
    await goToEditor(page);
    await page.locator('button:has-text("打开文件夹")').first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('.ant-modal-title:has-text("打开文件夹")').first()).toBeVisible();
    await expect(page.locator('.ant-modal button:has-text("F:")').first()).toBeVisible({ timeout: 3000 });
  });

  test('4. 输入路径 → 打开 → 看到树', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await skipOnboarding(page);
    await goToEditor(page);
    await page.locator('button:has-text("打开文件夹")').first().click();
    await page.waitForTimeout(400);
    const pathInput = page.locator('input[placeholder*="agentai"]').first();
    await pathInput.fill('F:\\agentai-platform\\packages\\agentai-gui\\src\\components');
    await page.locator('.ant-modal button:has-text("打开")').click();
    await page.waitForTimeout(1500);
    await expect(page.locator('.ant-tree-node-content-wrapper:has-text("Editor.tsx")').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ant-tree-node-content-wrapper:has-text("Chat.tsx")').first()).toBeVisible({ timeout: 3000 });
  });

  test('5. 点文件 → 右侧打开 → 看到内容', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await skipOnboarding(page);
    await goToEditor(page);
    await page.locator('button:has-text("打开文件夹")').first().click();
    await page.waitForTimeout(400);
    const pathInput = page.locator('input[placeholder*="agentai"]').first();
    await pathInput.fill('F:\\agentai-platform\\packages\\agentai-gui\\src\\components');
    await page.locator('.ant-modal button:has-text("打开")').click();
    await page.waitForTimeout(1500);
    await page.locator('.ant-tree-node-content-wrapper:has-text("Editor.tsx")').first().click();
    await page.waitForTimeout(1500);
    await expect(page.locator('.ant-tabs-tab:has-text("Editor.tsx")').first()).toBeVisible({ timeout: 5000 });
    const textarea = page.locator('textarea').first();
    const value = await textarea.inputValue();
    expect(value.length).toBeGreaterThan(1000);
  });

  test('6. API 新建文件 → 出现在树上', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await skipOnboarding(page);
    await goToEditor(page);
    await page.locator('button:has-text("打开文件夹")').first().click();
    await page.waitForTimeout(400);
    const pathInput = page.locator('input[placeholder*="agentai"]').first();
    await pathInput.fill('F:\\agentai-platform\\packages\\agentai-gui\\src\\components');
    await page.locator('.ant-modal button:has-text("打开")').click();
    await page.waitForTimeout(1500);

    // 调 API 新建
    const resp = await page.evaluate(async () => {
      const r = await fetch('http://127.0.0.1:18789/v1/files/touch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'F:\\agentai-platform\\packages\\agentai-gui\\src\\components\\_E2E_TEST_DELETE_ME.ts', content: '// e2e' }),
      });
      return await r.json();
    });
    expect(resp.ok).toBe(true);

    // 刷新
    await page.locator('button[title*="刷新"]').first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await expect(page.locator('text=_E2E_TEST_DELETE_ME.ts').first()).toBeVisible({ timeout: 5000 });
  });
});
