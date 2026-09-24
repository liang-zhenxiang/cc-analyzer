import styles from "./StatusToast.module.css";

export type ToastTone = "success" | "error";
export type Toast = { id: string; message: string; tone: ToastTone };

export function StatusToast({ toasts }: { toasts: Toast[] }) {
  return (
    <div className={styles.container} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <output key={toast.id} className={`${styles.toast} ${styles[toast.tone]}`}>
          {toast.message}
        </output>
      ))}
    </div>
  );
}
