import { createHmac } from 'crypto';
import {
  INIT_DATA_MAX_AGE_SECONDS,
  validateInitData,
} from './telegram-init-data.util';

const BOT_TOKEN = '110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const NOW = 1_760_000_000; // fixed "now" so tests never rot

/** Build initData exactly the way Telegram signs it (documented algorithm). */
function buildInitData(
  fields: Record<string, string>,
  botToken: string,
): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

function validFields(authDate: number): Record<string, string> {
  return {
    auth_date: String(authDate),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify({
      id: 279058397,
      first_name: 'Mohammad',
      last_name: 'Hashemian',
      username: '_hashemian__',
      language_code: 'fa',
    }),
  };
}

describe('validateInitData', () => {
  it('accepts correctly signed initData and parses the user', () => {
    const raw = buildInitData(validFields(NOW - 60), BOT_TOKEN);
    const result = validateInitData(raw, BOT_TOKEN, { nowSeconds: NOW });
    expect(result.user.id).toBe(279058397);
    expect(result.user.first_name).toBe('Mohammad');
    expect(result.user.username).toBe('_hashemian__');
    expect(result.authDate).toBe(NOW - 60);
    expect(result.queryId).toBe('AAHdF6IQAAAAAN0XohDhrOrc');
  });

  it('rejects initData whose user payload was tampered with after signing', () => {
    const raw = buildInitData(validFields(NOW - 60), BOT_TOKEN);
    const params = new URLSearchParams(raw);
    const user = JSON.parse(params.get('user') as string);
    user.first_name = 'Mallory';
    params.set('user', JSON.stringify(user));
    expect(() =>
      validateInitData(params.toString(), BOT_TOKEN, { nowSeconds: NOW }),
    ).toThrow(/hash mismatch/);
  });

  it('rejects initData signed with a different bot token', () => {
    const raw = buildInitData(validFields(NOW - 60), BOT_TOKEN);
    expect(() =>
      validateInitData(raw, '999999:WRONG-TOKEN', { nowSeconds: NOW }),
    ).toThrow(/hash mismatch/);
  });

  it('accepts auth_date exactly at the 24h boundary', () => {
    const raw = buildInitData(
      validFields(NOW - INIT_DATA_MAX_AGE_SECONDS),
      BOT_TOKEN,
    );
    expect(() =>
      validateInitData(raw, BOT_TOKEN, { nowSeconds: NOW }),
    ).not.toThrow();
  });

  it('rejects stale initData (auth_date older than 24h)', () => {
    const raw = buildInitData(
      validFields(NOW - INIT_DATA_MAX_AGE_SECONDS - 1),
      BOT_TOKEN,
    );
    expect(() =>
      validateInitData(raw, BOT_TOKEN, { nowSeconds: NOW }),
    ).toThrow(/expired/);
  });

  it('rejects initData without a hash', () => {
    const raw = new URLSearchParams(validFields(NOW)).toString();
    expect(() =>
      validateInitData(raw, BOT_TOKEN, { nowSeconds: NOW }),
    ).toThrow(/no hash/);
  });
});
