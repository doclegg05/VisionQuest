import { ReactNode } from "react";

interface PageIntroProps {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
}

export default function PageIntro({
  eyebrow = "SPOKES VisionQuest",
  title,
  description,
  actions,
  children,
}: PageIntroProps) {
  return (
    <section className="page-hero">
      <div className="min-w-0 max-w-3xl flex-1">
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{description}</p>
        {children}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </section>
  );
}
