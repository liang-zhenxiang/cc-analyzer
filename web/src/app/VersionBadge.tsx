import { useEffect, useState } from "react";
import { useBridges } from "../api/bridges";
import { useNotifications } from "./NotificationProvider";
import { isDemoMode } from "../demo/demoMode";
import styles from "./VersionBadge.module.css";

/**
 * 顶栏的版本徽章：显示当前运行的版本号，点击复制「CC Analyzer vX.Y.Z」。
 *
 * 存在的理由不只是好看——它是**升级是否生效的第一眼证据**：自动更新把应用
 * 换掉之后，用户不需要翻设置、也不需要问，顶栏的数字就变了。版本号取自
 * Rust 的 `app.package_info()`（编译进二进制的真实版本），不是前端常量，
 * 所以它不可能「显示新版本而实际还是旧的」。
 *
 * 三种状态（Issue #339）：
 * - **正式版**：`v0.41.0`。
 * - **预发布**：只显示 `v0.41.0` + `Beta` 胶囊。版本号里本来就含 `-beta.1`，
 *   再把它印一遍等于同一句话写两次；完整版本仍在可访问名与复制内容里。
 * - **演示模式**：显示「演示数据」。演示桥报的是 `0.0.0-demo`，直接渲染
 *   会像版本号坏了。
 */
export function VersionBadge() {
  const bridges = useBridges();
  const { notify } = useNotifications();
  const [version, setVersion] = useState<string | null>(null);
  const demo = isDemoMode();

  useEffect(() => {
    let cancelled = false;
    bridges.updater
      ?.appVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => {
        // 取不到版本就整个不渲染——宁可没有徽章，也不显示一个假版本号。
        if (!cancelled) setVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, [bridges]);

  // 演示模式：内存桥的 `0.0.0-demo` 不是用户装的版本，显示它等于撒谎。
  if (demo) {
    return (
      <span
        className={`${styles.badge} ${styles.demo}`}
        title="演示数据 · 不会读取你的会话"
        data-probe="version-badge-demo"
      >
        演示数据
      </span>
    );
  }

  if (!version) return null;

  // 预发布版本（含 `-`）在徽章上显式标出：装的是 beta 还是稳定版，应该一眼
  // 看得出来，而不是让人去比对版本号里有没有 `-beta`。后缀只保留在 tag 里。
  const isPrerelease = version.includes("-");
  const displayVersion = isPrerelease ? version.slice(0, version.indexOf("-")) : version;

  return (
    <button
      type="button"
      className={isPrerelease ? `${styles.badge} ${styles.prerelease}` : styles.badge}
      title="点击复制版本信息"
      aria-label={`当前版本 v${version}${isPrerelease ? "（先行版）" : ""}，点击复制版本信息`}
      onClick={() => {
        void bridges.clipboard
          .writeText(`CC Analyzer v${version}`)
          .then(
            () => notify(`已复制版本信息：CC Analyzer v${version}`),
            () => notify("复制版本信息失败", "error")
          );
      }}
    >
      v{displayVersion}
      {isPrerelease ? <span className={styles.tag}>Beta</span> : null}
    </button>
  );
}
