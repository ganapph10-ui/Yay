import type { Page } from '@playwright/test';
import { runtimeConfig } from '../config.js';
import { sendErrorWithScreenshot } from '../telegram.js';

export interface BrowserRemoveResult {
  mediaUrl: string;
}

const SOCIAL_API_PATH = '/api/sora/remove-watermark';

export async function removeWatermarkViaBrowser(
  page: Page,
  soraUrl: string,
  taskId?: string
): Promise<BrowserRemoveResult | null> {
  try {
    const currentUrl = page.url();
    if (currentUrl.startsWith(runtimeConfig.SOCIAL_URL)) {
      console.log('[browser-flow] Page đã ở đúng URL, refresh page...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    } else {
      console.log('[browser-flow] Điều hướng tới trang SocialUtils...');
      await page.goto(runtimeConfig.SOCIAL_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000
      });
    }

    console.log('[browser-flow] Đợi 5s để trang load hoàn toàn...');
    await page.waitForTimeout(5_000);
    await page.keyboard.press('Escape').catch(() => {});

    // Đóng banner quảng cáo nếu xuất hiện
    const closeButton = page.locator('button[aria-label="Close modal"]');
    if (await closeButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
      console.log('[browser-flow] Phát hiện banner quảng cáo, đang đóng...');
      await closeButton.click({ timeout: 5_000, force: true });
      await page.waitForTimeout(500);
    }

    const input = page
      .locator(
        '#video-input, input[name="url"], input[name="videoUrl"], input[placeholder*="Sora"], input[placeholder*="Video URL"]'
      )
      .first();
    console.log('[browser-flow] Đang click vào input video...');
    await input.waitFor({ timeout: 15_000 });
    await input.click();
    await input.fill('');
    await input.type(soraUrl, { delay: 20 });

    const inputValue = await input.inputValue();
    console.log('[browser-flow] Đã điền Sora URL vào input:', inputValue);
    if (inputValue !== soraUrl) {
      throw new Error(`Input value không khớp! Expected: ${soraUrl}, Got: ${inputValue}`);
    }

    console.log('[browser-flow] Đang click button Remove Watermark...');
    
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(SOCIAL_API_PATH) && res.request().method() === 'POST',
        { timeout: 60_000 }
      ),
      page.locator('button.btn, button:has-text("Remove Watermark")').first().click()
    ]);

    console.log('[browser-flow] Đã click button và nhận response từ API /api/sora/remove-watermark');

    const result = (await response.json()) as any;

    if (result?.errorCode == null && typeof result?.mediaUrl === 'string') {
      console.log('[browser-flow] API thành công! Media URL:', result.mediaUrl);
      return { mediaUrl: result.mediaUrl };
    }

    const errorMsg = `API trả về lỗi: ${JSON.stringify(result)}`;
    console.error('[browser-flow]', errorMsg);
    await sendErrorWithScreenshot(page, errorMsg, taskId);
    return null;
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    console.error('[browser-flow] Lỗi khi xử lý:', errorMsg);
    await sendErrorWithScreenshot(page, errorMsg, taskId);
    return null;
  }
}


