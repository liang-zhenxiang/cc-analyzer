import type { WorkspaceTab } from "./AppShell";
import { SegmentedControl, type SegmentedItem } from "../components/SegmentedControl";
import styles from "./AppShell.module.css";

const tabs: SegmentedItem<WorkspaceTab>[] = [
  { value: "analyzer", label: "会话分析" },
  { value: "usage", label: "用量总览" },
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
    <SegmentedControl
      items={tabs}
      value={value}
      onChange={onChange}
      ariaLabel="页面切换"
      variant="wide"
      className={styles.workspaceTabs}
    />
  );
}
