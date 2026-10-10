import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Bridges } from "../../api/types";
import { useBridges, useTrayBridge } from "../../api/bridges";
import { SessionRepository } from "../sessions/sessionRepository";
import { sharedSessionParseCache } from "../sessions/sessionParseCache";
import { parseJsonlTextAsync } from "../sessions/parseJsonl";
import type { SessionMeta } from "../sessions/metadataCache";
import type { ParsedSession } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { usePlan } from "./planLimits";
import { buildTrayReadout, recentSessionsFor } from "./quotaReadout";

/** 常驻读数的刷新节奏：一分钟一次，与 Issue #150 的约定一致。 */
export const TRAY_TICK_MS = 60_000;

/** 设置开关的持久化键；缺省开（规格 Round P §5 定死这个名字）。 */
export const TRAY_ENABLED_KEY = "cca-tray-visible";

/**
 * 开关的存储读取。缺省开——只有明确的 "false" / "0" 才算关闭，空值与损坏值
 * 都退回默认，避免一次写坏 localStorage 就永久关掉读数。
 */
function readTrayEnabled(): boolean {
  try {
    const raw = localStorage.getItem(TRAY_ENABLED_KEY);
    return raw !== "false" && raw !== "0";
  } catch {
    return true;
  }
}

// 模块级订阅表：设置面板与 AppShell 的 hook 在两个组件里，靠它同步开关状态。
const trayEnabledListeners = new Set<() => void>();

export function subscribeTrayEnabled(listener: () => void): () => void {
  trayEnabledListeners.add(listener);
  return () => {
    trayEnabledListeners.delete(listener);
  };
}

/** 写入设置里的开关并向订阅者广播；持久化失败不影响本次会话内的切换。 */
export function setTrayEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(TRAY_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // 持久化可选：本次会话内的开关仍然生效。
  }
  for (const listener of trayEnabledListeners) listener();
}

export function useTrayEnabled(): boolean {
  return useSyncExternalStore(subscribeTrayEnabled, readTrayEnabled);
}

/** 复用与用量页同一份解析缓存：一个文件只解析一次，旁路读数不重复付费。 */
async function parseSession(bridges: Bridges, session: SessionMeta): Promise<ParsedSession> {
  const cached = sharedSessionParseCache.get(session.path);
  if (
    cached &&
    cached.mtimeMs === session.mtimeMs &&
    cached.sizeBytes === session.sizeBytes
  ) {
    return cached.session;
  }
  const text = await bridges.fs.readText(session.path);
  const parsed = await parseJsonlTextAsync(text, session.path);
  sharedSessionParseCache.set(session.path, {
    mtimeMs: session.mtimeMs,
    sizeBytes: session.sizeBytes,
    session: parsed
  });
  return parsed;
}

async function readTrayInputs(
  bridges: Bridges,
  sessions: readonly SessionMeta[]
): Promise<UsageSessionInput[]> {
  const inputs: UsageSessionInput[] = [];
  for (const session of sessions) {
    try {
      const parsed = await parseSession(bridges, session);
      if (parsed.records.length === 0) continue;
      inputs.push({
        records: parsed.records,
        projectLabel: session.projectLabel,
        projectPath: session.cwd,
        session
      });
    } catch {
      // 一个会话读不出来不能把整份读数清空——跳过它，其余会话照常计入。
    }
  }
  return inputs;
}

/**
 * 驱动菜单栏/托盘读数：列会话（mtime 收窄）→ 解析 → 算读数 → 推给 Rust。
 *
 * 成本约定（改动前先读这条）：**每一跳只做「列目录 + 每文件一次 stat」**，
 * stat 命中 metadata 缓存，**只有 mtime/size 变过的文件才真正解析**（解析缓存
 * 已按这两项校验）。「常驻读数」最容易被骂的就是它偷偷全量扫描，这条不能被破。
 *
 * 触发时机：挂载、每 60 秒、计划（预算分母）变化。开关关闭时连计算也停掉——
 * 不显示就不该继续付扫描的账。
 */
export function useTrayReadout(): void {
  const bridges = useBridges();
  const tray = useTrayBridge();
  const plan = usePlan();
  const enabled = useTrayEnabled();
  const repository = useMemo(() => new SessionRepository(bridges), [bridges]);
  const warnedRef = useRef(false);

  // 托盘是旁路：失败只提示一次，绝不冒泡打断界面（同仓库其它旁路代码的态度）。
  const warnOnce = useCallback((cause: unknown) => {
    if (warnedRef.current) return;
    warnedRef.current = true;
    console.warn("托盘读数推送失败（后续失败不再重复打印）", cause);
  }, []);

  // 开关：挂载时先推一次当前值，之后每次变化都推。
  useEffect(() => {
    try {
      void tray?.setVisible(enabled).catch(warnOnce);
    } catch (cause) {
      warnOnce(cause);
    }
  }, [tray, enabled, warnOnce]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const push = async () => {
      try {
        const now = Date.now();
        const sessions = await repository.listSessions();
        if (cancelled) return;
        const inputs = await readTrayInputs(bridges, recentSessionsFor(sessions, now));
        if (cancelled) return;
        await tray?.updateReadout(buildTrayReadout(inputs, plan, now));
      } catch (cause) {
        warnOnce(cause);
      }
    };

    void push();
    const timer = window.setInterval(() => void push(), TRAY_TICK_MS);
    // 卸载必须清掉定时器：常驻读数不能给已经离开的页面继续打点。
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [repository, bridges, tray, enabled, plan, warnOnce]);
}
