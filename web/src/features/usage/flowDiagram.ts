import { formatModelId, formatProjectPath } from "../../lib/format";
import {
  OTHER_LABEL,
  totalsSum,
  type RangeAggregate
} from "./usageAggregations";

/**
 * Token flow diagram (F1): project → model → token counter.
 *
 * Three columns, two link sets. Values are the four counters summed, because a
 * Sankey's width is a single quantity — the four-way split appears once, at
 * the last column, where each counter gets its own node.
 *
 * The numbers come from `range.cross` (project × model × four counters, built
 * in the same windowed pass as the rest of the range). Node values are summed
 * *from the cross-tab* rather than copied from `topProjects` / `topModels`, so
 * every node equals its incident links and the two layers cannot drift apart:
 * a project's cross sum is the same set `tokenTotalsOf` sums, which is exactly
 * what its `projects` bucket holds.
 *
 * Long tails are folded exactly like the bars above it: any project or model
 * outside `topProjects` / `topModels` joins the `其他` node, so the diagram is
 * bounded (≤ 7 + 7 + 4 nodes) without hiding tokens.
 */

/** The three columns, left to right. */
export type FlowLayer = "project" | "model" | "category";

/** The four counters, in display order (input → output → cache write → read). */
export const FLOW_CATEGORIES = ["input", "output", "cacheCreation", "cacheRead"] as const;
export type FlowCategory = (typeof FLOW_CATEGORIES)[number];

export const FLOW_CATEGORY_LABELS: Record<FlowCategory, string> = {
  input: "输入",
  output: "输出",
  cacheCreation: "缓存写入",
  cacheRead: "缓存读取"
};

export type FlowNode = {
  /** Stable DOM key, e.g. `project:-repo-alpha`. */
  id: string;
  layer: FlowLayer;
  /** Display label: project basename, short model name, counter name. */
  label: string;
  /** Underlying key: project label, raw model id, category key. */
  raw: string;
  /** Total tokens through this node. */
  value: number;
  /** 1-based `--chart-N` tone (cycles 1–6 for project/model, 1–4 for counters). */
  tone: number;
};

type FlowLinkBase = {
  id: string;
  from: string;
  to: string;
  value: number;
};

export type ProjectModelLink = FlowLinkBase & {
  kind: "project-model";
  project: string;
  model: string;
};

export type ModelCategoryLink = FlowLinkBase & {
  kind: "model-category";
  model: string;
  category: FlowCategory;
};

export type FlowDiagram = {
  projects: FlowNode[];
  models: FlowNode[];
  categories: FlowNode[];
  projectToModel: ProjectModelLink[];
  modelToCategory: ModelCategoryLink[];
  /** Tokens represented by the diagram; `0` means "nothing to draw". */
  total: number;
};

function emptyDiagram(): FlowDiagram {
  return {
    projects: [],
    models: [],
    categories: [],
    projectToModel: [],
    modelToCategory: [],
    total: 0
  };
}

/** Adds to a counter map; `Map.get` + `set` keeps the helper allocation-free. */
function bump<K>(map: Map<K, number>, key: K, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

/**
 * Ordered node keys: the Top-N labels first (so `其他` stays last), then any
 * keys the cross-tab has but the slices do not — a hand-built range may be
 * narrower than its cross-tab, and dropping those tokens would be a lie.
 */
function orderedKeys(labels: readonly string[], values: ReadonlyMap<string, number>): string[] {
  const seen = new Set(labels);
  const extra: string[] = [];
  for (const key of values.keys()) {
    if (!seen.has(key)) {
      seen.add(key);
      extra.push(key);
    }
  }
  return [...labels, ...extra];
}

export function buildFlowDiagram(
  range: RangeAggregate,
  projectPaths: Map<string, string | undefined>
): FlowDiagram {
  const cross = range.cross;
  if (!cross || cross.size === 0) return emptyDiagram();

  const projectLabels = range.topProjects.map((slice) => slice.label);
  const modelLabels = range.topModels.map((slice) => slice.label);
  const projectSet = new Set(projectLabels);
  const modelSet = new Set(modelLabels);
  const projectKeyOf = (raw: string) => (projectSet.has(raw) ? raw : OTHER_LABEL);
  const modelKeyOf = (raw: string) => (modelSet.has(raw) ? raw : OTHER_LABEL);

  const projectValues = new Map<string, number>();
  const modelValues = new Map<string, number>();
  const categoryValues = new Map<FlowCategory, number>();
  const pairValues = new Map<string, Map<string, number>>();
  const modelSplits = new Map<string, Map<FlowCategory, number>>();

  for (const [rawProject, byModel] of cross) {
    const projectKey = projectKeyOf(rawProject);
    for (const [rawModel, totals] of byModel) {
      const value = totalsSum(totals);
      if (value <= 0) continue;
      const modelKey = modelKeyOf(rawModel);

      bump(projectValues, projectKey, value);
      bump(modelValues, modelKey, value);
      let row = pairValues.get(projectKey);
      if (!row) {
        row = new Map();
        pairValues.set(projectKey, row);
      }
      row.set(modelKey, (row.get(modelKey) ?? 0) + value);

      let split = modelSplits.get(modelKey);
      if (!split) {
        split = new Map();
        modelSplits.set(modelKey, split);
      }
      for (const category of FLOW_CATEGORIES) {
        const amount = totals[category];
        if (amount <= 0) continue;
        split.set(category, (split.get(category) ?? 0) + amount);
        bump(categoryValues, category, amount);
      }
    }
  }

  const projectNodes: FlowNode[] = orderedKeys(projectLabels, projectValues)
    .filter((key) => (projectValues.get(key) ?? 0) > 0)
    .map((key, index) => ({
      id: `project:${key}`,
      layer: "project",
      label: formatProjectPath(key, projectPaths.get(key)),
      raw: key,
      value: projectValues.get(key) ?? 0,
      tone: (index % 6) + 1
    }));

  const modelNodes: FlowNode[] = orderedKeys(modelLabels, modelValues)
    .filter((key) => (modelValues.get(key) ?? 0) > 0)
    .map((key, index) => ({
      id: `model:${key}`,
      layer: "model",
      label: formatModelId(key),
      raw: key,
      value: modelValues.get(key) ?? 0,
      tone: (index % 6) + 1
    }));

  const categoryNodes: FlowNode[] = FLOW_CATEGORIES.map((category, index) => ({
    id: `category:${category}`,
    layer: "category" as const,
    label: FLOW_CATEGORY_LABELS[category],
    raw: category,
    value: categoryValues.get(category) ?? 0,
    tone: index + 1
  })).filter((node) => node.value > 0);

  const projectToModel: ProjectModelLink[] = [];
  for (const project of projectNodes) {
    const row = pairValues.get(project.raw);
    if (!row) continue;
    for (const model of modelNodes) {
      const value = row.get(model.raw);
      if (!value) continue;
      projectToModel.push({
        id: `pm:${project.raw}::${model.raw}`,
        kind: "project-model",
        from: project.id,
        to: model.id,
        project: project.raw,
        model: model.raw,
        value
      });
    }
  }

  const modelToCategory: ModelCategoryLink[] = [];
  for (const model of modelNodes) {
    const split = modelSplits.get(model.raw);
    if (!split) continue;
    for (const category of FLOW_CATEGORIES) {
      const value = split.get(category);
      if (!value) continue;
      modelToCategory.push({
        id: `mc:${model.raw}::${category}`,
        kind: "model-category",
        from: model.id,
        to: `category:${category}`,
        model: model.raw,
        category,
        value
      });
    }
  }

  const total = projectNodes.reduce((sum, node) => sum + node.value, 0);
  if (total <= 0) return emptyDiagram();

  return {
    projects: projectNodes,
    models: modelNodes,
    categories: categoryNodes,
    projectToModel,
    modelToCategory,
    total
  };
}
