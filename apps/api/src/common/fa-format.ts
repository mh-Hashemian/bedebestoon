/**
 * Format an integer amount with Persian digits and the ٬ thousands
 * separator (e.g. 101000 -> «۱۰۱٬۰۰۰»). Manual implementation so backend
 * messages never depend on the runtime's ICU data. The unit word
 * («تومان») is added by callers.
 */
export function formatTomanFa(n: number): string {
  const grouped = Math.abs(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  const fa = grouped.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  return n < 0 ? `-${fa}` : fa;
}
