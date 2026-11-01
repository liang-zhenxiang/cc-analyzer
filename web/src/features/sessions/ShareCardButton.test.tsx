import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { ShareCardButton } from "./ShareCardButton";
import { shareCardContent, shareCardDayLabel, shareCardFileName, shortIdOf } from "./shareCard";
import type { ParsedSession, SessionRecord, SessionUsage } from "./types";
import type { SessionMeta } from "./metadataCache";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges } from "../../api/types";
import { NotificationProvider } from "../../app/NotificationProvider";

const T0 = new Date(2026, 9, 2, 9).getTime();

function usage(inputTokens: number): SessionUsage {
  return {
    inputTokens,
    outputTokens: 10,
    cacheCreationTokens: 0,
    cacheReadTokens: 0
  } as SessionUsage;
}

let seq = 0;
function record(kind: "user" | "assistant", ts: number, model?: string, usageValue?: SessionUsage): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `s:r${seq}`,
    kind,
    timestamp: ts,
    durationMs: 0,
    model,
    text: "",
    isError: false,
    usage: usageValue,
    raw: {}
  };
}

function parsedOf(records: SessionRecord[]): ParsedSession {
  return {
    sessionId: "abcd1234-5678-90ab-cdef-1234567890ab",
    path: "/logs/s1.jsonl",
    startedAt: records[0]?.timestamp ?? T0,
    endedAt: records[records.length - 1]?.timestamp ?? T0,
    records,
    turns: [],
    unmatchedToolUses: [],
    warnings: [],
    systemTurnDurations: [],
    skippedCounts: {},
    sidechainMessages: []
  };
}

const SESSION: SessionMeta = {
  path: "/logs/s1.jsonl",
  mtimeMs: 0,
  sizeBytes: 0,
  projectLabel: "proj",
  cwd: "/Users/dev/work/cc-analyzer",
  hasRecords: true
} as unknown as SessionMeta;

/** 完整桥：savePath/writeBinary 都在。 */
function makeBridges(overrides: Partial<Bridges> = {}): Bridges {
  return {
    dialog: { savePath: vi.fn(async () => "/out/card.png") },
    fs: { writeBinary: vi.fn(async () => undefined), readText: vi.fn(async () => "") },
    ...overrides
  } as unknown as Bridges;
}

function renderWith(bridges: Bridges, props: { session: SessionMeta; parsed: ParsedSession }) {
  return render(
    <BridgesProvider bridges={bridges}>
      <NotificationProvider>
        <ShareCardButton {...props} />
      </NotificationProvider>
    </BridgesProvider>
  );
}

describe("ShareCardButton（H8 会话分享卡）", () => {
  afterEach(() => cleanup());

  it("桥接齐全：按钮可点，导出流程 savePath→writeBinary 走通", async () => {
    const user = userEvent.setup();
    const bridges = makeBridges();
    // jsdom 没有 2d canvas：mock 掉 getContext/toDataURL（PosterPanel.test 同款）。
    const context = {
      fillStyle: "",
      font: "",
      textBaseline: "",
      fillRect: vi.fn(),
      fillText: vi.fn()
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,UE5HIQ==");
    const parsed = parsedOf([
      record("user", T0),
      record("assistant", T0 + 1000, "claude-sonnet-4-5", usage(1200))
    ]);
    renderWith(bridges, { session: SESSION, parsed });
    const button = screen.getByRole("button", { name: "分享卡" });
    expect(button).toBeEnabled();
    await user.click(button);
    // savePath 收到的文件名带短 id；写盘收到 base64。
    const savePath = bridges.dialog.savePath as ReturnType<typeof vi.fn>;
    const writeBinary = bridges.fs.writeBinary as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => {
      expect(savePath).toHaveBeenCalledWith(
        "cca-session-card-abcd1234.png",
        expect.objectContaining({ extensions: ["png"] })
      );
      expect(writeBinary).toHaveBeenCalledTimes(1);
      expect(writeBinary.mock.calls[0][1]).toBe("UE5HIQ==");
    });
    // 画布确实画了字（管线走到了 drawPoster）。
    expect(context.fillText).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("桥接缺失（writeBinary 不存在）：disabled + title 说明，不留死按钮", () => {
    const bridges = makeBridges();
    // 抹掉 writeBinary——运行时环境里旧宿主就是没这个函数。
    delete (bridges.fs as { writeBinary?: unknown }).writeBinary;
    const parsed = parsedOf([record("user", T0), record("assistant", T0 + 1000)]);
    renderWith(bridges, { session: SESSION, parsed });
    const button = screen.getByRole("button", { name: "分享卡" });
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toContain("不支持导出 PNG");
  });
});

describe("shareCardContent（卡面数据）", () => {
  it("标题是常量「一次 Claude Code 会话」——不印会话名（§2-⑤）", () => {
    const content = shareCardContent({
      projectBasename: "cc-analyzer",
      dayLabel: "2026-10-02",
      durationMs: 12 * 60_000,
      totalTokens: 1234,
      toolCallCount: 5,
      modelLabel: "claude-sonnet-4-5",
      sessionId: "abcd1234-9999"
    });
    expect(content.title).toBe("一次 Claude Code 会话");
    // 副标题 = 项目 basename + 日期，没有路径分隔符。
    expect(content.period).toBe("cc-analyzer · 2026-10-02");
    expect(content.period).not.toContain("/");
    // 页脚短 id 前 8 位。
    expect(content.model).toBe("会话 abcd1234");
    // 四读数 cells。
    expect(content.cells.map((cell) => cell.label)).toEqual([
      "会话时长",
      "token（四类合计）",
      "次工具调用",
      "主导模型"
    ]);
  });

  it("无 token 读数印「—」不印 0；模型未知印「未知」", () => {
    const content = shareCardContent({
      projectBasename: null,
      dayLabel: "2026-10-02",
      durationMs: 60_000,
      totalTokens: null,
      toolCallCount: 0,
      modelLabel: null,
      sessionId: "abcd1234"
    });
    expect(content.cells[1].value).toBe("—");
    expect(content.cells[3].value).toBe("未知");
    expect(content.period).toContain("未知项目");
  });

  it("工具函数：dayLabel 补零、fileName 带短 id、shortId 截前 8 位", () => {
    expect(shareCardDayLabel(new Date(2026, 0, 5, 9).getTime())).toBe("2026-01-05");
    expect(shareCardFileName("abcd1234")).toBe("cca-session-card-abcd1234.png");
    expect(shortIdOf("abcd1234-9999-8888")).toBe("abcd1234");
    expect(shortIdOf("short")).toBe("short");
  });
});
