import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { HeartbeatPanel } from "./HeartbeatPanel";

const NOW = new Date(2026, 9, 15, 18, 0).getTime();

function at(day: number, hour: number, minute = 0): number {
  return new Date(2026, 9, day, hour, minute).getTime();
}

function record(kind: SessionRecord["kind"], timestamp: number): SessionRecord {
  return {
    id: `r-${timestamp}-${kind}`,
    fullId: `r-${timestamp}-${kind}`,
    kind,
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {}
  };
}

function input(
  projectLabel: string,
  records: SessionRecord[],
  meta?: { path: string; title: string }
): UsageSessionInput {
  return {
    projectLabel,
    records,
    ...(meta
      ? {
          session: {
            path: meta.path,
            projectLabel,
            hasRecords: true,
            mtimeMs: NOW,
            sizeBytes: 1,
            aiTitle: meta.title
          }
        }
      : {})
  };
}

describe("HeartbeatPanel（F8 对话心跳）", () => {
  it("按天模式：三条通道读数、最长静默与可访问摘要", () => {
    render(
      <HeartbeatPanel
        inputs={[
          input("p", [
            record("user", at(15, 9, 0)),
            record("user", at(15, 9, 5)),
            record("assistant", at(15, 9, 10)),
            record("tool", at(15, 11, 24))
          ])
        ]}
        days={7}
        now={NOW}
      />
    );

    const readout = screen.getByLabelText("心跳读数");
    expect(readout).toHaveTextContent(/用户\s*2/);
    expect(readout).toHaveTextContent(/助手\s*1/);
    expect(readout).toHaveTextContent(/工具\s*1/);
    expect(within(readout).getByText("2h14m")).toBeInTheDocument();

    const chart = screen.getByRole("img", { name: /对话心跳/ });
    expect(chart.getAttribute("aria-label")).toContain("10 月 15 日");
    expect(chart.getAttribute("aria-label")).toContain("最长静默 2 小时 14 分");
    expect(screen.getByText("静默 2 小时 14 分")).toBeInTheDocument();
  });

  it("窗口内没有可画的记录：给空态，不画空坐标系", () => {
    render(<HeartbeatPanel inputs={[]} days={7} now={NOW} />);

    expect(screen.getByText("所选范围内没有可画的一天")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /对话心跳/ })).not.toBeInTheDocument();
  });

  it("只有 wait / system：同样算没有可画的一天", () => {
    render(
      <HeartbeatPanel
        inputs={[input("p", [record("wait", at(15, 9)), record("system", at(15, 10))])]}
        days={7}
        now={NOW}
      />
    );

    expect(screen.getByText("所选范围内没有可画的一天")).toBeInTheDocument();
  });

  it("切到单会话：出现会话选择器，选中后会换成该会话自己的最近活动日", async () => {
    const user = userEvent.setup();
    render(
      <HeartbeatPanel
        inputs={[
          input("p", [record("user", at(14, 10))], {
            path: "/p/a.jsonl",
            title: "会话 A"
          }),
          input("p", [record("assistant", at(15, 17))], {
            path: "/p/b.jsonl",
            title: "会话 B"
          })
        ]}
        days={7}
        now={NOW}
      />
    );

    // 按天模式先看最近一天（10/15，只有会话 B 的助手记录）。
    let readout = screen.getByLabelText("心跳读数");
    expect(readout).toHaveTextContent(/助手\s*1/);
    expect(readout).toHaveTextContent(/用户\s*0/);

    await user.click(screen.getByRole("radio", { name: "单会话" }));

    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("/p/b.jsonl");

    await user.selectOptions(select, "/p/a.jsonl");

    readout = screen.getByLabelText("心跳读数");
    expect(readout).toHaveTextContent(/用户\s*1/);
    expect(readout).toHaveTextContent(/助手\s*0/);
    expect(screen.getByText(/10 月 14 日/)).toBeInTheDocument();
  });

  it("某条通道当天为 0：只留基线，不隐藏通道", () => {
    render(
      <HeartbeatPanel inputs={[input("p", [record("user", at(15, 9))])]} days={7} now={NOW} />
    );

    const chart = screen.getByRole("img", { name: /对话心跳/ });
    expect(chart.textContent).toContain("助手");
    expect(chart.textContent).toContain("工具");
    expect(chart.querySelectorAll('[data-heartbeat-channel="assistant"]')).toHaveLength(0);
    expect(chart.querySelectorAll('[data-heartbeat-channel="tool"]')).toHaveLength(0);
  });
});
