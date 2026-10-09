/** The slice of `window.open` this module needs, injectable for tests. */
export type WindowOpener = (url?: string, target?: string, features?: string) => Window | null;

/**
 * Opens a blank window and writes `html` into it, ready to print.
 *
 * Do not pass "noopener" here: per the HTML spec window.open then returns
 * null, which made every resume print fail with "Pop-up blocked." Clearing
 * `opener` afterwards gives the same isolation while keeping the handle we
 * need to write into the window.
 *
 * Returns null only when the browser actually blocked the window.
 */
export function openPrintWindow(html: string, open: WindowOpener): Window | null {
  const printWindow = open("", "_blank");
  if (!printWindow) return null;

  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  return printWindow;
}
