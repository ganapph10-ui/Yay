import fetch, { type Response } from 'node-fetch';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Cookie } from '@playwright/test';

// This file may not be used if using browser flow
// Keeping for backward compatibility
const API_URL = process.env.SORA_PRO_API_URL || 'https://www.removesorawatermark.pro/api/jobs/post-url';

export interface RemoveWatermarkResult {
  mediaUrl: string;
}

export function extractVideoCode(soraUrl: string): string | null {
  const pattern = /(s_[a-f0-9]+)/;
  const match = soraUrl.match(pattern);
  if (!match) {
    console.error('[sora] Không tìm thấy video code trong URL:', soraUrl);
    return null;
  }
  const videoCode = match[1];
  console.log('[sora] Đã extract video code:', videoCode);
  return videoCode;
}

export function cookiesToHeader(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function generateRequestPayload(videoCode: string) {
  const timestamp = Date.now();

  const clientId = randomUUID();
  const clientAppId = randomUUID();
  const clientKey = randomUUID();

  // Chuỗi 10 chữ số từ timestamp (giống Python)
  const clientToken = String(timestamp).slice(-10);

  return {
    clientId,
    clientAppId,
    timestamp,
    clientToken,
    clientKey,
    videoCode
  };
}

async function assertOk(response: Response): Promise<Response> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `HTTP ${response.status} ${response.statusText}. Body: ${text.slice(0, 500)}`
    );
  }
  return response;
}

export async function callRemoveWatermarkApi(
  soraUrl: string,
  cookies: Cookie[],
  proxy: string
): Promise<RemoveWatermarkResult | null> {
  const videoCode = extractVideoCode(soraUrl);
  if (!videoCode) return null;

  const payload = generateRequestPayload(videoCode);
  console.log('[sora] Đang gọi API remove watermark...', { videoCode, proxy });

  const cookieHeader = cookiesToHeader(cookies);

  // Dùng proxy khi gọi API (quan trọng: cookie lấy bằng proxy nào thì phải dùng proxy đó)
  const agent = new HttpsProxyAgent(proxy);

  const res = await assertOk(
    await fetch(API_URL, {
      method: 'POST',
      // @ts-ignore - node-fetch v3 supports agent
      agent,
      headers: {
        accept: '*/*',
        'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'content-type': 'application/json',
        origin: 'https://www.removesorawatermark.pro',
        referer: 'https://www.removesorawatermark.pro/en',
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
      body: JSON.stringify(payload)
    })
  );

  const result = (await res.json()) as any;

  if (result?.errorCode == null && typeof result?.mediaUrl === 'string') {
    console.log('[sora] API thành công! Media URL:', result.mediaUrl);
    return { mediaUrl: result.mediaUrl };
  }

  console.error('[sora] API trả về lỗi:', result);
  return null;
}

export async function downloadVideo(
  mediaUrl: string,
  outputDir: string,
  filename?: string
): Promise<string | null> {
  await mkdir(outputDir, { recursive: true });

  let finalName = filename;
  if (!finalName) {
    const url = new URL(mediaUrl);
    const base = basename(url.pathname);
    if (base && base !== '/') {
      finalName = base;
    } else {
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
        now.getDate()
      ).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(
        now.getMinutes()
      ).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      finalName = `sora_video_${ts}.mp4`;
    }
  }

  const filepath = join(outputDir, finalName);
  console.log('[sora] Đang download video...', { mediaUrl, filepath });

  const res = await assertOk(
    await fetch(mediaUrl, {
      method: 'GET'
    })
  );

  const totalSize = Number(res.headers.get('content-length') ?? '0');

  // node-fetch body là Node.js stream
  const body = res.body;
  if (!body) {
    throw new Error('Không có body trong response khi download video');
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const fileStream = createWriteStream(filepath);
    let downloaded = 0;

    body.on('data', (chunk: Buffer) => {
      downloaded += chunk.length;
      if (totalSize > 0) {
        const percent = (downloaded / totalSize) * 100;
        process.stdout.write(
          `\r[sora] Progress: ${percent.toFixed(1)}% (${downloaded}/${totalSize} bytes)`
        );
      }
    });

    body.on('error', (err) => {
      fileStream.close();
      rejectPromise(err);
    });

    body.pipe(fileStream);
    fileStream.on('finish', () => {
      console.log('\n[sora] Download hoàn thành!');
      resolvePromise();
    });
    fileStream.on('error', (err) => {
      rejectPromise(err);
    });
  });

  return filepath;
}


