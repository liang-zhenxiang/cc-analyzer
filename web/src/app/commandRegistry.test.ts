import { describe, expect, test } from "vitest";
import {
  filterCommands,
  firstEnabledIndex,
  isRunnable,
  nextIndex,
  normalizeQuery,
  scoreCommand,
  stepHighlight,
  type CommandAction
} from "./commandRegistry";

function action(overrides: Partial<CommandAction> & Pick<CommandAction, "id" | "title">): CommandAction {
  return { group: "动作", ...overrides };
}

const registry: CommandAction[] = [
  action({ id: "nav-analyzer", title: "会话分析", group: "视图" }),
  action({ id: "nav-usage", title: "用量总览", group: "视图" }),
  action({ id: "nav-monitor", title: "实时监控", group: "视图" }),
  action({ id: "nav-search", title: "全局搜索", group: "视图" }),
  action({ id: "nav-archive", title: "归档仓库", group: "视图", disabled: true, detail: "本轮未接入" }),
  action({ id: "theme-light", title: "主题：浅色", group: "外观", keywords: "theme light" }),
  action({ id: "theme-dark", title: "主题：深色", group: "外观", keywords: "theme dark" }),
  action({ id: "export-usage", title: "导出用量快照", group: "动作", disabled: true })
];

describe("normalizeQuery", () => {
  test("小写化并去掉所有空白（换行也算）", () => {
    expect(normalizeQuery("  Toggle \n Theme  ")).toBe("toggleTheme".toLowerCase());
  });
});

describe("scoreCommand", () => {
  test("空查询对每个动作都是 0 分，不是不匹配", () => {
    expect(scoreCommand("", registry[0])).toBe(0);
    expect(scoreCommand("   ", registry[4])).toBe(0);
  });

  test("子序列匹配失败返回 null（不是 0 分）", () => {
    expect(scoreCommand("落地页", registry[0])).toBeNull();
    // 顺序错了也不算匹配：子序列要求字符按顺序出现。
    expect(scoreCommand("总用量", registry[1])).toBeNull();
  });

  test("大小写不敏感：英文别名也能命中", () => {
    const lower = scoreCommand("theme dark", registry[6]);
    const upper = scoreCommand("THEME DARK", registry[6]);
    expect(lower).not.toBeNull();
    expect(upper).toBe(lower);
  });

  test("查询里的空白被忽略：「主题 深色」与「主题深色」等价", () => {
    const spaced = scoreCommand("主题 深色", action({ id: "x", title: "主题：深色" }));
    const tight = scoreCommand("主题深色", action({ id: "x", title: "主题：深色" }));
    expect(spaced).not.toBeNull();
    expect(spaced).toBe(tight);
  });

  test("分组名参与匹配，但不抢标题前缀的加分", () => {
    const byTitle = scoreCommand("主题：深色", action({ id: "a", title: "主题：深色" })) ?? -1;
    const byGroup =
      scoreCommand("外观", action({ id: "b", title: "主题：深色", group: "外观" })) ?? -1;
    expect(byGroup).toBeGreaterThan(0);
    expect(byTitle).toBeGreaterThan(byGroup);
  });

  test("连续命中高于分散命中", () => {
    const query = "深浅";
    const consecutive = scoreCommand(query, action({ id: "a", title: "深浅" }));
    const scattered = scoreCommand(query, action({ id: "b", title: "深度调浅" }));
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(consecutive!).toBeGreaterThan(scattered!);
  });

  test("前缀命中高于词中间命中", () => {
    const query = "主题";
    const prefix = scoreCommand(query, action({ id: "a", title: "主题：浅色" }));
    const middle = scoreCommand(query, action({ id: "b", title: "切换主题" }));
    expect(prefix!).toBeGreaterThan(middle!);
  });

  test("词首命中拿到加分：跟在空白后面的字符不算「埋在词中间」", () => {
    const query = "设置";
    const wordStart = scoreCommand(query, action({ id: "a", title: "全局 设置" }));
    const buried = scoreCommand(query, action({ id: "b", title: "全局设置X" }));
    expect(wordStart!).toBeGreaterThan(buried!);
  });
});

describe("filterCommands", () => {
  test("空查询保留注册顺序（不可用项也在原位）", () => {
    expect(filterCommands(registry, "").map((item) => item.id)).toEqual(registry.map((item) => item.id));
  });

  test("按分数排序，同分保持注册顺序", () => {
    // 「用量」同时命中「用量总览」与「导出用量快照」；前缀命中在前。
    const ids = filterCommands(registry, "用量").map((item) => item.id);
    expect(ids[0]).toBe("nav-usage");
    expect(ids).toContain("export-usage");
  });

  test("不匹配的动作整条消失，列表可以为空", () => {
    expect(filterCommands(registry, "zzz")).toEqual([]);
  });

  test("不可用的动作仍然出现在结果里（要如实显示「不可用」）", () => {
    const ids = filterCommands(registry, "归档").map((item) => item.id);
    expect(ids).toEqual(["nav-archive"]);
  });
});

describe("键盘导航索引", () => {
  test("nextIndex 两端绕回，空列表为 -1", () => {
    expect(nextIndex(0, 3, 1)).toBe(1);
    expect(nextIndex(2, 3, 1)).toBe(0);
    expect(nextIndex(0, 3, -1)).toBe(2);
    // 首次向下 / 向上：落在头 / 尾。
    expect(nextIndex(-1, 3, 1)).toBe(0);
    expect(nextIndex(-1, 3, -1)).toBe(2);
    expect(nextIndex(0, 0, 1)).toBe(-1);
  });

  test("stepHighlight 跳过不可用项，一圈都不可用返回 -1", () => {
    const items = [
      action({ id: "a", title: "A", disabled: true }),
      action({ id: "b", title: "B" }),
      action({ id: "c", title: "C", disabled: true })
    ];
    expect(stepHighlight(items, -1, 1)).toBe(1);
    expect(stepHighlight(items, 1, 1)).toBe(1);
    expect(stepHighlight(items, 1, -1)).toBe(1);

    const allDisabled = items.map((item) => ({ ...item, disabled: true }));
    expect(stepHighlight(allDisabled, -1, 1)).toBe(-1);
    expect(stepHighlight([], 0, 1)).toBe(-1);
  });

  test("firstEnabledIndex 落在第一条可用动作上", () => {
    expect(firstEnabledIndex(registry)).toBe(0);
    expect(firstEnabledIndex([registry[4], registry[0]])).toBe(1);
    expect(firstEnabledIndex([registry[4]])).toBe(-1);
  });
});

describe("isRunnable", () => {
  test("只有未禁用且有 run 的动作可执行", () => {
    const callback = () => undefined;
    expect(isRunnable(action({ id: "a", title: "A", run: callback }))).toBe(true);
    expect(isRunnable(action({ id: "b", title: "B" }))).toBe(false);
    expect(isRunnable(action({ id: "c", title: "C", run: callback, disabled: true }))).toBe(false);
  });
});
