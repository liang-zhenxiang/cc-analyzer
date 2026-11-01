import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionHeader } from "./SessionHeader";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges } from "../../api/types";
import { NotificationProvider } from "../../app/NotificationProvider";
import type { ClipboardService } from "../../api/types";
import type { SessionMeta } from "./metadataCache";
import type { ParsedSession, SessionRecord } from "./types";

const ID = "3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11";

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    path: `/home/me/.claude/projects/-repo-demo/${ID}.jsonl`,
    mtimeMs: 0,
    sizeBytes: 10,
    projectLabel: "repo-demo",
    sessionId: ID,
    cwd: "/repo/demo",
    hasRecords: true,
    ...overrides
  };
}

/** 队友 H8 的 ShareCardButton 挂进了 SessionHeader（parsed 才渲染），
 *  它 useBridges——所有渲染路径都要 BridgesProvider 兜底。桥接成员给
 *  no-op：分享卡按钮在无 fs/窗口桥接时自行 disabled，不影响这里的断言。 */
const TEST_BRIDGES: Bridges = {
  fs: { writeBinary: vi.fn(async () => undefined), readText: vi.fn(async () => "") },
  system: { openFolder: vi.fn(async () => undefined) },
  clipboard: { writeText: vi.fn(async () => undefined) }
} as unknown as Bridges;

function renderHeader(
  session: SessionMeta,
  clipboard: ClipboardService,
  parsed: ParsedSession | null = null
) {
  return render(
    <BridgesProvider bridges={TEST_BRIDGES}>
    <NotificationProvider>
      {/* H8 分享卡按钮要桥面：给一个最小测试桥（savePath/writeBinary 缺失
          只会让按钮 disabled，不影响既有断言）。 */}
      <BridgesProvider
        bridges={
          {
            dialog: {},
            fs: {},
            events: { onSessionImport: async () => () => undefined }
          } as unknown as Bridges
        }
      >
            <SessionHeader
            session={session}
            parsed={parsed}
            tokenPanelOpen={false}
            onToggleTokenPanel={() => undefined}
            onOpenFolder={() => undefined}
            onExport={() => undefined}
          clipboard={clipboard}
        />
      </BridgesProvider>
    </NotificationProvider>
    </BridgesProvider>
  );
}

const PARSED: ParsedSession = {
  sessionId: ID,
  path: `/home/me/.claude/projects/-repo-demo/${ID}.jsonl`,
  startedAt: 0,
  endedAt: 1_000,
  records: [],
  turns: [],
  unmatchedToolUses: [],
  warnings: [],
  systemTurnDurations: [],
  skippedCounts: {},
  sidechainMessages: []
};

test("offers export only once the session has parsed", () => {
  const clipboard = { writeText: vi.fn(async () => undefined) };
  const { rerender } = renderHeader(meta(), clipboard);
  // 解析中没有数据可导，摆一个禁用按钮只是噪音。
  expect(screen.queryByRole("button", { name: "导出" })).toBeNull();

  rerender(
    <NotificationProvider>
      <BridgesProvider
        bridges={
          {
            dialog: {},
            fs: {},
            events: { onSessionImport: async () => () => undefined }
          } as unknown as Bridges
        }
      >
        <SessionHeader
          session={meta()}
          parsed={PARSED}
          tokenPanelOpen={false}
          onToggleTokenPanel={() => undefined}
          onOpenFolder={() => undefined}
          onExport={() => undefined}
          clipboard={clipboard}
        />
      </BridgesProvider>
    </NotificationProvider>
  );
  expect(screen.getByRole("button", { name: "导出" })).toBeInTheDocument();
});

test("copies the exact resume command and confirms it", async () => {
  const user = userEvent.setup();
  const clipboard = { writeText: vi.fn(async () => undefined) };
  renderHeader(meta(), clipboard);

  await user.click(screen.getByRole("button", { name: "复制 resume 命令" }));

  expect(clipboard.writeText).toHaveBeenCalledWith(
    `cd "/repo/demo" && claude --resume ${ID}`
  );
  expect(await screen.findByText("已复制 resume 命令")).toBeInTheDocument();
});

test("degrades visibly when the session has no cwd", async () => {
  const user = userEvent.setup();
  const clipboard = { writeText: vi.fn(async () => undefined) };
  renderHeader(meta({ cwd: undefined }), clipboard);

  // 降级不是静默的：旁边要明说这条命令得在项目目录下执行。
  expect(screen.getByText("需在该会话的项目目录下执行")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "复制 resume 命令" }));
  expect(clipboard.writeText).toHaveBeenCalledWith(`claude --resume ${ID}`);
});

test("disables the button and explains why when there is no usable session id", () => {
  renderHeader(meta({ sessionId: undefined }), { writeText: vi.fn() });

  expect(screen.getByRole("button", { name: "复制 resume 命令" })).toBeDisabled();
  expect(
    screen.getByText("该会话缺少可用的会话 ID，无法生成 resume 命令")
  ).toBeInTheDocument();
});

test("surfaces a visible error when the clipboard rejects", async () => {
  const user = userEvent.setup();
  const clipboard = { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) };
  renderHeader(meta(), clipboard);

  await user.click(screen.getByRole("button", { name: "复制 resume 命令" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("复制 resume 命令失败: denied");
});

/* ── E7 上下文健康分（Round EE）───────────────────────────────── */

function usageRecord(id: string, at: number, inputTokens: number): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp: at,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    model: "claude-sonnet-4-5-20250929",
    usage: { inputTokens }
  };
}

function parsedWith(records: SessionRecord[]): ParsedSession {
  return {
    ...PARSED,
    records,
    compactEvents: []
  } as ParsedSession;
}

function healthScore(): HTMLElement {
  const node = document.querySelector('[data-probe="health-score"]');
  expect(node).not.toBeNull();
  return node as HTMLElement;
}

test("健康分按水位分档：90 分亮 success 竖条，数字本身不带色", () => {
  // 20k / 200k 阈值 = 10% → waterScore 90，无压缩无出血 → 90。
  renderHeader(meta(), { writeText: vi.fn(async () => undefined) }, parsedWith([
    usageRecord("a1", 1_000, 20_000)
  ]));

  const node = healthScore();
  expect(node).toHaveAttribute("data-tone", "healthy");
  expect(node.getAttribute("aria-label")).toBe("健康分 90");
  expect(node.textContent).toContain("90");
  expect(node.textContent).toContain("健康，余量充足");
});

test("70 分是「偏紧」一档：竖条走 chart-1，不是 success", () => {
  // 60k / 200k = 30% → waterScore 70。
  renderHeader(meta(), { writeText: vi.fn(async () => undefined) }, parsedWith([
    usageRecord("a1", 1_000, 60_000)
  ]));

  const node = healthScore();
  expect(node).toHaveAttribute("data-tone", "tight");
  expect(node.textContent).toContain("偏紧但可控");
});

test("水位贴近阈值时分数跌进警示档，但仍是一个整数读数", () => {
  // 180k / 200k = 90% → waterScore 10。
  renderHeader(meta(), { writeText: vi.fn(async () => undefined) }, parsedWith([
    usageRecord("a1", 1_000, 180_000)
  ]));

  const node = healthScore();
  expect(node).toHaveAttribute("data-tone", "bad");
  expect(node.textContent).toContain("紧张，建议尽快清理或收尾");
});

test("没有上下文读数时印「—」和「不可用」，不印 0 分", () => {
  renderHeader(meta(), { writeText: vi.fn(async () => undefined) }, parsedWith([]));

  const node = healthScore();
  expect(node).toHaveAttribute("data-tone", "none");
  expect(node.getAttribute("aria-label")).toBe("健康分不可用");
  // 0 分是一个断言（测到了 0），缺失不是；所以这里必须是破折号。
  expect(node.textContent).toContain("—");
  expect(node.textContent).toContain("不可用 · 没有上下文读数");
});

test("健康分挂在页头标题行里，会话读数行原样保留", () => {
  renderHeader(meta(), { writeText: vi.fn(async () => undefined) }, parsedWith([
    usageRecord("a1", 1_000, 20_000)
  ]));

  const header = screen.getByRole("banner", { name: "会话信息" });
  expect(header).toContainElement(healthScore());
  // 五格读数行没被挤掉：健康分是「加一格」不是「换一格」。
  expect(screen.getByRole("button", { name: "会话读数" })).toBeInTheDocument();
  expect(screen.getAllByText("总耗时")).toHaveLength(1);
});

test("E9：页头显示数据新鲜度，按最后一条记录算，不编扫描时刻", () => {
  const clipboard = { writeText: vi.fn(async () => undefined) };
  const parsed: ParsedSession = {
    ...PARSED,
    records: [
      {
        id: "r1",
        fullId: "r1",
        kind: "user",
        timestamp: Date.now() - 2.5 * 60_000,
        durationMs: 0,
        text: "hi",
        isError: false,
        raw: {}
      }
    ]
  };
  renderHeader(meta(), clipboard, parsed);

  const badge = document.querySelector<HTMLElement>('[data-probe="data-freshness"]');
  expect(badge).not.toBeNull();
  expect(badge?.textContent).toMatch(/^数据截至 \d{2}:\d{2}（2 分钟前）$/);
});

/* ── H5 重启徽章（Round HH，§4.5）────────────────────────────── */

function renderHeaderWithRestarts(restartCount: number | undefined) {
  const clipboard = { writeText: vi.fn(async () => undefined) };
  return render(
    <BridgesProvider bridges={TEST_BRIDGES}>
    <NotificationProvider>
      <BridgesProvider
        bridges={
          {
            dialog: {},
            fs: {},
            events: { onSessionImport: async () => () => undefined }
          } as unknown as Bridges
        }
      >
        <SessionHeader
          session={meta()}
          parsed={parsedWith([usageRecord("a1", 1_000, 20_000)])}
          tokenPanelOpen={false}
          onToggleTokenPanel={() => undefined}
          onOpenFolder={() => undefined}
          onExport={() => undefined}
          clipboard={clipboard}
          restartCount={restartCount}
        />
      </BridgesProvider>
    </NotificationProvider>
    </BridgesProvider>
  );
}

test("H5：链长 3 显示「重新发起 2 次」，title 带链位语义", () => {
  renderHeaderWithRestarts(3);

  const chip = document.querySelector<HTMLElement>('[data-probe="session-restart"]');
  expect(chip).not.toBeNull();
  expect(chip?.textContent).toBe("重新发起 2 次");
  expect(chip?.getAttribute("title")).toBe("同目录 24 小时内的第 3 次新会话");
});

test("H5：undefined 与 1 都不渲染——「没有概念」和「链首」不同形", () => {
  const first = renderHeaderWithRestarts(undefined);
  expect(document.querySelector('[data-probe="session-restart"]')).toBeNull();
  // 读数带本体还在，徽章缺席不是列表塌了。
  expect(screen.getByRole("button", { name: "会话读数" })).toBeInTheDocument();
  first.unmount();

  renderHeaderWithRestarts(1);
  expect(document.querySelector('[data-probe="session-restart"]')).toBeNull();
});

test("H5：徽章在读数带内、紧挨总耗时之后，是 span 不是嵌套 button", () => {
  renderHeaderWithRestarts(2);

  const readouts = screen.getByRole("button", { name: "会话读数" });
  const chip = document.querySelector<HTMLElement>('[data-probe="session-restart"]');
  expect(chip).not.toBeNull();
  expect(readouts).toContainElement(chip);
  // 读数带是 button：徽章必须是非聚焦 span，不能嵌套交互控件。
  expect(chip?.tagName).toBe("SPAN");
  // 顺序：总耗时 span 之后、输入 span 之前。
  const children = Array.from(readouts.querySelectorAll("span"));
  const chipIndex = children.findIndex((node) => node === chip);
  const durationIndex = children.findIndex((node) => node.textContent?.includes("总耗时"));
  const inputIndex = children.findIndex(
    (node) => node.textContent?.includes("输入") && node !== chip
  );
  expect(durationIndex).toBeGreaterThan(-1);
  expect(chipIndex).toBeGreaterThan(durationIndex);
  expect(inputIndex).toBeGreaterThan(chipIndex);
});

test("H5：链长 2 起才显示——链长 2 显示「重新发起 1 次」", () => {
  renderHeaderWithRestarts(2);

  const chip = document.querySelector<HTMLElement>('[data-probe="session-restart"]');
  expect(chip?.textContent).toBe("重新发起 1 次");
});
