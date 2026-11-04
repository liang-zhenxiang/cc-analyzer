/**
 * 演示模式的开关状态。
 *
 * 状态落在 localStorage 而不是 React Context：入口（引导页、设置页）与
 * `App` 可能不在同一棵子树里，而演示开关是**整机级**的——换一棵树就丢失状态
 * 会让用户点完「看看演示」之后界面原地不动。事件负责把变化广播回 `App`。
 *
 * 切换演示必须 remount 整个外壳（见 `App.tsx` 的 `key`）：真实模式下算过的
 * 元数据、用量聚合缓存在模块级单例里，不 remount 会把真实读数漏进演示界面。
 */

export const DEMO_STORAGE_KEY = "cca-demo-mode";
/** 任何关心演示模式的组件都监听这个事件，而不是各自轮询 localStorage。 */
export const DEMO_CHANGE_EVENT = "cca-demo-change";
/** 由「进入演示」的入口派发，App 收到后把开关落成 on 并切换内存桥。 */
export const DEMO_ENTER_EVENT = "cca-demo-enter";
/** 由演示徽章的「退出演示」派发。 */
export const DEMO_EXIT_EVENT = "cca-demo-exit";

/** localStorage 在隐私模式 / 沙箱里可能直接抛错；读失败一律按「不是演示」。 */
export function isDemoMode(): boolean {
  try {
    return window.localStorage.getItem(DEMO_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

/**
 * 写入开关并广播。持久化失败时**仍然广播**：本次会话内的切换必须生效，
 * 只是下次启动不会记得——这与仓库里其它设置（托盘开关、字号）的处理一致。
 */
export function setDemoMode(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(DEMO_STORAGE_KEY, "on");
    else window.localStorage.removeItem(DEMO_STORAGE_KEY);
  } catch {
    // 见上：内存态照常切换。
  }
  window.dispatchEvent(new Event(DEMO_CHANGE_EVENT));
}

/**
 * 订阅「进入 / 退出演示」两个命令事件，返回取消订阅函数。
 * 由 `App` 在挂载时调用；放在这里是为了让事件名与写入逻辑只存在于一处。
 */
export function installDemoModeListeners(): () => void {
  const enter = () => setDemoMode(true);
  const exit = () => setDemoMode(false);

  window.addEventListener(DEMO_ENTER_EVENT, enter);
  window.addEventListener(DEMO_EXIT_EVENT, exit);

  return () => {
    window.removeEventListener(DEMO_ENTER_EVENT, enter);
    window.removeEventListener(DEMO_EXIT_EVENT, exit);
  };
}
