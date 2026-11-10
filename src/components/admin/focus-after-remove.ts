interface Focusable {
  focus: () => void;
}

type Lookup = (id: string) => Focusable | null;
type Schedule = (run: () => void) => void;

const byId: Lookup = (id) => document.getElementById(id);
const nextFrame: Schedule = (run) => {
  requestAnimationFrame(run);
};

/**
 * After a coordinator is removed their Remove button is gone, so focus would
 * fall to the page. Move it to the region's add-coordinator select, or to the
 * row when the select is not shown. It waits a frame so React has redrawn.
 */
export function focusAfterRemove(regionId: string, lookup: Lookup = byId, schedule: Schedule = nextFrame): void {
  schedule(() => {
    (lookup(`add-coordinator-${regionId}`) ?? lookup(`region-${regionId}`))?.focus();
  });
}
