/**
 * I10 工具组合签名：把每个会话用到的工具集合归一成签名（排序后 join），
 * 统计最常出现的组合。
 *
 * 口径：
 *   - 签名 = 会话内工具名**去重、按码点排序**后以 " · " 连接；顺序无关，
 *     `Read,Bash` 与 `Bash,Read` 是同一个签名。
 *   - `count` 与 `sessions` 当前同值（一个会话只贡献一次），分开是给以后
 *     「同一组合在多少会话里出现」留位置；空字符串/非字符串工具名忽略。
 *   - 输出按 count 降序、并列按签名字典序（与项目其它榜单一致），截前
 *     `MAX_TOOL_SIGNATURES` 条。
 *   - 空工具集的会话计入 `noToolsCount`，不进榜；全部会话都没有工具时
 *     返回 null（没有可排的组合），而不是 0 条的空榜。
 */

export type ToolSignature = {
  signature: string;
  /** 归一后的工具名（已排序），界面可直接展示。 */
  tools: string[];
  count: number;
  sessions: number;
};

export type ToolSignatures = {
  signatures: ToolSignature[];
  /** 工具集为空的会话数——不进榜，但要让界面能说「N 个会话没用工具」。 */
  noToolsCount: number;
};

export const MAX_TOOL_SIGNATURES = 8;
export const TOOL_SIGNATURE_SEPARATOR = " · ";

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function toolSignaturesOf(
  sessions: readonly { tools: readonly string[] }[]
): ToolSignatures | null {
  if (sessions.length === 0) return null;

  let noToolsCount = 0;
  const bySignature = new Map<string, { tools: string[]; count: number }>();

  for (const session of sessions) {
    const unique = new Set<string>();
    for (const tool of session.tools) {
      if (typeof tool === "string" && tool.length > 0) unique.add(tool);
    }

    if (unique.size === 0) {
      noToolsCount += 1;
      continue;
    }

    const tools = [...unique].sort(compareCodePoints);
    const signature = tools.join(TOOL_SIGNATURE_SEPARATOR);
    const entry = bySignature.get(signature);
    if (entry) entry.count += 1;
    else bySignature.set(signature, { tools, count: 1 });
  }

  if (bySignature.size === 0) return null;

  const signatures = [...bySignature.entries()]
    .map(([signature, entry]) => ({
      signature,
      tools: entry.tools,
      count: entry.count,
      sessions: entry.count
    }))
    .sort(
      (left, right) =>
        right.count - left.count || compareCodePoints(left.signature, right.signature)
    )
    .slice(0, MAX_TOOL_SIGNATURES);

  return { signatures, noToolsCount };
}
