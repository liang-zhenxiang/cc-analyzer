import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import {
  aggregateRange,
  type ProjectModelCross,
  type RangeAggregate,
  type UsageSessionInput,
  type UsageSlice,
  type UsageTotals
} from "./usageAggregations";
import { FLOW_CATEGORY_LABELS, buildFlowDiagram, type FlowDiagram } from "./flowDiagram";

/** Local noon, so every fixture record lands on the same calendar day. */
const T0 = new Date(2026, 9, 26, 12, 0, 0).getTime();

function totals(
  input: number,
  output: number,
  cacheCreation: number,
  cacheRead: number
): UsageTotals {
  return { input, output, cacheCreation, cacheRead };
}

function record(partial: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "r",
    fullId: "r",
    kind: "assistant",
    timestamp: T0 - 60_000,
    durationMs: 0,
    text: "",
    isError: false,
    raw: null,
    ...partial
  };
}

function rangeOf(
  topProjects: UsageSlice[],
  topModels: UsageSlice[],
  cross?: ProjectModelCross
): RangeAggregate {
  return {
    sessionCount: 0,
    messages: 0,
    totals: totals(0, 0, 0, 0),
    daily: new Map(),
    models: new Map(),
    projects: new Map(),
    hourly: [],
    dailySeries: [],
    topProjects,
    topModels,
    kpi: { sessions: 0, messages: 0, tokens: 0 },
    ...(cross ? { cross } : {})
  };
}

function linkSum(diagram: FlowDiagram, kind: "project-model" | "model-category"): number {
  const links = kind === "project-model" ? diagram.projectToModel : diagram.modelToCategory;
  return links.reduce((sum, link) => sum + link.value, 0);
}

describe("buildFlowDiagram", () => {
  it("returns an empty diagram when the range has no cross-tab", () => {
    const withoutCross = buildFlowDiagram(rangeOf([{ label: "-a", value: 100 }], []), new Map());
    expect(withoutCross).toEqual({
      projects: [],
      models: [],
      categories: [],
      projectToModel: [],
      modelToCategory: [],
      total: 0
    });

    const emptyCross = buildFlowDiagram(
      rangeOf([{ label: "-a", value: 100 }], [{ label: "claude-sonnet-4", value: 100 }], new Map()),
      new Map()
    );
    expect(emptyCross.total).toBe(0);
    expect(emptyCross.projectToModel).toEqual([]);
  });

  it("splits one project's tokens across its model and the four counters", () => {
    const cross: ProjectModelCross = new Map([
      ["-repo-alpha", new Map([["claude-sonnet-4-5-20250929", totals(10, 20, 30, 40)]])]
    ]);
    const diagram = buildFlowDiagram(
      rangeOf(
        [{ label: "-repo-alpha", value: 100 }],
        [{ label: "claude-sonnet-4-5-20250929", value: 100 }],
        cross
      ),
      new Map()
    );

    expect(diagram.total).toBe(100);
    expect(diagram.projects).toHaveLength(1);
    expect(diagram.projects[0]).toMatchObject({
      id: "project:-repo-alpha",
      layer: "project",
      label: "repo-alpha",
      value: 100,
      tone: 1
    });
    expect(diagram.models[0]).toMatchObject({
      id: "model:claude-sonnet-4-5-20250929",
      label: "Sonnet 4.5",
      value: 100
    });
    expect(diagram.categories.map((node) => [node.raw, node.label, node.value, node.tone])).toEqual([
      ["input", FLOW_CATEGORY_LABELS.input, 10, 1],
      ["output", FLOW_CATEGORY_LABELS.output, 20, 2],
      ["cacheCreation", FLOW_CATEGORY_LABELS.cacheCreation, 30, 3],
      ["cacheRead", FLOW_CATEGORY_LABELS.cacheRead, 40, 4]
    ]);

    expect(diagram.projectToModel).toHaveLength(1);
    expect(diagram.projectToModel[0]).toMatchObject({
      kind: "project-model",
      from: "project:-repo-alpha",
      to: "model:claude-sonnet-4-5-20250929",
      project: "-repo-alpha",
      model: "claude-sonnet-4-5-20250929",
      value: 100
    });
    expect(diagram.modelToCategory).toHaveLength(4);
    expect(diagram.modelToCategory.map((link) => link.category)).toEqual([
      "input",
      "output",
      "cacheCreation",
      "cacheRead"
    ]);
  });

  it("closes across layers: every link set and node layer sums to the same total", () => {
    const cross: ProjectModelCross = new Map([
      [
        "-repo-a",
        new Map([
          ["claude-sonnet-4-5-20250929", totals(10, 1, 2, 3)],
          ["claude-haiku-4-5-20251001", totals(5, 0, 0, 0)]
        ])
      ],
      ["-repo-b", new Map([["claude-sonnet-4-5-20250929", totals(0, 20, 0, 7)]])]
    ]);
    const diagram = buildFlowDiagram(
      rangeOf(
        [
          { label: "-repo-a", value: 21 },
          { label: "-repo-b", value: 27 }
        ],
        [
          { label: "claude-sonnet-4-5-20250929", value: 43 },
          { label: "claude-haiku-4-5-20251001", value: 5 }
        ],
        cross
      ),
      new Map()
    );

    const total = 21 + 27;
    expect(diagram.total).toBe(total);
    expect(linkSum(diagram, "project-model")).toBe(total);
    expect(linkSum(diagram, "model-category")).toBe(total);
    expect(diagram.projects.reduce((sum, node) => sum + node.value, 0)).toBe(total);
    expect(diagram.models.reduce((sum, node) => sum + node.value, 0)).toBe(total);
    expect(diagram.categories.reduce((sum, node) => sum + node.value, 0)).toBe(total);
    // Per model, its category split also closes.
    for (const model of diagram.models) {
      const outgoing = diagram.modelToCategory
        .filter((link) => link.model === model.raw)
        .reduce((sum, link) => sum + link.value, 0);
      expect(outgoing).toBe(model.value);
    }
  });

  it("folds projects and models outside the Top-N into 其他", () => {
    const projects = ["p0", "p1", "p2", "p3", "p4", "p5", "p6"];
    const models = ["m0", "m1", "m2", "m3", "m4", "m5", "m6"];
    const cross: ProjectModelCross = new Map(
      projects.map((project, index) => [
        project,
        new Map([[models[index], totals(10 * (index + 1), 0, 0, 0)]])
      ])
    );
    const diagram = buildFlowDiagram(
      rangeOf(
        [
          ...projects.slice(0, 6).map((label, index) => ({ label, value: 10 * (index + 1) })),
          { label: "其他", value: 70 }
        ],
        [
          ...models.slice(0, 6).map((label, index) => ({ label, value: 10 * (index + 1) })),
          { label: "其他", value: 70 }
        ],
        cross
      ),
      new Map()
    );

    expect(diagram.projects).toHaveLength(7);
    expect(diagram.projects.at(-1)).toMatchObject({ raw: "其他", value: 70 });
    expect(diagram.projects.some((node) => node.raw === "p6")).toBe(false);
    expect(diagram.models).toHaveLength(7);
    expect(diagram.models.at(-1)).toMatchObject({ raw: "其他", value: 70 });
    expect(diagram.total).toBe(280);
  });

  it("keeps usage without a model id under 未知模型", () => {
    const cross: ProjectModelCross = new Map([
      ["-repo-alpha", new Map([["未知模型", totals(7, 0, 0, 0)]])]
    ]);
    const diagram = buildFlowDiagram(
      rangeOf([{ label: "-repo-alpha", value: 7 }], [{ label: "未知模型", value: 7 }], cross),
      new Map()
    );

    expect(diagram.models).toHaveLength(1);
    expect(diagram.models[0]).toMatchObject({ label: "未知模型", raw: "未知模型", value: 7 });
  });

  it("drops zero-token nodes instead of drawing empty wires", () => {
    const cross: ProjectModelCross = new Map([
      ["-repo-alpha", new Map([["claude-sonnet-4-5-20250929", totals(5, 0, 0, 0)]])],
      ["-repo-idle", new Map([["claude-sonnet-4-5-20250929", totals(0, 0, 0, 0)]])]
    ]);
    const diagram = buildFlowDiagram(
      rangeOf(
        [
          { label: "-repo-alpha", value: 5 },
          { label: "-repo-idle", value: 0 }
        ],
        [{ label: "claude-sonnet-4-5-20250929", value: 5 }],
        cross
      ),
      new Map()
    );

    expect(diagram.projects.map((node) => node.raw)).toEqual(["-repo-alpha"]);
    expect(diagram.total).toBe(5);
  });

  it("prints the project's real basename when the scan carried a cwd", () => {
    const cross: ProjectModelCross = new Map([
      ["-repo-alpha", new Map([["claude-sonnet-4-5-20250929", totals(1, 0, 0, 0)]])]
    ]);
    const diagram = buildFlowDiagram(
      rangeOf([{ label: "-repo-alpha", value: 1 }], [{ label: "claude-sonnet-4-5-20250929", value: 1 }], cross),
      new Map([["-repo-alpha", "/Users/tester/work/cc-analyzer"]])
    );

    expect(diagram.projects[0].label).toBe("cc-analyzer");
  });

  it("matches the split aggregateRange builds for the same window", () => {
    const sessions: UsageSessionInput[] = [
      {
        projectLabel: "-repo-alpha",
        projectPath: "/Users/tester/work/alpha",
        records: [
          record({ id: "a1", kind: "user", timestamp: T0 - 3_600_000 }),
          record({
            id: "a2",
            timestamp: T0 - 3_500_000,
            model: "claude-sonnet-4-5-20250929",
            usage: { inputTokens: 100, outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 400 }
          })
        ]
      },
      {
        projectLabel: "-repo-beta",
        records: [
          record({
            id: "b1",
            timestamp: T0 - 3_400_000,
            model: "claude-haiku-4-5-20251001",
            usage: { inputTokens: 50 }
          })
        ]
      }
    ];

    const range = aggregateRange(sessions, 7, T0);
    expect(range.cross?.get("-repo-alpha")?.get("claude-sonnet-4-5-20250929")).toEqual(
      totals(100, 20, 30, 400)
    );

    const diagram = buildFlowDiagram(range, new Map());
    expect(diagram.total).toBe(range.kpi.tokens);
    expect(diagram.total).toBe(600);
    for (const slice of range.topProjects) {
      const node = diagram.projects.find((candidate) => candidate.raw === slice.label);
      expect(node?.value).toBe(slice.value);
    }
    for (const slice of range.topModels) {
      const node = diagram.models.find((candidate) => candidate.raw === slice.label);
      expect(node?.value).toBe(slice.value);
    }
  });
});
