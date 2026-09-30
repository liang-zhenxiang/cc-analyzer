# Type Safety

> How types are written, where the trust boundary sits, and how external data is narrowed.

---

## Overview

`web/tsconfig.json` runs `strict` with `noUnusedLocals`, `noUnusedParameters` and
`noFallthroughCasesInSwitch`. There is **no `any` in `web/src`**, no
`@ts-ignore`, and no runtime schema library (no zod, no io-ts, no valibot).

The rule that replaces them: **anything that crossed a process or disk boundary
starts as `unknown` and is narrowed by hand-written guards.** Types describe data
the app produced; `unknown` + a normalizer describes data it did not.

---

## Types Mirror the Rust Wire Format

`api/types.ts` is the contract with `src-tauri/src/lib.rs`, and it copies the
serde output **verbatim, including snake_case**:

```ts
export type DirEntry = { name: string; is_dir: boolean; is_file: boolean };
export type StatInfo = { is_file: boolean; size: number; mtime_ms: number };
```

Renaming `mtime_ms` to look tidy means the type no longer matches what `invoke`
returns. Convert at the point of use if a local name reads better.

**The direction matters**: command *arguments* are camelCase in TS and snake_case
in Rust (Tauri converts them) — `readHead(path, maxBytes)` maps to Rust's
`max_bytes`. Command *return values* are not converted.

`invoke` rejects with whatever the Rust command returned as its error type, and
every command here returns `Result<T, String>`. **A caught rejection is a plain
string, not an `Error`** — which is why error handling is always
`` `${String(cause)}` `` and never `cause.message`.

`Option<String>` fields arrive as `string | null`, which is why `tauri.ts`
normalizes them: `return { ...result, error: result.error ?? undefined };`.

---

## The Declared Boundaries

| Boundary | Type enters as | Narrowed by |
| --- | --- | --- |
| Session JSONL file | `string` from `bridges.fs.readText` | `parseJsonl.ts` (per-line `unknown`) |
| `meta-cache-v2.json` | `unknown` from `JSON.parse` | `normalizeMetadataCache` in `metadataCache.ts` |
| `cca-thresholds` in `localStorage` | `unknown` from `JSON.parse` | `clampThresholds` in `thresholds.ts` |
| `cca-session-collapsed` | `unknown` from `JSON.parse` | inline `Array.isArray` + `typeof` filter in `SessionList.tsx` |
| `postMessage` from the monitor iframe | `MessageEvent.data` as `{ type?: unknown }` | `isLocalMonitorOrigin` + property checks |

---

## Narrowing Helpers

`metadataCache.ts` is the reference implementation. Three small guards, each
returning `undefined` instead of throwing, so a bad field degrades to a default
rather than dropping the whole entry:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function optionalString(value: unknown): string | undefined { /* non-empty string or undefined */ }
function nonNegativeNumber(value: unknown): number | undefined { /* finite >= 0 or undefined */ }
```

Each returns `undefined` rather than throwing, so one bad field degrades to a
default instead of dropping the whole entry. The `normalizeX(value: unknown): X`
contract is: **always return a complete, valid `X`.** `normalizeMetadataCache`
returns `{ version: 2, generatedAt, entries: {} }` for a null cache, a v1 cache,
or garbage, so callers never null-check the result. Follow that shape for any new
persisted structure.

---

## Discriminated Unions Are the Default Model

Model variations as a union with a literal field, and switch on it exhaustively
— `noFallthroughCasesInSwitch` then catches the missing branch:

- `SessionRecord.kind: "user" | "assistant" | "tool" | "wait"`
- `LogRowKind: "user" | "llm" | "tool" | "subagent" | "workflow" | "wait"`
  (`features/sessions/logRows.ts`)
- `StructuredToolResult` — discriminated by `toolName`: `Bash`, `Edit`, `Write`,
  `Read`, `Grep`, `Glob`, `Agent`, `Workflow`
- `MonitorState: { status: "probing" | "ready" | "unavailable"; ... }`
- `AnalyzerView`, `ViewMode`, `WorkspaceTab`

Optional fields use `?` for "may be absent" and `| null` for "present but
empty". Do not mix them for the same slot.

Use `Record<UnionType, T>` to make a union exhaustive by construction — adding a
member then becomes a compile error at every table that must cover it, instead of
a silent `undefined` at runtime (see `KIND_LABELS: Record<LogRowKind, string>`).

---

## Serialization

Transcript values may not survive `JSON.stringify`. `lib/json.ts` exposes
`safeStringify`, which converts `bigint` to `` `${n}n` ``, functions to `[函数]`,
and a revisited object to `[循环引用]`, and returns a message string if stringify
still throws. Use it for `record.raw` and anything else originating in a file;
`structuredResultLines.ts` does the same job for the typed `structuredResult`.
Its doc comment records a real limitation: a replacer cannot tell "already
visited" from "currently open", so a value referenced twice also renders as
`[循环引用]`.

---

## Common Mistakes

- **Casting instead of narrowing** — `JSON.parse(raw) as MetadataCache` type-checks
  and then crashes on a hand-edited cache file.
- **Camel-casing wire fields** in `api/types.ts`.
- **Reading `cause.message`** after an `invoke` rejection (it is a string).
- **Extending `node.d.ts` / `jsdom.d.ts`** to get another node or jsdom API into a
  test. Those stubs exist because `@types/node` is intentionally absent; growing
  them is a separate decision with its own issue, not a local patch.
