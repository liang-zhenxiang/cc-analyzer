import { cssColorFor, normalizeTerminalText, parseAnsi, stripAnsi } from "./ansi";

const ESC = "\u001b";

test("strips SGR, CSI and OSC sequences down to plain text", () => {
  expect(stripAnsi(`${ESC}[31m红色${ESC}[0m`)).toBe("红色");
  expect(stripAnsi(`${ESC}[2K清屏前${ESC}[1;1H再画`)).toBe("清屏前再画");
  // 窗口标题（OSC）与 8 位 CSI 都不该出现在文本里。
  expect(stripAnsi(`${ESC}]0;npm run build\u0007输出`)).toBe("输出");
  expect(stripAnsi(`\u009b31m红色\u009b0m`)).toBe("红色");
  expect(stripAnsi(`${ESC}(B字符集`)).toBe("字符集");
  // 残缺序列（无终止字节）也要被吃掉，不能把半个转义留在正文里。
  expect(stripAnsi(`前面${ESC}[`)).toBe("前面");
});

test("resolves carriage-return rewrites the way a terminal would", () => {
  // 进度输出 10%\r55%\r100% 在终端里最终只看到最后一段（覆盖写）。
  expect(stripAnsi("progress 10%\rprogress 100%")).toBe("progress 100%");
  // 覆盖不是「只留最后一段」：后一段比前一段短时，前一段的尾巴要留下。
  expect(stripAnsi("abcdef\rXY")).toBe("XYcdef");
  expect(stripAnsi("10%\r5%")).toBe("5%%");
  expect(normalizeTerminalText("a\rb\nc\rd")).toBe("b\nd");
  expect(normalizeTerminalText("没有回车\n保持原样")).toBe("没有回车\n保持原样");
});

test("treats CRLF as a line ending, not as a rewind", () => {
  // `\r\n` 是行尾（Windows 工具、tail、任何 CRLF 抓取），不是「回到行首」；
  // 把它当回写会把整行清空——这是静默丢字，比颜色错严重得多。
  expect(stripAnsi("line1\r\nline2\r\n")).toBe("line1\nline2\n");
  expect(normalizeTerminalText("abc\r\n")).toBe("abc\n");
  expect(stripAnsi("10%\r50%\r100%\r\n")).toBe("100%\n");
});

test("does not swallow the character after a stray escape byte", () => {
  // 正文里混进一个游离 ESC（截断的日志）时，后面那个真字符必须留下。
  expect(stripAnsi("前\u001b中后")).toBe("前中后");
  expect(stripAnsi("前\u001b\u{1f600}后")).toBe("前\u{1f600}后");
  // 合法的两字节转义（ESC c = 复位）仍然整条吃掉。
  expect(stripAnsi("前\u001bc后")).toBe("前后");
});

test("carries style across runs and resets it", () => {
  const spans = parseAnsi(`${ESC}[1;31m粗红${ESC}[0m普通`);
  expect(spans).toHaveLength(2);
  expect(spans[0].style).toEqual({ bold: true, fg: { kind: "palette", index: 1 } });
  expect(spans[0].text).toBe("粗红");
  expect(spans[1].style).toEqual({});
  expect(spans[1].text).toBe("普通");
});

test("clears one attribute at a time", () => {
  const spans = parseAnsi(`${ESC}[1;4m粗下划线${ESC}[24m仍有粗体${ESC}[22m都没有`);
  expect(spans[0].style).toEqual({ bold: true, underline: true });
  expect(spans[1].style).toEqual({ bold: true });
  expect(spans[2].style).toEqual({});
});

test("handles bright, background and explicit reset codes", () => {
  const [span] = parseAnsi(`${ESC}[91;44m反白`); // 91 亮红前景，44 蓝背景
  expect(span.style.fg).toEqual({ kind: "palette", index: 9 });
  expect(span.style.bg).toEqual({ kind: "palette", index: 4 });

  const [afterFgReset] = parseAnsi(`${ESC}[31;42m${ESC}[39m只有背景`);
  expect(afterFgReset.style.fg).toBeUndefined();
  expect(afterFgReset.style.bg).toEqual({ kind: "palette", index: 2 });

  const [afterBgReset] = parseAnsi(`${ESC}[31;42m${ESC}[49m只有前景`);
  expect(afterBgReset.style.bg).toBeUndefined();
  expect(afterBgReset.style.fg).toEqual({ kind: "palette", index: 1 });
});

test("parses 256-colour and true-colour sequences", () => {
  const [indexed] = parseAnsi(`${ESC}[38;5;208m橙`);
  // 0–15 归主题调色板，其余走固定 RGB——主题切换只该影响终端基本色。
  expect(indexed.style.fg).toEqual({ kind: "indexed", index: 208 });
  expect(cssColorFor(indexed.style.fg)).toBe("rgb(255 135 0)");

  const [basic] = parseAnsi(`${ESC}[38;5;4m蓝`);
  expect(basic.style.fg).toEqual({ kind: "palette", index: 4 });

  const [gray] = parseAnsi(`${ESC}[38;5;240m灰`);
  expect(cssColorFor(gray.style.fg)).toBe("rgb(88 88 88)");

  const [rgb] = parseAnsi(`${ESC}[38;2;12;189;240m真彩`);
  expect(rgb.style.fg).toEqual({ kind: "rgb", r: 12, g: 189, b: 240 });
  expect(cssColorFor(rgb.style.fg)).toBe("rgb(12 189 240)");
});

test("accepts the colon-separated spelling of 256-colour", () => {
  const [span] = parseAnsi(`${ESC}[38:5:196m红`);
  expect(span.style.fg).toEqual({ kind: "indexed", index: 196 });
});

test("drops an out-of-range colour instead of inventing one", () => {
  // 越界分量、缺分量、非整数：一律不设色，正文照常输出。
  const [tooBig] = parseAnsi(`${ESC}[38;2;300;0;0m超界`);
  expect(tooBig.text).toBe("超界");
  expect(tooBig.style.fg).toBeUndefined();
  expect(cssColorFor(tooBig.style.fg)).toBeUndefined();

  const [missing] = parseAnsi(`${ESC}[38;2;1;2m缺分量`);
  expect(missing.style.fg).toBeUndefined();

  expect(cssColorFor({ kind: "rgb", r: -1, g: 0, b: 0 })).toBeUndefined();
  expect(cssColorFor({ kind: "rgb", r: 1.5, g: 0, b: 0 })).toBeUndefined();
  expect(cssColorFor({ kind: "indexed", index: 999 })).toBeUndefined();
  expect(cssColorFor(undefined)).toBeUndefined();
});

test("never lets transcript text become CSS", () => {
  // 会话内容是不可信输入：颜色只能由我们按白名单拼出来，正文里写什么都是正文。
  const [span] = parseAnsi(`${ESC}[38;2;1;2;3mcolor:red;background:url(evil)`);
  expect(span.style).toEqual({ fg: { kind: "rgb", r: 1, g: 2, b: 3 } });
  expect(cssColorFor(span.style.fg)).toBe("rgb(1 2 3)");
  expect(span.text).toBe("color:red;background:url(evil)");

  // 没有转义序列时，一串看起来像 CSS 的文本也只是文本。
  const [plain] = parseAnsi("color:red;background:url(evil)");
  expect(plain.style).toEqual({});

  // 任何 cssColorFor 的输出只可能是 var(--ansi-N) 或 rgb(r g b)。
  for (let index = 0; index < 16; index += 1) {
    expect(cssColorFor({ kind: "palette", index })).toMatch(/^var\(--ansi-\d+\)$/);
  }
  for (let index = 16; index < 256; index += 1) {
    expect(cssColorFor({ kind: "indexed", index })).toMatch(/^rgb\(\d{1,3} \d{1,3} \d{1,3}\)$/);
  }
});

test("merges adjacent runs that share a style", () => {
  // 不合并的话，一份日志会变成几百个 span（每个转义一次）。
  const spans = parseAnsi(`${ESC}[31m红${ESC}[31m还是红${ESC}[32m绿`);
  expect(spans).toHaveLength(2);
  expect(spans[0].text).toBe("红还是红");
  expect(spans[1].text).toBe("绿");
});

test("keeps plain text as a single unstyled span", () => {
  const spans = parseAnsi("没有转义");
  expect(spans).toEqual([{ text: "没有转义", style: {} }]);
  expect(parseAnsi("")).toEqual([]);
});

test("ignores unknown SGR codes without eating the text", () => {
  const [span] = parseAnsi(`${ESC}[53m上划线${ESC}[0m`);
  expect(span.text).toBe("上划线");
  expect(span.style).toEqual({});
});
