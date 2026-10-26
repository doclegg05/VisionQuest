// Browser-side computed-color checks; synthetic UI only, no accessibility detector.
export function measureControls(nodes) {
  const rgba = (value) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v);
  };
  const over = (fg, bg) => [...fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])), 1];
  const background = (node) => {
    if (!node) return [[255, 255, 255, 1]];
    const style = getComputedStyle(node);
    const color = rgba(style.backgroundColor);
    const parents = color[3] === 1 ? [[255, 255, 255, 1]] : background(node.parentElement);
    const base = parents.map((b) => over(color, b));
    // Conservative range across gradient stops, including transparent stops.
    const stops = style.backgroundImage.match(/rgba?\([^)]*\)|#[\da-f]{6}|transparent/gi) || [];
    const candidates = stops.length ? stops.flatMap((stop) => base.map((b) => over(rgba(stop), b))) : base;
    return [...new Map(candidates.map((b) => [b.join(','), b])).values()];
  };
  const luminance = (rgb) => rgb.slice(0, 3).map((v) => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  return nodes.filter((node) => node.getClientRects().length).map((node) => {
    const style = getComputedStyle(node), bg = background(node);
    const backgrounds = bg;
    const focus = node.matches(':focus-visible');
    return { text: (node.textContent || node.getAttribute('aria-label') || node.value || node.tagName).trim(), tag: node.tagName, disabled: node.matches(':disabled'), color: style.color, background: style.backgroundColor, backgroundImage: style.backgroundImage, opacity: style.opacity, contrast: Math.min(...backgrounds.map((b) => ratio(over(rgba(style.color), b), b))), focus, outline: style.outline, focusContrast: focus ? Math.min(...background(node.parentElement).map((b) => ratio(over(rgba(style.outlineColor), b), b))) : null };
  });
}

export async function checkDashboardContrast({ page, url, evidence, report, failures }) {
  const { default: path } = await import('node:path');
  const check = (ok, message) => { if (!ok) report.violations.push({ id: 'computed-contrast', message }); };
  for (const size of [{ name: 'desktop', width: 1440, height: 1100 }, { name: 'mobile', width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    for (const theme of ['light', 'dark']) {
      const prefix = `${size.name} ${theme}`;
      const capture = async (state, selector = '#main-content button, #main-content .primary-button, [role="dialog"] button, [data-radix-toast-viewport] button') => {
        const values = await page.locator(selector).evaluateAll(measureControls);
        check(values.length > 0, `${prefix} ${state}: missing controls`);
        for (const value of values) {
          check(value.contrast >= 4.5, `${prefix} ${state}: ${value.text} text ${value.contrast.toFixed(2)}`);
          if (value.focus) check(value.focusContrast >= 3 && !value.outline.startsWith('none') && !value.outline.includes(' 0px'), `${prefix} ${state}: ${value.text} focus ${value.focusContrast.toFixed(2)}`);
        }
        report.checks.push({ viewport: size.name, theme, state, computedButtons: values });
      };
      const focus = async (button) => { await page.keyboard.press('Tab'); await button.focus(); check(await button.evaluate((n) => n.matches(':focus-visible')), `${prefix}: keyboard focus not visible`); };
      failures.save = false; failures.overview = false;
      await page.goto(`${url}/dashboard?theme=${theme}`);
      await page.getByText('14 matching tasks').waitFor();
      await page.getByText('View chart values as text').waitFor();
      await capture('workspace default + disabled');
      const refresh = page.getByRole('button', { name: 'Refresh dashboard' });
      await refresh.hover(); await page.waitForTimeout(180); await capture('workspace hover');
      await focus(refresh); await capture('workspace keyboard focus');
      const primary = page.getByRole('button', { name: 'Add personal task', exact: true });
      await primary.hover(); await page.waitForTimeout(450); await capture('primary hover');
      await focus(primary); await capture('primary keyboard focus');
      await page.getByRole('checkbox', { name: 'Select tasks on this page' }).check();
      await capture('bulk actions enabled');
      check(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), `${prefix}: page overflow`);
      await page.screenshot({ path: path.join(evidence, `contrast-${size.name}-${theme}-workspace.png`), fullPage: true });
      await page.getByRole('button', { name: 'Add personal task', exact: true }).click();
      const dialog = page.getByRole('dialog');
      check(await dialog.evaluate((n) => !document.querySelector('#main-content').contains(n)), `${prefix}: dialog not portalled`);
      check(await dialog.evaluate((n) => getComputedStyle(n).backgroundColor !== 'rgba(0, 0, 0, 0)'), `${prefix}: transparent dialog surface`);
      await capture('portalled create dialog');
      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
      await cancel.hover(); await page.waitForTimeout(180); await capture('dialog secondary hover');
      await focus(cancel); await capture('dialog secondary keyboard focus');
      const save = dialog.getByRole('button', { name: 'Save task', exact: true });
      await save.hover(); await page.waitForTimeout(450); await capture('dialog primary hover');
      await focus(save); await capture('dialog primary keyboard focus');
      await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
      await page.getByText('Enter a task title.').waitFor();
      check(await page.getByLabel('Task title', { exact: true }).getAttribute('aria-invalid') === 'true', `${prefix}: validation state missing`);
      await capture('validation error', '[role="dialog"] button, [role="dialog"] input, [role="dialog"] p[id$="-error"]');
      await page.getByLabel('Task title', { exact: true }).fill('Synthetic contrast check');
      failures.save = true;
      await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
      await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
      await capture('pending disabled dialog');
      await dialog.getByRole('alert').waitFor();
      await capture('save error + retry', '[role="dialog"] button, [role="dialog"] [role="alert"]');
      await page.screenshot({ path: path.join(evidence, `contrast-${size.name}-${theme}-dialog.png`), fullPage: true });
      await cancel.click();
      await page.getByRole('button', { name: 'Edit Practice task 2', exact: true }).click();
      await capture('edit dialog including delete');
      const remove = dialog.getByRole('button', { name: 'Delete personal task', exact: true });
      await remove.hover(); await page.waitForTimeout(180); await capture('delete hover');
      await focus(remove); await capture('delete keyboard focus');
      await remove.click();
      await capture('delete confirmation');
      await page.screenshot({ path: path.join(evidence, `contrast-${size.name}-${theme}-delete.png`) });
      await dialog.getByRole('button', { name: 'Confirm delete', exact: true }).click();
      await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
      await capture('delete pending');
      await dialog.getByRole('alert').waitFor();
      await capture('delete error', '[role="dialog"] button, [role="dialog"] [role="alert"]');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      failures.overview = true;
      await refresh.click();
      await page.getByText(/Showing last saved data/).waitFor();
      const retry = page.getByRole('button', { name: 'Try again', exact: true });
      await focus(retry); await capture('overview error recovery');
      failures.overview = false; failures.save = false;
      await page.getByRole('searchbox', { name: 'Search tasks' }).fill('no synthetic match');
      await page.getByText('0 matching tasks').waitFor();
      await capture('empty state reset');
    }
  }
}
