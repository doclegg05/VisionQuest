/** Shown in place of a Region select while the system has no region. Admin page only. */
export function NoRegionsHint() {
  return (
    <p className="text-sm text-[var(--ink-strong)]">
      No regions yet. Add one in the{" "}
      <a href="#regions" className="font-semibold underline">Regions card</a> at the top of this page first.
    </p>
  );
}
