// Dựa trên cách dùng playwright-with-fingerprints trong sora2 (sora-worker/credit-updater),
// nhưng rút gọn cho use-case: mở browser, áp dụng fingerprint + proxy, lấy cookies.

import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { plugin } from 'playwright-with-fingerprints';
import type { Tag } from 'playwright-with-fingerprints';
import { runtimeConfig } from '../config.js';

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  artifactsDir: string;
}

export interface LaunchOptions {
  proxy: string | null;
}

// Cấu hình fingerprint engine giống sora2
const fingerprintEngineDir = resolve(runtimeConfig.FINGERPRINT_WORKDIR);
plugin.setWorkingFolder(fingerprintEngineDir);
plugin.setServiceKey(runtimeConfig.BABLOSOFT_API_KEY);

const DEFAULT_TAGS: Tag[] = ['Microsoft Windows', 'Chrome'];
const usedFingerprintCombosByDate = new Map<string, Set<string>>();
const MAX_COMBO_DUPLICATE_RETRIES = 5;

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getProxyKey(proxy: string | null): string {
  return proxy?.trim()?.toLowerCase() ?? 'no-proxy';
}

function cleanupOldDateEntries(currentKey: string): void {
  for (const key of usedFingerprintCombosByDate.keys()) {
    if (key !== currentKey) {
      usedFingerprintCombosByDate.delete(key);
    }
  }
}

function hasUsedCombo(dateKey: string, comboKey: string): boolean {
  return usedFingerprintCombosByDate.get(dateKey)?.has(comboKey) ?? false;
}

function markComboUsed(dateKey: string, comboKey: string): void {
  let combos = usedFingerprintCombosByDate.get(dateKey);
  if (!combos) {
    combos = new Set<string>();
    usedFingerprintCombosByDate.set(dateKey, combos);
  }
  combos.add(comboKey);
}

export async function launchBrowser(options: LaunchOptions): Promise<BrowserSession> {
  const artifactsDir = await mkdtemp(join(tmpdir(), 'sora-artifacts-'));
  // Mỗi lần chạy dùng một profile tạm → fingerprint mới, không reuse profile
  const userDataDir = await mkdtemp(join(tmpdir(), 'sora-profile-'));
  const todayKey = getTodayKey();
  const proxyKey = getProxyKey(options.proxy);
  cleanupOldDateEntries(todayKey);

  // Retry logic cho fetch fingerprint (vì API có thể trả về "undefined" hoặc lỗi)
  let fingerprint: string | null = null;
  const maxRetries = 3;
  let retryCount = 0;
  let duplicateComboCount = 0;

  while (!fingerprint && retryCount < maxRetries) {
    try {
      console.log(
        `[browser] Requesting new fingerprint from Bablosoft with tags: ${DEFAULT_TAGS.join(', ')} (attempt ${retryCount + 1}/${maxRetries})`
      );
      let fetchedFingerprint = await plugin.fetch({ tags: DEFAULT_TAGS });

      if (!fetchedFingerprint || fetchedFingerprint.trim() === '' || fetchedFingerprint === 'undefined') {
        throw new Error('Fingerprint API trả về giá trị không hợp lệ');
      }

      const comboKey = `${proxyKey}|${fetchedFingerprint}`;
      if (hasUsedCombo(todayKey, comboKey)) {
        duplicateComboCount += 1;
        console.warn(
          `[browser] Fingerprint + proxy combo đã được dùng hôm nay (combo ${duplicateComboCount}/${MAX_COMBO_DUPLICATE_RETRIES}). Đang yêu cầu fingerprint khác...`
        );
        if (duplicateComboCount >= MAX_COMBO_DUPLICATE_RETRIES) {
          throw new Error('Không thể tìm fingerprint mới chưa dùng cùng proxy trong ngày hôm nay');
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        continue;
      }

      fingerprint = fetchedFingerprint;
      markComboUsed(todayKey, comboKey);
      console.log('[browser] Đã lấy fingerprint thành công và đánh dấu combo fingerprint+proxy cho ngày hôm nay');
      break;
    } catch (error: any) {
      retryCount++;
      const errorMsg = error?.message || String(error);
      console.error(`[browser] Lỗi khi fetch fingerprint (attempt ${retryCount}/${maxRetries}):`, errorMsg);

      if (retryCount >= maxRetries) {
        throw new Error(`Không thể lấy fingerprint sau ${maxRetries} lần thử: ${errorMsg}`);
      }

      // Exponential backoff: 5s, 10s, 15s
      const delay = retryCount * 5_000;
      console.log(`[browser] Đợi ${delay / 1000}s trước khi thử lại...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  if (!fingerprint) {
    throw new Error('Không thể lấy fingerprint từ Bablosoft API');
  }

  plugin.useFingerprint(fingerprint);

  if (options.proxy && options.proxy.trim()) {
    console.log('[browser] Using proxy:', options.proxy);
    plugin.useProxy(options.proxy, {
      changeGeolocation: true,
      changeBrowserLanguage: true,
      changeTimezone: true
    });
  } else {
    console.log('[browser] No proxy configured, running without proxy');
  }

  const context = await plugin.launchPersistentContext(userDataDir, {
    headless: runtimeConfig.BROWSER_HEADLESS
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await mkdir(artifactsDir, { recursive: true });

  return { context, page, artifactsDir };
}


