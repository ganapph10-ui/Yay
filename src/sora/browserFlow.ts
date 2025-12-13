import type { Page } from '@playwright/test';
import { runtimeConfig } from '../config.js';
import { sendErrorWithScreenshot } from '../telegram.js';

export interface BrowserRemoveResult {
  mediaUrl: string;
}

const SORA_PRO_API_PATH = '/api/jobs/post-url';

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
      console.log('[browser-flow] Điều hướng tới trang removesorawatermark.pro...');
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

    // Try multiple selectors for the input field
    const inputSelectors = [
      '#video-input',
      'input[name="url"]',
      'input[name="videoUrl"]',
      'input[name="soraUrl"]',
      'input[type="url"]',
      'input[placeholder*="Sora" i]',
      'input[placeholder*="Video URL" i]',
      'input[placeholder*="URL" i]',
      'textarea[name="url"]',
      'textarea[name="videoUrl"]'
    ];
    
    let input: ReturnType<Page['locator']> | null = null;
    console.log('[browser-flow] Đang tìm input video với các selector...');
    for (const selector of inputSelectors) {
      const locator = page.locator(selector).first();
      const isVisible = await locator.isVisible({ timeout: 2_000 }).catch(() => false);
      if (isVisible) {
        input = locator;
        console.log(`[browser-flow] Tìm thấy input với selector: ${selector}`);
        break;
      }
    }
    
    if (!input) {
      // Take screenshot for debugging
      const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
      const pageContent = await page.content().catch(() => '');
      throw new Error(
        `Không tìm thấy input video trên trang. URL: ${page.url()}. ` +
        `Đã thử ${inputSelectors.length} selectors khác nhau.`
      );
    }
    
    console.log('[browser-flow] Đang click vào input video...');
    await input.waitFor({ state: 'visible', timeout: 15_000 });
    await input.click();
    await input.fill('');
    await input.type(soraUrl, { delay: 20 });

    const inputValue = await input.inputValue();
    console.log('[browser-flow] Đã điền Sora URL vào input:', inputValue);
    if (inputValue !== soraUrl) {
      throw new Error(`Input value không khớp! Expected: ${soraUrl}, Got: ${inputValue}`);
    }

    console.log('[browser-flow] Đang tìm và click button Remove Watermark...');
    
    // Try multiple button selectors
    const buttonSelectors = [
      'button:has-text("Remove Watermark" i)',
      'button:has-text("Remove" i)',
      'button:has-text("Submit" i)',
      'button[type="submit"]',
      'button.btn-primary',
      'button.btn',
      'input[type="submit"]'
    ];
    
    let button: ReturnType<Page['locator']> | null = null;
    for (const selector of buttonSelectors) {
      const locator = page.locator(selector).first();
      const isVisible = await locator.isVisible({ timeout: 2_000 }).catch(() => false);
      if (isVisible) {
        button = locator;
        console.log(`[browser-flow] Tìm thấy button với selector: ${selector}`);
        break;
      }
    }
    
    if (!button) {
      throw new Error(
        `Không tìm thấy button Remove Watermark trên trang. URL: ${page.url()}. ` +
        `Đã thử ${buttonSelectors.length} selectors khác nhau.`
      );
    }
    
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(SORA_PRO_API_PATH) && res.request().method() === 'POST',
        { timeout: 60_000 }
      ),
      button.click()
    ]);

    console.log('[browser-flow] Đã click button và nhận response từ API /api/jobs/post-url');

    const result = (await response.json()) as any;

    // removesorawatermark.pro API returns { success: boolean, videoUrl?: string }
    if (result?.success && typeof result?.videoUrl === 'string') {
      console.log('[browser-flow] API thành công! Video URL:', result.videoUrl);
      return { mediaUrl: result.videoUrl };
    }
    
    // Fallback for old format (mediaUrl)
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


