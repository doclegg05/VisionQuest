"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useReducer } from "react";

import { useConfirm } from "@/components/ui/useConfirm";
import { api } from "@/lib/api";
import { RegionsCardView } from "./RegionsCardView";
import { createRegionsController } from "./regions-controller";
import { INITIAL_REGIONS_STATE, regionsReducer } from "./regions-reducer";

/**
 * The admin's Regions card: list, add and rename regions,
 * and assign or remove their coordinators. This file only wires React to the
 * controller; the requests and the state rules live in the regions-* modules.
 */
export function RegionsCard() {
  const router = useRouter();
  const [state, dispatch] = useReducer(regionsReducer, INITIAL_REGIONS_STATE);
  const { confirm, confirmDialog } = useConfirm();

  // `confirm` and `router` keep their identity, so this builds one controller.
  const controller = useMemo(
    () =>
      createRegionsController({
        http: api,
        dispatch,
        confirm,
        // Other cards on the page take their region lists from the server.
        onSaved: () => router.refresh(),
      }),
    [confirm, router],
  );

  useEffect(() => {
    void controller.load();
  }, [controller]);

  return (
    <>
      <RegionsCardView state={state} handlers={controller} />
      {confirmDialog}
    </>
  );
}
