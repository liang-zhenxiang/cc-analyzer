import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useBridges } from "../../api/bridges";
import { Button } from "../../components/Button";
import {
  CLAUDE_ROOT_CHANGED_EVENT,
  checkClaudeRoot,
  readStoredClaudeRoot,
  setClaudeRoot,
  type RootCheck
} from "./claudeRoot";
import styles from "./ClaudeRootGate.module.css";

/**
 * 「先看演示数据」只发一个事件，**不** import 演示模块。
 *
 * 演示数据是另一条独立的加载路径（由监听方决定挂什么）；引导层一旦直接
 * import，就会把演示模块拖进正常启动的 bundle，也会让「演示」与「真实」
 * 两种模式在同一个组件里纠缠。
 */
const DEMO_ENTER_EVENT = "cca-demo-enter";

/**
 * 开箱引导的第一道门：根目录没配好、或者里面一个会话都没有时，先把主内容
 * 换成一次可操作的说明。
 *
 * 只包住 `<main>` 里的内容，不动顶栏、设置抽屉与浮层——那些在「还没数据」
 * 时依然该可用（用户可以先去设置里调主题，或者打开命令面板）。
 *
 * 判定口径只有一条：`checkClaudeRoot` 说 `ok`（至少读到一个 `.jsonl`）才放行。
 * `empty` 也要拦：目录存在但空着，主内容只会是一片空图表，不如直接讲清楚。
 */
export function ClaudeRootGate({ children }: { children: ReactNode }) {
  const bridges = useBridges();
  const [check, setCheck] = useState<RootCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const next = await checkClaudeRoot(bridges);
      setCheck(next);
      setHint(null);
    } finally {
      setChecking(false);
    }
  }, [bridges]);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  // 目录在别处被改掉时（设置面板 / 另一个窗口）自动重查，不靠重启。
  useEffect(() => {
    const onChanged = () => void runCheck();
    window.addEventListener(CLAUDE_ROOT_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CLAUDE_ROOT_CHANGED_EVENT, onChanged);
  }, [runCheck]);

  // `dialog` 在类型上是必填，但老宿主 / 单测可能没有；统一走可选链。
  const openDirectory = bridges.dialog?.openDirectory;

  async function handlePickDirectory() {
    if (!openDirectory) {
      setHint("当前运行环境不支持选择目录。请确认会话目录存在后点「重新扫描」。");
      return;
    }
    try {
      const picked = await openDirectory({ title: "选择 Claude 会话目录（通常以 .claude/projects 结尾）" });
      // 取消不是失败：保持原样，不弹提示。
      if (!picked) return;
      // 写入后 `setClaudeRoot` 会广播事件，上面的事件监听负责重查。
      setClaudeRoot(picked);
    } catch (cause) {
      setHint(`选择目录失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  async function handleUseDefault() {
    setClaudeRoot(null);
    // 事件监听会重查一次；这里再同步查一次是为了在默认目录也不存在时立刻
    // 给出「先运行一次 Claude Code」的可执行提示，而不是沉默地停在原处。
    const next = await checkClaudeRoot(bridges);
    setCheck(next);
    setHint(
      next.state === "ok" || next.state === "empty"
        ? null
        : "默认目录还不存在。请先运行一次 Claude Code 生成会话，再点「重新扫描」。"
    );
  }

  function handleDemo() {
    window.dispatchEvent(new Event(DEMO_ENTER_EVENT));
  }

  // 自检还没回来时照常渲染主内容：有数据的用户不该为一次检查看到空白闪烁；
  // 没数据的用户会在检查回来后切到引导层。
  if (!check || check.state === "ok") return <>{children}</>;

  const title = check.state === "empty" ? "这个目录里没有会话" : "还没有找到会话目录";
  // 主按钮跟着「用户现在最可能想做什么」走：连目录都没有的人（多半还没装
  // Claude Code）最该看到产品长什么样；目录里有会话只是空的，才轮到换目录。
  const demoLeads = check.state !== "empty";
  const hasCustomRoot = readStoredClaudeRoot() !== null;

  return (
    <div className={styles.gate}>
      <section className={styles.card} aria-label="会话目录引导" data-probe="claude-root-gate">
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.description}>{check.message}</p>

        <p className={styles.privacy}>会话数据只在本机读取，不上传、不内置遥测。</p>

        <div className={styles.pathRow}>
          <span className={styles.pathLabel}>当前检测路径</span>
          {/* 可选中复制：用户要把这段路径贴进终端排查时不用手抄。 */}
          <code className={styles.path}>{check.path}</code>
        </div>

        {hint ? (
          <p className={styles.hint} role="status">
            {hint}
          </p>
        ) : null}

        <div className={styles.actions}>
          {demoLeads ? (
            <Button type="button" variant="primary" onClick={handleDemo}>
              先看演示数据
            </Button>
          ) : null}
          <Button
            type="button"
            variant={demoLeads ? "secondary" : "primary"}
            disabled={checking || !openDirectory}
            title={!openDirectory ? "当前运行环境不支持选择目录" : undefined}
            onClick={() => void handlePickDirectory()}
          >
            选择其他目录
          </Button>
          <Button type="button" disabled={checking} onClick={() => void runCheck()}>
            {checking ? "正在检查…" : "重新扫描"}
          </Button>
          {hasCustomRoot ? (
            <Button type="button" disabled={checking} onClick={() => void handleUseDefault()}>
              按默认目录继续
            </Button>
          ) : null}
          {demoLeads ? null : (
            <Button type="button" variant="ghost" onClick={handleDemo}>
              先看演示数据
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
