# Dashboard contrast checks

## Scope and outcome

UI contrast only. Preserved layout, copy, shared global styling, and task behavior. No task API/service/database/auth changes. No production authentication, credentials, or student records were used. The isolated browser harness serves actual React components with synthetic loopback HTTP fixtures and aborts external browser requests. This is **not security, authorization, persistence, or database verification**.

Completed one desktop/mobile × light/dark inspection batch, one local fix batch, and one confirmation batch. Context and the design detector were not rerun. The contrast-only harness does not invoke axe. Existing `report.json` evidence was inspected, not overwritten by this run.

## Findings and local fixes

- **Secondary scope verified:** `.workspace .secondary-button` handles workspace controls; `.dialog .secondary-button` independently handles Radix content portalled outside `#main-content`. The portal placement is asserted in-browser. Existing ratios of **16.71:1 light / 16.17:1 dark** are confirmed, including Cancel and Confirm delete.
- **Primary buttons failed:** white labels over the green gradient had a computed minimum around **2.04–2.07:1**. Dashboard-only primary styling now uses the existing royal foreground and green accent, retaining the gradient shape and button design. Minimum gradient-stop contrast is **6.77:1** in either theme, covering Add personal task, Save task, and the primary learning link.
- **Dialog and toast surfaces were transparent:** `--surface-card` is undefined in the incumbent global tokens. The task dialog and dashboard toast now explicitly use opaque `--surface-base`; portal error/delete text no longer depends on underlying content. The dialog's opaque computed background is asserted. No global token was introduced.
- **Focus/disabled styling:** dashboard/portal controls use the strong foreground for keyboard outlines. Disabled dashboard buttons retain readable labels, use dashed borders and a not-allowed cursor, and suppress lift/filter/shadow feedback rather than reducing opacity.
- **Delete coverage:** Delete personal task, Confirm delete, Keep task, pending deletion, and failed deletion are measured. Delete label/error red remains unchanged: it passes on the repaired surface.

## Confirmation results

Chromium: desktop **1440×1100**, mobile **390×844**, light and dark. **88 state records; zero reported contrast violations or page errors.** Workspace page-width overflow assertions passed in all four combinations. Confirmation delete-dialog screenshots were inspected in all four combinations.

| Measured text/control | Light | Dark |
| --- | ---: | ---: |
| Secondary buttons, including portal Cancel/Confirm delete | 16.71:1 | 16.17:1 |
| Primary buttons (minimum gradient stop) | 6.77:1 | 6.77:1 |
| Delete personal task / dialog error red | 4.80:1 | 6.06:1 |
| Overview Try again | 7.70:1 | 7.11:1 |
| Toast Dismiss | 16.71:1 | 16.17:1 |
| Lowest sampled keyboard outline | 16.41:1 | 14.93:1 |

Coverage includes default/enabled/disabled workspace buttons, selected bulk actions, secondary and primary hover/focus, create/edit portals, invalid-title validation, pending save, save failure/retry controls, delete hover/focus/confirmation/pending/failure, overview error recovery, and empty-table Reset table. Assertions require text ≥4.5:1 (including disabled labels as a project quality goal, although inactive controls are WCAG-exempt) and sampled keyboard outlines ≥3:1.

## Evidence and commands

- `scripts/verify-dashboard-ui.mjs --contrast-only` delegates to `scripts/dashboard-contrast-checks.mjs`.
- `docs/audits/evidence/dashboard-ui/button-contrast.json`: final computed styles, state records, and assertions.
- `docs/audits/evidence/dashboard-ui/button-contrast-initial.json`: initial diagnostic output. **Not all initial failures are product defects:** the first helper treated ancestor gradients as white, causing false dark-mode retry/focus/delete findings. The confirmation helper composites ancestor backgrounds and evaluates gradient-stop ranges instead.
- `docs/audits/evidence/dashboard-ui/contrast-{desktop,mobile}-{light,dark}-{workspace,dialog,delete}.png`: final synthetic screenshots.

Passed:

```sh
node scripts/verify-dashboard-ui.mjs --contrast-only
npx eslint scripts/verify-dashboard-ui.mjs scripts/dashboard-contrast-checks.mjs \
  'src/app/(student)/dashboard/DashboardClient.tsx' \
  src/components/dashboard/TaskDialog.tsx src/components/dashboard/TaskTable.tsx
npx tsc --noEmit --incremental false
```

## Limits

Computed ratios use browser-resolved colors, alpha composition, and conservative gradient-stop ranges, not pixel-level rasterization of filters, decorative pseudo-elements, antialiasing, or sibling overlays. Opaque button/dialog/toast surfaces make the principal measurements independent of those layers. Focus/hover are sampled on representative control variants, not every repeated task row. This bounded check is not a whole-application accessibility certification, cross-browser audit, or security sign-off. Backend/security work remains with its owning agents.
