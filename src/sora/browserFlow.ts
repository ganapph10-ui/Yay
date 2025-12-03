import type { Page } from '@playwright/test';
import { runtimeConfig } from '../config.js';
import { sendErrorWithScreenshot } from '../telegram.js';

export interface BrowserRemoveResult {
  mediaUrl: string;
}

const REMOVER_API_PATH = '/api/removesora/remove';

export async function removeWatermarkViaBrowser(
  page: Page,
  soraUrl: string,
  taskId?: string
): Promise<BrowserRemoveResult | null> {
  try {
    const currentUrl = page.url();
    if (currentUrl.startsWith(runtimeConfig.REMOVER_URL)) {
      console.log('[browser-flow] Page đã ở đúng URL, refresh page...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    } else {
      console.log('[browser-flow] Điều hướng tới trang RemoveSoraWatermark...');
      await page.goto(runtimeConfig.REMOVER_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000
      });
    }

    console.log('[browser-flow] Đợi 5s để trang load hoàn toàn...');
    await page.waitForTimeout(5_000);

    const input = page.locator('#share-link');
    console.log('[browser-flow] Đang click vào input #share-link...');
    await input.click({ timeout: 15_000 });
    await input.fill('');
    await input.type(soraUrl, { delay: 20 });

    const inputValue = await input.inputValue();
    console.log('[browser-flow] Đã điền Sora URL vào input:', inputValue);
    if (inputValue !== soraUrl) {
      throw new Error(`Input value không khớp! Expected: ${soraUrl}, Got: ${inputValue}`);
    }

    console.log('[browser-flow] Đang click button Remove Watermark Now...');

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(REMOVER_API_PATH) && res.request().method() === 'POST',
        { timeout: 60_000 }
      ),
      page.getByRole('button', { name: /Remove Watermark Now/i }).click()
    ]);

    console.log('[browser-flow] Đã click button và nhận response từ API /api/removesora/remove');

    const result = (await response.json()) as any;

    if (result?.success && typeof result?.resultVideoUrl === 'string') {
      console.log('[browser-flow] API thành công! Media URL:', result.resultVideoUrl);
      return { mediaUrl: result.resultVideoUrl };
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


