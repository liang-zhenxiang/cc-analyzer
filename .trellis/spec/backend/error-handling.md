# Error Handling

> How failures cross the IPC boundary. The rule is short: `Err(String)` means
> "the operation could not be performed"; `Ok` with `ok: false` means "the
> operation ran and the outcome was failure".

---

## The Two Channels

### 1. `Err(String)` — the promise rejects

Every command returns `Result<T, String>`. An `Err` becomes a rejected promise
on the JS side, so callers must `try/catch` or let it propagate.

Use it for: file not found, permission denied, spawn failure, mutex poisoning,
"cannot read command output". `lib.rs` never returns a structured error enum —
`String` **is** the contract.

### 2. `Ok(T { ok: false, error: Some(..) })` — expected failure

`RunLinesResult` and `ExecTextResult` both carry `ok` / `error` fields. A
non-zero exit code, a timeout, and a user cancellation are all normal outcomes
of running a command, so they resolve successfully:

- `run_lines` → `ok: status.success()`, `error: (!success).then(|| format!("命令退出码: {status}"))`
- `exec_text` → same shape, plus `out` instead of `stderr`
- cancelled → `ok: false, error: Some("分析已取消")`
- timed out → `ok: false, error: Some("命令执行超时")`

**Never** convert "command exited non-zero" into `Err`. The streaming caller has
already consumed stdout and still needs `stderr`, which is why `RunLinesResult`
always carries `stderr: String` — even on the failure path.

---

## The `io_error` Helper

`fn io_error(context: &str, error: std::io::Error) -> String` (lib.rs:47) is the
only normalizer. It special-cases `ErrorKind::NotFound` into a friendly Chinese
message and otherwise formats `"{context}: {error}"`:

```rust
format!("{context}: 文件或目录不存在")   // NotFound
format!("{context}: {error}")            // everything else
```

Rules:

- Always route `std::io::Error` through it — never `?` a raw `io::Error` into a
  `Result<_, String>` (it does not convert).
- `context` is a Chinese, user-facing phrase naming the failed step: `"读取目录失败"`,
  `"读取文件失败"`, `"写入文件失败"`, `"创建目录失败"`, `"启动进程失败"`,
  `"等待命令失败"`, `"写入命令输入失败"`.
- **Error strings are UI copy.** They are shown to the user as-is, so keep them
  in Chinese, in the same voice, and don't leak absolute paths or environment
  details through them.

---

## Cancellation and Timeout Are Not Errors

- `cancel_lines` returns `Ok(true)` when it signalled a live handle and
  `Ok(false)` when the `stream_id` is unknown — for example the command already
  finished. A `false` result is not a failure to report to the user; the
  frontend's "停止分析" flow treats both as done.
- `run_lines` implements this with a `tokio::select!` over the wait future and
  the `oneshot` receiver, producing `WaitOutcome::{Exited, TimedOut, Cancelled}`.
  All three paths converge on a single `RunLinesResult`; only `Exited(Err(..))`
  escapes as a Rust `Err`.
- Cleanup is unconditional: the cancel entry is removed from `ProcState.cancels`
  after the wait regardless of outcome, and killed children are reaped with
  `child.wait().await` so they do not linger as zombies.

---

## Panics and Lock Poisoning

- Mutex poisoning is mapped, never unwrapped:
  `.lock().map_err(|_| "无法登记取消句柄".to_string())?`. Keep this style.
- The crate has exactly one deliberate panic: `.expect("error while running CC Analyzer")`
  on `Builder::run()` in `run()` — startup failure is unrecoverable and there is
  no UI to report it to. `let status = status.expect("status checked")` in
  `run_lines` is guarded by `if status.is_none()` three lines above.
- Do not add new `unwrap()` / `expect()` on IO results inside commands. Return
  `Err(io_error(...))` instead.

---

## Frontend Side of the Contract

`web/src/api/tauri.ts` adapts the Rust shape into TS:

```ts
return { ...result, error: result.error ?? undefined };
```

Rust `Option<String>` arrives as `string | null`; the bridge collapses it to
`undefined` so `error?: string` in `web/src/api/types.ts` is honest. UI code
checks `result.ok` first and reads `result.error` only for display.

Rejected promises (channel 1) are **not** caught by the bridges — they propagate
to the calling feature code, which is where user-facing handling belongs.

---

## Anti-Patterns

- Adding `anyhow` / `thiserror` / a `BackendError` enum. There is no error
  hierarchy here and adding one means changing every signature plus
  `web/src/api/types.ts`.
- Returning `Err("命令执行超时")` from `run_lines` — the frontend already
  distinguishes it via `ok`/`error`; flipping channels would turn a handled case
  into an unhandled rejection.
- Swallowing an error with `let _ = ...` unless it is genuinely non-observable
  (the `emit` failures in `run_lines` are the accepted case: a closed window has
  nowhere to deliver lines).
- Logging error text to stdout/stderr in the Rust layer — errors travel back
  through the return value, and session data must not be dumped to logs.
