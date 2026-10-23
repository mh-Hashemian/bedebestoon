import type { CSSProperties } from 'react';

/** Visual tokens from Mohammad's mockups (design/mockup-*.png). */
export const BLUE = 'var(--tgui--button_color, #2f7cf6)';
export const GREEN = '#34a853';
export const GREEN_TINT = 'rgba(52, 168, 83, 0.10)';
export const RED = '#e5484d';
export const RED_TINT = 'rgba(229, 72, 77, 0.10)';
export const BLUE_TINT = 'rgba(47, 124, 246, 0.10)';
export const AMBER = '#e8a13a';

/** White card with the mockups' large radius and soft shadow. */
export const cardStyle: CSSProperties = {
  background: 'var(--tgui--bg_color, #ffffff)',
  borderRadius: 20,
  boxShadow: '0 6px 24px rgba(31, 64, 120, 0.08)',
  padding: 16,
};

/** Deterministic pleasant color for a person's initial-letter avatar. */
const AVATAR_COLORS = [
  '#f2994a',
  '#2f7cf6',
  '#9b51e0',
  '#34a853',
  '#eb5757',
  '#00b8a9',
  '#f2c94c',
  '#56ccf2',
  '#bb6bd9',
  '#6fcf97',
];

export function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Category emoji + soft tint for a transaction, guessed from its title. */
export function categoryVisual(title: string): { emoji: string; tint: string } {
  const t = title.toLowerCase();
  const has = (...words: string[]) => words.some((w) => t.includes(w));
  if (has('ناهار', 'نهار', 'غذا', 'رستوران', 'پیتزا', 'برگر', 'ساندویچ', 'خوراک'))
    return { emoji: '🍕', tint: 'rgba(242, 201, 76, 0.25)' };
  if (has('قهوه', 'کافی', 'کافه', 'چای', 'نسکافه'))
    return { emoji: '☕', tint: 'rgba(160, 130, 100, 0.18)' };
  if (has('تاکسی', 'اسنپ', 'ماشین', 'بنزین', 'سفر'))
    return { emoji: '🚕', tint: 'rgba(242, 201, 76, 0.25)' };
  if (has('خرید', 'ملزومات', 'فروشگاه', 'سوپر'))
    return { emoji: '🛍️', tint: 'rgba(235, 87, 87, 0.12)' };
  if (has('قبض', 'برق', 'آب', 'گاز', 'اینترنت', 'شارژ'))
    return { emoji: '💡', tint: 'rgba(86, 204, 242, 0.18)' };
  if (has('اجاره', 'خانه', 'خونه'))
    return { emoji: '🏠', tint: 'rgba(111, 207, 151, 0.18)' };
  if (has('فیلم', 'سینما', 'بازی', 'تفریح'))
    return { emoji: '🎬', tint: 'rgba(155, 81, 224, 0.14)' };
  return { emoji: '🧾', tint: 'rgba(47, 124, 246, 0.10)' };
}
