/**
 * Normalize an Iranian mobile number to E.164 format (+98...).
 *
 * Accepted inputs (separators/spaces are ignored):
 *   09123456789 | 9123456789 | +989123456789 | 989123456789 | 00989123456789
 *
 * Returns the normalized string (+989123456789) or null when the input is not
 * a valid Iranian mobile number (mobiles are 10 digits starting with 9 once
 * the country/trunk prefix is removed). Landlines intentionally return null:
 * contact matching keys on the mobile that owns the Telegram account.
 */
export function normalizeIranianPhone(
  input: string | null | undefined,
): string | null {
  if (!input) return null;

  let s = input.replace(/[\s\-()]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+$/.test(s)) return null;

  let national: string;
  if (s.startsWith('0098')) {
    national = s.slice(4);
  } else if (s.startsWith('98') && s.length === 12) {
    national = s.slice(2);
  } else if (s.startsWith('0')) {
    national = s.slice(1);
  } else {
    national = s;
  }

  if (national.length !== 10) return null;
  if (!/^9\d{9}$/.test(national)) return null;
  return `+98${national}`;
}
