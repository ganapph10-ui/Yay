#!/usr/bin/env node
import { runtimeConfig } from './config.js';
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import readline from 'node:readline';

async function main() {
  console.log('============================================================');
  console.log('SORA PRO PREMIUM LOGIN HELPER');
  console.log('============================================================');
  console.log('[sora-login] Profile dir:', runtimeConfig.SORA_PRO_PROFILE_DIR);
  console.log(
    '[sora-login] Trang login:',
    runtimeConfig.SORA_PRO_BASE_URL ?? 'https://www.removesorawatermark.pro/en'
  );

  // Mở browser mặc định, không proxy, không fingerprint (legit site)
  const userDataDir = resolve(runtimeConfig.SORA_PRO_PROFILE_DIR);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false
  });

  const page = context.pages()[0] ?? (await context.newPage());
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

  console.log('[sora-login] Đang đóng browser và lưu profile...');
  await context.close();
  console.log('[sora-login] Hoàn tất. Bạn có thể chạy: npm run sora');
}

main().catch((err) => {
  console.error('[sora-login] Lỗi không mong muốn:', err);
  process.exit(1);
});


