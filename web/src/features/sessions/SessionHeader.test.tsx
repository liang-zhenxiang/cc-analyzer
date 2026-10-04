import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionHeader } from "./SessionHeader";
import { NotificationProvider } from "../../app/NotificationProvider";
import type { ClipboardService } from "../../api/types";
import type { SessionMeta } from "./metadataCache";
import type { ParsedSession } from "./types";

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

function renderHeader(
  session: SessionMeta,
  clipboard: ClipboardService,
  parsed: ParsedSession | null = null
) {
  return render(
    <NotificationProvider>
      <SessionHeader
        session={session}
        parsed={parsed}
        tokenPanelOpen={false}
        onToggleTokenPanel={() => undefined}
        onOpenFolder={() => undefined}
        onExport={() => undefined}
        clipboard={clipboard}
      />
    </NotificationProvider>
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
      <SessionHeader
        session={meta()}
        parsed={PARSED}
        tokenPanelOpen={false}
        onToggleTokenPanel={() => undefined}
        onOpenFolder={() => undefined}
        onExport={() => undefined}
        clipboard={clipboard}
      />
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
