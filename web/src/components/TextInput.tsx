import type { InputHTMLAttributes } from "react";
import styles from "./TextInput.module.css";

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${styles.input} ${className ?? ""}`} />;
}
