import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// Load .env from project root (same pattern như bên sora2 nhưng đơn giản hơn)
loadEnv({ path: resolve(process.cwd(), '.env') });

export interface RuntimeConfig {
  BABLOSOFT_API_KEY: string;
  API_BASE_URL: string;
  API_KEY: string;
  PRODUCT_CODE: string;
  FINGERPRINT_WORKDIR: string;
  BROWSER_HEADLESS: boolean;
  REMOVER_URL: string;
  OUTPUT_DIR: string;
  SKIP_GET_COOKIES: boolean;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const runtimeConfig: RuntimeConfig = {
  BABLOSOFT_API_KEY: process.env.BABLOSOFT_API_KEY ?? '',
  API_BASE_URL: process.env.API_BASE_URL ?? 'https://media.yofatik.ai/api/v1/tool',
  API_KEY: process.env.API_KEY ?? process.env.TOOL_API_KEY ?? '',
  PRODUCT_CODE: process.env.PRODUCT_CODE ?? 'sora-2-remove-watermark',
  FINGERPRINT_WORKDIR: process.env.FINGERPRINT_WORKDIR ?? '.fingerprint-engine',
  BROWSER_HEADLESS: toBool(process.env.BROWSER_HEADLESS, false),
  REMOVER_URL:
    process.env.REMOVER_URL ??
    process.env.SOCIALUTILS_URL ??
    'https://www.removesorawatermark.online/',
  OUTPUT_DIR: process.env.OUTPUT_DIR ?? 'downloads',
  SKIP_GET_COOKIES: toBool(process.env.SKIP_GET_COOKIES, false),
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID ?? ''
};


