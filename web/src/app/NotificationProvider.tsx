import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { StatusToast, type Toast } from "../components/StatusToast";

type Tone = "success" | "error";
type NotificationValue = { notify: (message: string, tone?: Tone) => void };

const Context = createContext<NotificationValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef(new Set<number>());

  const notify = useCallback((message: string, tone: Tone = "success") => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, tone }]);
    const timerId = window.setTimeout(() => {
      timersRef.current.delete(timerId);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
    timersRef.current.add(timerId);
  }, []);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      timersRef.current.clear();
    };
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <Context.Provider value={value}>
      {children}
      <StatusToast toasts={toasts} />
    </Context.Provider>
  );
}

export function useNotifications() {
  const context = useContext(Context);
  if (!context) throw new Error("useNotifications 必须在 NotificationProvider 内使用");
  return context;
}
