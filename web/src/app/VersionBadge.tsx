import { useEffect, useState } from "react";
import { useBridges } from "../api/bridges";
import { useNotifications } from "./NotificationProvider";
import styles from "./VersionBadge.module.css";

/**
 * 顶栏的版本徽章：显示当前运行的版本号，点击复制「CC Analyzer vX.Y.Z」。
 *
 * 存在的理由不只是好看——它是**升级是否生效的第一眼证据**：自动更新把应用
 * 换掉之后，用户不需要翻设置、也不需要问，顶栏的数字就变了。版本号取自
 * Rust 的 `app.package_info()`（编译进二进制的真实版本），不是前端常量，
 * 所以它不可能「显示新版本而实际还是旧的」。
 */
export function VersionBadge() {
  const bridges = useBridges();
  const { notify } = useNotifications();
  const [version, setVersion] = useState<string | null>(null);

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

  if (!version) return null;

  // 预发布版本（含 `-`）在徽章上显式标出：装的是 beta 还是稳定版，应该一眼
  // 看得出来，而不是让人去比对版本号里有没有 `-beta`。
  const isPrerelease = version.includes("-");

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
      v{version}
      {isPrerelease ? <span className={styles.tag}>Beta</span> : null}
    </button>
  );
}
