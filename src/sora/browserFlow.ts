import type { Page } from '@playwright/test';
import { runtimeConfig } from '../config.js';
import { sendErrorWithScreenshot } from '../telegram.js';
import fetch from 'node-fetch';
import { URL } from 'node:url';

export interface BrowserRemoveResult {
  mediaUrl: string;
}

interface SoraProResponse {
  success: boolean;
  jobId?: string;
  videoUrl?: string;
  message?: string;
}

function cookiesToHeader(cookies: { name: string; value: string }[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Kiểm tra và đăng nhập lại nếu bị out acc
 */
async function checkAndLoginIfNeeded(page: Page): Promise<void> {
  try {
    const loginButton = page.locator('button:has-text("Login")').first();
    const isLoginVisible = await loginButton.isVisible({ timeout: 2_000 }).catch(() => false);
    
    if (isLoginVisible) {
      console.log('[browser-flow] Phát hiện bị out acc, đang click nút Login...');
      await loginButton.click();
      await page.waitForTimeout(1_000);
      
      // Đợi modal đăng nhập xuất hiện và click "Sign in with Google"
      console.log('[browser-flow] Đang đợi modal đăng nhập xuất hiện...');
      const googleSignInButton = page.locator('button:has-text("Sign in with Google")').first();
      await googleSignInButton.waitFor({ state: 'visible', timeout: 10_000 });
      console.log('[browser-flow] Đang click nút "Sign in with Google"...');
      await googleSignInButton.click();
      console.log('[browser-flow] Đã click Google sign in, đợi đăng nhập hoàn tất...');
      
      // Đợi một chút để đăng nhập hoàn tất
      await page.waitForTimeout(5_000);
      
      // Kiểm tra xem đã đăng nhập thành công chưa (nút Login biến mất)
      const stillLoggedOut = await loginButton.isVisible({ timeout: 2_000 }).catch(() => false);
      if (stillLoggedOut) {
        console.log('[browser-flow] Vẫn chưa đăng nhập, đợi thêm...');
        await page.waitForTimeout(5_000);
      } else {
        console.log('[browser-flow] ✅ Đã đăng nhập thành công!');
      }
    } else {
      console.log('[browser-flow] Đã đăng nhập, tiếp tục...');
    }
  } catch (checkError: any) {
    console.log('[browser-flow] Lỗi khi kiểm tra login status:', checkError?.message || checkError);
    // Tiếp tục dù có lỗi
  }
}

/**
 * Get cookies from browser context and call API directly to remove watermark
 * Browser is only used to get fresh cookies/tokens, not for web interaction
 */
export async function removeWatermarkViaBrowser(
  page: Page,
  soraUrl: string,
  taskId?: string
): Promise<BrowserRemoveResult | null> {
  try {
    const context = page.context();
    
    // Navigate to the page to ensure we have fresh cookies
    console.log('[browser-flow] Điều hướng tới trang removesorawatermark.pro để lấy cookies...');
    await page.goto(runtimeConfig.SOCIAL_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    });

    console.log('[browser-flow] Đợi 3s để trang load và cookies được set...');
    await page.waitForTimeout(3_000);
    
    // Kiểm tra xem có bị out acc không và đăng nhập lại nếu cần
    await checkAndLoginIfNeeded(page);

    // Get cookies from browser context
    const origin = new URL(runtimeConfig.SOCIAL_URL).origin;
    const cookies = await context.cookies(origin);
    
    if (!cookies || cookies.length === 0) {
      throw new Error('Không lấy được cookies từ browser context');
    }

    console.log(`[browser-flow] Đã lấy ${cookies.length} cookies từ browser`);
    const cookieHeader = cookiesToHeader(cookies);

    // Call API directly with cookies
    console.log('[browser-flow] Gọi API /api/jobs/post-url với soraUrl:', soraUrl);
    const res = await fetch(runtimeConfig.SORA_PRO_API_URL, {
      method: 'POST',
      headers: {
        accept: '*/*',
        'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'content-type': 'application/json',
        origin: 'https://www.removesorawatermark.pro',
        referer: runtimeConfig.SORA_PRO_BASE_URL,
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        cookie: cookieHeader
      },
      body: JSON.stringify({ soraUrl })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const errorMsg = `API trả về HTTP ${res.status} ${res.statusText}. Body: ${text.slice(0, 300)}`;
      console.error('[browser-flow]', errorMsg);
      
      // Nếu lỗi 401/403 (token hết hạn), refresh page để lấy token mới
      if (res.status === 401 || res.status === 403) {
        console.log('[browser-flow] Phát hiện lỗi auth (401/403), đang refresh page để lấy token mới...');
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForTimeout(3_000);
          console.log('[browser-flow] Đã refresh page, kiểm tra xem có bị out acc không...');
          
          // Kiểm tra xem có bị out acc không và đăng nhập lại nếu cần
          await checkAndLoginIfNeeded(page);
          
          console.log('[browser-flow] Thử lại API call...');
          
          // Lấy cookies mới sau khi refresh
          const newCookies = await context.cookies(origin);
          if (newCookies && newCookies.length > 0) {
            const newCookieHeader = cookiesToHeader(newCookies);
            console.log('[browser-flow] Đã lấy cookies mới, thử lại API...');
            
            // Thử lại API call với cookies mới
            const retryRes = await fetch(runtimeConfig.SORA_PRO_API_URL, {
              method: 'POST',
              headers: {
                accept: '*/*',
                'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
                'content-type': 'application/json',
                origin: 'https://www.removesorawatermark.pro',
                referer: runtimeConfig.SORA_PRO_BASE_URL,
                'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'user-agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
                cookie: newCookieHeader
              },
              body: JSON.stringify({ soraUrl })
            });
            
            if (retryRes.ok) {
              const retryResult = (await retryRes.json()) as SoraProResponse;
              if (retryResult?.success && typeof retryResult?.videoUrl === 'string') {
                console.log('[browser-flow] ✅ API thành công sau khi refresh token! Video URL:', retryResult.videoUrl);
                return { mediaUrl: retryResult.videoUrl };
              }
            }
          }
        } catch (refreshError: any) {
          console.error('[browser-flow] Lỗi khi refresh page:', refreshError?.message || refreshError);
        }
      }
      
      await sendErrorWithScreenshot(page, errorMsg, taskId);
      return null;
    }

    const result = (await res.json()) as SoraProResponse;
    console.log('[browser-flow] API response:', result);

    // removesorawatermark.pro API returns { success: boolean, videoUrl?: string }
    if (result?.success && typeof result?.videoUrl === 'string') {
      console.log('[browser-flow] ✅ API thành công! Video URL:', result.videoUrl);
      return { mediaUrl: result.videoUrl };
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


