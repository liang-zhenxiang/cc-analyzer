/**
 * 重启计数（H5）：识别「同一项目里刚起不久又起了新会话」的连续链。
 *
 * 口径与为什么：
 * - 链的定义：同一 project 内，按 startTimestamp 升序，相邻两会话间隔
 *   < windowMs（默认 15 分钟）即视为同一条链——上一个会话刚起不久用户
 *   又 /clear 或重开，这是「重启」的行为签名；间隔 >= windowMs 的窗口外
 *   新会话重新起链为 1（判据选 >=：正好等于窗口长的间隔是「等了一整个
 *   窗口才再起」，不算重启）；
 * - Map 的值 = 该会话所在链的长度（链首 1）；UI 显示「重新发起 N 次」
 *   时 N = 链长 − 1（自己在链里但不把自己算成「又发起了一次」）；
 * - projectLabel 缺省（null/undefined）按「同 cwd 段」处理：调用方已把
 *   path 的 cwd 段作为兜底 label 传入时本函数自然正确；这里对
 *   null/undefined 的处理是「不并入任何已知项目、也不互相同链」——
 *   没有归属依据的会话不猜邻居，每个自成链 1；
 * - startTimestamp 为 null 的会话不参与链计算（记 0，不猜）：时间未知
 *   就没有「间隔」可言，把它挂进任何一条链都是编造；
 * - 输出键用 session.path（UI 侧 Map.get(path) ?? 0——不参与/不存在的
 *   会话读 0，0 表示「没有重启证据」而不是「有一次」）。
 */

/** 会话的最小形状：路径 + 可选归属 + 可选起点。 */
export type RestartSession = {
  path: string;
  projectLabel?: string | null;
  startTimestamp: number | null;
};

/**
 * 每个会话的重启链长。返回 Map 的键 = session.path；值为该会话所在
 * 「连续重启链」的长度（链首 1，不参与计数的会话记 0）。
 */
export function countRestarts(
  sessions: readonly RestartSession[],
  windowMs: number = 15 * 60_000
): Map<string, number> {
  const result = new Map<string, number>();

  // 按 (project, startTimestamp) 升序分组扫描：链只在同 project 内传递。
  const groups = new Map<string, RestartSession[]>();
  for (const session of sessions) {
    // 时间未知的会话不参与（记 0）：没有起点就没有间隔可言。
    if (session.startTimestamp === null) {
      result.set(session.path, 0);
      continue;
    }
    const group = session.projectLabel ?? null;
    // 无归属（projectLabel null/undefined）不猜邻居：每个自成链 1，
    // 用唯一键（控制字符前缀 + path）隔离——真实 projectLabel 是目录
    // 编码名，不会以控制字符开头，天然不与任何真实项目并链。
    // 空字符串是合法分组键（调用方解析出的「无项目名」桶）：同桶照常
    // 成链，与 null/undefined 的「没有依据」语义分开。
    const key = group === null ? "\u0001" + session.path : group;
    const bucket = groups.get(key);
    if (bucket) bucket.push(session);
    else groups.set(key, [session]);
  }

  for (const bucket of groups.values()) {
    bucket.sort((a, b) => (a.startTimestamp ?? 0) - (b.startTimestamp ?? 0));
    let chain = 0;
    let prevStart: number | null = null;
    for (const session of bucket) {
      const start = session.startTimestamp ?? 0;
      // 链首（prevStart 为 null）或窗口外（间隔 >= windowMs）→ 重新起链为 1。
      if (prevStart === null || start - prevStart >= windowMs) chain = 1;
      else chain += 1;
      result.set(session.path, chain);
      prevStart = start;
    }
  }

  return result;
}
