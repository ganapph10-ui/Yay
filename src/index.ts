#!/usr/bin/env node
import { runtimeConfig } from './config.js';
import { downloadVideo } from './sora/remover.js';
import { TaskClient } from './taskClient.js';
import { launchBrowser } from './browser/launch.js';
import { getRandomProxy } from './proxy/select.js';
import { removeWatermarkViaBrowser } from './sora/browserFlow.js';
import type { BrowserContext, Page } from '@playwright/test';

const POLL_INTERVAL_MS = 10_000; // 10s

async function processTaskWithBrowser(
  taskClient: TaskClient,
  page: Page
): Promise<'has_task' | 'no_task' | 'task_processed'> {
  // 1) Claim task từ media.yofatik.ai theo PRODUCT_CODE
  const task = await taskClient.claimTask(runtimeConfig.PRODUCT_CODE);

  if (!task) {
    // Không có task pending → giữ browser, không đóng
    return 'no_task';
  }

  console.log('[worker] Đã claim task', { id: task.id });

  const soraUrl = task.video_url;
  if (!soraUrl) {
    const reason = 'Task không có field video_url';
    console.error('[worker] ' + reason);
    // Thiếu dữ liệu đầu vào → báo lỗi hẳn, không retry
    await taskClient.reportTask(task.id, reason);
    return 'task_processed'; // Đã xử lý xong (report), cần đóng browser
  }

  // 2) Browser đã sẵn sàng, chỉ cần refresh và xử lý ngay (nhanh hơn nhiều)
  console.log('\n============================================================');
  console.log('BƯỚC 2: REMOVE WATERMARK & DOWNLOAD QUA BROWSER');
  console.log('============================================================');

  const browserResult = await removeWatermarkViaBrowser(page, soraUrl, task.id);

  if (!browserResult) {
    const reason = 'Không remove được watermark qua browser (remover provider)';
    console.error('[worker] ' + reason);
    // Lỗi tạm thời khi xử lý → reset để hệ thống retry task với worker khác/lần khác
    await taskClient.resetTask(task.id);
    return 'task_processed'; // Đã xử lý xong (reset), cần đóng browser
  }

  // 3) Download video (local) từ mediaUrl
  const filepath = await downloadVideo(browserResult.mediaUrl, runtimeConfig.OUTPUT_DIR);

  if (filepath) {
    console.log('\n============================================================');
    console.log('✅ HOÀN THÀNH TẤT CẢ!');
    console.log('============================================================');
    console.log('📁 Video đã lưu tại:', filepath);

    // 4) Gửi mediaUrl (URL video không watermark) về Tool API
    await taskClient.completeTask(task.id, browserResult.mediaUrl);
    console.log('[worker] Đã complete task', {
      taskId: task.id,
      resultUrl: browserResult.mediaUrl
    });
    console.log('============================================================');
    return 'task_processed'; // Đã xử lý xong (thành công), cần đóng browser
  } else {
    const reason = 'Không download được video từ mediaUrl';
    console.error('[worker] ' + reason);
    // Download fail cũng coi là lỗi tạm thời → reset cho retry
    await taskClient.resetTask(task.id);
    return 'task_processed'; // Đã xử lý xong (reset), cần đóng browser
  }
}

async function runWorkerOnce(): Promise<void> {
  console.log('============================================================');
  console.log('SORA-2 REMOVE WATERMARK WORKER SERVICE');
  console.log('============================================================');
  console.log('[worker] Service đã khởi động...');

  const taskClient = new TaskClient();

  // Load browser đầu tiên
  console.log('[worker] Đang load browser với fingerprint + proxy...');
  const proxy = getRandomProxy();
  let browserSession = await launchBrowser({ proxy });
  let context: BrowserContext | null = browserSession.context;
  let page: Page | null = browserSession.page;

  // Load web và đợi 5s để trang load xong
  console.log('[worker] Browser đã sẵn sàng, đang load trang remover...');
  await page.goto(runtimeConfig.REMOVER_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000
  });
  console.log('[worker] Đã load trang, đợi 5s để trang load hoàn toàn...');
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  console.log('[worker] Bắt đầu claim task...');

  let sessionTaskCount = 0;

  while (true) {
    try {
      if (!page || !context) {
        throw new Error('Browser context/page không tồn tại');
      }

      // Claim task và xử lý với browser đã sẵn sàng
      const result = await processTaskWithBrowser(taskClient, page);

      if (result === 'no_task') {
        // Không có task → giữ browser, đợi một chút rồi claim lại
        console.log('[worker] Không có task, đợi 10s rồi claim lại...');
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }

      // Đã xử lý xong task (thành công hoặc thất bại)
      sessionTaskCount += 1;
      console.log('[worker] Đã xử lý xong task, số task trong session hiện tại:', sessionTaskCount);

      if (sessionTaskCount >= 2) {
        // Đủ 2 task cho 1 browser session → đóng browser và load browser mới
        console.log(
          '[worker] Đã xử lý đủ 2 task cho browser hiện tại, đóng browser và chuẩn bị load browser mới...'
        );
        await context.close();

        // Đợi một chút trước khi load browser mới
        await new Promise((resolve) => setTimeout(resolve, 2_000));

        // Load browser mới cho task tiếp theo
        console.log('[worker] Đang load browser mới với fingerprint + proxy...');
        const newProxy = getRandomProxy();
        browserSession = await launchBrowser({ proxy: newProxy });
        context = browserSession.context;
        page = browserSession.page;

        // Load web provider mới và đợi 5s để trang load xong
        console.log('[worker] Browser mới đã sẵn sàng, đang load trang remover...');
        await page.goto(runtimeConfig.REMOVER_URL, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000
        });
        console.log('[worker] Đã load trang, đợi 5s để trang load hoàn toàn...');
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        console.log('[worker] Bắt đầu claim task...');

        // Reset counter cho session mới
        sessionTaskCount = 0;
      }
    } catch (error) {
      console.error('[worker] Lỗi khi xử lý task:', error);

      // Nếu lỗi, đóng browser và load lại
      try {
        if (context) {
          await context.close();
        }
      } catch (closeError) {
        console.error('[worker] Lỗi khi đóng browser:', closeError);
      }

      // Đợi một chút trước khi load browser mới
      await new Promise((resolve) => setTimeout(resolve, 2_000));

      // Load browser mới
      console.log('[worker] Đang load browser mới sau lỗi...');
      const newProxy = getRandomProxy();
      browserSession = await launchBrowser({ proxy: newProxy });
      context = browserSession.context;
      page = browserSession.page;

      // Load web provider mới và đợi 5s để trang load xong
      console.log('[worker] Browser mới đã sẵn sàng, đang load trang remover...');
      await page.goto(runtimeConfig.REMOVER_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000
      });
      console.log('[worker] Đã load trang, đợi 5s để trang load hoàn toàn...');
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      console.log('[worker] Bắt đầu claim task...');
    }
  }
}

async function main() {
  const MAX_RESTART_DELAY = 60_000; // 60s max delay
  let restartDelay = 5_000; // Bắt đầu với 5s

  while (true) {
    try {
      await runWorkerOnce();
      // Nếu runOnce hoàn thành bình thường, reset delay
      restartDelay = 5_000;
    } catch (fatalError: any) {
      const errorMsg = fatalError?.message || String(fatalError);
      console.error('\n[worker] ❌ Lỗi fatal trong worker, sẽ tự động restart...', errorMsg);
      console.error('[worker] Stack:', fatalError?.stack);

      console.log(`[worker] Đợi ${restartDelay / 1000}s trước khi restart...`);
      await new Promise((resolve) => setTimeout(resolve, restartDelay));

      // Tăng delay cho lần restart tiếp theo (exponential backoff)
      restartDelay = Math.min(restartDelay * 2, MAX_RESTART_DELAY);
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[worker] Đang dừng service...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[worker] Đang dừng service...');
  process.exit(0);
});

main().catch((error) => {
  console.error('[worker] Lỗi không thể recover:', error);
  process.exit(1);
});


