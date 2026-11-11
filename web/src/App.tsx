import { useEffect, useMemo, useState } from "react";
import { AppShell } from "./app/AppShell";
import { installTauriBridges } from "./api/tauri";
import { initFontScale } from "./features/settings/fontScale";
import { initContrast } from "./features/settings/contrast";
import { initAccent } from "./features/settings/accent";
import { initKiosk } from "./app/KioskMode";
import { DemoBadge } from "./demo/DemoBadge";
import { installDemoBridges } from "./demo/demoBridges";
import {
  DEMO_CHANGE_EVENT,
  installDemoModeListeners,
  isDemoMode
} from "./demo/demoMode";

// index.html 的预绘制脚本负责第一帧不闪；这里把内存 store 同步到同一档，
// 避免控件在首屏短暂显示默认 100%。
initFontScale();
// 界面对比度：解析持久化、没写过才跟随系统偏好，把结果写到根元素并同步内存 store。
initContrast();
// 强调色：与字号 / 对比度同款，先落地持久化再渲染；index.html 的预绘制负责第一帧。
initAccent();
// 大屏模式：与字号/对比度同款，先落地持久化再渲染，避免第一帧先闪一下常规外壳。
initKiosk();

/**
 * 演示开关的 React 视图：初值读持久化，之后只认 `cca-demo-change`。
 *
 * 不直接订阅 enter/exit 两个命令事件——它们会先经 `installDemoModeListeners`
 * 落成持久化状态再广播 change。这样「谁改的」（引导页按钮 / 徽章退出 /
 * 将来别的入口）都不影响这里，状态只有一个来源。
 */
function useDemoMode(): boolean {
  const [demo, setDemo] = useState(isDemoMode);

  useEffect(() => {
    const sync = () => setDemo(isDemoMode());
    window.addEventListener(DEMO_CHANGE_EVENT, sync);
    return () => window.removeEventListener(DEMO_CHANGE_EVENT, sync);
  }, []);

  return demo;
}

export default function App() {
  const demo = useDemoMode();

  // 命令事件 → 持久化 → change 广播。挂在 App 上是因为入口分散在引导页、
  // 设置页和徽章里，它们只该知道「派发一个事件」。
  useEffect(() => installDemoModeListeners(), []);

  // 演示桥每次切换重建：内存文件系统不跨模式复用，退出演示后真实扫描从零开始。
  const bridges = useMemo(
    () => (demo ? installDemoBridges() : installTauriBridges()),
    [demo]
  );

  return (
    <>
      {demo ? <DemoBadge /> : null}
      {/*
        key 必须跟着模式走：会话列表、用量聚合、解析缓存在模块级单例里，
        只换 bridges 而不 remount 会把真实模式的缓存带进演示界面（反过来
        也会把演示数据带出去）。remount 是这条边界的唯一可靠实现。
      */}
      <AppShell key={demo ? "demo" : "real"} bridges={bridges} />
    </>
  );
}
