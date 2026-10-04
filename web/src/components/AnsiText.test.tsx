import { render } from "@testing-library/react";
import { AnsiText } from "./AnsiText";

const ESC = "\u001b";
/** 浏览器会把内联色值序列化成 `rgb(255, 135, 0)`，比较时统一去掉空格。 */
const tight = (value: string) => value.replace(/\s+/g, "");

test("renders terminal colours from the theme palette", () => {
  const { container } = render(<AnsiText text={`${ESC}[31m错误${ESC}[0m`} />);
  const [red] = Array.from(container.querySelectorAll("span"));
  expect(red.textContent).toBe("错误");
  // 调色板走主题变量：深浅两套值由 tokens.css 给，组件不写死十六进制。
  expect(red.style.color).toBe("var(--ansi-1)");
});

test("maps 256-colour and true-colour values to fixed rgb", () => {
  const { container } = render(
    <AnsiText text={`${ESC}[38;5;208m橙${ESC}[38;2;12;34;56m真彩${ESC}[0m`} />
  );
  const spans = Array.from(container.querySelectorAll("span"));
  expect(tight(spans[0].style.color)).toBe("rgb(255,135,0)");
  expect(tight(spans[1].style.color)).toBe("rgb(12,34,56)");
});

test("applies attribute flags as classes, not inline text decoration", () => {
  const { container } = render(
    <AnsiText text={`${ESC}[1m粗${ESC}[2m暗${ESC}[3m斜${ESC}[4m下划线${ESC}[9m删除${ESC}[0m`} />
  );
  const spans = Array.from(container.querySelectorAll("span"));
  expect(spans[0].className).toMatch(/bold/);
  expect(spans[1].className).toMatch(/dim/);
  expect(spans[2].className).toMatch(/italic/);
  expect(spans[3].className).toMatch(/underline/);
  expect(spans[4].className).toMatch(/strike/);
});

test("swaps foreground and background for inverse video", () => {
  const { container } = render(<AnsiText text={`${ESC}[7;31m反显${ESC}[0m`} />);
  const [span] = Array.from(container.querySelectorAll("span"));
  // 只给了前景色：反显时它变成背景，前景退回页面底色，而不是留空。
  expect(span.style.background).toBe("var(--ansi-1)");
  expect(span.style.color).toBe("var(--bg-subtle)");
});

test("dims the foreground without washing out a background", () => {
  const { container } = render(
    <AnsiText
      text={
        `${ESC}[2m无颜色${ESC}[0m` +
        `${ESC}[2;31m命名色${ESC}[0m` +
        `${ESC}[2;38;2;1;2;3m数值色${ESC}[0m` +
        `${ESC}[2;41m有背景${ESC}[0m`
      }
    />
  );
  const spans = Array.from(container.querySelectorAll("span"));

  // 没有颜色可调时，整段透明度就是「变暗」的正确表达。
  expect(spans[0].className).toMatch(/dim/);
  // 命名色没有 alpha 通道、且没有背景：同样用整段透明度。
  expect(spans[1].className).toMatch(/dim/);
  expect(spans[1].style.color).toBe("var(--ansi-1)");
  // 数值色可以只压暗前景，不必动背景。
  expect(spans[2].className).not.toMatch(/dim/);
  // 浏览器会把 `rgb(1 2 3 / 0.62)` 序列化成 `rgba(1, 2, 3, 0.62)`。
  expect(tight(spans[2].style.color)).toMatch(/^rgba?\(1,2,3,(0\.62|62%)\)$/);
  // 有背景色时不能整段淡化（那会把本该实心的底色洗掉）：保留满色。
  expect(spans[3].className).not.toMatch(/dim/);
  expect(spans[3].style.background).toBe("var(--ansi-1)");
});

test("never renders an escape byte into the DOM", () => {
  const { container } = render(
    <AnsiText text={`${ESC}]0;window\u0007${ESC}[2K前面${ESC}[31m红${ESC}[0m后面`} />
  );
  expect(container.textContent).toBe("前面红后面");
  expect(container.textContent).not.toContain(ESC);
});

test("renders plain text unchanged", () => {
  const { container } = render(<AnsiText text={"普通输出\n第二行"} />);
  expect(container.textContent).toBe("普通输出\n第二行");
  expect(container.querySelector("span")?.getAttribute("style")).toBeNull();
});
