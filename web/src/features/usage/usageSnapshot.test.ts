import { formatClock, formatDateTime, formatTokenCount } from "../../lib/format";
import { escapeHtml } from "../sessions/exportHtml";
import { REPO_URL } from "../sessions/exportTypes";
import type { BillingBlock } from "./billingWindow";
import { PRICING_AS_OF } from "./pricingSnapshot";
import type { QuotaAttribution } from "./quotaAttribution";
import { formatDayLabel } from "./usageAggregations";
import type {
  DailyPoint,
  ModelBucket,
  ProjectBucket,
  RangeAggregate,
  UsageSlice,
  UsageTotals
} from "./usageAggregations";
import { usageSnapshotFileName, usageSnapshotHtml } from "./usageSnapshot";
import type { UsageSnapshotInput } from "./usageSnapshot";
import snapshotSource from "./usageSnapshot.ts?raw";
import type { WeeklyWindow } from "./weeklyWindow";

const NOW = new Date(2026, 9, 11, 14, 30).getTime();
const DAY = 24 * 60 * 60 * 1000;

function totals(input: number, output = 0, cacheCreation = 0, cacheRead = 0): UsageTotals {
  return { input, output, cacheCreation, cacheRead };
}

function slice(label: string, value: number): UsageSlice {
  return { label, value };
}

function dayBuckets(values: readonly number[], messages: readonly number[]): DailyPoint[] {
  return values.map((value, index) => ({
    dayStart: new Date(2026, 9, 7 + index).getTime(),
    ...totals(value),
    messages: messages[index]
  }));
}

/** 基准夹具：五个日历日、两个项目、两个模型，三处合计都是 310,000 token。 */
function baseRange(overrides: Partial<RangeAggregate> = {}): RangeAggregate {
  const daily = new Map<number, DailyPoint & { messages: number }>();
  const series = dayBuckets([120_000, 40_000, 0, 90_000, 60_000], [14, 5, 0, 13, 10]);
  for (const point of series) daily.set(point.dayStart, point);

  const projects = new Map<string, ProjectBucket>([
    ["-Users-me-demo-app", { ...totals(250_000), sessions: 2 }],
    ["-Users-me-other", { ...totals(60_000), sessions: 1 }]
  ]);
  const models = new Map<string, ModelBucket>([
    ["claude-sonnet-4-5-20250929", { ...totals(200_000), messages: 30 }],
    ["claude-haiku-4-5-20251001", { ...totals(110_000), messages: 12 }]
  ]);

  const hourly = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  hourly[1][9] = 12;
  hourly[1][14] = 30;
  hourly[3][10] = 5;

  return {
    sessionCount: 3,
    messages: 42,
    totals: totals(310_000),
    daily,
    models,
    projects,
    hourly,
    dailySeries: series,
    topProjects: [slice("-Users-me-demo-app", 250_000), slice("-Users-me-other", 60_000)],
    topModels: [
      slice("claude-sonnet-4-5-20250929", 200_000),
      slice("claude-haiku-4-5-20251001", 110_000)
    ],
    kpi: { sessions: 3, messages: 42, tokens: 310_000 },
    ...overrides
  };
}

function baseBlock(): BillingBlock {
  const start = NOW - 2 * 60 * 60 * 1000;
  return {
    start,
    end: start + 5 * 60 * 60 * 1000,
    totals: totals(150_000, 20_000, 0, 5_000),
    messages: 22
  };
}

function baseWeekly(overrides: Partial<WeeklyWindow> = {}): WeeklyWindow {
  return {
    consumed: totals(700_000, 150_000, 0, 50_000),
    previousConsumed: totals(900_000, 250_000, 0, 50_000),
    activeDays: 4,
    limitTokens: 5_000_000,
    ...overrides
  };
}

function baseAttribution(): QuotaAttribution {
  const block = baseBlock();
  return {
    windowTokens: 175_000,
    windowStart: block.start,
    windowEnd: block.end,
    rows: [
      {
        path: "/Users/me/demo-app/session.jsonl",
        title: "跑一下构建脚本",
        projectLabel: "-Users-me-demo-app",
        projectPath: "/Users/me/demo-app",
        tokens: 100_000,
        messages: 12,
        share: 100_000 / 175_000
      },
      {
        path: "/Users/me/other/session.jsonl",
        title: "写文档",
        projectLabel: "-Users-me-other",
        projectPath: "/Users/me/other",
        tokens: 60_000,
        messages: 8,
        share: 60_000 / 175_000
      }
    ],
    remainder: { sessions: 1, tokens: 15_000, messages: 2, share: 15_000 / 175_000 },
    sessionsInWindow: 3
  };
}

function base(overrides: Partial<UsageSnapshotInput> = {}): UsageSnapshotInput {
  return {
    days: 5,
    now: NOW,
    appVersion: "0.17.0",
    range: baseRange(),
    projectPaths: new Map([
      ["-Users-me-demo-app", "/Users/me/demo-app"],
      ["-Users-me-other", "/Users/me/other"]
    ]),
    billing: { block: baseBlock(), weekly: baseWeekly(), planLimitTokens: 1_750_000 },
    attribution: baseAttribution(),
    ...overrides
  };
}

function emptyInput(): UsageSnapshotInput {
  return {
    days: 30,
    now: NOW,
    appVersion: "0.17.0",
    range: {
      sessionCount: 0,
      messages: 0,
      totals: totals(0),
      daily: new Map(),
      models: new Map(),
      projects: new Map(),
      hourly: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
      dailySeries: [],
      topProjects: [],
      topModels: [],
      kpi: { sessions: 0, messages: 0, tokens: 0 }
    },
    projectPaths: new Map(),
    billing: {
      block: null,
      weekly: { consumed: totals(0), previousConsumed: totals(0), activeDays: 0, limitTokens: null },
      planLimitTokens: null
    },
    attribution: null
  };
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function section(document: Document, name: string): Element {
  const node = document.querySelector(`[data-snapshot-section="${name}"]`);
  if (!node) throw new Error(`缺少区块 ${name}`);
  return node;
}

/** 从产物自己的内联样式里取出某条规则的声明块——判据读的是产物，不是源码字符串。 */
function cssRule(html: string, selector: string): string {
  const style = parse(html).querySelector("style")?.textContent ?? "";
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[\\n}])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(style);
  if (!match) throw new Error(`内联样式里找不到规则 ${selector}`);
  return match[1];
}

test("是一份自包含文档：无脚本、无外链资源、内联样式加本地 CSP", () => {
  const html = usageSnapshotHtml(base());
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toContain('<meta charset="utf-8">');
  expect(html).toContain('<meta name="color-scheme" content="light dark">');
  expect(html).toContain("default-src 'none'");
  expect(html).toContain("style-src 'unsafe-inline'");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<link");
  expect(html).not.toContain("src=");
  expect(html).not.toContain("@import");
  expect(html).not.toContain("url(http");
});

test("只有一个出站链接，指向本仓库，页脚写明数据未上传", () => {
  const html = usageSnapshotHtml(base());
  const hrefs = html.match(/href="/g) ?? [];
  expect(hrefs).toHaveLength(1);
  expect(html).toContain(`href="${REPO_URL}"`);
  expect(html).toContain("由 CC Analyzer 生成");
  expect(html).toContain("数据未上传");
});

test("带上应用深色与打印样式，字体栈含系统 CJK 字体", () => {
  const html = usageSnapshotHtml(base());
  expect(html).toContain("@media (prefers-color-scheme: dark)");
  expect(html).toContain("@media print");
  // 深色系统下打印不能只刷白底：整套浅色必须重声明。
  const print = html.slice(html.indexOf("@media print"));
  for (const token of ["--text:", "--text-tertiary:", "--chart-1-soft:"]) {
    expect(print).toContain(token);
  }
  const fontFamily = html.match(/--font-sans:[^;]+;/)?.[0] ?? "";
  for (const key of ["system-ui", '"PingFang SC"', '"Microsoft YaHei"']) {
    expect(fontFamily).toContain(key);
  }
});

test("KPI 行是四块读数，与页面同一组标签和同一套格式化", () => {
  const document = parse(usageSnapshotHtml(base()));
  const labels = Array.from(document.querySelectorAll(".readout dt")).map((node) =>
    node.textContent?.replace(/\d+$/, "")
  );
  expect(labels).toEqual(["Tokens 总量", "会话数", "消息数", "估算成本"]);
  // 出处用两枚上标钉在各自的半句前，说明条在读数带下方。
  expect(document.querySelectorAll(".readout sup")).toHaveLength(4);
  expect(document.querySelector(".readouts-note")?.textContent).toContain("读自本机日志");
  const values = Array.from(document.querySelectorAll(".readout dd")).map((node) => node.textContent);
  expect(values).toEqual([
    formatTokenCount(310_000),
    "3",
    "42",
    // 200K sonnet 输入 → $0.60；110K haiku 输入 → $0.11。
    "$0.71"
  ]);
});

test("成本按离线定价快照折算，未收录定价的模型在脚注里记数而不是算成 0", () => {
  const models = new Map<string, ModelBucket>([
    ["claude-sonnet-4-5-20250929", { ...totals(1_000_000), messages: 1 }],
    ["gpt-5", { ...totals(1_000), messages: 1 }]
  ]);
  const html = usageSnapshotHtml(
    base({ range: baseRange({ models, topModels: [slice("gpt-5", 1_000)] }) })
  );
  const document = parse(html);
  const values = Array.from(document.querySelectorAll(".readout dd")).map((node) => node.textContent);
  expect(values[3]).toBe("$3.00");
  expect(html).not.toContain("$0.0000");
  const note = document.querySelector(".readouts-note")?.textContent ?? "";
  expect(note).toContain("未计入");
  expect(note).toContain(formatTokenCount(1_000));
  expect(note).toContain(PRICING_AS_OF);
});

test("快照元数据写清生成时刻、区间、应用版本与定价快照日期", () => {
  const html = usageSnapshotHtml(base());
  const document = parse(html);
  // h1 逐字用页面 aria-label 与侧栏标签，「快照」交给 <title> / 文件名 / 页脚。
  expect(document.querySelector("h1")?.textContent).toBe("用量总览");
  expect(document.querySelector("title")?.textContent).toBe("CC Analyzer 用量快照 · 近 5 天");
  const meta = document.querySelector(".meta")?.textContent ?? "";
  expect(meta).toContain("近 5 天");
  expect(meta).toContain(formatDateTime(NOW));
  expect(meta).toContain("CC Analyzer v0.17.0");
  expect(meta).toContain(PRICING_AS_OF);
});

test("每日趋势的柱数就是日序列长度，轴标签走既有日期口径", () => {
  const five = parse(usageSnapshotHtml(base()));
  expect(section(five, "trend").querySelectorAll("rect.trend-bar")).toHaveLength(5);
  expect(section(five, "trend").textContent).toContain(formatDayLabel(new Date(2026, 9, 7).getTime()));
  // 图下的口径句说明「一根柱是什么」，省得收件人自己猜纵轴。
  expect(section(five, "trend").querySelector(".caption")?.textContent).toContain(
    "每根柱 = 一个自然日"
  );

  const week = usageSnapshotHtml(
    base({
      days: 7,
      range: baseRange({
        dailySeries: dayBuckets([1, 2, 3, 4, 5, 6, 7], [1, 1, 1, 1, 1, 1, 1])
      })
    })
  );
  expect(parse(week).querySelectorAll("rect.trend-bar")).toHaveLength(7);
});

test("分布图的行数等于输入切片数，数值与标签逐条对上", () => {
  const projects = [
    slice("-Users-me-demo-app", 250_000),
    slice("-Users-me-other", 60_000),
    slice("-Users-me-third", 30_000),
    slice("-Users-me-fourth", 10_000)
  ];
  const document = parse(
    usageSnapshotHtml(base({ range: baseRange({ topProjects: projects }) }))
  );
  const rows = section(document, "projects").querySelectorAll("g.dist-row");
  expect(rows).toHaveLength(4);
  expect(rows[0].textContent).toContain("demo-app");
  expect(rows[0].textContent).toContain(formatTokenCount(250_000));
  expect(rows[3].textContent).toContain("fourth");
});

test("模型图只出可读名与数值，原始 id 不上纸面", () => {
  const document = parse(usageSnapshotHtml(base()));
  const models = section(document, "models");
  const rows = models.querySelectorAll(".model-legend li");
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain("Sonnet 4.5");
  expect(rows[0].textContent).toContain(formatTokenCount(200_000));
  // 纸上没有悬停，完整 id 也不属于这张摘要。
  expect(models.innerHTML).not.toContain("claude-sonnet-4-5-20250929");
  expect(models.innerHTML).not.toContain("claude-haiku-4-5-20251001");
});

test("图例把名字与数值钉成一组：固定 8px、长名不撑破两列", () => {
  const html = usageSnapshotHtml(base());

  // 回归来源：`.model-legend li` 曾是栅格，中间的 `1fr` 轨道吸走空档，把数值
  // 推到格子右边缘——实测正常的「Sonnet 4.5」与 210,480 之间裂开 320px
  // （打印版 593px），长模型名还会折成两行。这一组断言在改回去时必须变红。
  const row = cssRule(html, ".model-legend li");
  expect(row).toMatch(/display:\s*flex/);
  expect(row).not.toMatch(/grid-template-columns/);
  expect(row).not.toMatch(/justify-content:\s*(space-between|flex-end)/);
  expect(row).toMatch(/gap:\s*8px/);

  // 名字可以省略号收窄（长 id 撑不破两列），数值与色块刚性不动（推不走）。
  const name = cssRule(html, ".model-legend .model-name");
  expect(name).toMatch(/min-width:\s*0/);
  expect(name).toMatch(/white-space:\s*nowrap/);
  expect(name).toMatch(/text-overflow:\s*ellipsis/);
  const value = cssRule(html, ".model-legend .model-value");
  expect(value).toMatch(/flex:\s*none/);
  expect(value).not.toMatch(/margin-(left|inline-start):\s*auto/);
  expect(value).toMatch(/font-variant-numeric:\s*tabular-nums/);
  expect(cssRule(html, ".model-legend .swatch")).toMatch(/flex:\s*none/);

  // 结构上数值必须紧跟名字之后：顺序换了，8px 的「一组」也就没意义了。
  const first = section(parse(html), "models").querySelector(".model-legend li");
  expect(Array.from(first?.children ?? []).map((node) => node.getAttribute("class"))).toEqual([
    "swatch",
    "model-name",
    "model-value"
  ]);
});

test("热力图是完整的 7×24 格，周行按周一到周日排", () => {
  const document = parse(usageSnapshotHtml(base()));
  const heatmap = section(document, "heatmap");
  expect(heatmap.querySelectorAll("rect.heat-cell")).toHaveLength(168);
  const weekdays = Array.from(heatmap.querySelectorAll("text.heat-weekday")).map(
    (node) => node.textContent
  );
  expect(weekdays).toEqual(["一", "二", "三", "四", "五", "六", "日"]);
  // 色阶图例的档数与格子用的是同一组透明度：没有刻度的热力图没有标尺。
  expect(heatmap.querySelectorAll(".heat-legend-cell")).toHaveLength(4);
});

test("两层限额读数取自已算好的窗口对象，不是在这里重新切窗口", () => {
  const document = parse(usageSnapshotHtml(base()));
  const limits = section(document, "limits");
  const text = limits.textContent ?? "";
  expect(text).toContain("5 小时窗口");
  expect(text).toContain("滚动 7 天");
  expect(text).toContain(formatTokenCount(175_000));
  expect(text).toContain("10.0%");
  expect(text).toContain(formatTokenCount(900_000));
  expect(text).toContain("18.0%");
  expect(text).toContain("4");
  // 纸面写绝对时刻，不写倒计时：文件打开时倒计时早就错了。
  expect(text).toContain(formatClock(baseBlock().start));
  expect(text).toContain(formatClock(baseBlock().end));
  // 上期读数来自 weekly.previousConsumed（900,000 对 1,200,000 → −25.0%）。
  expect(text).toContain("-25.0%");
  expect(text).toContain("滚动 7 天累计，不是官方重置窗口，两者不逐分钟吻合");
});

test("没有设置限额就不印百分比，也不会把 0 当分母", () => {
  const document = parse(
    usageSnapshotHtml(
      base({
        billing: {
          block: baseBlock(),
          weekly: baseWeekly({ limitTokens: null }),
          planLimitTokens: null
        }
      })
    )
  );
  const limits = section(document, "limits");
  const windowText =
    (limits.querySelector(".window")?.textContent ?? "") +
    (limits.querySelector(".plan-note")?.textContent ?? "");
  const weekText = limits.querySelector(".week")?.textContent ?? "";
  // 没有分母就没有比率：5 小时层连一个百分号都不该有。
  expect(windowText).not.toContain("%");
  expect(windowText).toContain("未选择订阅计划");
  expect(weekText).not.toContain("周预算已用");
  expect(weekText).toContain("未设周预算");
  expect(limits.textContent).not.toContain("NaN");
  // 没有分母就不画表盘：一圈没有刻度的弧在纸面上读不出比例。
  expect(limits.querySelector(".gauge")).toBeNull();
});

test("没有进行中的计费窗口时如实说没有，不编一个空窗口", () => {
  const document = parse(
    usageSnapshotHtml(
      base({
        billing: { block: null, weekly: baseWeekly(), planLimitTokens: null },
        attribution: null
      })
    )
  );
  const limits = section(document, "limits");
  expect(limits.textContent).toContain("当前没有进行中的 5 小时计费窗口");
  expect(limits.textContent).not.toContain("175,000");
  // 整节不消失：一张打印稿少了一节会被读成漏页。
  expect(limits.querySelector(".week")).not.toBeNull();
});

test("本窗口消耗 Top 会话逐行列出，余项合并成一行", () => {
  const document = parse(usageSnapshotHtml(base()));
  const attribution = section(document, "attribution");
  const rows = attribution.querySelectorAll("tbody tr");
  expect(rows).toHaveLength(3);
  expect(rows[0].textContent).toContain("跑一下构建脚本");
  expect(rows[0].textContent).toContain("57.1%");
  expect(rows[0].textContent).toContain("demo-app");
  expect(rows[2].textContent).toContain("其余 1 个会话");
  expect(rows[2].textContent).toContain("8.6%");
  // 占比条是纸面唯一的比例刻度，非零行不能被画成空条。
  const fills = Array.from(attribution.querySelectorAll(".share-fill")).map((node) =>
    node.getAttribute("style")
  );
  expect(fills).toHaveLength(3);
  for (const fill of fills) {
    expect(fill).not.toContain("width:0");
  }
  expect(attribution.querySelector(".denominator")?.textContent).toBe(
    "占比分母 = 本窗口总消耗（与表盘中心同一个数）。"
  );
});

test("没有归因结果时不给一张空表", () => {
  const document = parse(usageSnapshotHtml(base({ attribution: null })));
  const attribution = section(document, "attribution");
  expect(attribution.querySelector("table")).toBeNull();
  expect(attribution.textContent).toContain("本窗口没有可归因的会话消耗");
});

test("口径脚注写明数字未经重算，并逐字说明包含与不含", () => {
  const html = usageSnapshotHtml(base());
  const document = parse(html);
  const note = document.querySelector(".coverage")?.textContent ?? "";
  expect(note).toContain("本快照包含");
  expect(note).toContain("不含工具与 skill 普查、压缩统计、错误档");
  expect(note).toContain("未重算");
  expect(document.querySelector(".foot")?.textContent).toContain(REPO_URL.split("//")[1]);
});

test("每一段用户文本都过转义，塞脚本也只会印成文字", () => {
  const hostile = "<script>alert(1)</script> & a & b";
  const document = parse(
    usageSnapshotHtml(
      base({
        range: baseRange({
          topProjects: [slice(hostile, 1_000)],
          topModels: [slice(hostile, 1_000)]
        }),
        attribution: {
          ...baseAttribution(),
          rows: [
            {
              path: "",
              title: hostile,
              projectLabel: hostile,
              tokens: 1,
              messages: 1,
              share: 1
            }
          ],
          remainder: null,
          sessionsInWindow: 1
        }
      })
    )
  );
  const html = usageSnapshotHtml(
    base({
      range: baseRange({ topProjects: [slice(hostile, 1_000)] })
    })
  );
  expect(html).not.toContain("<script");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).toContain("&amp;");
  expect(document.body.textContent).toContain(hostile);
  expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
});

test("产物里不留本机路径、日志目录与会话文件名", () => {
  const html = usageSnapshotHtml(base());
  expect(html).not.toContain("/Users/");
  expect(html).not.toContain("/home/");
  expect(html).not.toContain(".claude/projects");
  expect(html).not.toContain(".jsonl");
  expect(html).not.toContain("session.jsonl");
  expect(html).toContain("demo-app");
});

test("项目落在用户主目录时退回项目标签，绝不印出路径", () => {
  // 与会话报告同一条回退：主目录的目录名就是用户名，所以退回项目标签本身。
  const label = "-Users-secretuser";
  const html = usageSnapshotHtml(
    base({
      range: baseRange({ topProjects: [slice(label, 1_000)] }),
      projectPaths: new Map([[label, "/Users/secretuser"]])
    })
  );
  expect(parse(html).body.textContent).toContain("Users-secretuser");
  expect(html).not.toContain("/Users/");
  expect(html).not.toContain("/home/");
});

test("同一个输入两次生成逐字节一致，文件名只由传入时刻决定", () => {
  const input = base();
  expect(usageSnapshotHtml(input)).toBe(usageSnapshotHtml(input));
  expect(usageSnapshotHtml(base())).toBe(usageSnapshotHtml(base()));

  const stamp = new Date(2026, 9, 11, 9, 30).getTime();
  expect(usageSnapshotFileName(stamp)).toBe("cc-analyzer-usage-2026-10-11.html");
  expect(usageSnapshotFileName(stamp)).toMatch(/^cc-analyzer-usage-\d{4}-\d{2}-\d{2}\.html$/);
  expect(usageSnapshotFileName(stamp)).not.toContain(" ");
});

test("一个会话都没有时只说明没有数据，不铺一屏空图", () => {
  const html = usageSnapshotHtml(emptyInput());
  const document = parse(html);
  // 品牌标记仍是内联 SVG，这里禁的是图表本身与它的数据 ink。
  expect(document.querySelectorAll("svg.chart")).toHaveLength(0);
  expect(document.querySelectorAll("[data-snapshot-section]")).toHaveLength(0);
  expect(document.querySelector(".empty h2")?.textContent).toBe("所选区间内没有会话记录");
  expect(document.querySelector(".empty p")?.textContent).toContain("没有可统计的会话记录");
  expect(document.querySelector(".empty p")?.textContent).toContain("近 30 天");
  expect(document.querySelector(".meta")?.textContent).toContain("0.17.0");
  expect(document.querySelector(".coverage")?.textContent).toContain("本快照包含");
  expect(document.querySelector(".foot")?.textContent).toContain("由 CC Analyzer 生成");
  // 没有记录时成本是「未知」不是零：读数带整条不出现，也不许印 $0.00。
  expect(document.querySelectorAll(".readout")).toHaveLength(0);
  expect(document.querySelector(".readouts-note")).toBeNull();
  expect(html).not.toContain("$0.00");
  expect(html).not.toContain("$0.0000");
  expect(html).not.toContain("暂无数据");
});

test("打印的是传进来的数，不是它能自己再算一遍的数", () => {
  // kpi 与日序列故意互相矛盾：生成器必须照 kpi 印，重算就会露馅。
  const planted = baseRange({
    kpi: { sessions: 7, messages: 111, tokens: 999_999 },
    dailySeries: dayBuckets([1, 1, 1], [1, 1, 1])
  });
  const document = parse(usageSnapshotHtml(base({ range: planted })));
  const values = Array.from(document.querySelectorAll(".readout dd")).map((node) => node.textContent);
  expect(values[0]).toBe("999,999");
  expect(values[1]).toBe("7");
  expect(values[2]).toBe("111");
  expect(document.querySelectorAll("rect.trend-bar")).toHaveLength(3);
});

test("生成器只消费预算好的结果：聚合与窗口模块只能以类型身份出现", () => {
  const imports = new Map<string, boolean>();
  const pattern = /^\s*import\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm;
  for (const match of snapshotSource.matchAll(pattern)) {
    const typeOnly = match[1] !== undefined;
    const spec = match[2];
    imports.set(spec, (imports.get(spec) ?? true) && typeOnly);
  }
  expect(Object.fromEntries(imports)).toEqual({
    "../../lib/format": false,
    "../sessions/exportHtml": false,
    "../sessions/exportShell": false,
    "../sessions/exportTypes": false,
    "./planLimits": false,
    "./pricingSnapshot": false,
    "./usageAggregations": false,
    "./charts/chartPrimitives": false,
    "./billingWindow": true,
    "./weeklyWindow": true,
    "./quotaAttribution": true
  });
});

test("生成器里没有时钟、随机数与环境读取", () => {
  expect(snapshotSource).not.toMatch(/Date\.now/);
  expect(snapshotSource).not.toMatch(/new Date\(\s*\)/);
  expect(snapshotSource).not.toMatch(/Math\.random/);
  expect(snapshotSource).not.toMatch(/performance\.now/);
  expect(snapshotSource).not.toMatch(/localStorage/);
  // 传进来的时刻才决定时间戳：差一天必然写出不同的日期。
  expect(usageSnapshotFileName(NOW)).not.toBe(usageSnapshotFileName(NOW + DAY));
});

test("落款用 generatedAt（缺省回落到 now）：窗口时刻与文档时刻分开", () => {
  // 窗口数学跟着屏幕的 tick 值走，「生成于」必须是点击那一刻——两者可以不同。
  const generatedAt = NOW + 42_000;
  const stamped = parse(usageSnapshotHtml(base({ generatedAt })));
  expect(stamped.querySelector(".meta")?.textContent).toContain(formatDateTime(generatedAt));
  expect(stamped.querySelector(".foot")?.textContent).toContain(formatDateTime(generatedAt));

  // 不传 generatedAt：落款就是 now——既有调用点的行为一字未变。
  const legacy = parse(usageSnapshotHtml(base()));
  expect(legacy.querySelector(".meta")?.textContent).toContain(formatDateTime(NOW));
  expect(legacy.querySelector(".foot")?.textContent).toContain(formatDateTime(NOW));
});
