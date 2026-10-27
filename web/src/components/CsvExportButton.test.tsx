import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BridgesProvider } from "../api/bridges";
import { NotificationProvider } from "../app/NotificationProvider";
import type { Bridges } from "../api/types";
import { CSV_BOM, CSV_EOL } from "../features/usage/csvExport";
import { CsvExportButton } from "./CsvExportButton";

/**
 * 只钉三件事：写进去的**字节**、取消不是失败、失败必须看得见。
 * 桥接层用一行 `as unknown as Bridges` 的手写桩——这里要验的是按钮的行为，
 * 不是整个 Bridges 的形状（那由 `api/bridges` 自己的测试负责）。
 */
function harness(save: (name: string, contents: string) => Promise<string | null>) {
  const saveText = vi.fn(
    async (
      defaultName: string,
      contents: string,
      _options: { title: string; filterName: string; extensions: string[] }
    ) => save(defaultName, contents)
  );
  const bridges = { dialog: { saveText } } as unknown as Bridges;
  render(
    <NotificationProvider>
      <BridgesProvider bridges={bridges}>
        <CsvExportButton
          filename="models.csv"
          headers={["模型", "token"]}
          rows={[
            ["Sonnet", 1200],
            ["Opus", 300]
          ]}
          probe="csv-export-models"
        />
      </BridgesProvider>
    </NotificationProvider>
  );
  return { saveText };
}

beforeEach(() => {
  localStorage.clear();
});

describe("CsvExportButton", () => {
  test("点击后把 BOM + CSV 交给 dialog.saveText，并 toast 行数", async () => {
    const user = userEvent.setup();
    const { saveText } = harness(async () => "/tmp/models.csv");

    await user.click(screen.getByRole("button", { name: "导出 CSV" }));

    expect(saveText).toHaveBeenCalledTimes(1);
    const [name, contents, options] = saveText.mock.calls[0];
    expect(name).toBe("models.csv");
    expect(contents).toBe(
      `${CSV_BOM}模型,token${CSV_EOL}Sonnet,1200${CSV_EOL}Opus,300${CSV_EOL}`
    );
    expect(options).toEqual({
      title: "导出 CSV",
      filterName: "CSV",
      extensions: ["csv"]
    });
    await screen.findByText("已导出 2 行 CSV");
  });

  test("保存框取消（null）不是失败：无红字、无 toast", async () => {
    const user = userEvent.setup();
    harness(async () => null);

    await user.click(screen.getByRole("button", { name: "导出 CSV" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText(/已导出/u)).toBeNull();
  });

  test("写入失败：就地 role=alert 报原因，并加一条 error toast", async () => {
    const user = userEvent.setup();
    harness(async () => {
      throw new Error("磁盘只读");
    });

    await user.click(screen.getByRole("button", { name: "导出 CSV" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("导出失败：磁盘只读");
    // 同一句话也进 toast（`<output>`）：关掉面板前用户仍能看到它出过错。
    await waitFor(() => {
      expect(document.querySelector("output")?.textContent).toBe("导出失败：磁盘只读");
    });
  });

  test("没有数据行时按钮禁用并说明原因", () => {
    const bridges = { dialog: { saveText: vi.fn() } } as unknown as Bridges;
    render(
      <NotificationProvider>
        <BridgesProvider bridges={bridges}>
          <CsvExportButton filename="x.csv" headers={["a"]} rows={[]} probe="csv-export-projects" />
        </BridgesProvider>
      </NotificationProvider>
    );

    const button = screen.getByRole("button", { name: "无可导出" });
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toBe("没有可导出的行");
  });

  test("挂载点锚点按传入的 probe 渲染", () => {
    const bridges = { dialog: { saveText: vi.fn() } } as unknown as Bridges;
    const { container } = render(
      <NotificationProvider>
        <BridgesProvider bridges={bridges}>
          <CsvExportButton filename="x.csv" headers={["a"]} rows={[["1"]]} probe="csv-export-top-calls" />
        </BridgesProvider>
      </NotificationProvider>
    );
    expect(container.querySelector('[data-probe="csv-export-top-calls"]')).not.toBeNull();
  });
});
