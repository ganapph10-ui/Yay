#!/usr/bin/env node
import { runtimeConfig } from './config.js';
import { downloadVideo } from './sora/remover.js';
import { TaskClient } from './taskClient.js';
import fetch from 'node-fetch';
import { chromium } from '@playwright/test';
import { URL } from 'node:url';

const POLL_INTERVAL_MS = 10_000; // 10s

let cachedCookieHeader: string | null = null;
let refreshing = false;
let refreshPromise: Promise<void> | null = null;

function cookiesToHeader(cookies: { name: string; value: string }[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function refreshCookiesFromProfile(): Promise<void> {
  if (refreshing && refreshPromise) {
    return refreshPromise;
  }

  refreshing = true;
  refreshPromise = (async () => {
    console.log(
      '[sora-pro] Đang load cookies từ profile:',
      runtimeConfig.SORA_PRO_PROFILE_DIR
    );
    const context = await chromium.launchPersistentContext(
      runtimeConfig.SORA_PRO_PROFILE_DIR,
      { headless: true }
    );
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(runtimeConfig.SORA_PRO_BASE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000
      });

      const cookies = await context.cookies(
        new URL(runtimeConfig.SORA_PRO_BASE_URL).origin
      );
      if (!cookies.length) {
        throw new Error(
          'Không tìm thấy cookie nào cho removesorawatermark.pro. Hãy chạy `npm run sora-login` trước.'
        );
      }
      cachedCookieHeader = cookiesToHeader(cookies);
      console.log('[sora-pro] Đã load cookies thành công');
    } finally {
      await context.close();
      refreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function getCookieHeader(): Promise<string> {
  if (cachedCookieHeader) return cachedCookieHeader;
  await refreshCookiesFromProfile();
  if (!cachedCookieHeader) {
    throw new Error(
      'Không thể load cookies cho removesorawatermark.pro. Vui lòng chạy lại `npm run sora-login`.'
    );
  }
  return cachedCookieHeader;
}

interface SoraProResponse {
  success: boolean;
  jobId?: string;
  videoUrl?: string;
  message?: string;
}

async function callSoraProApi(soraUrl: string): Promise<string | null> {
  const cookieHeader = await getCookieHeader();

  console.log('[sora-pro] Gọi API post-url với soraUrl:', soraUrl);
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
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      cookie: cookieHeader
    },
    body: JSON.stringify({ soraUrl })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(
      `[sora-pro] HTTP ${res.status} ${res.statusText}. Body: ${text.slice(0, 300)}`
    );
    if (res.status === 401 || res.status === 403) {
      cachedCookieHeader = null;
    }
    return null;
  }

  const data = (await res.json()) as SoraProResponse;
  console.log('[sora-pro] Response JSON:', data);

  if (!data.success || !data.videoUrl) {
    // Nếu có vẻ do auth/cookie → clear cache để lần sau reload
    if (
      data.message &&
      /auth|login|token|expired/i.test(data.message)
    ) {
      cachedCookieHeader = null;
    }
    return null;
  }

  return data.videoUrl;
}

async function workerLoop(id: number, taskClient: TaskClient): Promise<void> {
  console.log(`[sora-worker-${id}] Bắt đầu loop xử lý task...`);

  while (true) {
    try {
      const task = await taskClient.claimTask(runtimeConfig.PRODUCT_CODE);
      if (!task) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      console.log(`[sora-worker-${id}] Đã claim task ${task.id}`);
      const soraUrl = task.video_url;
      if (!soraUrl) {
        const reason = 'Task không có field video_url';
        console.error(`[sora-worker-${id}] ${reason}`);
        await taskClient.reportTask(task.id, reason);
        continue;
      }

      const videoUrl = await callSoraProApi(soraUrl);
      if (!videoUrl) {
        const reason = 'Không lấy được videoUrl từ removesorawatermark.pro';
        console.error(`[sora-worker-${id}] ${reason}`);
        await taskClient.resetTask(task.id);
        continue;
      }

      const filepath = await downloadVideo(videoUrl, runtimeConfig.OUTPUT_DIR);
      if (!filepath) {
        const reason = 'Không download được video từ videoUrl';
        console.error(`[sora-worker-${id}] ${reason}`);
        await taskClient.resetTask(task.id);
        continue;
      }

      await taskClient.completeTask(task.id, videoUrl);
      console.log(
        `[sora-worker-${id}] ✅ Đã complete task ${task.id} với videoUrl: ${videoUrl}`
      );
    } catch (err: any) {
      console.error(`[sora-worker-${id}] Lỗi không mong muốn trong loop:`, err?.message || String(err));
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}

async function main() {
  console.log('============================================================');
  console.log('SORA PRO PREMIUM WORKER SERVICE');
  console.log('============================================================');

  const taskClient = new TaskClient();
  const concurrency = runtimeConfig.SORA_PRO_CONCURRENCY;
  console.log('[sora-worker] Concurrency:', concurrency);

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(workerLoop(i + 1, taskClient));
  }

  await Promise.all(workers);
}

main().catch((err) => {
  console.error('[sora-worker] Lỗi fatal:', err);
  process.exit(1);
});


