import { describe, expect, it } from "vitest";
import { resumeCommand } from "./resumeCommand";

const ID = "3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11";

describe("resumeCommand", () => {
  it("prefixes the project directory so the session can be found", () => {
    const command = resumeCommand({ sessionId: ID, cwd: "/repo/demo" });

    // 逐字符断言：一个引号或空格的偏差都会让用户粘进终端后找不到会话。
    expect(command).toEqual({
      text: `cd "/repo/demo" && claude --resume ${ID}`,
      degraded: false
    });
  });

  it("degrades to the bare command and flags it when cwd is missing", () => {
    expect(resumeCommand({ sessionId: ID })).toEqual({
      text: `claude --resume ${ID}`,
      degraded: true
    });
  });

  it("treats a blank cwd as missing", () => {
    expect(resumeCommand({ sessionId: ID, cwd: "   " })).toEqual({
      text: `claude --resume ${ID}`,
      degraded: true
    });
  });

  it("returns null when the session has no id", () => {
    expect(resumeCommand({ cwd: "/repo/demo" })).toBeNull();
    expect(resumeCommand({ sessionId: "   ", cwd: "/repo/demo" })).toBeNull();
  });

  it("rejects an id that is not a UUID, so a crafted file cannot inject a command", () => {
    // sessionId 来自磁盘上的 JSONL；未校验就拼接会让用户粘贴时执行到后半段。
    expect(resumeCommand({ sessionId: "abc; rm -rf ~", cwd: "/repo/demo" })).toBeNull();
  });

  it("quotes a path with spaces", () => {
    expect(resumeCommand({ sessionId: ID, cwd: "/Users/me/my project" })?.text).toBe(
      `cd "/Users/me/my project" && claude --resume ${ID}`
    );
  });

  it("escapes a double quote inside the path", () => {
    expect(resumeCommand({ sessionId: ID, cwd: '/repo/my "quoted" dir' })?.text).toBe(
      `cd "/repo/my \\"quoted\\" dir" && claude --resume ${ID}`
    );
  });

  it("neutralizes $ and backticks inside the path", () => {
    expect(resumeCommand({ sessionId: ID, cwd: "/repo/$HOME" })?.text).toBe(
      `cd "/repo/\\$HOME" && claude --resume ${ID}`
    );
    expect(resumeCommand({ sessionId: ID, cwd: "/repo/`whoami`" })?.text).toBe(
      `cd "/repo/\\\`whoami\\\`" && claude --resume ${ID}`
    );
  });

  it("normalizes Windows backslashes to forward slashes", () => {
    // 保留反斜杠会引发转义难题；正斜杠在 cmd.exe / PowerShell / POSIX shell 都成立。
    expect(resumeCommand({ sessionId: ID, cwd: "C:\\Users\\me" })?.text).toBe(
      `cd "C:/Users/me" && claude --resume ${ID}`
    );
  });

  it("keeps a trailing backslash (drive root) from eating the closing quote", () => {
    // `C:\` 若原样保留，收尾的反斜杠会转义我们补上的引号（`cd "C:\"` 引号不闭合）。
    expect(resumeCommand({ sessionId: ID, cwd: "C:\\" })?.text).toBe(
      `cd "C:/" && claude --resume ${ID}`
    );
  });

  it("handles a backslash followed by a double quote", () => {
    expect(resumeCommand({ sessionId: ID, cwd: 'C:\\my "dir"' })?.text).toBe(
      `cd "C:/my \\"dir\\"" && claude --resume ${ID}`
    );
  });

  it("handles a backslash followed by a dollar sign", () => {
    expect(resumeCommand({ sessionId: ID, cwd: "C:\\$dir" })?.text).toBe(
      `cd "C:/\\$dir" && claude --resume ${ID}`
    );
  });

  it("degrades when the cwd contains a control character", () => {
    // 换行在终端里要么变成断行、要么变成第二条命令——引用救不了，降级为裸命令。
    expect(resumeCommand({ sessionId: ID, cwd: "/repo/a\nb" })).toEqual({
      text: `claude --resume ${ID}`,
      degraded: true
    });
  });
});
