"use client";

import { useMemo } from "react";

/**
 * Simplified interactive map of the six WV Adult Ed / SPOKES regions.
 *
 * Each region is a single `<path>` — click handler on the path sets the active
 * region on the parent dashboard. This is the v0 of an eventually
 * county-aware map: today the regions are stylized polygons loosely matching
 * the WV Adult Ed regional map's relative positions, not real geography.
 *
 * Upgrade path (deliberately not done today):
 *   1. Source a public-domain WV counties GeoJSON/SVG (Census TIGER/Line or
 *      Wikimedia). Convert to one `<path d="...">` per county.
 *   2. Group county paths under their region `<g data-region="...">`.
 *   3. Region click handler stays the same; add a county click handler that
 *      routes to `/coordinator/counties/<fips>` once that page exists.
 *
 * The component does NOT fetch — it takes the region list as a prop so the
 * parent controls which regions exist. Regions without a matching seed row
 * (RegionOption) render greyed out and disabled.
 */

interface RegionOption {
  id: string;
  name: string;
  code: string;
  status: string;
}

interface Props {
  regions: RegionOption[];
  activeRegionId: string;
  onSelect: (regionId: string) => void;
}

// --- Visual definition of the six regions --------------------------------
//
// Coordinates are picked to evoke WV's rough layout:
//   - Northern panhandle juts up from the top-left of the main body.
//   - Eastern panhandle extends to the right.
//   - Main body is the kidney-shaped middle/south region.
//
// Each region path is a self-contained polygon; no shared borders are split
// between regions because the geometry is stylized, not anatomical.
// ------------------------------------------------------------------------

interface RegionShape {
  code: string;
  displayName: string;
  color: string;
  path: string;
  // Label placement — roughly the centroid of each path.
  labelX: number;
  labelY: number;
}

const REGION_SHAPES: RegionShape[] = [
  {
    code: "NORTHERN",
    displayName: "Northern",
    color: "#1FA3D4", // blue
    path: "M 290 30 L 330 30 L 345 120 L 352 190 L 340 260 L 310 290 L 275 285 L 250 245 L 248 170 L 258 100 Z",
    labelX: 300,
    labelY: 170,
  },
  {
    code: "NORTH_CENTRAL",
    displayName: "North Central",
    color: "#2FAD47", // green
    path: "M 352 190 L 470 195 L 478 260 L 470 325 L 410 345 L 360 335 L 340 290 L 340 260 Z",
    labelX: 407,
    labelY: 265,
  },
  {
    code: "EASTERN_PANHANDLE",
    displayName: "Eastern Panhandle",
    color: "#C55A6B", // rose
    path: "M 478 200 L 605 195 L 615 250 L 600 285 L 540 295 L 485 275 L 478 240 Z",
    labelX: 545,
    labelY: 245,
  },
  {
    code: "MID_OHIO_VALLEY",
    displayName: "Mid-Ohio Valley",
    color: "#E8B93A", // gold
    path: "M 175 220 L 250 245 L 310 290 L 340 290 L 350 360 L 290 385 L 220 375 L 180 340 L 165 280 Z",
    labelX: 250,
    labelY: 315,
  },
  {
    code: "SOUTH_WEST",
    displayName: "South West",
    color: "#858B8D", // slate gray
    path: "M 180 340 L 290 385 L 310 430 L 290 475 L 230 485 L 170 460 L 150 400 Z",
    labelX: 230,
    labelY: 425,
  },
  {
    code: "SOUTH_EAST",
    displayName: "South East",
    color: "#14487A", // navy
    path: "M 310 430 L 470 325 L 478 370 L 490 430 L 455 485 L 380 495 L 320 470 L 290 475 L 310 430 Z",
    labelX: 400,
    labelY: 430,
  },
];

// Outline of WV as a whole — single path for visual framing.
const WV_OUTLINE =
  "M 290 30 L 330 30 L 345 120 L 470 195 L 605 195 L 615 250 L 600 285 L 490 430 L 455 485 L 380 495 L 320 470 L 230 485 L 170 460 L 150 400 L 165 280 L 175 220 L 248 170 L 258 100 Z";

export default function CoordinatorRegionMap({ regions, activeRegionId, onSelect }: Props) {
  const regionsByCode = useMemo(() => {
    const map = new Map<string, RegionOption>();
    for (const r of regions) map.set(r.code, r);
    return map;
  }, [regions]);

  const activeCode = useMemo(() => {
    const active = regions.find((r) => r.id === activeRegionId);
    return active?.code ?? null;
  }, [regions, activeRegionId]);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ink)]">West Virginia regions</h3>
          <p className="text-xs text-[var(--ink-muted)]">
            Click a region to view its rollup. County-level routing is coming in a later phase.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_220px]">
        <svg
          viewBox="0 0 780 530"
          role="img"
          aria-label="Interactive map of West Virginia's six adult-education coordinator regions"
          className="w-full max-w-3xl"
        >
          {/* Subtle drop-shadow for the state outline */}
          <defs>
            <filter id="region-lift" x="-5%" y="-5%" width="110%" height="110%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.12" />
            </filter>
          </defs>

          {/* State outline (purely decorative framing) */}
          <path
            d={WV_OUTLINE}
            fill="none"
            stroke="var(--border)"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />

          {/* One clickable path per region */}
          <g filter="url(#region-lift)">
            {REGION_SHAPES.map((shape) => {
              const region = regionsByCode.get(shape.code);
              const isActive = activeCode === shape.code;
              const isSeeded = Boolean(region);

              const baseOpacity = isActive ? 1 : isSeeded ? 0.9 : 0.35;
              const strokeColor = isActive ? "#ffffff" : "rgba(0,0,0,0.15)";
              const strokeWidth = isActive ? 3 : 1;

              return (
                <g key={shape.code}>
                  <path
                    d={shape.path}
                    fill={shape.color}
                    fillOpacity={baseOpacity}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeLinejoin="round"
                    className={isSeeded ? "cursor-pointer transition-opacity hover:fill-opacity-100" : "cursor-not-allowed"}
                    role={isSeeded ? "button" : undefined}
                    tabIndex={isSeeded ? 0 : -1}
                    aria-label={`${shape.displayName} region${isActive ? " (selected)" : ""}${isSeeded ? "" : " (not yet seeded)"}`}
                    aria-pressed={isActive}
                    onClick={() => {
                      if (region) onSelect(region.id);
                    }}
                    onKeyDown={(event) => {
                      if ((event.key === "Enter" || event.key === " ") && region) {
                        event.preventDefault();
                        onSelect(region.id);
                      }
                    }}
                  />
                  <text
                    x={shape.labelX}
                    y={shape.labelY}
                    textAnchor="middle"
                    className="pointer-events-none select-none text-[10px] font-semibold uppercase tracking-wide"
                    fill="#ffffff"
                    style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.35))" }}
                  >
                    {shape.displayName}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <ul className="flex flex-col gap-1.5 text-xs" aria-label="Region legend">
          {REGION_SHAPES.map((shape) => {
            const region = regionsByCode.get(shape.code);
            const isActive = activeCode === shape.code;
            const isSeeded = Boolean(region);
            return (
              <li key={shape.code}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors ${
                    isActive
                      ? "bg-[var(--surface-muted)] font-semibold"
                      : "hover:bg-[var(--surface-muted)]/50"
                  } ${isSeeded ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
                  onClick={() => {
                    if (region) onSelect(region.id);
                  }}
                  disabled={!isSeeded}
                  aria-pressed={isActive}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 shrink-0 rounded"
                    style={{ background: shape.color }}
                  />
                  <span className="truncate">{shape.displayName}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
