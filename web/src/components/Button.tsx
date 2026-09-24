import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <button
      {...props}
      className={[styles.button, styles[variant], className].filter(Boolean).join(" ")}
    />
  );
}
