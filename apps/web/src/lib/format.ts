/** Persian (fa-IR) formatting helpers — all money is integer Tomans. */

const numberFa = new Intl.NumberFormat('fa-IR');

const dateFa = new Intl.DateTimeFormat('fa-IR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** 123456 -> "۱۲۳٬۴۵۶" */
export function formatNumberFa(value: number): string {
  return numberFa.format(value);
}

/** 123456 -> "۱۲۳٬۴۵۶ تومان" */
export function formatToman(value: number): string {
  return `${numberFa.format(value)} تومان`;
}

/** Signed amounts for balances: +۱۲٬۰۰۰ / −۵٬۰۰۰ تومان (no unit when zero). */
export function formatSignedToman(value: number): string {
  if (value === 0) return '۰ تومان';
  const sign = value > 0 ? '+' : '−';
  return `${sign}${numberFa.format(Math.abs(value))} تومان`;
}

/** ISO timestamp -> "۲۱ مهر ۱۴۰۵" style Persian date. */
export function formatDateFa(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateFa.format(d);
}

const timeFa = new Intl.DateTimeFormat('fa-IR', {
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Mockup-style timestamp: "امروز • ۱۳:۴۲" / "دیروز • ۱۶:۲۰" for recent
 * expenses, otherwise "۱۴۰۴/۰۸/۲۹ • ۱۸:۱۰".
 */
export function formatDateTimeFa(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = timeFa.format(d);
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round(
    (startOfDay(new Date()) - startOfDay(d)) / 86_400_000,
  );
  if (dayDiff === 0) return `امروز • ${time}`;
  if (dayDiff === 1) return `دیروز • ${time}`;
  return `${dateFa.format(d)} • ${time}`;
}

const percentFa = new Intl.NumberFormat('fa-IR', {
  style: 'percent',
  maximumFractionDigits: 1,
});

/** 0.338 -> "٪۳۳٫۸" (fa-IR percent style, as in the custom-split mockup). */
export function formatPercentFa(fraction: number): string {
  if (!Number.isFinite(fraction)) return percentFa.format(0);
  return percentFa.format(fraction);
}

/** Keep only ASCII digits from a user-typed amount (accepts Persian digits too). */
export function parseAmountInput(raw: string): number {
  const ascii = raw
    .replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)))
    .replace(/[^0-9]/g, '');
  if (!ascii) return 0;
  const n = Number.parseInt(ascii, 10);
  return Number.isSafeInteger(n) ? n : 0;
}
