import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, IconButton } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { SegmentedControl } from "../../components/SegmentedControl";
import { TextInput } from "../../components/TextInput";
import {
  DEFAULT_THRESHOLDS,
  THRESHOLD_KEYS,
  THRESHOLD_SPECS,
  resetThresholds,
  setThreshold,
  useThresholds,
  type ThresholdKey
} from "./thresholds";
import { PLAN_PRESETS, setPlan, usePlan, type PlanId } from "../usage/planLimits";
import { useArchiveBundleBridge, useBridges } from "../../api/bridges";
import {
  CHANNEL_LABELS,
  loadAutoCheck,
  loadChannel,
  storeAutoCheck,
  storeChannel,
  type UpdateChannel
} from "./updateChannel";
import { useNotifications } from "../../app/NotificationProvider";
import {
  disable as disableArchive,
  enable as enableArchive,
  refreshAfterImport as refreshArchiveAfterImport,
  refreshStatus as refreshArchiveStatus,
  runNow as runArchiveNow,
  useArchiveTask,
  type ArchiveTaskState
} from "../archive/archiveTask";
import { exportArchiveBundle, importArchiveBundle } from "../archive/bundleStore";
import type { ImportFailure } from "../archive/bundle";
import { formatBytes, formatDateTime, formatRelativeTime } from "../../lib/format";
import {
  DEFAULT_FONT_SCALE,
  FONT_SCALES,
  formatFontScale,
  parseFontScale,
  setFontScale,
  useFontScale
} from "./fontScale";
import { setTrayEnabled, useTrayEnabled } from "../usage/useTrayReadout";
import type { Bridges, UpdateCheck } from "../../api/types";
import styles from "./ThresholdsPanel.module.css";

/** Disk-full / permission failures get one actionable sentence; others stay verbatim. */
function failureText(reason: string): string {
  if (/no space|space left|磁盘|空间/i.test(reason)) {
    return `${reason} 请清理磁盘空间后重试。`;
  }
  if (/permission|denied|eacces|e?perm|权限/i.test(reason)) {
    return `${reason} 请检查归档目录的读写权限后重试。`;
  }
  return reason;
}

function readoutTitle(state: ArchiveTaskState): string | undefined {
  const parts: string[] = [];
  if (state.footprint.lastArchivedAt) parts.push(formatDateTime(state.footprint.lastArchivedAt));
  if (state.archiveDir) parts.push(state.archiveDir);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function ArchiveSection({ bridges }: { bridges: Bridges }) {
  const archive = useArchiveTask();
  const { notify } = useNotifications();
  const titleId = useId();
  const [flash, setFlash] = useState<"copied" | "uptodate" | null>(null);
  const previousStatus = useRef(archive.status);
  const notifiedError = useRef(archive.status === "error" ? archive.error : null);

  // Show what is already on disk as soon as the panel is opened.
  useEffect(() => {
    void refreshArchiveStatus(bridges);
  }, [bridges]);

  // The button lingers on「已是最新」for a beat after a no-op run, then resets.
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = archive.status;
    if (archive.status !== "done" || previous === "done") return undefined;
    const run = archive.lastRun;
    setFlash(run && run.copied === 0 && run.failures.length === 0 ? "uptodate" : "copied");
    const timer = window.setTimeout(() => setFlash(null), 2000);
    return () => window.clearTimeout(timer);
  }, [archive.status, archive.lastRun]);

  // Failure is surfaced in place (below) and once as a toast; the panel has no
  // modal. The ref keeps reopening the panel from re-announcing an old failure.
  useEffect(() => {
    if (archive.status === "error" && archive.error) {
      if (notifiedError.current !== archive.error) {
        notifiedError.current = archive.error;
        notify(`归档失败：${failureText(archive.error)}`, "error");
      }
    } else if (archive.status !== "error") {
      notifiedError.current = null;
    }
  }, [archive.status, archive.error, notify]);

  const running = archive.status === "running";
  const progress = archive.progress;
  const footprint = archive.footprint;

  let readout: ReactNode;
  if (running && progress) {
    readout = (
      <>
        正在归档 <span className={styles.number}>{progress.done}</span>/
        <span className={styles.number}>{progress.total}</span> …
      </>
    );
  } else if (flash === "uptodate") {
    readout = <>已是最新，无需归档</>;
  } else if (flash === "copied" && archive.lastRun) {
    readout = <>本次归档 {archive.lastRun.copied} 个会话</>;
  } else if (footprint.count === 0) {
    readout = <>尚未归档任何会话</>;
  } else {
    readout = (
      <>
        已归档 <span className={styles.number}>{footprint.count.toLocaleString("en-US")}</span> 个会话 ·{" "}
        上次归档{" "}
        <span className={styles.number}>
          {footprint.lastArchivedAt ? formatRelativeTime(footprint.lastArchivedAt) : "-"}
        </span>{" "}
        · 占用 <span className={styles.number}>{formatBytes(footprint.bytes)}</span>
      </>
    );
  }

  const disabled = !archive.enabled || running;
  const buttonLabel = running ? "正在归档…" : flash === "uptodate" ? "已是最新" : "立即归档";

  return (
    <>
      <h3 className={styles.sectionTitle}>本地归档</h3>
      <p className={styles.note}>
        Claude Code 会清理约 30 天前的会话；归档把副本留在本机，让更早的记录仍能统计。
      </p>
      <div className={styles.grid}>
        {/* aria-labelledby keeps the checkbox's name exactly the visible title,
            even though the trust hints sit inside the same label. */}
        <label className={styles.field}>
          <span className={styles.label} id={titleId}>
            启用本地归档
          </span>
          <span className={styles.control}>
            <input
              type="checkbox"
              aria-labelledby={titleId}
              checked={archive.enabled}
              onChange={(event) => {
                if (event.target.checked) enableArchive(bridges);
                else disableArchive();
              }}
            />
          </span>
          <span className={styles.hint}>在本机复制，不联网，不改动 ~/.claude 的原始文件。</span>
          {archive.enabled ? null : (
            <span className={styles.hint}>关闭只停止后续归档，已归档的副本会保留。</span>
          )}
        </label>
      </div>
      <p className={styles.readout} role="status" aria-live="polite" title={readoutTitle(archive)}>
        {readout}
      </p>
      {archive.indexCorrupt ? (
        <p className={styles.hint}>归档索引已损坏，下次归档会重建。</p>
      ) : null}
      {archive.status === "error" && archive.error ? (
        <p className={styles.alert} role="alert">
          归档失败：{failureText(archive.error)}
        </p>
      ) : null}
      <div className={styles.archiveRow}>
        <Button
          type="button"
          onClick={() => void runArchiveNow(bridges)}
          disabled={disabled}
          aria-busy={running || undefined}
          title={archive.enabled ? undefined : "先开启本地归档"}
        >
          {buttonLabel}
        </Button>
        {running && progress && progress.total > 0 ? (
          <progress
            className={styles.archiveProgress}
            value={progress.done}
            max={progress.total}
          />
        ) : null}
      </div>
      <BundleActions bridges={bridges} />
    </>
  );
}

type BundleMode = "export" | "import";

/**
 * 「导出归档包…」/「导入归档包…」两个入口与它们的口令弹层（Issue #152）。
 *
 * 口令**只活在组件 state 里**：不进 localStorage、不进日志、不回显（input 是
 * password 类型，提交后立刻清空）。「忘了口令 = 数据永远打不开」这句话要成立，
 * 前提就是应用这边不替用户留任何副本。
 */
function BundleActions({ bridges }: { bridges: Bridges }) {
  const bundle = useArchiveBundleBridge();
  const titleId = useId();
  const [mode, setMode] = useState<BundleMode | null>(null);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readout, setReadout] = useState<string | null>(null);
  const [failures, setFailures] = useState<ImportFailure[]>([]);
  const opener = useRef<HTMLElement | null>(null);

  // Esc 关掉弹层：与「导出会话报告」浮层是同一套键盘语言。捕获阶段拦下，
  // 免得 Esc 又去触发背后的全局快捷键；跑动中的操作不响应，避免半途收摊。
  useEffect(() => {
    if (!mode) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) return;
      event.stopPropagation();
      setMode(null);
      setPassword("");
      setConfirmText("");
      opener.current?.focus?.();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [mode, busy]);

  // 桥是可选的：老宿主 / 老测试没有它。禁用并说明，而不是让面板崩掉。
  if (!bundle) {
    return (
      <div className={styles.bundleRow}>
        <Button type="button" disabled>
          导出归档包…
        </Button>
        <Button type="button" disabled>
          导入归档包…
        </Button>
        <span className={styles.hint}>当前宿主不支持加密归档包</span>
      </div>
    );
  }

  function open(next: BundleMode, element: HTMLElement) {
    opener.current = element;
    setMode(next);
    setPassword("");
    setConfirmText("");
    setError(null);
    setReadout(null);
    setFailures([]);
  }

  function close() {
    setMode(null);
    setPassword("");
    setConfirmText("");
    setBusy(false);
    // 焦点还给触发它的按钮：WebKit 点按钮不给焦点，只能自己记。
    opener.current?.focus?.();
  }

  const mismatch = mode === "export" && confirmText.length > 0 && confirmText !== password;
  const canConfirm = password.length > 0 && (mode === "import" || password === confirmText);
  const finished = readout !== null;

  async function run() {
    if (mode === null || !canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "export") {
        const outcome = await exportArchiveBundle(bridges, password);
        // 取消系统保存对话框不是失败：直接收起弹层，什么都不说。
        if (outcome === null) {
          close();
          return;
        }
        setReadout(`已导出 ${outcome.entries} 条会话 · ${formatBytes(outcome.bytes)}`);
      } else {
        const outcome = await importArchiveBundle(bridges, password);
        if (outcome === null) {
          close();
          return;
        }
        setReadout(outcome.readout.text);
        setFailures(outcome.failures);
        try {
          // 导入改写了索引：让面板读数与会话列表跟上（running/importing → done 的
          // 跃迁正是列表重跑发现的触发点）。
          await refreshArchiveAfterImport(bridges);
        } catch {
          // 读数刷新失败不改变导入结论：条目已经落盘、索引已经写回。
        }
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
      // 口令用完即弃：不留在内存里等下一次误用。
      setPassword("");
      setConfirmText("");
    }
  }

  return (
    <>
      <div className={styles.bundleRow}>
        <Button type="button" onClick={(event) => open("export", event.currentTarget)}>
          导出归档包…
        </Button>
        <Button type="button" onClick={(event) => open("import", event.currentTarget)}>
          导入归档包…
        </Button>
      </div>
      {mode ? (
        <div
          className={styles.bundleBackdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={styles.bundlePanel}
          >
            <h2 id={titleId} className={styles.bundleTitle}>
              {mode === "export" ? "导出归档包" : "导入归档包"}
            </h2>
            <p className={styles.note}>
              {mode === "export"
                ? "把本机归档的会话打成一个口令加密的单文件包（.ccabundle），换到别的机器用同一个口令导入。"
                : "选一个归档包，用导出时设的口令解开；包里的会话并进本机归档，已存在的跳过，不同版本并列保留。"}
            </p>
            <p className={styles.bundleWarning}>
              口令无法找回：忘记口令，这个包里的数据就永远打不开。应用不留后门，也不上传任何东西。
            </p>
            <label className={styles.field}>
              <span className={styles.label}>口令</span>
              <TextInput
                className={styles.bundleInput}
                type="password"
                autoComplete="new-password"
                autoFocus
                disabled={busy}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {mode === "export" ? (
              <label className={styles.field}>
                <span className={styles.label}>再输一次</span>
                <TextInput
                  className={styles.bundleInput}
                  type="password"
                  autoComplete="new-password"
                  disabled={busy}
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                />
                {mismatch ? <span className={styles.hint}>两次输入不一致</span> : null}
              </label>
            ) : null}
            {error ? (
              <p className={styles.alert} role="alert">
                {error}
              </p>
            ) : null}
            {finished ? (
              <div className={styles.bundleResult}>
                <p className={styles.readout} role="status">
                  {readout}
                </p>
                {failures.map((failure) => (
                  <p key={failure.sourcePath} className={styles.alert}>
                    {failure.sourcePath}：{failure.reason}
                  </p>
                ))}
              </div>
            ) : null}
            <div className={styles.bundleActions}>
              <Button type="button" onClick={close} disabled={busy}>
                {finished || error ? "关闭" : "取消"}
              </Button>
              <Button
                type="button"
                variant="primary"
                aria-busy={busy || undefined}
                disabled={busy || (!finished && !canConfirm)}
                onClick={() => void run()}
              >
                {busy
                  ? mode === "export"
                    ? "正在导出…"
                    : "正在导入…"
                  : finished
                    ? "完成"
                    : "确认"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

/**
 * 「界面字号」一节：五档 90–130%，即时生效并持久化。
 *
 * 放在面板最前面（第一节）：需要放大的是看不清屏幕的人，把开关埋在几段读不清的
 * 说明之后是自相矛盾的。切档只改 `--font-scale`，预览行用同一批 token 自动跟着缩放，
 * 所以这里不需要第二套样式，也不加 live region / 确认框 / 滑杆（见规格 §2、§4）。
 */
function FontScaleSection() {
  const fontScale = useFontScale();
  const items = FONT_SCALES.map((scale) => ({
    value: String(scale),
    // 100% 是默认档：给它一段视觉隐藏的「（默认）」，让屏幕阅读器也听得见默认位，
    // 可见文字仍是「100%」，与其它档位的百分比同形。
    label:
      scale === DEFAULT_FONT_SCALE ? (
        <>
          {formatFontScale(scale)}
          <span className={styles.srOnly}>（默认）</span>
        </>
      ) : (
        formatFontScale(scale)
      )
  }));

  return (
    <div className={styles.fontScaleSection}>
      <h3 className={styles.sectionTitle}>界面字号</h3>
      <p className={styles.note}>默认 100%，随时可改回。</p>
      <SegmentedControl
        role="radiogroup"
        ariaLabel="界面字号"
        variant="equal"
        items={items}
        value={String(fontScale)}
        onChange={(next) => setFontScale(parseFontScale(next))}
      />
      {/* 一行固定示例读数（真实字段形状，非真实数据）：给五档一个稳定的密度参照。 */}
      <p className={styles.preview}>12:04:08 · LLM · claude-sonnet-4 · 3.00s</p>
      <p className={styles.previewSub}>提示词 17 / 输出 34 · 2.7% · 正常</p>
    </div>
  );
}

/**
 * 「常驻读数」小节：托盘 / 菜单栏读数的开关。紧挨产生读数的「计费窗口」，
 * 用户为「从哪来 / 怎么关」而来时顺手就能找到。关掉只隐藏读数，统计口径不变。
 * 默认开（见 useTrayReadout.ts 的 TRAY_ENABLED_KEY）。
 */
function TrayReadoutSection() {
  const enabled = useTrayEnabled();
  const titleId = useId();
  return (
    <>
      <h3 className={styles.sectionTitle}>常驻读数</h3>
      <div className={styles.grid}>
        {/* aria-labelledby 锁住可见标题本身（照「启用本地归档」）：包一层 label 时
            说明文字会一起进可访问名，视觉名与朗读名就此分叉。 */}
        <label className={styles.field}>
          <span className={styles.label} id={titleId}>
            显示用量读数
          </span>
          <span className={styles.control}>
            <input
              type="checkbox"
              aria-labelledby={titleId}
              checked={enabled}
              onChange={(event) => setTrayEnabled(event.target.checked)}
            />
          </span>
          <span className={styles.hint}>
            在 macOS 菜单栏与 Windows 托盘常驻显示，读自本机日志；关掉只隐藏读数，统计不受影响。
          </span>
          {enabled ? null : (
            <span className={styles.hint}>
              关掉只是不显示读数；「用量总览」与统计照常，随时可再打开。
            </span>
          )}
        </label>
      </div>
    </>
  );
}

function ThresholdField({ thresholdKey }: { thresholdKey: ThresholdKey }) {
  const thresholds = useThresholds();
  const spec = THRESHOLD_SPECS[thresholdKey];
  const stored = spec.toInput(thresholds[thresholdKey]);
  const [draft, setDraft] = useState(String(stored));
  const [focused, setFocused] = useState(false);

  // Keep the box in sync with the store, but never rewrite what is being typed.
  useEffect(() => {
    if (!focused) setDraft(String(stored));
  }, [focused, stored]);

  return (
    <label className={styles.field}>
      <span className={styles.label}>{spec.label}</span>
      <span className={styles.control}>
        <TextInput
          type="number"
          aria-label={spec.label}
          min={spec.toInput(spec.min)}
          max={spec.toInput(spec.max)}
          step={spec.toInput(spec.step)}
          value={draft}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setDraft(String(stored));
          }}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            if (text === "") return;
            const value = spec.fromInput(Number(text));
            if (Number.isFinite(value)) setThreshold(thresholdKey, value);
          }}
        />
        <span className={styles.unit}>{spec.unit}</span>
      </span>
      <span className={styles.hint}>{spec.hint}</span>
    </label>
  );
}

export function ThresholdsPanel({ onClose }: { onClose: () => void }) {
  const thresholds = useThresholds();
  const plan = usePlan();
  const isDefault = THRESHOLD_KEYS.every((key) => thresholds[key] === DEFAULT_THRESHOLDS[key]);
  const [customDraft, setCustomDraft] = useState(String(plan.limitTokens ?? ""));
  const [customFocused, setCustomFocused] = useState(false);
  const [weeklyDraft, setWeeklyDraft] = useState(String(plan.weeklyLimitTokens ?? ""));
  const [weeklyFocused, setWeeklyFocused] = useState(false);

  useEffect(() => {
    if (!customFocused) setCustomDraft(String(plan.limitTokens ?? ""));
  }, [customFocused, plan.limitTokens]);

  useEffect(() => {
    if (!weeklyFocused) setWeeklyDraft(String(plan.weeklyLimitTokens ?? ""));
  }, [weeklyFocused, plan.weeklyLimitTokens]);
  const bridges = useBridges();
  const [channel, setChannel] = useState<UpdateChannel>(() => loadChannel());
  const [autoCheck, setAutoCheck] = useState(() => loadAutoCheck());
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<UpdateCheck | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    void bridges.updater?.appVersion().then(setAppVersion, () => setAppVersion("未知"));
  }, [bridges]);

  async function runCheck() {
    setChecking(true);
    setCheckError(null);
    try {
      setCheckResult(await bridges.updater.checkUpdates(channel));
    } catch (cause) {
      setCheckResult(null);
      setCheckError(`检查失败：${String(cause)}`);
    } finally {
      setChecking(false);
    }
  }

  async function installAndRelaunch() {
    if (!checkResult?.available) return;
    setInstalling(true);
    try {
      await checkResult.install();
      await bridges.updater.relaunch();
    } catch (cause) {
      setCheckError(`安装失败：${String(cause)}`);
      setInstalling(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="阈值设置">
      <header className={styles.header}>
        <h2>阈值设置</h2>
        <IconButton label="关闭" onClick={onClose}>
          <Icon name="close" size={16} />
        </IconButton>
      </header>
      <p className={styles.note}>
        控制报告与日志表的规模，改动立即生效并保存在本机。
      </p>
      <FontScaleSection />
      <div className={styles.grid}>
        {THRESHOLD_KEYS.map((key) => (
          <ThresholdField key={key} thresholdKey={key} />
        ))}
      </div>
      <h3 className={styles.sectionTitle}>计费窗口</h3>
      <p className={styles.note}>
        订阅计划决定「用量总览」里 5 小时窗口的限额刻度。限额是社区整理的
        估算值（非官方），选「不选」则只看消耗、不显示百分比。周预算与计划
        无关，需要对照再填。
      </p>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span className={styles.label}>订阅计划</span>
          <span className={styles.control}>
            <select
              aria-label="订阅计划"
              className={styles.select}
              value={plan.id}
              onChange={(event) => {
                const id = event.target.value as PlanId;
                const preset = PLAN_PRESETS.find((item) => item.id === id);
                // 保留周预算：两层限额正交，切计划不该把使用者填的周数字丢掉。
                setPlan({ ...plan, id, limitTokens: preset ? preset.limitTokens : null });
              }}
            >
              {PLAN_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </span>
          <span className={styles.hint}>Team 与自定义在下一栏填每窗口上限。</span>
        </label>
        {(plan.id === "team" || plan.id === "custom") ? (
          <label className={styles.field}>
            <span className={styles.label}>每窗口上限（tokens）</span>
            <span className={styles.control}>
              <TextInput
                type="number"
                aria-label="每窗口上限（tokens）"
                min={1000}
                step={1000}
                value={customDraft}
                onFocus={() => setCustomFocused(true)}
                onBlur={() => {
                  setCustomFocused(false);
                  setCustomDraft(String(plan.limitTokens ?? ""));
                }}
                onChange={(event) => {
                  const text = event.target.value;
                  setCustomDraft(text);
                  const value = Number(text);
                  if (text !== "" && Number.isFinite(value) && value > 0) {
                    setPlan({ ...plan, limitTokens: Math.round(value) });
                  }
                }}
              />
              <span className={styles.unit}>tok/5h</span>
            </span>
            <span className={styles.hint}>四舍五入到整数；留空表示不设上限。</span>
          </label>
        ) : null}
        <label className={styles.field}>
          <span className={styles.label}>周预算（可选）</span>
          <span className={styles.control}>
            <TextInput
              type="number"
              aria-label="周预算（可选）"
              min={1000}
              step={1000}
              value={weeklyDraft}
              onFocus={() => setWeeklyFocused(true)}
              onBlur={() => {
                setWeeklyFocused(false);
                setWeeklyDraft(String(plan.weeklyLimitTokens ?? ""));
              }}
              onChange={(event) => {
                const text = event.target.value;
                setWeeklyDraft(text);
                if (text === "") {
                  // 清空即撤销预算：周档没有预设可退，必须能一路退回「只显示消耗」。
                  setPlan({ ...plan, weeklyLimitTokens: null });
                  return;
                }
                const value = Number(text);
                if (Number.isFinite(value) && value > 0) {
                  setPlan({ ...plan, weeklyLimitTokens: Math.round(value) });
                }
              }}
            />
            <span className={styles.unit}>tok/7d</span>
          </span>
          <span className={styles.hint}>
            周限额没有可靠的社区估算值，需要对照就自己填；清空则只显示消耗。
          </span>
        </label>
      </div>
      <TrayReadoutSection />
      <h3 className={styles.sectionTitle}>软件更新</h3>
      <p className={styles.note}>
        更新检查只是读取 GitHub 发布页的一次下载请求，不上传任何数据。稳定版
        由维护者人工验证后发布；Beta 是每轮功能自动构建的先行版。
      </p>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span className={styles.label}>更新渠道</span>
          <span className={styles.control}>
            <select
              aria-label="更新渠道"
              className={styles.select}
              value={channel}
              onChange={(event) => {
                const next = event.target.value as UpdateChannel;
                setChannel(next);
                storeChannel(next);
              }}
            >
              <option value="stable">{CHANNEL_LABELS.stable}</option>
              <option value="beta">{CHANNEL_LABELS.beta}</option>
            </select>
          </span>
          <span className={styles.hint}>当前版本 {appVersion ?? "…"}</span>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>启动时自动检查</span>
          <span className={styles.control}>
            <input
              type="checkbox"
              aria-label="启动时自动检查更新"
              checked={autoCheck}
              onChange={(event) => {
                setAutoCheck(event.target.checked);
                storeAutoCheck(event.target.checked);
              }}
            />
          </span>
          <span className={styles.hint}>关闭后仍可随时手动检查。</span>
        </label>
      </div>
      <div className={styles.updateRow}>
        <Button type="button" onClick={() => void runCheck()} disabled={checking}>
          {checking ? "检查中…" : "立即检查更新"}
        </Button>
        {checkResult ? (
          checkResult.available ? (
            <span className={styles.updateResult}>
              发现新版本 {checkResult.version}{" "}
              <Button
                type="button"
                variant="primary"
                onClick={() => void installAndRelaunch()}
                disabled={installing}
              >
                {installing ? "安装中…" : "安装并重启"}
              </Button>
            </span>
          ) : (
            <span className={styles.updateResult}>已是最新（{checkResult.currentVersion}）</span>
          )
        ) : checkError ? (
          <span className={styles.updateError}>{checkError}</span>
        ) : null}
      </div>
      <ArchiveSection bridges={bridges} />
      <footer className={styles.footer}>
        <Button type="button" onClick={() => resetThresholds()} disabled={isDefault}>
          恢复默认
        </Button>
      </footer>
    </section>
  );
}
