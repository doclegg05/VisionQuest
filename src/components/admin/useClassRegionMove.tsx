"use client";

import { useState } from "react";

import { useConfirm } from "@/components/ui/useConfirm";
import { regionChoiceFor, regionMoveConfirm, regionPatchFor, type ClassRegionChoice } from "./class-region-choice";
import type { RegionOption } from "./region-pick";

interface MovableClass {
  id: string;
  name: string;
  region: RegionOption | null;
}

/**
 * The class settings' region move: the select's state, the confirm before a
 * move, and the part of the save body that carries it. Kept out of
 * ClassRosterManager, which is already over the file-size rule.
 */
export function useClassRegionMove(classDetail: MovableClass | null, regions: readonly RegionOption[]) {
  const [choice, setChoice] = useState<ClassRegionChoice | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const classId = classDetail?.id ?? "";
  const current = classDetail?.region ?? null;
  const value = regionChoiceFor(choice, classId, current?.id ?? null);

  async function confirmMove(): Promise<boolean> {
    const target = regions.find((region) => region.id === value);
    if (!classDetail || !target || target.id === current?.id) return true;
    const copy = regionMoveConfirm({ className: classDetail.name, from: current?.name ?? null, to: target.name });
    return copy ? confirm(copy) : true;
  }

  return {
    field: { regions, currentRegion: current, value, onChange: (regionId: string) => setChoice({ classId, regionId }) },
    patch: () => regionPatchFor(choice, classId, current?.id ?? null),
    confirmMove,
    confirmDialog,
  };
}
