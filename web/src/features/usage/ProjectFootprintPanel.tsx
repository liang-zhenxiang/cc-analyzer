import { useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { useFontScale } from "../settings/fontScale";
import type { SessionMeta } from "../sessions/metadataCache";
import type { PlanSelection } from "./planLimits";
import {
  buildFileFootprint,
  FOOTPRINT_FILE_SIZE,
  FOOTPRINT_PROJECT_RADIUS,
  FOOTPRINT_VIEW_HEIGHT,
  FOOTPRINT_VIEW_WIDTH,
  topSharedFiles,
  type FootprintEdge
} from "./projectFootprint";
import type { UsageSessionInput } from "./usageAggregations";
import primitives from "./charts/chartPrimitives.module.css";
import styles from "./ProjectFootprintPanel.module.css";

/**
 * 「项目文件足迹」（F7）：左圆 = 项目，右方 = 被 ≥2 个项目动过的文件。
 *
 * 两类节点靠「形状 + 所在列 + 颜色」三重区分，高对比度下形状与列仍然成立。
 * 边是承载数据的线（`--text-tertiary`，≥3:1），不是结构网格。悬停节点只压暗
 * 无关边；图形不进入 Tab 序——下方「共享最多的文件」列表是键盘与读屏的等价物。
 */

const PROJECT_LABEL_LIMIT = 16;
const FILE_LABEL_LIMIT = 22;

type Props = {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
  plan?: PlanSelection;
  onOpenSession?: (session: SessionMeta) => void;
};

type HoverTarget = { kind: "project" | "file"; id: string };

function ribbon(x1: number, y1: number, x2: number, y2: number): string {
  const bend = (x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function truncate(label: string, limit: number): string {
  const chars = Array.from(label);
  return chars.length > limit ? `${chars.slice(0, limit).join("")}…` : label;
}

export function ProjectFootprintPanel({ inputs, days, now }: Props) {
  const fontScale = useFontScale();
  // 130% 只减样本数（项目 5 / 文件 7），不缩字号、不缩节点。
  const maxProjects = fontScale > 1.2 ? 5 : 6;
  const maxFiles = fontScale > 1.2 ? 7 : 10;
  const footprint = useMemo(
    () => buildFileFootprint(inputs, days, now, { maxProjects, maxFiles }),
    [inputs, days, now, maxProjects, maxFiles]
  );
  const [hover, setHover] = useState<HoverTarget | null>(null);

  const related = useMemo(() => {
    const projects = new Set<string>();
    const files = new Set<string>();
    if (hover === null) return { projects, files };
    if (hover.kind === "project") {
      projects.add(hover.id);
      for (const edge of footprint.edges) {
        if (edge.project === hover.id) files.add(edge.file);
      }
    } else {
      files.add(hover.id);
      for (const edge of footprint.edges) {
        if (edge.file === hover.id) projects.add(edge.project);
      }
    }
    return { projects, files };
  }, [hover, footprint.edges]);

  if (footprint.emptyReason !== null) {
    const detail =
      footprint.emptyReason === "single-project"
        ? "只有 1 个项目，足迹图需要至少 2 个项目。"
        : `本窗口 ${footprint.projectCount} 个项目、${footprint.fileCount} 个文件；共享指同一个文件被 2 个以上项目动过。`;
    return (
      <Panel
        title="项目文件足迹"
        ariaLabel="项目文件足迹"
        titleAs="h3"
        actions={
          <span className={styles.scope}>{`${footprint.projectCount} 个项目`}</span>
        }
      >
        <div data-probe="lab-footprint">
          <EmptyState size="inline" title="没有跨项目共享的文件" />
          <p className={styles.emptyNote}>{detail}</p>
        </div>
      </Panel>
    );
  }

  const shared = topSharedFiles(footprint, 3);
  const top = shared[0];
  const maxEdgeTouches = Math.max(1, ...footprint.edges.map((edge) => edge.touches));
  const summary = top
    ? `文件足迹：${footprint.projectCount} 个项目共享 ${footprint.sharedCount} 个文件；共享最多的是 ${top.display}，被 ${top.projectCount} 个项目动过。`
    : `文件足迹：${footprint.projectCount} 个项目共享 ${footprint.sharedCount} 个文件。`;

  const edgeActive = (edge: FootprintEdge) =>
    hover !== null &&
    ((hover.kind === "project" && edge.project === hover.id) ||
      (hover.kind === "file" && edge.file === hover.id));

  const projectDim = (label: string) =>
    hover !== null && hover.kind !== "project" && !related.projects.has(label);
  const fileDim = (path: string) =>
    hover !== null && hover.kind !== "file" && !related.files.has(path);

  return (
    <Panel
      title="项目文件足迹"
      ariaLabel="项目文件足迹"
      titleAs="h3"
      actions={
        <span className={styles.scope}>
          {`${footprint.projectCount} 个项目 · ${footprint.sharedCount} 个共享文件`}
        </span>
      }
    >
      <div className={styles.root} data-probe="lab-footprint">
        <svg
          className={primitives.chart}
          viewBox={`0 0 ${FOOTPRINT_VIEW_WIDTH} ${FOOTPRINT_VIEW_HEIGHT}`}
          role="img"
          aria-label={summary}
        >
          {footprint.edges.map((edge) => {
            const project = footprint.projects.find((node) => node.label === edge.project);
            const file = footprint.files.find((node) => node.path === edge.file);
            if (!project || !file) return null;
            const dim = hover !== null && !edgeActive(edge);
            return (
              <path
                key={`${edge.project}|${edge.file}`}
                d={ribbon(
                  project.x + FOOTPRINT_PROJECT_RADIUS,
                  project.y,
                  file.x - FOOTPRINT_FILE_SIZE / 2,
                  file.y
                )}
                fill="none"
                strokeWidth={edgeActive(edge) ? 2 : 1 + 2 * (edge.touches / maxEdgeTouches)}
                className={`${styles.edge} ${dim ? styles.edgeDim : ""}`}
                data-probe="footprint-edge"
                data-edge={`${edge.project}|${edge.file}`}
              >
                <title>
                  {`${project.display} × ${file.display} · ${edge.touches} 次`}
                </title>
              </path>
            );
          })}

          {footprint.projects.map((project) => (
            <g
              key={project.label}
              className={`${styles.projectNode} ${projectDim(project.label) ? styles.nodeDim : ""}`}
              data-probe="footprint-project"
              onMouseEnter={() => setHover({ kind: "project", id: project.label })}
              onMouseLeave={() => setHover(null)}
            >
              <title>{project.display}</title>
              <circle
                cx={project.x}
                cy={project.y}
                r={FOOTPRINT_PROJECT_RADIUS}
                className={styles.projectCircle}
              />
              <text
                x={project.x - FOOTPRINT_PROJECT_RADIUS - 6}
                y={project.y + 4}
                textAnchor="end"
                className={styles.projectLabel}
              >
                {truncate(project.display, PROJECT_LABEL_LIMIT)}
              </text>
            </g>
          ))}

          {footprint.files.map((file) => (
            <g
              key={file.path}
              className={`${styles.fileNode} ${fileDim(file.path) ? styles.nodeDim : ""}`}
              data-probe="footprint-file"
              onMouseEnter={() => setHover({ kind: "file", id: file.path })}
              onMouseLeave={() => setHover(null)}
            >
              <title>{file.path}</title>
              <rect
                x={file.x - FOOTPRINT_FILE_SIZE / 2}
                y={file.y - FOOTPRINT_FILE_SIZE / 2}
                width={FOOTPRINT_FILE_SIZE}
                height={FOOTPRINT_FILE_SIZE}
                rx={2}
                className={styles.fileSquare}
              />
              <text
                x={file.x + FOOTPRINT_FILE_SIZE / 2 + 6}
                y={file.y + 4}
                textAnchor="start"
                className={styles.fileLabel}
              >
                {truncate(file.display, FILE_LABEL_LIMIT)}
              </text>
            </g>
          ))}
        </svg>

        <p className={styles.listTitle}>共享最多的文件</p>
        <ul className={styles.shared} aria-label="共享最多的文件">
          {shared.map((file) => (
            <li key={file.path} className={styles.sharedRow}>
              <span className={styles.sharedPath} title={file.path}>
                {file.display}
              </span>
              <span className={styles.sharedCount}>
                {`${file.projectCount} 个项目 · ${file.touches} 次`}
              </span>
            </li>
          ))}
        </ul>

        <p className={styles.footnote}>
          只统计 Read / Edit / Write / NotebookEdit 的文件路径，含子 agent 的改动（与「改动文件」
          视图同一口径）；Bash 间接改动看不见。路径按项目根缩写，完整路径在悬停里。
          {footprint.hiddenProjects > 0 ? `另有 ${footprint.hiddenProjects} 个项目未画出。` : ""}
          {footprint.hiddenFiles > 0 ? `另有 ${footprint.hiddenFiles} 个共享文件未画出。` : ""}
          {footprint.hiddenEdges > 0 ? `另有 ${footprint.hiddenEdges} 条边被截断。` : ""}
        </p>
      </div>
    </Panel>
  );
}
