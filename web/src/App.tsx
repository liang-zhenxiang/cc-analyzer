import { AppShell } from "./app/AppShell";
import { installTauriBridges } from "./api/tauri";
import { initFontScale } from "./features/settings/fontScale";
import { initContrast } from "./features/settings/contrast";
import { initKiosk } from "./app/KioskMode";

// index.html 的预绘制脚本负责第一帧不闪；这里把内存 store 同步到同一档，
// 避免控件在首屏短暂显示默认 100%。
initFontScale();
// 界面对比度：解析持久化、没写过才跟随系统偏好，把结果写到根元素并同步内存 store。
initContrast();
// 大屏模式：与字号/对比度同款，先落地持久化再渲染，避免第一帧先闪一下常规外壳。
initKiosk();

export default function App() {
  return (
    <AppShell bridges={installTauriBridges()} />
  );
}
