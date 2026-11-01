/**
 * 空状态引导（H10，Round HH）：新用户第一次打开时给他一条「下一步做什么」。
 *
 * 口径立场：本模块是**纯状态机**——三个布尔/数字进来，三步引导出去，
 * 不碰扫描器、不碰 UI。状态推进规则只有一条：
 *
 *   第一个未 done 的步骤是 current（正在做的那步），
 *   它之前的都 done，它之后的都 todo。
 *   全部 done 时最后一步 current（引导收尾：告诉用户「去打开用量总览」，
 *   而不是三条全灰让引导凭空消失）。
 *
 * 「等待扫描」的 done 判定是 scanComplete && sessionCount > 0 **同时成立**：
 * 扫描完成但一个会话都没找到，等于这步没有产出——保持 current 并把
 * detail 换成「没找到会话文件，检查目录」的排查文案（选错目录是空状态
 * 最常见的原因，值得占住这一步说话）。
 */

export type EmptyGuideInput = {
  /** 是否已选择日志目录。 */
  hasDirectory: boolean;
  /** 扫描是否已完成。 */
  scanComplete: boolean;
  /** 扫到的会话数。 */
  sessionCount: number;
};

export type GuideStep = {
  /** 步骤 id（界面层做 key / probe）。 */
  id: "pick" | "scan" | "explore";
  /** 步骤名。 */
  title: string;
  /** 一句话说明（「等待扫描」在扫完但零会话时换成排查文案）。 */
  detail: string;
  /** done = 已完成；current = 正在这一步（全 done 时收尾步是 current）；todo = 还没轮到。 */
  state: "done" | "current" | "todo";
};

export type EmptyGuide = {
  steps: GuideStep[];
};

export function emptyGuideSteps(input: EmptyGuideInput): EmptyGuide {
  const pickDone = input.hasDirectory;

  // 扫完但零会话不算 done：这一步保持 current，文案切到排查。
  const scanFound = input.scanComplete && input.sessionCount > 0;
  const scanEmpty = input.scanComplete && input.sessionCount === 0;

  // 「打开用量总览」的 done 判定：前两步都成了、且已经有数据可看。
  // 本模块拿不到「用户是否真的打开过总览」——那条信号归界面层（视图
  // 状态不在模型层手里）；所以这里用「数据已就绪」近似：前两步 done
  // 时第三步 current 收尾，引导停在最后一步等用户行动。
  const exploreReady = pickDone && scanFound;

  const steps: GuideStep[] = [
    {
      id: "pick",
      title: "选择目录",
      detail: "指定 Claude 的日志目录（~/.claude/projects）",
      state: pickDone ? "done" : "current"
    },
    {
      id: "scan",
      title: "等待扫描",
      detail: scanEmpty
        ? "没找到会话文件，检查目录"
        : "读完目录里的全部会话文件",
      state: pickDone ? (scanFound ? "done" : "current") : "todo"
    },
    {
      id: "explore",
      title: "打开用量总览",
      detail: "看看这段时间都用在了哪里",
      state: exploreReady ? "current" : "todo"
    }
  ];

  return { steps };
}
