import { expect, test } from '../fixtures';
import type { Page } from '@playwright/test';

async function openRoute(page: Page, route: string) {
  await page.evaluate((nextRoute: string) => {
    window.location.hash = `#${nextRoute}`;
  }, route);
  await page.waitForURL((url) => url.hash.includes(route.split('?')[0]), { timeout: 15_000 });
}

test.describe('Decision release smoke', () => {
  test('standard home and meeting-room controls render', async ({ page }) => {
    await openRoute(page, '/guid');

    await expect(page.locator('textarea, [contenteditable="true"], [role="textbox"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="team-section-toggle"]')).toContainText(
      /Decision rooms|决策会议室|決策會議室/
    );
    await expect(page.locator('[data-testid="team-create-btn"]')).toBeVisible();
  });

  test('model settings load without a backend failure', async ({ page }) => {
    await openRoute(page, '/settings/model');

    await expect(
      page
        .locator('.text-20px')
        .filter({ hasText: /Model|模型/ })
        .first()
    ).toBeVisible();
    await expect(page.getByText(/backend startup failed|后端启动失败/i)).toHaveCount(0);
  });

  test('personal workspace views render', async ({ page }) => {
    await openRoute(page, '/files');

    await expect(page.getByText(/Personal Workspace|个人工作空间|個人工作空間/).first()).toBeVisible();
    await expect(page.getByText(/To Organize|待整理|待整理內容/).first()).toBeVisible();
    await expect(page.getByText(/My Assets|我的资产|我的資產/).first()).toBeVisible();
    await expect(page.getByText(/Knowledge Base|知识库|知識庫/).first()).toBeVisible();
  });

  test('app store renders its empty state', async ({ page }) => {
    await openRoute(page, '/settings/appstore');

    await expect(page.getByText(/App Store|应用商店|應用商店/).first()).toBeVisible();
    await expect(page.getByText(/No apps available yet|暂无可用应用|暫無可用應用/).first()).toBeVisible();
  });
});
