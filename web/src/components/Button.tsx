import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      {...props}
      className={[styles.button, styles[variant], className].filter(Boolean).join(" ")}
    />
  );
}

/**
 * 只有图标的按钮。
 *
 * `label` 是必填的：它是可访问名，也是 tooltip——把两者绑在一起，
 * 「这个图标什么意思」就不会只写在某人的记忆里。
 */
export function IconButton({
  label,
  className,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      {...props}
      variant="ghost"
      className={[styles.icon, className].filter(Boolean).join(" ")}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}
