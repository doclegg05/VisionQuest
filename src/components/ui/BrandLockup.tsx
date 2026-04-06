import Image from "next/image";
import Link from "next/link";

interface BrandLockupProps {
  href?: string;
  title?: string;
  subtitle?: string;
  size?: "sm" | "md" | "lg";
  theme?: "light" | "dark";
  align?: "left" | "center";
  priority?: boolean;
}

const SIZE_MAP = {
  sm: {
    imageWidth: 54,
    imageHeight: 36,
    titleClassName: "text-base",
    subtitleClassName: "text-[10px] tracking-[0.18em]",
    gapClassName: "gap-2.5",
  },
  md: {
    imageWidth: 76,
    imageHeight: 50,
    titleClassName: "text-xl",
    subtitleClassName: "text-[11px] tracking-[0.2em]",
    gapClassName: "gap-3",
  },
  lg: {
    imageWidth: 108,
    imageHeight: 72,
    titleClassName: "text-[1.85rem]",
    subtitleClassName: "text-xs tracking-[0.22em]",
    gapClassName: "gap-4",
  },
} as const;

export default function BrandLockup({
  href,
  title = "VisionQuest",
  subtitle = "SPOKES Workforce Development",
  size = "md",
  theme = "light",
  align = "left",
  priority = false,
}: BrandLockupProps) {
  const sizeConfig = SIZE_MAP[size];
  const isDark = theme === "dark";
  const stackOnMobile = size !== "sm";
  const wrapperClassName = `inline-flex max-w-full items-center ${
    stackOnMobile ? "flex-wrap" : "flex-nowrap"
  } ${sizeConfig.gapClassName} ${
    align === "center" ? "justify-center text-center" : ""
  }`;
  const titleClassName = `font-display leading-none ${sizeConfig.titleClassName} ${
    isDark ? "text-white" : "text-[var(--ink-strong)]"
  }`;
  const subtitleClassName = `mt-1 uppercase ${sizeConfig.subtitleClassName} ${
    isDark ? "text-white/60" : "text-[var(--ink-muted)]"
  }`;

  const content = (
    <div className={wrapperClassName}>
      <div className="flex shrink-0 items-stretch gap-1.5">
        <div
          className="relative flex items-center justify-center overflow-hidden rounded-[0.8rem] bg-[var(--surface-raised)] p-1.5 shadow-[0_14px_34px_rgba(16,37,62,0.12)]"
          style={{ maxHeight: sizeConfig.imageHeight + 12, maxWidth: Math.round(sizeConfig.imageWidth * 0.9) + 12 }}
        >
          <Image
            src="/wvae-logo.png"
            alt="WVAE logo"
            width={Math.round(sizeConfig.imageWidth * 0.9)}
            height={Math.round(sizeConfig.imageHeight * 0.9)}
            priority={priority}
            className="h-auto max-h-full w-auto max-w-full object-contain"
          />
        </div>
        <div
          className="relative flex items-center justify-center overflow-hidden rounded-[0.8rem] bg-[var(--surface-raised)] p-1.5 shadow-[0_14px_34px_rgba(16,37,62,0.12)]"
          style={{ maxHeight: sizeConfig.imageHeight + 12, maxWidth: sizeConfig.imageWidth + 12 }}
        >
          <Image
            src="/spokes-logo.png"
            alt="SPOKES logo"
            width={sizeConfig.imageWidth}
            height={sizeConfig.imageHeight}
            priority={priority}
            className="h-auto max-h-full w-auto max-w-full object-contain"
          />
        </div>
      </div>
      <div className={`min-w-0 ${stackOnMobile ? "basis-full pt-1" : ""}`}>
        <p className={titleClassName}>{title}</p>
        <p className={subtitleClassName}>{subtitle}</p>
      </div>
    </div>
  );

  if (!href) {
    return content;
  }

  return (
    <Link href={href} className="inline-flex max-w-full">
      {content}
    </Link>
  );
}
