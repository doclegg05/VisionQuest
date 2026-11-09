import type { ReactNode } from "react";

interface LogoPlateProps {
  /** The logo sits on a navy or royal ground in every theme, such as the sign-in hero. */
  onDark?: boolean;
  children: ReactNode;
}

/** SPOKES rule: the full-color logo goes on a white rounded plate over navy or royal. */
export function LogoPlate({ onDark = false, children }: LogoPlateProps) {
  const plate = onDark ? "bg-white" : "dark:bg-white";
  return <span className={`inline-flex items-center justify-center rounded-xl p-1.5 ${plate}`}>{children}</span>;
}
