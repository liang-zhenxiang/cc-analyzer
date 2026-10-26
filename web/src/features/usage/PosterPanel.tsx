import { useMemo, useState } from "react";
import { useBridges } from "../../api/bridges";
import { useNotifications } from "../../app/NotificationProvider";
import { Button } from "../../components/Button";
import { Panel } from "../../components/Panel";
import type { UsageSessionInput } from "./usageAggregations";
import { buildPosterStats } from "./posterStats";
import {
  drawPoster,
  posterContentOf,
  posterFileName,
  posterSvg,
  type PosterPalette
} from "./posterCanvas";
import styles from "./PosterPanel.module.css";

/**
 * 「开发者海报」（D5）：里程碑档尾巴上的一张可导出的图。
 *
 * 预览与导出共用 `posterCanvas` 的同一份图元列表；palette 从根元素的令牌里
 * 现取，所以海报跟随主题，且这一层不出现任何颜色字面量。
 * PNG 需要宿主的 `writeBinary`；缺桥接时禁用并给出可用的替代（SVG）。
 */

const PNG_UNSUPPORTED = "当前版本不支持导出 PNG（缺少二进制写入），可用 SVG";

function readPalette(): PosterPalette {
  if (typeof window === "undefined") {
    return { bg: "", text: "", muted: "", accent: "", border: "" };
  }
  const computed = getComputedStyle(document.documentElement);
  const read = (name: string) => computed.getPropertyValue(name).trim();
  return {
    bg: read("--bg"),
    text: read("--text"),
    muted: read("--text-secondary"),
    accent: read("--accent"),
    border: read("--border")
  };
}

export function PosterPanel({
  inputs,
  now
}: {
  inputs: readonly UsageSessionInput[];
  now?: number;
}) {
  const bridges = useBridges();
  const { notify } = useNotifications();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mountedNow] = useState(() => Date.now());
  const stats = useMemo(
    () => buildPosterStats([...inputs], now ?? mountedNow),
    [inputs, now, mountedNow]
  );
  const content = useMemo(() => posterContentOf(stats), [stats]);
  const palette = useMemo(readPalette, []);
  const empty = stats.totalTokens === 0 && stats.totalMessages === 0;
  const pngSupported = typeof bridges.fs.writeBinary === "function";

  const preview = useMemo(() => {
    const svg = posterSvg(content, palette);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [content, palette]);

  const savePng = async () => {
    if (!pngSupported || empty || busy) return;
    setBusy(true);
    setError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1350;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError("当前环境不支持画布，无法导出 PNG；可以改用 SVG。");
        return;
      }
      drawPoster(ctx, content, palette);
      const base64 = canvas.toDataURL("image/png").split(",")[1];
      const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      const path = await bridges.dialog.savePath(posterFileName(new Date(), theme, "png"), {
        title: "导出开发者海报（PNG）",
        filterName: "PNG 图片",
        extensions: ["png"]
      });
      if (path === null) return;
      await bridges.fs.writeBinary?.(path, base64);
      notify("已导出开发者海报", "success");
    } catch (cause) {
      const message = `导出失败：${String(cause)}`;
      setError(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const saveSvg = async () => {
    if (empty || busy) return;
    setBusy(true);
    setError(null);
    try {
      const svg = posterSvg(content, palette);
      const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      const path = await bridges.dialog.savePath(posterFileName(new Date(), theme, "svg"), {
        title: "导出开发者海报（SVG）",
        filterName: "SVG 图片",
        extensions: ["svg"]
      });
      if (path === null) return;
      await bridges.fs.writeText(path, svg);
      notify("已导出开发者海报", "success");
    } catch (cause) {
      const message = `导出失败：${String(cause)}`;
      setError(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="开发者海报"
      ariaLabel="开发者海报"
      actions={
        <Button variant="ghost" onClick={() => setOpen((value) => !value)}>
          {open ? "收起预览" : "预览"}
        </Button>
      }
    >
      <p className={styles.hint}>
        {empty
          ? "还没有可做海报的数据"
          : "一张离线生成的总结图：只有聚合数与模型名，不含项目路径、会话 id 或消息原文。"}
      </p>
      <div className={styles.actions}>
        <Button
          variant="primary"
          onClick={() => void savePng()}
          disabled={empty || busy || !pngSupported}
          title={!pngSupported ? PNG_UNSUPPORTED : undefined}
          data-probe="poster-export"
        >
          导出 PNG
        </Button>
        <Button
          variant="ghost"
          onClick={() => void saveSvg()}
          disabled={empty || busy}
          data-probe="poster-export-svg"
        >
          导出 SVG
        </Button>
        {!pngSupported ? <span className={styles.degraded}>{PNG_UNSUPPORTED}</span> : null}
      </div>
      {open ? (
        <div className={styles.preview} data-probe="poster-preview">
          <img className={styles.image} src={preview} alt="开发者海报预览" width={208} height={260} />
        </div>
      ) : null}
      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}
