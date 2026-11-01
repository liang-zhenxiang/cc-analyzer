import { describe, expect, it } from "vitest";
import { emptyGuideSteps } from "./emptyGuide";

describe("emptyGuideSteps", () => {
  it("全空：第一步 current，其余 todo", () => {
    const { steps } = emptyGuideSteps({ hasDirectory: false, scanComplete: false, sessionCount: 0 });
    expect(steps.map((s) => [s.id, s.state])).toEqual([
      ["pick", "current"],
      ["scan", "todo"],
      ["explore", "todo"]
    ]);
  });

  it("选了目录但没扫完：第一步 done，第二步 current", () => {
    const { steps } = emptyGuideSteps({ hasDirectory: true, scanComplete: false, sessionCount: 0 });
    expect(steps.map((s) => s.state)).toEqual(["done", "current", "todo"]);
  });

  it("扫完但 0 会话：第二步仍 current，detail 换成排查文案", () => {
    const { steps } = emptyGuideSteps({ hasDirectory: true, scanComplete: true, sessionCount: 0 });
    expect(steps[1].state).toBe("current");
    expect(steps[1].detail).toBe("没找到会话文件，检查目录");
    // 第三步没轮到。
    expect(steps[2].state).toBe("todo");
  });

  it("扫完且有会话：前两步 done，第三步 current 收尾", () => {
    const { steps } = emptyGuideSteps({ hasDirectory: true, scanComplete: true, sessionCount: 7 });
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "current"]);
    // 收尾步的文案仍是行动指令（不是 done 后的灰色总结）。
    expect(steps[2].title).toBe("打开用量总览");
  });

  it("没选目录时扫描已完成的数据不推进第一步（目录是硬前提）", () => {
    // 异序输入（先有扫描结果后选目录）下，pick 仍挡在最前。
    const { steps } = emptyGuideSteps({ hasDirectory: false, scanComplete: true, sessionCount: 5 });
    expect(steps[0].state).toBe("current");
    expect(steps[1].state).toBe("todo");
    expect(steps[2].state).toBe("todo");
  });

  it("三步 id 与 title 稳定（界面层按 id 做 probe）", () => {
    const { steps } = emptyGuideSteps({ hasDirectory: true, scanComplete: true, sessionCount: 1 });
    expect(steps.map((s) => s.id)).toEqual(["pick", "scan", "explore"]);
    expect(steps.map((s) => s.title)).toEqual(["选择目录", "等待扫描", "打开用量总览"]);
  });
});
