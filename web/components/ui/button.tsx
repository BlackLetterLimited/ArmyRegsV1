import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  const variantClass = variant === "ghost" ? "ds-button--ghost" : "ds-button--primary";

  return (
    <button className={`ds-button ${variantClass} ${className}`.trim()} {...props} />
  );
}

