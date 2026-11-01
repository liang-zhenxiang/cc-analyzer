import type { SessionMeta } from "../sessions/metadataCache";
import type { PlanSelection } from "./planLimits";
import type { UsageSessionInput } from "./usageAggregations";
import { BudgetRunwayPanel } from "./BudgetRunwayPanel";
import { ConstellationPanel } from "./ConstellationPanel";
import { CostSandboxPanel } from "./CostSandboxPanel";
import { CutoffPanel } from "./CutoffPanel";
import type { HourlyTokens } from "./cutoffProjection";
import { CostTerrainPanel } from "./CostTerrainPanel";
import { FlameGraphPanel } from "./FlameGraphPanel";
import { HallOfFamePanel } from "./HallOfFamePanel";
import { HeartbeatPanel } from "./HeartbeatPanel";
import { ProjectFootprintPanel } from "./ProjectFootprintPanel";
import { PromptRhythmPanel } from "./PromptRhythmPanel";
import { ToolEcosystemPanel } from "./ToolEcosystemPanel";
import styles from "./LabView.module.css";

/**
 * 数据实验室（Round FF：十种看法 + Round HH 的收工推演，共十一张卡）。
 *
 * 它是用量页的第 5 个子视图，不是新页面——十张卡吃的是同一次扫描产出的
 * `inputs`、同一个区间控件与同一个 `now`，零新增 I/O、零新增后端命令。
 *
 * 版面按阅读叙事排（设计 §1.3），不是按功能编号：
 * 星系独享整行（全景）→ 地形成对名人堂（形态 → 极值）→ 火焰成对沙盘
 * （观察 → 假设）→ 生态成对足迹（工具结构 / 项目结构）→ 心跳整行（节奏）
 * → 跑道成对散点（前瞻 → 个人节律）。
 *
 * 每张卡外面包一层 `data-lab-card`：截图脚本按它逐卡取图，e2e 按它断言
 * 「十一张卡都在」，卡片本身不重复造定位属性。
 */
export function LabView({
  inputs,
  days,
  now,
  plan,
  onOpenSession,
  hourlyTokens,
  sampleDays,
  scanning
}: {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
  plan: PlanSelection;
  onOpenSession?: (session: SessionMeta) => void;
  /** H2 的输入：窗口内按本地小时聚合的 token（`RangeAggregate.hourlyTokens`）。 */
  hourlyTokens?: readonly HourlyTokens[];
  /** 窗口内有逐小时读数的天数——少于 3 天时推演卡不给滑杆。 */
  sampleDays: number;
  scanning: boolean;
}) {
  return (
    <section className={styles.lab} aria-label="数据实验室" data-probe="lab-view">
      <header className={styles.intro}>
        <div className={styles.introText}>
          <h2 className={styles.title}>数据实验室</h2>
          <p className={styles.description}>
            十一个视角读同一份本机日志：形状、密度、极端值、前瞻与「如果早点收工」——全部现算，不出本机。
          </p>
        </div>
        {/* 口径声明，不是第二个区间控件：窗口的唯一实例仍在页头第一行。 */}
        <span className={styles.scope}>{`近 ${days} 天 · 全量扫描`}</span>
      </header>

      <div className={styles.grid}>
        <div className={`${styles.card} ${styles.galaxy}`} data-lab-card="galaxy">
          <ConstellationPanel
            inputs={inputs}
            days={days}
            now={now}
            onOpenSession={onOpenSession}
          />
        </div>

        <div className={`${styles.card} ${styles.terrain}`} data-lab-card="terrain">
          <CostTerrainPanel inputs={inputs} days={days} now={now} />
        </div>

        <div className={`${styles.card} ${styles.hall}`} data-lab-card="hall">
          <HallOfFamePanel inputs={inputs} days={days} now={now} onOpenSession={onOpenSession} />
        </div>

        <div className={`${styles.card} ${styles.flame}`} data-lab-card="flame">
          <FlameGraphPanel inputs={inputs} days={days} now={now} onOpenSession={onOpenSession} />
        </div>

        <div className={`${styles.card} ${styles.sandbox}`} data-lab-card="sandbox">
          <CostSandboxPanel inputs={inputs} days={days} now={now} plan={plan} />
        </div>

        {/* H2 收工推演（Round HH）：沙盘之后——同一个「如果……会怎样」的
            反事实区，不混进用量主档的实测读数。span 12 独占一行。 */}
        <div className={`${styles.card} ${styles.cutoff}`} data-lab-card="cutoff">
          <CutoffPanel
            hourlyTokens={hourlyTokens}
            days={days}
            sampleDays={sampleDays}
            scanning={scanning}
          />
        </div>

        <div className={`${styles.card} ${styles.network}`} data-lab-card="network">
          <ToolEcosystemPanel inputs={inputs} days={days} now={now} plan={plan} />
        </div>

        <div className={`${styles.card} ${styles.footprint}`} data-lab-card="footprint">
          <ProjectFootprintPanel inputs={inputs} days={days} now={now} plan={plan} />
        </div>

        <div className={`${styles.card} ${styles.heartbeat}`} data-lab-card="heartbeat">
          <HeartbeatPanel inputs={inputs} days={days} now={now} onOpenSession={onOpenSession} />
        </div>

        <div className={`${styles.card} ${styles.runway}`} data-lab-card="runway">
          <BudgetRunwayPanel inputs={inputs} days={days} now={now} plan={plan} />
        </div>

        <div className={`${styles.card} ${styles.scatter}`} data-lab-card="scatter">
          <PromptRhythmPanel inputs={inputs} days={days} now={now} onOpenSession={onOpenSession} />
        </div>
      </div>
    </section>
  );
}
