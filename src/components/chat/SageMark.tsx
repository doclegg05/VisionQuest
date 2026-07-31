import Image from "next/image";

interface SageMarkProps {
  className?: string;
}

/** Shared visual identity for Sage throughout the chat experience. */
export default function SageMark({ className = "h-8 w-8" }: SageMarkProps) {
  return (
    <Image
      src="/images/sage-compass-chat-symbol.png"
      alt=""
      aria-hidden="true"
      width={32}
      height={32}
      className={`${className} shrink-0 object-contain`}
    />
  );
}
