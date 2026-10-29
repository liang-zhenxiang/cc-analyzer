import type { ParsedSession, SessionRecord } from "../sessions/types";
import { extractFileActivities } from "../sessions/changedFiles";
import { basename } from "../../lib/path";
import { formatProjectPath } from "../../lib/format";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";

/**
 * 项目 ↔ 共享文件足迹（Round FF F7）的纯逻辑。
 *
 * 口径（与「改动文件」视图**同一份事实**）：
 * - 提取复用 `extractFileActivities(parsed)`——Read / Edit / Write / NotebookEdit、
 *   含内联子 agent 的调用；Bash 间接改文件两类数据源都看不见。
 * - `FileFact.touchTimestamps` 只收**成功**调用（失败调用在「改动文件」里也不进
 *   counts），窗口过滤按这些时间戳逐次计数，因此 30 天窗口不会把窗口外的旧触碰
 *   算进来。
 * - 共享 = 同一个**绝对路径**在窗口内被 ≥2 个项目触碰。只看 basename 会把
 *   两个仓库里同名的 `index.ts` 误判成一个文件，所以键是完整路径；展示层才
 *   缩写为项目内相对路径（完整路径只进 `<title>`，与既有隐私约定一致）。
 */

/** 一个会话里一个文件的成功触碰（窗口过滤的最小单位）。 */
export type FileFact = {
  /** 完整路径：只用于匹配与悬停 title，不常显。 */
  path: string;
  /** 会话 cwd 内 → 相对路径；否则原路径（`toRelativePath` 的口径）。 */
  relPath: string;
  /** 成功触碰的时间戳，升序；失败调用不进（与「改动文件」的 counts 同口径）。 */
  touchTimestamps: readonly number[];
  /** 其中来自子 agent 的成功触碰数。 */
  sidechainCount: number;
};

/**
 * 从一次解析结果提取文件事实。路径/工具判定全部交给 `extractFileActivities`，
 * 这里只补「每次成功触碰发生在什么时候」——那是窗口计数唯一需要、而
 * `FileActivity` 没有直接给出的信息。`recordIds` 已由它按路径筛好，据此回查
 * 时间戳不会另生一套口径。
 */
export function extractFileFacts(parsed: ParsedSession): FileFact[] {
  const activities = extractFileActivities(parsed);
  if (activities.length === 0) return [];

  const byId = new Map<string, SessionRecord>();
  for (const record of parsed.records) byId.set(record.fullId, record);
  for (const record of parsed.sidechainMessages) byId.set(record.fullId, record);

  return activities.map((activity) => {
    const timestamps: number[] = [];
    for (const id of activity.recordIds) {
      const record = byId.get(id);
      if (!record || record.isError) continue;
      timestamps.push(record.timestamp);
    }
    timestamps.sort((left, right) => left - right);
    return {
      path: activity.path,
      relPath: activity.relPath,
      touchTimestamps: timestamps,
      sidechainCount: activity.sidechainCount
    };
  });
}

/** 图上左列项目节点。 */
export type FootprintProjectNode = {
  label: string;
  display: string;
  /** 窗口内成功触碰总数。 */
  touches: number;
  x: number;
  y: number;
};

/** 图上右列共享文件节点。 */
export type FootprintFileNode = {
  path: string;
  /** 项目内相对路径；都在项目外时退回 basename。 */
  display: string;
  touches: number;
  /** 触碰它的项目数（≥2 才会成为节点）。 */
  projectCount: number;
  x: number;
  y: number;
};

/** 项目 → 文件的一条边。 */
export type FootprintEdge = {
  project: string;
  file: string;
  touches: number;
};

export type FootprintEmptyReason = "no-projects" | "single-project" | "no-shared";

export type FileFootprint = {
  projects: FootprintProjectNode[];
  files: FootprintFileNode[];
  edges: FootprintEdge[];
  /** 窗口内有文件活动的项目总数（截断前）。 */
  projectCount: number;
  /** 窗口内被触碰过的文件总数（截断前，含只被一个项目碰的）。 */
  fileCount: number;
  /** 共享文件总数（截断前）。 */
  sharedCount: number;
  hiddenProjects: number;
  hiddenFiles: number;
  hiddenEdges: number;
  emptyReason: FootprintEmptyReason | null;
};

export const FOOTPRINT_VIEW_WIDTH = 600;
export const FOOTPRINT_VIEW_HEIGHT = 320;
export const FOOTPRINT_PROJECT_X = 150;
export const FOOTPRINT_FILE_X = 450;
export const FOOTPRINT_PROJECT_RADIUS = 6;
export const FOOTPRINT_FILE_SIZE = 10;
/** 两列各自的垂直范围：上方 24、下方 296，留出标签与裁切的余量。 */
const COLUMN_TOP = 24;
const COLUMN_BOTTOM = 296;
const MIN_ROW_GAP = 18;
const CENTER_Y = FOOTPRINT_VIEW_HEIGHT / 2;

export const DEFAULT_MAX_PROJECTS = 6;
export const DEFAULT_MAX_FILES = 10;
export const DEFAULT_MAX_EDGES = 24;

export type FootprintLimits = {
  maxProjects?: number;
  maxFiles?: number;
  maxEdges?: number;
};

type ProjectAcc = { label: string; display: string; touches: number };
type FileAcc = {
  path: string;
  touches: number;
  byProject: Map<string, number>;
  relCandidates: string[];
};

/**
 * 等距铺开 n 个节点。节点少时按最小间距 18 居中，节点多时铺满整列——
 * 「宁可少画也不挤」的截断在上层完成，这里只负责几何。
 */
function spread(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [CENTER_Y];
  const step = Math.max(MIN_ROW_GAP, (COLUMN_BOTTOM - COLUMN_TOP) / (n - 1));
  const total = step * (n - 1);
  const start = CENTER_Y - total / 2;
  return Array.from({ length: n }, (_, index) => start + index * step);
}

/**
 * 展示路径：优先用「项目内相对路径」里最短的一条；所有触碰都发生在项目根
 * 之外时退回 basename——把完整绝对路径常显出来等于把用户路径写进画面。
 */
function displayPathOf(path: string, relCandidates: readonly string[]): string {
  const relative = relCandidates.filter((candidate) => candidate.length > 0 && candidate !== path);
  if (relative.length === 0) return basename(path);
  return relative.reduce((shortest, candidate) =>
    candidate.length < shortest.length ? candidate : shortest
  );
}

function windowStartOf(days: number, now: number): number {
  const windowDays = Math.max(1, Math.floor(days));
  return addLocalDays(dayStartOf(now), -(windowDays - 1));
}

/**
 * 窗口化聚合 + 确定性布局。`now` 显式传入（Lab 用挂载时刻，不每 30 秒重算）。
 */
export function buildFileFootprint(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number,
  limits: FootprintLimits = {}
): FileFootprint {
  const maxProjects = Math.max(2, limits.maxProjects ?? DEFAULT_MAX_PROJECTS);
  const maxFiles = Math.max(1, limits.maxFiles ?? DEFAULT_MAX_FILES);
  const maxEdges = Math.max(1, limits.maxEdges ?? DEFAULT_MAX_EDGES);
  const startTs = windowStartOf(days, now);

  const projects = new Map<string, ProjectAcc>();
  const files = new Map<string, FileAcc>();

  inputs.forEach((input, index) => {
    const facts = input.fileFacts;
    if (!facts || facts.length === 0) return;
    const projectKey = input.projectLabel || `input-${index}`;

    // 先建项目条目：一个项目就算所有触碰都在窗口外，也不该出现在图上。
    let project = projects.get(projectKey);
    if (!project) {
      project = {
        label: projectKey,
        display: formatProjectPath(input.projectLabel || projectKey, input.projectPath),
        touches: 0
      };
      projects.set(projectKey, project);
    }

    for (const fact of facts) {
      let inWindow = 0;
      for (const timestamp of fact.touchTimestamps) {
        if (timestamp >= startTs) inWindow += 1;
      }
      if (inWindow === 0) continue;

      project.touches += inWindow;

      let file = files.get(fact.path);
      if (!file) {
        file = { path: fact.path, touches: 0, byProject: new Map(), relCandidates: [] };
        files.set(fact.path, file);
      }
      file.touches += inWindow;
      file.byProject.set(projectKey, (file.byProject.get(projectKey) ?? 0) + inWindow);
      file.relCandidates.push(fact.relPath);
    }
  });

  const activeProjects = [...projects.values()].filter((project) => project.touches > 0);
  const shared = [...files.values()].filter((file) => file.byProject.size >= 2);

  const fileCount = [...files.values()].length;
  const sharedCount = shared.length;

  let emptyReason: FootprintEmptyReason | null = null;
  if (activeProjects.length === 0) emptyReason = "no-projects";
  else if (activeProjects.length < 2) emptyReason = "single-project";
  else if (sharedCount === 0) emptyReason = "no-shared";

  if (emptyReason !== null) {
    return {
      projects: [],
      files: [],
      edges: [],
      projectCount: activeProjects.length,
      fileCount,
      sharedCount,
      hiddenProjects: 0,
      hiddenFiles: 0,
      hiddenEdges: 0,
      emptyReason
    };
  }

  // 显示名撞车（同一仓库的不同 worktree）时补上编码名，否则两个节点无法区分。
  const displayCounts = new Map<string, number>();
  for (const project of activeProjects) {
    displayCounts.set(project.display, (displayCounts.get(project.display) ?? 0) + 1);
  }
  const displayOf = (project: ProjectAcc) =>
    (displayCounts.get(project.display) ?? 0) > 1
      ? `${project.display} · ${project.label}`
      : project.display;

  const sortedProjects = [...activeProjects].sort(
    (left, right) => right.touches - left.touches || left.label.localeCompare(right.label)
  );
  const sortedFiles = [...shared].sort(
    (left, right) => right.touches - left.touches || left.path.localeCompare(right.path)
  );

  const selectedProjects = sortedProjects.slice(0, maxProjects);
  const selectedFiles = sortedFiles.slice(0, maxFiles);
  const selectedProjectKeys = new Set(selectedProjects.map((project) => project.label));
  const selectedFilePaths = new Set(selectedFiles.map((file) => file.path));

  const allEdges: FootprintEdge[] = [];
  for (const file of selectedFiles) {
    for (const [projectKey, touches] of file.byProject) {
      if (!selectedProjectKeys.has(projectKey)) continue;
      allEdges.push({ project: projectKey, file: file.path, touches });
    }
  }
  allEdges.sort(
    (left, right) =>
      right.touches - left.touches ||
      left.file.localeCompare(right.file) ||
      left.project.localeCompare(right.project)
  );
  const edges = allEdges.slice(0, maxEdges);

  const projectYs = spread(selectedProjects.length);
  const fileYs = spread(selectedFiles.length);

  // 落在已选节点之间的全部边 vs 实际画出的：被 24 条上限截掉的都算「未画」。
  let withinSelectedEdges = 0;
  for (const file of shared) {
    if (!selectedFilePaths.has(file.path)) continue;
    for (const projectKey of file.byProject.keys()) {
      if (selectedProjectKeys.has(projectKey)) withinSelectedEdges += 1;
    }
  }

  return {
    projects: selectedProjects.map((project, index) => ({
      label: project.label,
      display: displayOf(project),
      touches: project.touches,
      x: FOOTPRINT_PROJECT_X,
      y: projectYs[index]
    })),
    files: selectedFiles.map((file, index) => ({
      path: file.path,
      display: displayPathOf(file.path, file.relCandidates),
      touches: file.touches,
      projectCount: file.byProject.size,
      x: FOOTPRINT_FILE_X,
      y: fileYs[index]
    })),
    edges,
    projectCount: activeProjects.length,
    fileCount,
    sharedCount,
    hiddenProjects: activeProjects.length - selectedProjects.length,
    hiddenFiles: sharedCount - selectedFiles.length,
    hiddenEdges: withinSelectedEdges - edges.length,
    emptyReason: null
  };
}

/** 最强的三条共享事实（图下方列表与读屏等价物）。 */
export function topSharedFiles(
  footprint: FileFootprint,
  limit = 3
): FootprintFileNode[] {
  return [...footprint.files]
    .sort((left, right) => right.touches - left.touches || left.path.localeCompare(right.path))
    .slice(0, limit);
}
