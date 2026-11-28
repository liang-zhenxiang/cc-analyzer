import type { HandoffProject } from "./projectHandoff";
import styles from "./ProjectSwitchStrip.module.css";

/**
 * 项目切换条：项目档里**唯一**的项目选择器（Issue #397）。
 *
 * 它住在项目接续卡与项目记忆卡之上，两张卡都吃同一个 `activeKey`——不允许
 * 接续卡自带下拉、记忆卡自带左栏，否则选中不同步时用户会看到「上面 A、
 * 下面 B」。
 *
 * 视觉沿用记忆卡原来的 chip 几何（32px 档、选中 = 底色 + 下缘 2px 竖条），
 * 只是把竖条从「左缘」换到「下缘」：横向排列时下缘才是「当前项」的方向。
 *
 * 键盘刻意**不做 roving tabindex**：每个 chip 是原生 `<button aria-pressed>`，
 * 各自进 Tab 序。项目数通常 < 20，这里不是接续轨道那种「一个 Tab 止点」
 * 的区域——Tab 能直接落到某个项目上，比先落进组再按方向键少一步。
 */
export function ProjectSwitchStrip({
  projects,
  activeKey,
  onSelect
}: {
  projects: readonly HandoffProject[];
  activeKey: string | null;
  onSelect: (key: string) => void;
}) {
  if (projects.length === 0) return null;

  return (
    <div className={styles.strip} role="group" aria-label="项目" data-probe="handoff-toolbar">
      {/* 组已有 aria-label，视觉标签不再重复给读屏。 */}
      <span className={styles.label} aria-hidden="true">
        项目
      </span>
      <div className={styles.chips}>
        {projects.map((project) => {
          const selected = project.key === activeKey;
          return (
            <button
              key={project.key}
              type="button"
              className={styles.chip}
              aria-pressed={selected}
              // title 只放显示名：编码目录名不进任何可见文案与 title。
              title={project.name}
              data-handoff-project={project.key}
              onClick={() => onSelect(project.key)}
            >
              <span className={styles.chipName}>{project.name}</span>
              <span
                className={styles.chipSessions}
                title={`${project.sessions.toLocaleString("en-US")} 次会话`}
              >
                {project.sessions.toLocaleString("en-US")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
