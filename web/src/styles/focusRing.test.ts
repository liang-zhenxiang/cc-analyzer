import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 焦点环几何的收口守卫（Round U / Issue #73）。
 *
 * 高对比度档不改任何选择器，只覆盖 `--focus-ring-width` / `--focus-ring-offset` /
 * `--focus-ring-inset` 三个令牌（见 tokens.css）。于是每个画焦点环的规则都必须
 * 消费令牌——谁留一个 `2px` / `-2px` 字面量，那一处就永远不会跟着高对比度加粗，
 * 而它在普通档下与令牌默认值逐字相同，肉眼、截图与真机门禁都看不出来。
 *
 * 断言读的是注释剥离后的 CSS 源码（不依赖 CSS Modules 的哈希类名）。
 */
const SRC = resolve(process.cwd(), "src");

type CssFile = { file: string; source: string };
type Rule = { file: string; selector: string; body: string };

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function cssFiles(dir: string = SRC): CssFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    if (!entry.isFile() || !entry.name.endsWith(".css")) return [];
    return [{ file: full.slice(SRC.length + 1), source: stripComments(readFileSync(full, "utf8")) }];
  });
}

/**
 * 极简规则解析：取每一对 `selector { body }`。`@media` 这类外层块会在第一次
 * 尝试时因为体里还有 `{` 而失败，正则随后从内层规则重新起匹配——所以拿到的
 * 是真正带声明的规则，而不是整段媒体查询。
 */
function rulesOf({ file, source }: CssFile): Rule[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    file,
    selector: selector.trim(),
    body
  }));
}

const ALL_RULES = cssFiles().flatMap(rulesOf);
const ALL_SOURCE = cssFiles()
  .map((item) => item.source)
  .join("\n");

const LITERAL_RING = /outline(?:-width)?:\s*-?\d+(?:\.\d+)?px/;
const LITERAL_OFFSET = /outline-offset:\s*-?\d+(?:\.\d+)?px/;
const LITERAL_BAR = /inset\s+\d+(?:\.\d+)?px\s+0\s+0/;

describe("焦点环的几何只走令牌", () => {
  /**
   * 唯一允许保留字面量偏移的三处（Round U 设计规格 §4.4）：它们本就是「环与控件
   * 之间有间隙」的宽档，且两处是图表容器——偏移再加一档会撞到相邻区块。高对比
   * 度下它们拿 3px 宽 + 2px 偏移，间隙照旧成立，所以偏移**不**跟着换挡。
   */
  const ALLOWED_OFFSET_LITERALS = new Map<string, string>([
    ["features/sessions/ContextView.module.css", "outline-offset: 2px"],
    ["features/sessions/ParseCoverageChip.module.css", "outline-offset: 2px"],
    ["features/usage/ErrorTrendChart.module.css", "outline-offset: 2px"]
  ]);

  const focusRules = ALL_RULES.filter((rule) => rule.selector.includes(":focus-visible"));

  it("任何 :focus-visible 规则里都不再出现环宽度与竖条宽度的字面量", () => {
    const offenders: string[] = [];
    for (const rule of focusRules) {
      for (const pattern of [LITERAL_RING, LITERAL_BAR]) {
        const hit = pattern.exec(rule.body)?.[0];
        if (hit) offenders.push(`${rule.file} → ${rule.selector}: ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("环偏移的字面量只剩白名单里那三处，且值仍是 2px", () => {
    const found = focusRules
      .map((rule) => ({ rule, hit: LITERAL_OFFSET.exec(rule.body)?.[0] }))
      .filter((item): item is { rule: Rule; hit: string } => Boolean(item.hit));
    const seen = found.map(({ rule, hit }) => {
      expect(hit, `${rule.file} 的偏移字面量不在白名单值上`).toBe(
        ALLOWED_OFFSET_LITERALS.get(rule.file)
      );
      return rule.file;
    });
    // 双向：多一处字面量会在这里红，白名单里那三处被改成令牌同样会红。
    expect(seen.sort()).toEqual([...ALLOWED_OFFSET_LITERALS.keys()].sort());
  });

  /**
   * 条数写死，来源是 Round U 设计规格 §4.1 的逐条清单，改完后再用 grep 数过一遍：
   * - `outline: var(--focus-ring-width)` 25 条 = 3 条 `--ring` 环（global / Button /
   *   TextInput）+ 22 条 `--accent` 环（其中 3 条带 2px 偏移，5 条是内嵌负偏移；
   *   Round V 的消耗日历补 3 条：格子按钮 / 清除按钮 / 会话行）；
   * - `outline-offset: var(--focus-ring-offset)` 17 条 = 上面 25 条里偏移为 1px 的那些；
   * - `outline-offset: var(--focus-ring-inset)` 5 条 = SearchPalette 输入框、
   *   ChangedFilesView 三条、ErrorEventList 行；
   * - 焦点竖条 7 条 = 4 条纯竖条 + 3 条与环并存的竖条。
   * 所以消费了令牌的规则共 29 条（25 条 outline 规则 + 4 条纯竖条）。
   */
  it("令牌被 29 条规则消费，环宽度 25 处、偏移 17 + 5 处、焦点竖条 7 处", () => {
    const count = (pattern: RegExp) => ALL_SOURCE.match(pattern)?.length ?? 0;
    // 只数「消费」的规则：tokens.css 里那几块是**声明**（`--focus-ring-width: 2px;`），
    // 不含 `var(...)`，不能被算进消费方。
    const consumingRules = ALL_RULES.filter((rule) => /var\(--focus-ring-/.test(rule.body));

    expect(count(/outline(?:-width)?:\s*var\(--focus-ring-width\)/g)).toBe(25);
    expect(count(/outline-offset:\s*var\(--focus-ring-offset\)/g)).toBe(17);
    expect(count(/outline-offset:\s*var\(--focus-ring-inset\)/g)).toBe(5);
    expect(count(/inset\s+var\(--focus-ring-width\)\s+0\s+0\s+var\(--accent\)/g)).toBe(7);
    expect(consumingRules.length).toBe(29);
  });
});

/**
 * 7 处同款竖条属于「选中态」（`.selected` / 展开行 / `aria-current`），不是焦点
 * 指示。它们是「选中」语义的既定信号，宽度不跟着高对比度换挡——这条守卫把两
 * 组竖条分开锁死，防止有人扫一遍 `inset 2px 0 0 var(--accent)` 就把它们一起换掉。
 */
const SELECTED_BAR_SELECTORS: Record<string, RegExp> = {
  "features/search/SearchPalette.module.css": /^\.itemActive$/,
  "features/sessions/ChangedFilesView.module.css": /^\.rowOpen$/,
  "features/sessions/FilterBar.module.css": /^\.chip\[aria-pressed="true"\]$/,
  "features/sessions/SessionList.module.css":
    /^\.groups \.sessionRow button\[aria-current="true"\],\n\.groups \.sessionRowWithStatus button\[aria-current="true"\]$/,
  "features/sessions/TreeView.module.css": /^\.nodeSelected$/,
  "features/usage/ErrorRankList.module.css": /^\.selected$/,
  "features/usage/ToolCensusPanel.module.css": /^\.selected$/
};

describe("选中态竖条与焦点竖条互不串门", () => {
  const withLiteralBar = ALL_RULES.filter((rule) => LITERAL_BAR.test(rule.body));
  const withTokenBar = ALL_RULES.filter((rule) =>
    /inset\s+var\(--focus-ring-width\)\s+0\s+0\s+var\(--accent\)/.test(rule.body)
  );

  it("全仓库恰好 7 处选中态竖条仍是字面量 2px，且一条都不在 :focus-visible 里", () => {
    expect(withLiteralBar).toHaveLength(7);
    expect(withLiteralBar.filter((rule) => rule.selector.includes(":focus-visible"))).toEqual([]);
    expect(withLiteralBar.map((rule) => rule.file).sort()).toEqual(
      Object.keys(SELECTED_BAR_SELECTORS).sort()
    );
    for (const rule of withLiteralBar) {
      expect(
        SELECTED_BAR_SELECTORS[rule.file]?.test(rule.selector),
        `${rule.file} 里字面量竖条的选择器变成了 ${rule.selector}`
      ).toBe(true);
      // 正面断言：选中态竖条不得消费任何焦点环令牌。
      expect(rule.body, `${rule.file} 的选中态竖条被换成了焦点环令牌`).not.toMatch(/--focus-ring-/);
    }
  });

  it("另外 7 处焦点竖条全部消费了 --focus-ring-width，且都在 :focus-visible 规则里", () => {
    expect(withTokenBar).toHaveLength(7);
    for (const rule of withTokenBar) {
      expect(rule.selector, `${rule.file} 的令牌竖条不在 :focus-visible 里`).toContain(
        ":focus-visible"
      );
    }
  });
});
