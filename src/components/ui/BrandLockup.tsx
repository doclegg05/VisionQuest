import Image from "next/image";
import Link from "next/link";
import { LogoPlate } from "@/components/ui/LogoPlate";

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
    spokesBound: "max-w-[54px] max-h-[36px]",
    wvaeBound: "max-w-[49px] max-h-[32px]",
    imageWidth: 54,
    imageHeight: 36,
    titleClassName: "text-base",
    subtitleClassName: "text-xs tracking-[0.18em]",
    gapClassName: "gap-2.5",
  },
  md: {
    spokesBound: "max-w-[76px] max-h-[50px]",
    wvaeBound: "max-w-[68px] max-h-[45px]",
    imageWidth: 76,
    imageHeight: 50,
    titleClassName: "text-xl",
    subtitleClassName: "text-xs tracking-[0.2em]",
    gapClassName: "gap-3",
  },
  lg: {
    spokesBound: "max-w-[108px] max-h-[72px]",
    wvaeBound: "max-w-[97px] max-h-[65px]",
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
  subtitle = "Skills for Life",
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
      <div className="flex shrink-0 items-center gap-1.5">
        <LogoPlate onDark={isDark}>
          <Image
            src="/wvae-logo.png"
            alt="WVAE logo"
            width={Math.round(sizeConfig.imageWidth * 0.9)}
            height={Math.round(sizeConfig.imageHeight * 0.9)}
            priority={priority}
            className={`h-auto w-auto object-contain ${sizeConfig.wvaeBound}`}
          />
        </LogoPlate>
        <LogoPlate onDark={isDark}>
          <Image
            src="/spokes-logo.png"
            alt="SPOKES logo"
            width={sizeConfig.imageWidth}
            height={sizeConfig.imageHeight}
            priority={priority}
            className={`h-auto w-auto object-contain ${sizeConfig.spokesBound}`}
          />
        </LogoPlate>
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
    <Link href={href} className="inline-flex min-h-11 max-w-full items-center">
      {content}
    </Link>
  );
}
