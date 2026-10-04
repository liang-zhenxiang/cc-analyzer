/**
 * ANSI / VT100 escape handling for terminal output captured in transcripts.
 *
 * Claude Code records tool output verbatim, so a `Bash` result is full of SGR
 * sequences: `\u001b[31m` for red, `\u001b[1m` for bold, `38;5;208` and
 * `38;2;r;g;b` for the 256- and true-colour palettes. Rendering those bytes as
 * text is what a log viewer sees today — the user gets `[31m` confetti instead
 * of a red error line.
 *
 * The module is pure and framework-free: `parseAnsi` produces spans, and the
 * React layer (`components/AnsiText.tsx`) turns them into elements. Anything
 * that needs one flat string — table cells, clipboard, CSV, search — goes
 * through `stripAnsi`, because an escape byte in a copied summary or a shared
 * CSV is garbage in someone else's tool.
 */

const ESC = "\u001b";
/** 8-bit CSI, which some tools emit instead of `ESC [`. */
const CSI_8BIT = "\u009b";
const BEL = "\u0007";

export type AnsiColor =
  /** One of the 16 named terminal colours; rendered from the theme's palette. */
  | { kind: "palette"; index: number }
  /** 16–255 from the xterm cube / greyscale ramp; a fixed RGB value. */
  | { kind: "indexed"; index: number }
  /** 24-bit colour straight from the sequence. */
  | { kind: "rgb"; r: number; g: number; b: number };

export type AnsiStyle = {
  fg?: AnsiColor;
  bg?: AnsiColor;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  inverse?: boolean;
};

export type AnsiSpan = { text: string; style: AnsiStyle };

const PALETTE_CSS = Array.from({ length: 16 }, (_, index) => `var(--ansi-${index})`);
/** The xterm 256-colour cube levels. */
const CUBE = [0, 95, 135, 175, 215, 255];

function isBlank(style: AnsiStyle): boolean {
  return Object.keys(style).length === 0;
}

/**
 * Terminals apply a carriage return by moving the cursor to column 0 and
 * **overwriting** from there, which is how progress output (`10%\r50%\r100%`)
 * reads as one final line. Keeping the bytes would show `10%50%100%`, so the
 * rewrite is resolved up front — before parsing, so spans cannot straddle it.
 *
 * Two traps this resolves, both of which silently ate real content before:
 *
 * - **CRLF is a line ending, not a rewind.** `tail -f` output, Windows tools and
 *   any `\r\n`-terminated capture would otherwise "rewind" to an empty segment
 *   and blank the whole line.
 * - **A rewrite overwrites, it does not replace.** `abcdef\rXY` shows `XYcdef`
 *   in a terminal; taking only the last segment would drop `cdef`.
 */
export function normalizeTerminalText(raw: string): string {
  if (!raw.includes("\r")) return raw;
  return raw.replace(/\r\n/g, "\n").split("\n").map(applyRewrites).join("\n");
}

/** Writes each `\r`-separated segment over the line, starting at column 0. */
function applyRewrites(line: string): string {
  if (!line.includes("\r")) return line;
  let out = "";
  for (const segment of line.split("\r")) {
    // Each `\r` puts the cursor back at column 0, so a segment replaces the
    // prefix of what is already there and leaves the tail it did not reach.
    out = segment + out.slice(segment.length);
  }
  return out;
}

/**
 * Length of the escape sequence starting at `start`, or `1` when the byte is a
 * lone ESC. Unknown introducers still consume their whole sequence, so nothing
 * half-parsed leaks into the rendered text.
 */
function sequenceLength(text: string, start: number): number {
  const next = text[start + 1];
  if (next === undefined) return 1;
  if (next === "[") {
    // CSI: parameters (0x30–0x3f), intermediates (0x20–0x2f), final (0x40–0x7e).
    let index = start + 2;
    while (index < text.length && /[\d;:?<>!= "'#$%&*+\-./]/.test(text[index])) index += 1;
    return index < text.length ? index - start + 1 : text.length - start;
  }
  if (next === "]") {
    // OSC (window title, hyperlinks): runs to BEL or ST.
    let index = start + 2;
    while (index < text.length) {
      if (text[index] === BEL) return index - start + 1;
      if (text[index] === ESC && text[index + 1] === "\\") return index - start + 2;
      index += 1;
    }
    return text.length - start;
  }
  // Charset selection (`ESC ( B`) and two-byte escapes (`ESC c`).
  if (next === "(" || next === ")" || next === "*" || next === "+") return 3;
  // A two-byte escape only exists when the second byte is a final byte
  // (0x40–0x7e). Anything else — a stray ESC in the middle of prose, a Unicode
  // letter — must not swallow the character that follows it.
  const code = next.charCodeAt(0);
  return code >= 0x40 && code <= 0x7e ? 2 : 1;
}

function clampByte(value: number): number | null {
  if (!Number.isInteger(value)) return null;
  if (value < 0 || value > 255) return null;
  return value;
}

/** Applies one SGR parameter list to the running style. */
function applySgr(style: AnsiStyle, params: number[]): AnsiStyle {
  const next: AnsiStyle = { ...style };
  const clear = (key: keyof AnsiStyle) => {
    delete next[key];
  };

  for (let index = 0; index < params.length; index += 1) {
    const code = params[index];
    if (!Number.isFinite(code)) continue;
    if (code === 0) {
      for (const key of Object.keys(next) as Array<keyof AnsiStyle>) delete next[key];
    } else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 9) next.strike = true;
    else if (code === 22) {
      clear("bold");
      clear("dim");
    } else if (code === 23) clear("italic");
    else if (code === 24) clear("underline");
    else if (code === 27) clear("inverse");
    else if (code === 29) clear("strike");
    else if (code >= 30 && code <= 37) next.fg = { kind: "palette", index: code - 30 };
    else if (code >= 90 && code <= 97) next.fg = { kind: "palette", index: code - 90 + 8 };
    else if (code >= 40 && code <= 47) next.bg = { kind: "palette", index: code - 40 };
    else if (code >= 100 && code <= 107) next.bg = { kind: "palette", index: code - 100 + 8 };
    else if (code === 39) clear("fg");
    else if (code === 49) clear("bg");
    else if (code === 38 || code === 48) {
      const target = code === 38 ? "fg" : "bg";
      const mode = params[index + 1];
      if (mode === 5) {
        const value = clampByte(params[index + 2] ?? Number.NaN);
        if (value !== null) next[target] = value < 16 ? { kind: "palette", index: value } : { kind: "indexed", index: value };
        index += 2;
      } else if (mode === 2) {
        // Out-of-range components are dropped rather than clamped: a colour the
        // terminal would not have shown is not a colour worth inventing.
        const r = clampByte(params[index + 2] ?? Number.NaN);
        const g = clampByte(params[index + 3] ?? Number.NaN);
        const b = clampByte(params[index + 4] ?? Number.NaN);
        if (r !== null && g !== null && b !== null) next[target] = { kind: "rgb", r, g, b };
        index += 4;
      }
    }
  }
  return next;
}

/**
 * Splits terminal output into styled runs. Adjacent runs that carry the same
 * style are merged, so a long log becomes a handful of spans instead of one per
 * sequence.
 */
export function parseAnsi(raw: string): AnsiSpan[] {
  const text = normalizeTerminalText(raw);
  const spans: AnsiSpan[] = [];
  let style: AnsiStyle = {};
  let buffer = "";

  const flush = () => {
    if (buffer.length === 0) return;
    const last = spans[spans.length - 1];
    if (last && sameStyle(last.style, style)) last.text += buffer;
    else spans.push({ text: buffer, style });
    buffer = "";
  };

  for (let index = 0; index < text.length; ) {
    const char = text[index];
    if (char === ESC || char === CSI_8BIT) {
      flush();
      const length = char === CSI_8BIT ? csiLength(text, index) : sequenceLength(text, index);
      if (char === ESC && text[index + 1] === "[") {
        const params = text.slice(index + 2, index + length - 1);
        style = applySgr(style, parseParams(params));
      } else if (char === CSI_8BIT) {
        const params = text.slice(index + 1, index + length - 1);
        style = applySgr(style, parseParams(params));
      }
      index += Math.max(1, length);
      continue;
    }
    buffer += char;
    index += 1;
  }
  flush();
  return spans;
}

/** CSI length for the 8-bit introducer, which has no `[`. */
function csiLength(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && /[\d;:?<>!= "'#$%&*+\-./]/.test(text[index])) index += 1;
  return index < text.length ? index - start + 1 : text.length - start;
}

/**
 * SGR parameters. `:`-separated forms (`38:5:196`) are accepted alongside the
 * `;` form — both are in the wild.
 */
function parseParams(raw: string): number[] {
  if (raw.trim().length === 0) return [0];
  return raw.split(/[;:]/).map((part) => Number.parseInt(part, 10));
}

function sameColor(a: AnsiColor | undefined, b: AnsiColor | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "rgb" && b.kind === "rgb") return a.r === b.r && a.g === b.g && a.b === b.b;
  if (a.kind !== "rgb" && b.kind !== "rgb") return a.index === b.index;
  return false;
}

function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
  if (isBlank(a) && isBlank(b)) return true;
  return (
    sameColor(a.fg, b.fg) &&
    sameColor(a.bg, b.bg) &&
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.dim) === Boolean(b.dim) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    Boolean(a.strike) === Boolean(b.strike) &&
    Boolean(a.inverse) === Boolean(b.inverse)
  );
}

/** The plain text of terminal output: no escapes, carriage returns resolved. */
export function stripAnsi(raw: string): string {
  return parseAnsi(raw)
    .map((span) => span.text)
    .join("");
}

/**
 * A CSS colour for one span, or `undefined` when the value is not usable.
 *
 * The returned string is always built here from validated numbers — user text
 * never reaches a `style` attribute, which is what keeps a crafted transcript
 * from injecting CSS.
 */
export function cssColorFor(color: AnsiColor | undefined): string | undefined {
  if (!color) return undefined;
  if (color.kind === "palette") {
    return PALETTE_CSS[color.index];
  }
  if (color.kind === "indexed") {
    const index = color.index;
    if (!Number.isInteger(index) || index < 0 || index > 255) return undefined;
    if (index < 16) return PALETTE_CSS[index];
    if (index >= 232) {
      const level = 8 + (index - 232) * 10;
      return `rgb(${level} ${level} ${level})`;
    }
    const value = index - 16;
    const r = CUBE[Math.floor(value / 36)];
    const g = CUBE[Math.floor((value % 36) / 6)];
    const b = CUBE[value % 6];
    return `rgb(${r} ${g} ${b})`;
  }
  const { r, g, b } = color;
  if (clampByte(r) === null || clampByte(g) === null || clampByte(b) === null) return undefined;
  return `rgb(${r} ${g} ${b})`;
}
