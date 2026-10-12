import { AppShell } from "./app/AppShell";
import { installTauriBridges } from "./api/tauri";
import { initFontScale } from "./features/settings/fontScale";
import { initContrast } from "./features/settings/contrast";

// index.html 的预绘制脚本负责第一帧不闪；这里把内存 store 同步到同一档，
// 避免控件在首屏短暂显示默认 100%。
initFontScale();
// 界面对比度：解析持久化、没写过才跟随系统偏好，把结果写到根元素并同步内存 store。
initContrast();

export default function App() {
  return (
    <AppShell bridges={installTauriBridges()} />
  );
}
