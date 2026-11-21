import type { SessionMeta } from "../sessions/metadataCache";
import { sessionTitle } from "../sessions/metadataCache";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import { labWindow } from "./constellation";
import { estimateCost } from "./pricingSnapshot";
import { usageTokens } from "./projectArena";
import {
  UNKNOWN_MODEL_LABEL,
  dayStartOf,
  type UsageSessionInput,
  type UsageTotals
} from "./usageAggregations";

/**
 * 回声（Echo）：把整个窗口内的会话按**内容**聚成话题组，只留下「同一件事
 * 被做了至少两次」的那些。
 *
 * 与 `sessionSimilarity` 的分工：那边是「为一条会话找最像的 K 条」，四维
 * Jaccard 只看项目 / 工具 / 模型 / 时长桶，不看内容；这里做全局聚类 + 内容
 * 相似，用来回答「我是不是在反复问同一件事」。
 *
 * 口径：
 * - 窗口与其它 Lab 面板相同（`labWindow`，本地自然日、含今天）；
 * - 会话身份：有元数据用 `path:` + 路径，手造输入退回 `anonymous:` + 下标；
 * - 花费只算窗口内的 usage，未知价模型让整条会话（继而整组）记为 `null`，
 *   不做事后补齐的部分求和；
 * - 代表标题永远是簇内某条会话的**真实** `sessionTitle`，不生成、不改写。
 */

/** 内容相似度阈值：Jaccard ≥ 0.55 才算「在问同一件事」。 */
export const ECHO_THRESHOLD = 0.55;

/**
 * 未传窗口天数时的兜底。Lab 页面默认区间是 30 天，但真正的值应由调用方
 * （面板的 `days` prop）作为第 4 个参数传入——见 `buildEchoGroups`。
 */
export const ECHO_DEFAULT_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;
const PROMPT_LIMIT = 200;

/** 一个会被界面直接渲染的会话。`usd === null` = 窗口内有未收录定价的模型。 */
export type EchoSession = {
  id: string;
  title: string;
  usd: number | null;
  at: number;
  meta?: SessionMeta;
};

/** 一组「同一件事」的会话。 */
export type EchoGroup = {
  key: string;
  /** 代表标题：簇内 token 最多、时间最早那条会话的真实 `sessionTitle`。 */
  label: string;
  /** 按时间升序排列（看得出「第一次问」和「又问了」）。 */
  sessions: EchoSession[];
  /** 任一会话未定价时为 `null`——全有或全无，不做部分求和。 */
  usd: number | null;
  /** 最早与最晚会话相差的自然日数，至少 1。 */
  spanDays: number;
};

export type EchoResult = {
  groups: EchoGroup[];
  /** 落进话题组（≥ 2 条）的会话数；单条会话不算重复，不计入。 */
  totalSessions: number;
  /** 所有话题组的花费之和；任一组为 `null` 时整体为 `null`。 */
  totalUsd: number | null;
};

/**
 * CJK 统一表意文字（含扩展 A / 兼容区 / 扩展 B）。只按汉字切 bigram；
 * 假名、谚文等不在此列，避免把非中文的亚洲文字误当汉字。
 */
const CJK_CHAR = /^[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2a6df}]$/u;

/** 西文/数字词字符；组合附加符号跟随基字母，不另起一个词。 */
const WORD_CHAR = /^[\p{L}\p{N}\p{M}]$/u;

/**
 * 话题签名。
 *
 * - 小写、去标点与空白；
 * - **连续汉字取字符 bigram**（「上下文压缩」→ 上下 / 下文 / 文压 / 压缩）；
 *   单字汉字串保留单字本身；
 * - **西文按词切分**，保留长度 ≥ 2 的词（单字母词没有区分度）。
 *
 * 标点在这里既不是 token 也不切断汉字串（「上下文，压缩」仍会产出「文压」），
 * 但它会结束一个西文词（「fix,bug」→ fix / bug，而不是 fixbug）。
 */
export function topicSignature(text: string): Set<string> {
  const tokens = new Set<string>();
  if (!text) return tokens;

  let cjkRun: string[] = [];
  let word: string[] = [];

  const flushCjk = (): void => {
    if (cjkRun.length === 1) {
      tokens.add(cjkRun[0]);
    } else if (cjkRun.length > 1) {
      for (let index = 0; index < cjkRun.length - 1; index += 1) {
        tokens.add(cjkRun[index] + cjkRun[index + 1]);
      }
    }
    cjkRun = [];
  };

  const flushWord = (): void => {
    if (word.length >= 2) tokens.add(word.join(""));
    word = [];
  };

  for (const char of Array.from(text.toLowerCase())) {
    if (CJK_CHAR.test(char)) {
      flushWord();
      cjkRun.push(char);
    } else if (WORD_CHAR.test(char)) {
      flushCjk();
      word.push(char);
    } else {
      // 标点/空白结束西文词；汉字串不在这里截断（先攒着，看下一个字符）。
      flushWord();
    }
  }
  flushCjk();
  flushWord();

  return tokens;
}

/** Jaccard：|A∩B| / |A∪B|。空集与任何集合（含空集）的相似度为 0。 */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function totalsOf(usage: SessionUsage): UsageTotals {
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheCreation: usage.cacheCreationTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0
  };
}

/** 一条会话在窗口内的读数：起点、token、金额（未知价 → null）。 */
type WindowFacts = {
  at: number;
  tokens: number;
  usd: number | null;
};

/**
 * 只统计落在 [startTs, endTs) 内的记录。窗口内一条记录都没有 → `null`，
 * 这条会话不参与聚类（它不属于当前窗口）。
 */
function windowFactsOf(
  records: readonly SessionRecord[],
  startTs: number,
  endTs: number
): WindowFacts | null {
  let at = Number.POSITIVE_INFINITY;
  let tokens = 0;
  let usd = 0;
  let unpriced = false;
  let seen = false;

  for (const record of records) {
    if (record.timestamp < startTs || record.timestamp >= endTs) continue;
    seen = true;
    if (record.timestamp < at) at = record.timestamp;

    const usage = record.usage;
    if (!usage) continue;
    tokens += usageTokens(usage);
    const estimate = estimateCost(totalsOf(usage), record.model ?? UNKNOWN_MODEL_LABEL);
    if ("unknownModel" in estimate) unpriced = true;
    else usd += estimate.usd;
  }

  if (!seen) return null;
  return { at, tokens, usd: unpriced ? null : usd };
}

type Candidate = WindowFacts & {
  id: string;
  title: string;
  signature: Set<string>;
  meta?: SessionMeta;
};

function findRoot(parent: number[], index: number): number {
  let root = index;
  while (parent[root] !== root) root = parent[root];
  // 路径压缩：第二遍把沿途节点都接到根上。
  let cursor = index;
  while (parent[cursor] !== root) {
    const next = parent[cursor];
    parent[cursor] = root;
    cursor = next;
  }
  return root;
}

function representativeOf(members: readonly Candidate[]): Candidate {
  let best = members[0];
  for (const candidate of members.slice(1)) {
    if (
      candidate.tokens > best.tokens ||
      (candidate.tokens === best.tokens && candidate.at < best.at) ||
      (candidate.tokens === best.tokens && candidate.at === best.at && candidate.id < best.id)
    ) {
      best = candidate;
    }
  }
  return best;
}

function spanDaysOf(sessions: readonly EchoSession[]): number {
  let earliest = sessions[0].at;
  let latest = sessions[0].at;
  for (const session of sessions) {
    if (session.at < earliest) earliest = session.at;
    if (session.at > latest) latest = session.at;
  }
  // 本地自然日之差；Math.round 吸收夏令时造成的 ±1 小时。
  const days = Math.round((dayStartOf(latest) - dayStartOf(earliest)) / DAY_MS);
  return Math.max(1, days);
}

/**
 * 把窗口内的会话按话题聚类。
 *
 * `threshold`：Jaccard 阈值，默认 `ECHO_THRESHOLD`。
 * `days`：窗口天数，默认 `ECHO_DEFAULT_WINDOW_DAYS`。**面板应把自身收到的
 * `days` prop 作为第 4 个参数传入**，才能和同屏其它卡片的「近 N 天」一致。
 */
export function buildEchoGroups(
  inputs: readonly UsageSessionInput[],
  now: number,
  threshold: number = ECHO_THRESHOLD,
  days: number = ECHO_DEFAULT_WINDOW_DAYS
): EchoResult {
  const { startTs, endTs } = labWindow(days, now);
  const cut = Number.isFinite(threshold) ? threshold : ECHO_THRESHOLD;

  const candidates: Candidate[] = [];
  inputs.forEach((input, index) => {
    const facts = windowFactsOf(input.records, startTs, endTs);
    if (!facts) return;

    const meta = input.session;
    // 标题与首条用户消息都缺失 = 没有话题可言，不参与聚类（不给它编一个）。
    const title = meta ? sessionTitle(meta).trim() : "";
    const prompt = (meta?.userPrompt ?? "").trim().slice(0, PROMPT_LIMIT);
    if (title === "" && prompt === "") return;

    const signature = topicSignature(`${title} ${prompt}`);
    if (signature.size === 0) return;

    candidates.push({
      ...facts,
      id: meta ? `path:${meta.path}` : `anonymous:${index}`,
      title,
      signature,
      ...(meta ? { meta } : {})
    });
  });

  // 按相似度 ≥ 阈值连边，取连通分量（并查集）。O(n²) 在这里完全够用：
  // 窗口内的会话量级是几百条，聚类只在渲染时算一次。
  const parent = candidates.map((_, index) => index);
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (jaccard(candidates[left].signature, candidates[right].signature) < cut) continue;
      const leftRoot = findRoot(parent, left);
      const rightRoot = findRoot(parent, right);
      if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
    }
  }

  const buckets = new Map<number, Candidate[]>();
  candidates.forEach((candidate, index) => {
    const root = findRoot(parent, index);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(candidate);
    else buckets.set(root, [candidate]);
  });

  const groups: EchoGroup[] = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue; // 单条会话的「簇」不是重复

    const ordered = [...members].sort(
      (a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
    const representative = representativeOf(members);
    const sessions: EchoSession[] = ordered.map((member) => ({
      id: member.id,
      title: member.title,
      usd: member.usd,
      at: member.at,
      ...(member.meta ? { meta: member.meta } : {})
    }));

    let usd: number | null = 0;
    for (const session of sessions) {
      if (session.usd === null) {
        usd = null;
        break;
      }
      usd += session.usd;
    }

    groups.push({
      key: representative.id,
      label: representative.title,
      sessions,
      usd,
      spanDays: spanDaysOf(sessions)
    });
  }

  groups.sort((a, b) => {
    if (a.usd === null && b.usd !== null) return 1;
    if (a.usd !== null && b.usd === null) return -1;
    if (a.usd !== null && b.usd !== null && b.usd !== a.usd) return b.usd - a.usd;
    if (b.sessions.length !== a.sessions.length) return b.sessions.length - a.sessions.length;
    return a.label.localeCompare(b.label) || a.key.localeCompare(b.key);
  });

  const totalSessions = groups.reduce((sum, group) => sum + group.sessions.length, 0);
  const totalUsd = groups.some((group) => group.usd === null)
    ? null
    : groups.reduce((sum, group) => sum + (group.usd ?? 0), 0);

  return { groups, totalSessions, totalUsd };
}
