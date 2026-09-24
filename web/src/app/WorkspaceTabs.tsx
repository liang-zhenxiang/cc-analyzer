import type { WorkspaceTab } from "./AppShell";
import styles from "./AppShell.module.css";

const tabs: Array<{ value: WorkspaceTab; label: string }> = [
  { value: "analyzer", label: "会话分析" },
  { value: "monitor", label: "实时监控" }
];

export function WorkspaceTabs({
  value,
  onChange
}: {
  value: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
}) {
  return (
    <nav className={styles.workspaceTabs} role="tablist" aria-label="页面切换">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
