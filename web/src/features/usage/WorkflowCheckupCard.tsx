import { Fragment, useState } from "react";
import { Panel } from "../../components/Panel";
import {
  CHECKUP_THRESHOLDS,
  type CheckupItem,
  type CheckupLevel,
  type CheckupMeter,
  type WorkflowCheckup
} from "./workflowCheckup";
import styles from "./WorkflowCheckupCard.module.css";

/**
 * 「工作流体检」（Issue #391）的卡片层。
 *
 * 判定、级别、排序、上限与每一句事实/证据文案都在 `workflowCheckup.ts`；
 * 这里只做四件事：把结果摆成两行一条的诊断清单、按需展开证据、把唯一的
 * 真实出口（「打开错误档」）接给页面、在两种空态下整卡不渲染。
 *
 * 六条写死在结构里的规则（design §1–§4）：
 * 1. **整行不可点**：行不是按钮、不在 Tab 序；只有行内「证据」与动作链接
 *    可聚焦。点事实文字不展开——这正是与「值得注意的变化」最明显的差异。
 * 2. **三档只靠形状 + 墨色 + 级别字**：实心圆 / 空心环 / 短横，零语义色；
 *    常态下唯一的彩色像素是真的能跳转的链接。
 * 3. **证据是定义列表 + 刻度条**，不是「当前 / 上一个」对照表；判定线画在
 *    填充之上（最需要看见它的时候，读数正好盖过它）。
 * 4. **手风琴**：同一时刻只开一条；Escape 收起且焦点留在「证据」按钮上。
 *    WKWebView 对鼠标点击的按钮不一定给焦点，所以点击时显式聚焦。
 * 5. **空态**：`quiet` / `insufficient` / `empty` 一律返回 `null`——没有要改
 *    的地方就不占版面。`insufficient` 的数据层事实（status 与三个计数）仍保留，
 *    但一条可执行信息都给不出的卡不该把后面的实质内容推出首屏。
 * 6. **行高由令牌派生**，不写固定 `height`：130% 字号下行盒会跟着长高。
 */

/** 数字片段：等宽 + 等宽数字，**不额外着色**（颜色会冒充「好 / 坏」判断）。 */
const NUMBER_TOKEN = /^\d[\d,.]*(?:[%KMB])?$/;

function renderNumbered(text: string) {
  return text
    .split(/(\d[\d,.]*(?:[%KMB])?)/)
    .filter((part) => part !== "")
    .map((part, index) =>
      NUMBER_TOKEN.test(part) ? (
        <span key={index} className={styles.number}>
          {part}
        </span>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      )
    );
}

const LEVEL_LABEL: Record<CheckupLevel, string> = {
  focus: "关注",
  notice: "留意",
  observe: "观察"
};

/** 级别字对读屏隐藏，语义由 h3 里的 sr-only 前缀承担，避免念两遍。 */
const LEVEL_PREFIX: Record<CheckupLevel, string> = {
  focus: "关注：",
  notice: "留意：",
  observe: "观察："
};

const MARKER_CLASS: Record<CheckupLevel, string> = {
  focus: styles.markerFocus,
  notice: styles.markerNotice,
  observe: styles.markerObserve
};

/**
 * 口径脚注（design §5 定稿）。两段条件追加只在有对应事实时出现：
 * 样本不足项与显示上限都不该被读者自己猜。
 */
const FOOTNOTE =
  "检查的是使用方式，不是日志文件完整性；只看绝对水平，不与上一段区间比较，" +
  "也不给分、不排名。阈值与样本下限写在每项的依据里。";

function clampPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

/** 顶部总述读数：只在 `ok` 状态渲染，形态是读数不是徽章。 */
function Summary({ checkup }: { checkup: WorkflowCheckup }) {
  const worth = checkup.counts.focus + checkup.counts.notice;
  return (
    <span className={styles.summary} data-probe="checkup-summary">
      <span className={styles.summaryNumber}>{checkup.checked}</span> 项检查里{" "}
      <span className={styles.summaryNumber}>{worth}</span> 项值得看一眼
    </span>
  );
}

function Meter({ meter }: { meter: CheckupMeter }) {
  return (
    <div className={styles.meter}>
      {/* 刻度条是纯图形：读数由可见的 caption 与 dl 承担。 */}
      <div className={styles.meterTrack} data-probe="checkup-meter" aria-hidden="true">
        <div
          className={styles.meterFill}
          style={{ width: `${clampPercent(meter.value, meter.max)}%` }}
        />
        <div
          className={styles.meterThreshold}
          style={{ left: `${clampPercent(meter.threshold, meter.max)}%` }}
        />
      </div>
      <p className={styles.meterCaption}>{meter.caption}</p>
    </div>
  );
}

function Evidence({ item }: { item: CheckupItem }) {
  return (
    <div
      className={styles.evidence}
      id={`checkup-evidence-${item.id}`}
      data-probe="checkup-evidence"
    >
      <dl className={styles.evidenceList} aria-label={`${item.dimension}的判定依据`}>
        {item.evidence.rows.map((row) => (
          <Fragment key={row.label}>
            <dt className={styles.evidenceLabel}>{row.label}</dt>
            <dd
              className={row.numeric ? styles.evidenceValueNumeric : styles.evidenceValue}
            >
              {row.numeric ? renderNumbered(row.value) : row.value}
            </dd>
          </Fragment>
        ))}
      </dl>
      {item.evidence.meter === null ? null : <Meter meter={item.evidence.meter} />}
    </div>
  );
}

export function WorkflowCheckupCard({
  checkup,
  onOpenErrors
}: {
  checkup: WorkflowCheckup;
  /**
   * 「打开错误档」的出口。缺省时不渲染按钮（不是 disabled）——一个按不动的
   * 链接会让用户以为坏了；处方文字照旧保留。
   */
  onOpenErrors?: () => void;
}) {
  // 同一时刻只有一条展开；规则 id 在五条规则里唯一，不需要另造 key。
  const [openId, setOpenId] = useState<string | null>(null);

  // 没有要改的地方就不占版面：quiet / insufficient / empty 一律不渲染。
  // 样本不足时数据层仍有 status 与三个计数（供测试 / 未来的页头提示），但它
  // 给不出任何可执行动作，把唯一有实质内容的卡推出首屏才是更坏的选择。
  if (
    checkup.status === "quiet" ||
    checkup.status === "insufficient" ||
    checkup.status === "empty"
  ) {
    return null;
  }

  return (
    <Panel
      title="工作流体检"
      ariaLabel="工作流体检"
      actions={<Summary checkup={checkup} />}
    >
      <div data-probe="workflow-checkup">
        <ol
          className={styles.list}
          data-probe="checkup-list"
          onKeyDown={(event) => {
            // 证据区没有可聚焦元素，焦点始终在「证据」按钮上；Escape 冒泡到
            // 清单即可收起，不移动焦点。
            if (event.key === "Escape" && openId !== null) {
              event.preventDefault();
              setOpenId(null);
            }
          }}
        >
          {checkup.items.map((item) => {
            const open = openId === item.id;
            const evidenceId = `checkup-evidence-${item.id}`;
            const jump = item.action?.kind === "jump" ? item.action : null;

            return (
              <li
                key={item.id}
                className={styles.item}
                data-probe="checkup-item"
                data-checkup-id={item.id}
                data-checkup-level={item.level}
              >
                <span className={styles.markerCell}>
                  <span
                    className={`${styles.marker} ${MARKER_CLASS[item.level]}`}
                    aria-hidden="true"
                  />
                </span>

                <div className={styles.dimension}>
                  <h3 className={styles.dimensionName}>
                    <span className={styles.srOnly}>{LEVEL_PREFIX[item.level]}</span>
                    {item.dimension}
                  </h3>
                  <span className={styles.level} aria-hidden="true">
                    {LEVEL_LABEL[item.level]}
                  </span>
                </div>

                <div className={styles.content}>
                  <p className={styles.fact} data-probe="checkup-fact">
                    {renderNumbered(item.fact)}
                    <button
                      type="button"
                      className={styles.evidenceToggle}
                      data-probe="checkup-evidence-toggle"
                      aria-expanded={open}
                      aria-controls={open ? evidenceId : undefined}
                      aria-label={
                        open
                          ? `收起证据：${item.dimension}`
                          : `展开证据：${item.dimension}`
                      }
                      onClick={(event) => {
                        // WKWebView 不保证鼠标点击给按钮焦点；不显式聚焦的话，
                        // 点开证据后按 Escape 没有落点。键盘路径的环不受影响。
                        event.currentTarget.focus();
                        setOpenId(open ? null : item.id);
                      }}
                    >
                      {open ? "收起" : "证据"}
                    </button>
                  </p>

                  <p className={styles.action} data-probe="checkup-action">
                    {item.action === null ? (
                      <>
                        <span className={styles.actionLabel}>说明</span>
                        <span data-probe="checkup-note">{item.note}</span>
                      </>
                    ) : (
                      <>
                        <span className={styles.actionLabel}>处方</span>
                        {item.action.text}
                        {jump !== null && onOpenErrors !== undefined ? (
                          <button
                            type="button"
                            className={styles.actionLink}
                            data-probe="checkup-action-link"
                            aria-label={`${jump.linkLabel}，${jump.text}`}
                            onClick={() => onOpenErrors()}
                          >
                            {jump.linkLabel} <span aria-hidden="true">→</span>
                          </button>
                        ) : null}
                      </>
                    )}
                  </p>

                  {open ? <Evidence item={item} /> : null}
                </div>
              </li>
            );
          })}
        </ol>

        <p className={styles.footnote}>
          {FOOTNOTE}
          {checkup.ineligible > 0
            ? ` 另有 ${checkup.ineligible} 项样本不足，未判定。`
            : ""}
          {checkup.dropped > 0
            ? ` 按严重度显示前 ${CHECKUP_THRESHOLDS.maxItems} 项。`
            : ""}
        </p>
      </div>
    </Panel>
  );
}
