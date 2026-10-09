import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangedFilesView } from "./ChangedFilesView";
import { parseJsonlText } from "./parseJsonl";

import changedFilesFixture from "../../../tests/fixtures/changed-files-session.jsonl?raw";
import basicFixture from "../../../tests/fixtures/session-basic.jsonl?raw";

function parsedChangedFiles() {
  return parseJsonlText(changedFilesFixture, "/tmp/changed-files-session.jsonl");
}

/** 文件行按钮：可访问名含相对路径（记录行的名字里只有工具名，不会撞）。 */
function fileRow(relPath: string) {
  const pattern = relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return screen.getByRole("button", { name: new RegExp(pattern) });
}

describe("ChangedFilesView 主流程", () => {
  it("渲染聚合读数与三行文件（计数、新建徽标、子 agent 徽标来自夹具）", () => {
    render(<ChangedFilesView parsed={parsedChangedFiles()} onLocateInLog={vi.fn()} />);

    // 聚合读数（裁决 #12 的文字行）：3 个文件 · 5 次改动 · 3 次查看 · 1 个新建。
    expect(
      screen.getByText("3 个文件 · 5 次改动 · 3 次查看 · 1 个新建")
    ).toBeInTheDocument();

    // 排序 lastAt 降序：A（含 sidechain）→ B（仅查看）→ C（cwd 外）。
    const rows = screen.getAllByRole("button", { name: /foo\.ts|bar\.md|\/etc\/hosts/ });
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("src/web/foo.ts"),
      expect.stringContaining("docs/bar.md"),
      expect.stringContaining("/etc/hosts")
    ]);

    // A 行：改动 4（Edit 3 含子链 + Write 1）、查看 2、「新建」「子agent 1」徽标。
    const rowA = fileRow("src/web/foo.ts");
    expect(rowA).toHaveTextContent("4");
    expect(rowA).toHaveTextContent("2");
    expect(within(rowA).getByText("新建")).toBeInTheDocument();
    expect(within(rowA).getByText("子agent 1")).toBeInTheDocument();
    // 全路径只进 title（隐私约定），界面只见相对路径。
    expect(rowA).toHaveAttribute(
      "title",
      expect.stringContaining("/repo/changed-demo/src/web/foo.ts")
    );
    // B 行：零改动列是「—」，无任何徽标。
    const rowB = fileRow("docs/bar.md");
    expect(within(rowB).getByText("—")).toBeInTheDocument();
    expect(within(rowB).queryByText("新建")).not.toBeInTheDocument();

    // 口径脚注常显（空态与数据态都要在场——藏起来的口径等于没有口径）。
    expect(screen.getByText(/改动 = 成功的 Edit \/ Write \/ NotebookEdit/)).toBeInTheDocument();
    expect(screen.getByText(/不含 Bash 等间接写文件的调用/)).toBeInTheDocument();
  });

  it("点文件行展开记录清单（单开手风琴），再点收起", async () => {
    const user = userEvent.setup();
    render(<ChangedFilesView parsed={parsedChangedFiles()} onLocateInLog={vi.fn()} />);

    const rowA = fileRow("src/web/foo.ts");
    await user.click(rowA);
    expect(rowA).toHaveAttribute("aria-expanded", "true");

    // 展开区：7 条记录（含失败现场）+ 失败小结；记录时间正序，首条是第一次 Read。
    const records = document.querySelector("[data-changes-records]");
    expect(records).not.toBeNull();
    const recordButtons = within(records as HTMLElement).getAllByRole("button");
    expect(recordButtons).toHaveLength(7);
    expect(within(records as HTMLElement).getByText(/7 条记录 · 其中 1 次失败/)).toBeInTheDocument();
    expect(within(records as HTMLElement).getAllByText("失败")).toHaveLength(1);
    expect(recordButtons[0]).toHaveTextContent("Read");
    // 失败的 Edit 与子 agent 的 Edit 都在下钻清单里（失败不计数但可见）。
    expect(recordButtons.map((button) => button.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Edit失败"), expect.stringContaining("Edit子 agent")])
    );

    // 单开：展开 B 时 A 自动收起。
    const rowB = fileRow("docs/bar.md");
    await user.click(rowB);
    expect(rowA).toHaveAttribute("aria-expanded", "false");
    expect(rowB).toHaveAttribute("aria-expanded", "true");
    expect(within(document.querySelector("[data-changes-records]") as HTMLElement).getByText(
      /1 条记录 · 首次/
    )).toBeInTheDocument();

    // 再点 B 收起。
    await user.click(rowB);
    expect(rowB).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("[data-changes-records]")).toBeNull();
  });

  it("点记录行回调定位；sidechain 记录照调不拦（裁决）", async () => {
    const onLocateInLog = vi.fn();
    const user = userEvent.setup();
    render(<ChangedFilesView parsed={parsedChangedFiles()} onLocateInLog={onLocateInLog} />);

    await user.click(fileRow("src/web/foo.ts"));
    const records = document.querySelector("[data-changes-records]") as HTMLElement;
    const recordButtons = within(records).getAllByRole("button");

    await user.click(recordButtons[2]);
    expect(onLocateInLog).toHaveBeenCalledWith("cf-edit-a1");
    // 最后一条是子链的 Edit：点击照常回调（跳回日志现场仍是有效落点）。
    await user.click(recordButtons[6]);
    expect(onLocateInLog).toHaveBeenCalledWith("cf-edit-a4");
    expect(onLocateInLog).toHaveBeenCalledTimes(2);
  });

  it("键盘：↑↓ 移动文件行，Enter 展开，Esc 收起", async () => {
    const user = userEvent.setup();
    render(<ChangedFilesView parsed={parsedChangedFiles()} onLocateInLog={vi.fn()} />);

    const scroller = screen.getByLabelText("改动文件列表");
    scroller.focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(fileRow("docs/bar.md")).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(fileRow("docs/bar.md")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("ChangedFilesView 空态（design §3.5）", () => {
  it("纯问答会话：如实文案，脚注照常在场", () => {
    render(
      <ChangedFilesView
        parsed={parseJsonlText(basicFixture, "/tmp/session-basic.jsonl")}
        onLocateInLog={vi.fn()}
      />
    );

    expect(screen.getByText("本会话没有接触任何文件")).toBeInTheDocument();
    expect(
      screen.getByText("没有成功的 Edit / Write / NotebookEdit，也没有 Read。")
    ).toBeInTheDocument();
    expect(screen.getByText(/改动 = 成功的 Edit \/ Write \/ NotebookEdit/)).toBeInTheDocument();
    // 空态省略聚合读数（没有数字可念）。
    expect(screen.queryByText(/个文件/)).not.toBeInTheDocument();
  });
});
