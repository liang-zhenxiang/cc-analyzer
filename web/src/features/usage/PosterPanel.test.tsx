import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges } from "../../api/types";
import { NotificationProvider } from "../../app/NotificationProvider";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { PosterPanel } from "./PosterPanel";

const NOW = new Date(2026, 0, 15, 12, 0).getTime();

function recordAt(id: string, timestamp: number): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    model: "claude-sonnet-4-5-20250929",
    usage: { inputTokens: 1000, outputTokens: 200 }
  };
}

const INPUTS: UsageSessionInput[] = [
  { projectLabel: "-work", records: [recordAt("a", NOW - 60_000), recordAt("b", NOW)] }
];

function bridgesOf(options: { withBinary: boolean }): Bridges {
  const fs: Record<string, unknown> = {
    readDir: vi.fn(async () => []),
    readText: vi.fn(async () => ""),
    readHead: vi.fn(async () => ""),
    writeText: vi.fn(async () => undefined),
    stat: vi.fn(async () => ({ is_file: true, size: 0, mtime_ms: 0 })),
    homeDir: vi.fn(async () => "/home/tester"),
    appDataDir: vi.fn(async () => "/app-data")
  };
  if (options.withBinary) {
    fs.writeBinary = vi.fn(async () => undefined);
  }
  return {
    fs,
    dialog: {
      saveText: vi.fn(async () => null),
      saveMarkdown: vi.fn(async () => null),
      savePath: vi.fn(async () => "/tmp/cc-analyzer-poster.png"),
      openFile: vi.fn(async () => null)
    },
    updater: { appVersion: vi.fn(async () => "0.31.0") },
    events: { onSessionImport: vi.fn(async () => () => undefined) }
  } as unknown as Bridges;
}

function renderPanel(bridges: Bridges, inputs: UsageSessionInput[] = INPUTS) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NotificationProvider>
      <BridgesProvider bridges={bridges}>{children}</BridgesProvider>
    </NotificationProvider>
  );
  return render(<PosterPanel inputs={inputs} now={NOW} />, { wrapper });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PosterPanel（D5 开发者海报）", () => {
  it("没有 token 也没有消息时，两个导出都禁用并如实说明", () => {
    renderPanel(bridgesOf({ withBinary: true }), []);

    expect(screen.getByText("还没有可做海报的数据")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 PNG" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导出 SVG" })).toBeDisabled();
  });

  it("缺 writeBinary 时只禁用 PNG，并给出可用的替代路线", () => {
    renderPanel(bridgesOf({ withBinary: false }));

    const png = screen.getByRole("button", { name: "导出 PNG" });
    expect(png).toBeDisabled();
    expect(png).toHaveAttribute("title", "当前版本不支持导出 PNG（缺少二进制写入），可用 SVG");
    expect(screen.getByRole("button", { name: "导出 SVG" })).toBeEnabled();
    expect(
      screen.getByText("当前版本不支持导出 PNG（缺少二进制写入），可用 SVG")
    ).toBeInTheDocument();
  });

  it("预览是内联 SVG 图，点开才出现，且不含项目路径", async () => {
    const user = userEvent.setup();
    const bridges = bridgesOf({ withBinary: true });
    renderPanel(bridges);

    expect(screen.queryByAltText("开发者海报预览")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "预览" }));

    const preview = screen.getByAltText("开发者海报预览") as HTMLImageElement;
    expect(preview.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    const decoded = decodeURIComponent(preview.getAttribute("src")?.split(",")[1] ?? "");
    expect(decoded).toContain("我的 AI 工作方式");
    expect(decoded).toContain("已读 token");
    expect(decoded).not.toContain("-work");
  });

  it("导出 SVG：走保存对话框，写入的是同一张图", async () => {
    const user = userEvent.setup();
    const bridges = bridgesOf({ withBinary: true });
    renderPanel(bridges);

    await user.click(screen.getByRole("button", { name: "导出 SVG" }));

    const savePath = vi.mocked(bridges.dialog.savePath);
    await waitFor(() => expect(savePath).toHaveBeenCalledTimes(1));
    expect(savePath.mock.calls[0][0]).toMatch(/^cc-analyzer-poster-\d{4}-\d{2}-\d{2}-(light|dark)\.svg$/);
    const writeText = vi.mocked(bridges.fs.writeText);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][1]).toContain("<svg");
    expect(await screen.findByText("已导出开发者海报")).toBeInTheDocument();
  });

  it("导出 PNG：画布转 base64，经 writeBinary 落盘", async () => {
    const user = userEvent.setup();
    const bridges = bridgesOf({ withBinary: true });
    const context = {
      fillStyle: "",
      font: "",
      textBaseline: "",
      fillRect: vi.fn(),
      fillText: vi.fn()
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,UE5HIQ==");
    renderPanel(bridges);

    await user.click(screen.getByRole("button", { name: "导出 PNG" }));

    const writeBinary = vi.mocked(bridges.fs.writeBinary!);
    await waitFor(() => expect(writeBinary).toHaveBeenCalledTimes(1));
    expect(writeBinary.mock.calls[0][0]).toMatch(/\.png$/);
    expect(writeBinary.mock.calls[0][1]).toBe("UE5HIQ==");
    expect(context.fillText).toHaveBeenCalled();
  });

  it("取消保存不写文件、不报错、不提示", async () => {
    const user = userEvent.setup();
    const bridges = bridgesOf({ withBinary: true });
    vi.mocked(bridges.dialog.savePath).mockResolvedValue(null);
    renderPanel(bridges);

    await user.click(screen.getByRole("button", { name: "导出 SVG" }));

    await waitFor(() => expect(bridges.dialog.savePath).toHaveBeenCalledTimes(1));
    expect(bridges.fs.writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("已导出开发者海报")).not.toBeInTheDocument();
  });
});
