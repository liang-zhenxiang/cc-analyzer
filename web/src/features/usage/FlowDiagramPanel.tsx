import { useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { formatTokenCount } from "../../lib/format";
import type {
  FlowCategory,
  FlowDiagram,
  FlowNode,
  ModelCategoryLink,
  ProjectModelLink
} from "./flowDiagram";
import styles from "./FlowDiagramPanel.module.css";

/**
 * F1「Token 流向」：项目 → 模型 → 四类计数器。
 *
 * 纯 SVG，零依赖（不引 chart 库）——这是本次改动唯一的「新画法」，用
 * `--chart-N` 与既有的 stroke-opacity 语言把三层流量画出来。节点值全部来自
 * `buildFlowDiagram` 的交叉表，所以每个节点 = 它两侧连线的和，不会出现
 * 「节点 100、连线 80」的漂移。
 *
 * 交互：悬停一条连线，高亮它经过的路径（项目→模型→该模型分出的四类计数器；
 * 或模型←各项目 + 该模型→某计数器），其余线条降透明度。数据探针
 * `data-flow-link` / `data-flow-link-active` / `data-flow-hit` / `data-flow-node`
 * 供组件测试用，不依赖 DOM 结构。
 */

const WIDTH = 960;
const HEIGHT = 440;
const TOP = 40;
const BOTTOM = 20;
const BAR_WIDTH = 10;
const GAP = 30;
const MIN_BAR = 8;
const MIN_LINK_WIDTH = 1.4;
const PROJECT_X = 190;
const MODEL_X = 490;
const CATEGORY_X = 790;

type PlacedNode = { node: FlowNode; y: number; height: number };
type Band = { center: number; width: number };
type RibbonLink = {
  id: string;
  title: string;
  d: string;
  width: number;
  tone: number;
};

function stackNodes(nodes: FlowNode[], total: number): PlacedNode[] {
  if (nodes.length === 0) return [];
  const gap = nodes.length > 1 ? GAP : 0;
  const usable = Math.max(1, HEIGHT - TOP - BOTTOM - gap * (nodes.length - 1));
  const rawHeights = nodes.map((node) => Math.max(MIN_BAR, (node.value / total) * usable));
  const rawSum = rawHeights.reduce((sum, value) => sum + value, 0);
  const scale = rawSum > usable ? usable / rawSum : 1;
  const heights = rawHeights.map((value) => value * scale);
  const content = heights.reduce((sum, value) => sum + value, 0) + gap * (nodes.length - 1);
  const placed: PlacedNode[] = [];
  let y = TOP + Math.max(0, (HEIGHT - TOP - BOTTOM - content) / 2);
  nodes.forEach((node, index) => {
    placed.push({ node, y, height: heights[index] });
    y += heights[index] + gap;
  });
  return placed;
}

function groupById<L extends { id: string; value: number }>(
  links: ReadonlyArray<L>,
  end: (link: L) => string
): Map<string, L[]> {
  const groups = new Map<string, L[]>();
  for (const link of links) {
    const key = end(link);
    const list = groups.get(key);
    if (list) {
      list.push(link);
    } else {
      groups.set(key, [link]);
    }
  }
  return groups;
}

/** Lays out link bands along a node's bar; the link order fixes the stacking. */
function bandLayout<L extends { id: string; value: number }>(
  placed: PlacedNode[],
  groups: Map<string, L[]>
): Map<string, Band> {
  const bands = new Map<string, Band>();
  for (const place of placed) {
    const links = groups.get(place.node.id);
    if (!links || links.length === 0) continue;
    const sum = links.reduce((total, link) => total + link.value, 0);
    let offset = place.y;
    for (const link of links) {
      const height = sum > 0 ? (place.height * link.value) / sum : place.height;
      bands.set(link.id, { center: offset + height / 2, width: Math.max(height, MIN_LINK_WIDTH) });
      offset += height;
    }
  }
  return bands;
}

function ribbon(x1: number, y1: number, x2: number, y2: number): string {
  const bend = (x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function NodeBar({
  place,
  x,
  labelX,
  textAnchor,
  above = false
}: {
  place: PlacedNode;
  x: number;
  labelX: number;
  textAnchor: "start" | "end";
  /** Middle-column labels sit above the bar so ribbons never run under text. */
  above?: boolean;
}) {
  const rect = (
    <rect
      x={x}
      y={place.y}
      width={BAR_WIDTH}
      height={Math.max(place.height, MIN_BAR)}
      rx={2}
      className={styles.bar}
      data-flow-node={place.node.id}
    />
  );
  if (above) {
    const text = `${place.node.label} ${formatTokenCount(place.node.value)}`;
    return (
      <>
        {rect}
        <text
          x={x + BAR_WIDTH / 2}
          y={place.y - 6}
          textAnchor="middle"
          className={styles.label}
        >
          {text}
        </text>
      </>
    );
  }
  return (
    <>
      {rect}
      <text x={labelX} y={place.y + place.height / 2 + 4} textAnchor={textAnchor} className={styles.label}>
        <tspan>{place.node.label}</tspan>
        <tspan dx={6} className={styles.value}>
          {formatTokenCount(place.node.value)}
        </tspan>
      </text>
    </>
  );
}

function Ribbon({
  link,
  active,
  dim
}: {
  link: RibbonLink;
  active: boolean;
  dim: boolean;
}) {
  const className = [styles.link, active ? styles.active : dim ? styles.dim : null]
    .filter(Boolean)
    .join(" ");
  return (
    <path
      d={link.d}
      fill="none"
      strokeWidth={active ? Math.max(link.width * 1.7, 2.4) : link.width}
      style={{ stroke: `var(--chart-${link.tone})` }}
      className={className}
      data-flow-link={link.id}
      data-flow-link-active={active ? "true" : undefined}
      aria-hidden="true"
    >
      <title>{link.title}</title>
    </path>
  );
}

export function FlowDiagramPanel({ diagram }: { diagram: FlowDiagram }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const hoveredLink = useMemo(() => {
    if (!hovered) return null;
    return (
      diagram.projectToModel.find((link) => link.id === hovered) ??
      diagram.modelToCategory.find((link) => link.id === hovered) ??
      null
    );
  }, [diagram, hovered]);

  const activeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!hoveredLink) return ids;
    ids.add(hoveredLink.id);
    if (hoveredLink.kind === "project-model") {
      for (const link of diagram.modelToCategory) {
        if (link.model === hoveredLink.model) ids.add(link.id);
      }
    } else {
      for (const link of diagram.projectToModel) {
        if (link.model === hoveredLink.model) ids.add(link.id);
      }
    }
    return ids;
  }, [diagram, hoveredLink]);

  const layout = useMemo(() => {
    if (diagram.total <= 0) return null;
    const projects = stackNodes(diagram.projects, diagram.total);
    const models = stackNodes(diagram.models, diagram.total);
    const categories = stackNodes(diagram.categories, diagram.total);
    const projectTone = new Map(diagram.projects.map((node) => [node.raw, node.tone]));
    const categoryTone = new Map(diagram.categories.map((node) => [node.raw, node.tone]));

    const projectOut = bandLayout(projects, groupById(diagram.projectToModel, (link) => link.from));
    const modelIn = bandLayout(models, groupById(diagram.projectToModel, (link) => link.to));
    const modelOut = bandLayout(models, groupById(diagram.modelToCategory, (link) => link.from));
    const categoryIn = bandLayout(categories, groupById(diagram.modelToCategory, (link) => link.to));

    const labels = new Map<string, string>();
    for (const node of [...diagram.projects, ...diagram.models, ...diagram.categories]) {
      labels.set(node.id, node.label);
    }
    const titleOf = (from: string, to: string, value: number) =>
      `${labels.get(from) ?? from} → ${labels.get(to) ?? to}：${formatTokenCount(value)} tok`;

    const projectLinks: RibbonLink[] = diagram.projectToModel.flatMap((link: ProjectModelLink) => {
      const out = projectOut.get(link.id);
      const into = modelIn.get(link.id);
      if (!out || !into) return [];
      return [
        {
          id: link.id,
          title: titleOf(link.from, link.to, link.value),
          d: ribbon(PROJECT_X + BAR_WIDTH, out.center, MODEL_X, into.center),
          width: Math.max(out.width, into.width, MIN_LINK_WIDTH),
          tone: projectTone.get(link.project) ?? 1
        }
      ];
    });

    const modelLinks: RibbonLink[] = diagram.modelToCategory.flatMap((link: ModelCategoryLink) => {
      const out = modelOut.get(link.id);
      const into = categoryIn.get(link.id);
      if (!out || !into) return [];
      const category: FlowCategory = link.category;
      return [
        {
          id: link.id,
          title: titleOf(link.from, link.to, link.value),
          d: ribbon(MODEL_X + BAR_WIDTH, out.center, CATEGORY_X, into.center),
          width: Math.max(out.width, into.width, MIN_LINK_WIDTH),
          tone: categoryTone.get(category) ?? 1
        }
      ];
    });

    return { projects, models, categories, projectLinks, modelLinks };
  }, [diagram]);

  if (diagram.total <= 0 || !layout) {
    return (
      <div data-probe="flow-root">
        <Panel title="Token 流向" ariaLabel="Token 流向">
          <EmptyState size="inline" title="所选范围内暂无消耗流向" />
        </Panel>
      </div>
    );
  }

  const figureLabel = `Token 从 ${diagram.projects.length} 个项目流向 ${diagram.models.length} 个模型和 ${diagram.categories.length} 类计数器`;
  const links = [...layout.projectLinks, ...layout.modelLinks];

  return (
    <div data-probe="flow-root">
      <Panel title="Token 流向" ariaLabel="Token 流向">
        <svg
          className={styles.chart}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={figureLabel}
        >
          <text x={PROJECT_X + BAR_WIDTH / 2} y={20} textAnchor="middle" className={styles.axis}>
            项目
          </text>
          <text x={MODEL_X + BAR_WIDTH / 2} y={20} textAnchor="middle" className={styles.axis}>
            模型
          </text>
          <text x={CATEGORY_X + BAR_WIDTH / 2} y={20} textAnchor="middle" className={styles.axis}>
            计数器
          </text>

          {links.map((link) => (
            <Ribbon
              key={link.id}
              link={link}
              active={activeIds.has(link.id)}
              dim={activeIds.size > 0 && !activeIds.has(link.id)}
            />
          ))}

          {/* 命中区：透明加宽线，让 1.4px 的细线也能被指到。不承载任何读屏信息。 */}
          {links.map((link) => (
            <path
              key={`hit-${link.id}`}
              d={link.d}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(link.width + 8, 12)}
              className={styles.hit}
              data-flow-hit={link.id}
              onMouseEnter={() => setHovered(link.id)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}

          {layout.projects.map((place) => (
            <NodeBar
              key={place.node.id}
              place={place}
              x={PROJECT_X}
              labelX={PROJECT_X - 8}
              textAnchor="end"
            />
          ))}
          {layout.models.map((place) => (
            <NodeBar
              key={place.node.id}
              place={place}
              x={MODEL_X}
              labelX={MODEL_X - 8}
              textAnchor="end"
              above
            />
          ))}
          {layout.categories.map((place) => (
            <NodeBar
              key={place.node.id}
              place={place}
              x={CATEGORY_X}
              labelX={CATEGORY_X + BAR_WIDTH + 8}
              textAnchor="start"
            />
          ))}
        </svg>
        <p className={styles.caption}>线宽按 token 量缩放；悬停一条线可追踪它经过的路径。</p>
      </Panel>
    </div>
  );
}
