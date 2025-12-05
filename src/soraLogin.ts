#!/usr/bin/env node
import { runtimeConfig } from './config.js';
import { resolve } from 'node:path';
import readline from 'node:readline';
import { promises as fs } from 'node:fs';
import { plugin } from 'playwright-with-fingerprints';
import type { Tag } from 'playwright-with-fingerprints';

const DEFAULT_TAGS: Tag[] = ['Microsoft Windows', 'Chrome'];

async function main() {
  console.log('============================================================');
  console.log('SORA PRO PREMIUM LOGIN HELPER');
  console.log('============================================================');
  console.log('[sora-login] Cookie file:', runtimeConfig.SORA_PRO_COOKIE_FILE);
  console.log(
    '[sora-login] Trang login:',
    runtimeConfig.SORA_PRO_BASE_URL ?? 'https://www.removesorawatermark.pro/en'
  );
  console.log('[sora-login] Chế độ: Dùng persistent profile (luôn lưu & tái sử dụng)');

  let browserOrContext: any = null;
  let context: any = null;
  let page: any = null;

  // Chuẩn bị fingerprint để browser trông "hợp lệ" hơn và gắn vào profile lưu lại.
  // Nếu không lấy được fingerprint → dừng hẳn (đảm bảo không chạy Chromium gốc).
  try {
    plugin.setWorkingFolder(resolve(runtimeConfig.FINGERPRINT_WORKDIR));
    plugin.setServiceKey(runtimeConfig.BABLOSOFT_API_KEY);
    console.log('[sora-login] Đang lấy fingerprint từ Bablosoft...');
    const fp = await plugin.fetch({ tags: DEFAULT_TAGS });
    if (!fp || fp.trim() === '' || fp === 'undefined') {
      throw new Error('Fingerprint API trả về giá trị không hợp lệ');
    }
    plugin.useFingerprint(fp);
    console.log('[sora-login] Đã áp dụng fingerprint thành công (sẽ lưu cùng profile)');
  } catch (err: any) {
    throw new Error(
      `[sora-login] Không thể lấy/áp dụng fingerprint: ${err?.message || String(err)}. Dừng để tránh chạy Chromium gốc.`
    );
  }

  try {
    console.log(
      '[sora-login] Đang mở browser fingerprint + persistent profile...',
      runtimeConfig.SORA_PRO_PROFILE_DIR
    );
    const userDataDir = resolve(runtimeConfig.SORA_PRO_PROFILE_DIR);
    context = await plugin.launchPersistentContext(userDataDir, { headless: false });
    page = context.pages()[0] ?? (await context.newPage());
    browserOrContext = context;
  } catch (err: any) {
    throw new Error(
      `[sora-login] Không thể launch browser fingerprint persistent: ${err?.message || String(err)}`
    );
  }

  if (!browserOrContext || !page || !context) {
    throw new Error('Không thể mở browser. Vui lòng kiểm tra lại cấu hình Bablosoft/Playwright.');
  }

  await page.goto(runtimeConfig.SORA_PRO_BASE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000
  });

  console.log('\n[sora-login] ❗ Hãy đăng nhập tài khoản premium trên cửa sổ browser.');
  console.log('[sora-login] Sau khi login xong và kiểm tra OK, quay lại terminal và nhấn Enter để lưu profile & thoát.\n');

  await new Promise<void>((resolvePromise) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question('Nhấn Enter sau khi đã login xong...', () => {
      rl.close();
      resolvePromise();
    });
  });

  console.log('[sora-login] Đang đọc cookies và lưu ra file...');
  const origin = new URL(runtimeConfig.SORA_PRO_BASE_URL).origin;
  const cookies = await context.cookies(origin);
  const cookieFile = resolve(runtimeConfig.SORA_PRO_COOKIE_FILE);
  await fs.writeFile(cookieFile, JSON.stringify(cookies, null, 2), 'utf8');
  console.log('[sora-login] Đã lưu cookies vào', cookieFile);

  console.log('[sora-login] Đang đóng browser...');
  await browserOrContext.close();
  console.log(
    '[sora-login] Hoàn tất. Bạn có thể chạy: npm run sora (worker) hoặc npm run sora-login --profile để xem lại).'
  );
}

main().catch((err) => {
  console.error('[sora-login] Lỗi không mong muốn:', err);
  process.exit(1);
});


