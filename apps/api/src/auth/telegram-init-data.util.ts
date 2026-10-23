import { createHmac, timingSafeEqual } from 'crypto';

/** Shape of the `user` object inside Telegram initData. */
export interface TelegramInitDataUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ValidatedInitData {
  user: TelegramInitDataUser;
  authDate: number; // unix seconds
  queryId?: string;
}

/** initData older than this is rejected (HANDOVER Phase 1 spec). */
export const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Validate Telegram Mini App initData exactly per Telegram's official
 * algorithm:
 *   data_check_string = all fields except `hash`, sorted by key,
 *                       joined as "key=value" lines with "\n"
 *   secret_key        = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   expected hash     = HMAC_SHA256(key = secret_key, message = data_check_string)
 *
 * Throws Error with a human-readable reason on any failure.
 */
export function validateInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number; nowSeconds?: number } = {},
): ValidatedInitData {
  if (!initData) throw new Error('initData is empty');
  if (!botToken) throw new Error('bot token is not configured');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('initData has no hash');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const computedHash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const computed = Buffer.from(computedHash, 'hex');
  const given = Buffer.from(hash, 'hex');
  if (computed.length !== given.length || !timingSafeEqual(computed, given)) {
    throw new Error('initData hash mismatch');
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new Error('initData has no valid auth_date');
  }
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAge = options.maxAgeSeconds ?? INIT_DATA_MAX_AGE_SECONDS;
  if (now - authDate > maxAge) {
    throw new Error('initData is expired (auth_date older than allowed)');
  }

  const userRaw = params.get('user');
  if (!userRaw) throw new Error('initData has no user');
  let user: TelegramInitDataUser;
  try {
    user = JSON.parse(userRaw) as TelegramInitDataUser;
  } catch {
    throw new Error('initData user is not valid JSON');
  }
  if (!user || typeof user.id !== 'number' || !user.first_name) {
    throw new Error('initData user is malformed');
  }

  return { user, authDate, queryId: params.get('query_id') ?? undefined };
}
