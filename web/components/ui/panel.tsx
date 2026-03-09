import type { HTMLAttributes, ReactNode } from "react";

type SurfaceElement = "aside" | "article" | "div" | "li" | "main" | "section";

interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: SurfaceElement;
  className?: string;
  children: ReactNode;
}

function classJoin(tokens: string[]) {
  return tokens.filter(Boolean).join(" ");
}

export function Panel({ as = "section", className = "", children, ...props }: PanelProps) {
  const Comp = as as typeof as;
  return (
    <Comp className={classJoin(["ds-panel", className])} {...props}>
      {children}
    </Comp>
  );
}

export function Card({ as = "div", className = "", children, ...props }: PanelProps) {
  const Comp = as as typeof as;
  return (
    <Comp className={classJoin(["ds-card", className])} {...props}>
      {children}
    </Comp>
  );
}
