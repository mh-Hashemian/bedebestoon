/**
 * Frontend mirror of the backend split rules
 * (apps/api/src/expenses/split.util.ts) so the Add Expense flow can preview
 * EXACTLY what the server will store. Keep the two implementations in sync.
 *
 * Addendum v1.1 remainder rule: leftover Tomans from an equal split go +1
 * each to the FIRST participants in list order.
 * Example: equalSplit(100000, 3) => [33334, 33333, 33333]
 */
export function equalSplit(totalAmount: number, parts: number): number[] {
  if (!Number.isInteger(totalAmount) || totalAmount < 0) {
    throw new Error('totalAmount must be a non-negative integer');
  }
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new Error('parts must be a positive integer');
  }
  const base = Math.floor(totalAmount / parts);
  const remainder = totalAmount - base * parts;
  return Array.from({ length: parts }, (_, i) =>
    i < remainder ? base + 1 : base,
  );
}

/** A custom split is valid when every amount is a non-negative integer and
 *  the amounts sum exactly to the total. */
export function isValidCustomSplit(
  totalAmount: number,
  amounts: number[],
): boolean {
  if (amounts.length === 0) return false;
  if (amounts.some((a) => !Number.isInteger(a) || a < 0)) return false;
  return amounts.reduce((sum, a) => sum + a, 0) === totalAmount;
}

export function sumAmounts(amounts: number[]): number {
  return amounts.reduce((sum, a) => sum + a, 0);
}
