import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import SignaturePad from './SignaturePad';

test('signature ink uses paper-white display in both themes without recoloring the exported ink', () => {
  const html = renderToStaticMarkup(<SignaturePad onSign={() => {}} onCancel={() => {}} />);
  assert.match(html, /border-gray-400 bg-white/);
  assert.match(html, /text-gray-600[^>]*>Sign above this line/);
  assert.match(html, /Choose Type above to type your signature instead/);
  assert.match(html, /bg-\[var\(--ink-strong\)\].*text-\[var\(--surface-base\)\]/);
});
