import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { useBridges } from "../../api/bridges";
import { useNotifications } from "../../app/NotificationProvider";
import {
  SHARE_CARD_HEIGHT,
  SHARE_CARD_LIGHT_PALETTE,
  SHARE_CARD_WIDTH,
  shareCardContent,
  shareCardDayLabel,
  shareCardFileName,
  shortIdOf
} from "./shareCard";
import { drawPoster } from "../usage/posterCanvas";
import { tokenTotalsOf } from "./tokenTotals";
import { projectNameOfCwd } from "./sessionArchive";
import { extractToolCalls } from "../usage/toolCensus";
import type { ParsedSession } from "./types";
import type { SessionMeta } from "./metadataCache";

/**
 * H8 会话分享卡按钮（Round HH §4.8）：SessionHeader 读数带上的
 * 「分享卡」——画 1080×1350 PNG 落盘，管线与开发者海报同一套。
 *
 * 桥接降级链（与 PosterPanel 同款）：dialog.savePath 或 fs.writeBinary
 * 缺失时按钮 disabled + title 说明「当前版本不支持导出 PNG」——不留
 * 一个点了没反应的死按钮。解析中（parsed=null）由调用方不渲染。
 *
 * 卡面内容见 shareCardContent：不印会话名（§2-⑤ 拍板），标题是常量。
 */

export function ShareCardButton({ session, parsed }: { session: SessionMeta; parsed: ParsedSession }) {
  const bridges = useBridges();
  const { notify } = useNotifications();
  const [busy, setBusy] = useState(false);

  // 桥面可能部分缺失（旧宿主、测试桥）——可选链逐面探测，缺任何一面都
  // 只降级成 disabled，不在渲染期抛错（PosterPanel 同思想）。
  const canPng =
    typeof bridges.dialog?.savePath === "function" &&
    typeof bridges.fs?.writeBinary === "function";

  const source = useMemo(() => {
    const totals = tokenTotalsOf(parsed.records);
    const models = new Map<string, number>();
    for (const record of parsed.records) {
      if (record.kind !== "assistant" || !record.model) continue;
      models.set(record.model, (models.get(record.model) ?? 0) + 1);
    }
    // 主导模型 = assistant 记录数最多（并列取字典序更小，与年报 topModel 同规则）。
    let modelLabel: string | null = null;
    let bestCount = -1;
    for (const [model, count] of models) {
      if (count > bestCount || (count === bestCount && modelLabel !== null && model < modelLabel)) {
        modelLabel = model;
        bestCount = count;
      }
    }
    const hasUsage = parsed.records.some((record) => record.usage !== undefined);
    return {
      projectBasename: session.cwd ? projectNameOfCwd(session.cwd) : session.projectLabel,
      dayLabel: shareCardDayLabel(parsed.startedAt),
      durationMs: Math.max(0, parsed.endedAt - parsed.startedAt),
      // 无读数是 null（卡上印「—」），不是 0——0 是断言，缺失不是。
      totalTokens: hasUsage ? totals.total : null,
      toolCallCount: extractToolCalls(parsed).length,
      modelLabel,
      sessionId: parsed.sessionId
    };
  }, [session, parsed]);

  const savePng = async () => {
    if (!canPng || busy) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = SHARE_CARD_WIDTH;
      canvas.height = SHARE_CARD_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        notify("当前环境不支持画布，无法导出分享卡", "error");
        return;
      }
      // 高对比度主题沿用浅色档：PNG 要发给别人，不假设对方的环境（§4.8）。
      drawPoster(ctx, shareCardContent(source), SHARE_CARD_LIGHT_PALETTE);
      const base64 = canvas.toDataURL("image/png").split(",")[1];
      const path = await bridges.dialog.savePath?.(shareCardFileName(shortIdOf(source.sessionId)), {
        title: "导出会话分享卡（PNG）",
        filterName: "PNG 图片",
        extensions: ["png"]
      });
      if (path === null || path === undefined) return;
      await bridges.fs.writeBinary?.(path, base64);
      notify("已导出会话分享卡", "success");
    } catch (cause) {
      notify(`导出失败：${String(cause)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      data-probe="share-card"
      disabled={!canPng || busy}
      title={canPng ? "导出这张会话的分享卡（PNG，不含消息内容）" : "当前版本不支持导出 PNG"}
      onClick={() => void savePng()}
    >
      分享卡
    </Button>
  );
}
