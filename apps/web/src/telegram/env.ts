import { retrieveRawInitData } from '@telegram-apps/sdk';

/**
 * Runtime environment of the web app:
 * - `telegram`: opened inside Telegram — raw initData is available and is
 *   sent to the API as the Authorization header.
 * - `mock`: plain browser with ?mock=1 — local UI demo with invented data,
 *   always labelled with a permanent warning banner. Never real data.
 * - `browser`: plain browser without mock — the app shows a notice screen;
 *   it does NOT fabricate any data.
 */
export type AppEnv =
  | { kind: 'telegram'; initDataRaw: string }
  | { kind: 'mock' }
  | { kind: 'browser' };

export function detectEnv(): AppEnv {
  try {
    if (new URLSearchParams(window.location.search).get('mock') === '1') {
      return { kind: 'mock' };
    }
  } catch {
    // ignore — fall through to Telegram detection
  }
  try {
    const raw = retrieveRawInitData();
    if (raw) return { kind: 'telegram', initDataRaw: raw };
  } catch {
    // Not inside Telegram (or launch params unavailable).
  }
  return { kind: 'browser' };
}
