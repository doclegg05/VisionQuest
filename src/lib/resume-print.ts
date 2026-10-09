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
 * Pass the page nonce (see pageNonce) so the stylesheet survives the
 * inherited CSP. Returns null only when the browser actually blocked the window.
 */
export function openPrintWindow(html: string, open: WindowOpener, nonce?: string): Window | null {
  const printWindow = open("", "_blank");
  if (!printWindow) return null;

  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(withStyleNonce(html, nonce));
  printWindow.document.close();
  return printWindow;
}

/** CSP nonces are base64; anything else is refused rather than escaped. */
const NONCE_SHAPE = /^[A-Za-z0-9+/=_-]+$/;

/**
 * Stamps the page's CSP nonce on every <style> tag. A window from
 * window.open("") or an srcdoc iframe inherits the app's policy, which only
 * admits nonce'd stylesheets, so without this the resume renders unstyled.
 */
export function withStyleNonce(html: string, nonce: string | undefined): string {
  if (!nonce || !NONCE_SHAPE.test(nonce)) return html;
  return html.replace(/<style(?=[\s>])/g, `<style nonce="${nonce}"`);
}

/**
 * The nonce the server put on this page's scripts. Browsers blank the nonce
 * attribute after parsing but keep the property.
 */
export function pageNonce(doc: Document): string | undefined {
  return doc.querySelector<HTMLElement>("script[nonce]")?.nonce || undefined;
}
