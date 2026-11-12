export interface CreateClassGateInput {
  /** The admin page. It has the Regions card, so its form always shows. */
  manageRegions: boolean;
  /** Regions the caller may create a class in. An instructor with no region has none. */
  regionCount: number;
  loading: boolean;
  isAdmin?: boolean;
}

export type CreateClassVisibility = "form" | "hint" | "pending";

/**
 * Whether the Create a Class form shows. A class needs a region, so an
 * instructor with no region gets the hint instead of a form that cannot work.
 * Until the first answer arrives nothing shows, so the form never flashes.
 */
export function createClassVisibility({ manageRegions, regionCount, loading }: CreateClassGateInput): CreateClassVisibility {
  if (manageRegions || regionCount > 0) return "form";
  return loading ? "pending" : "hint";
}

/** In place of the form, for an instructor with no region. Renders nothing otherwise. */
export function CreateClassHint(input: CreateClassGateInput) {
  if (createClassVisibility(input) !== "hint") return null;
  return (
    <div className="surface-section space-y-2 p-5">
      <h2 className="font-display text-2xl text-[var(--ink-strong)]">Create a Class</h2>
      {input.isAdmin ? (
        <p className="text-sm text-[var(--ink-strong)]">No regions yet. <a href="/admin#regions" className="inline-flex min-h-11 items-center font-semibold underline">Add a region in Admin</a> first.</p>
      ) : <p className="text-sm text-[var(--ink-strong)]">You are not in a region yet. Ask your program admin to add you to a region.</p>}
    </div>
  );
}
