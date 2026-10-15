import type { Locator, Page } from "@playwright/test";

/**
 * 会话条目的选择器——**整个 e2e 套件的唯一事实来源**。
 *
 * 一行字符串，但它踩过两次坑，两次都是「选择器写宽/写窄」而不是功能坏了：
 *
 * 1. **不能按标签名选 `button`**。行的本体是 `role="button"` 的 `<div>`，不是
 *    `<button>`：出血点徽章得是**真按钮**，而按钮不能嵌按钮，所以外层降级成了
 *    `role=button`（原因见 `features/sessions/SessionList.tsx` 里那段注释）。
 *    历史上这里写的是 `button[title]:has(strong)`，DOM 一改它就选到 **0 个元素**，
 *    整套 e2e 超时，而报错停在「等一个不存在的选择器」上，看不出真正的原因。
 *    所以按 `role` 选，不按标签名选。
 *
 * 2. **`[title]` 不是可有可无的**，也不能放宽成 `[role="button"]` 一类。会话条目
 *    带 `title={cwd ?? path}`（给用户看的路径提示），这是它的语义锚点；而列表
 *    容器里还有别的可点元素——工具栏那颗 IconButton 也带 `title`，分组折叠按钮
 *    也含 `<strong>`。少了 `[title]` 或少了 `:has(strong)` 都会把计数顶高一位
 *    （「5 个会话」变成 6），看着像功能坏了，其实是选择器写宽了。
 *
 * 因此选择器**故意写窄**：`[title]` 与 `:has(strong)` 各挡掉一类噪声。这份特异性是
 * 行为的一部分，不要为了省事删掉任一半。**全仓只此一份**——各 spec 各抄一份正是
 * 漂移能一次打穿十几个文件的根因。
 *
 * 特异性不是推理出来的，是实测的：见 `selector-probe.spec.ts`——它量出会话列表
 * 容器内共 9 个 `[title]` 元素而会话条目只有 8 条，多出的那 1 个正是工具栏
 * IconButton（`title="刷新会话列表"`）。改动这个选择器前先跑那条用例。
 */
export const SESSION_ITEM_SELECTOR = '[role="button"][title]:has(strong)';

/**
 * 侧栏「会话列表」里的会话行。
 *
 * 先限定在会话列表容器内（`getByLabel`），再套上面的窄选择器——两道收敛，缺一不可。
 */
export function sessionItems(page: Page): Locator {
  return page.getByLabel("会话列表", { exact: true }).locator(SESSION_ITEM_SELECTOR);
}
