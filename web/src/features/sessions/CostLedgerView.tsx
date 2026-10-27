import { useEffect, useMemo, useRef, useState } from "react";
import { CsvExportButton } from "../../components/CsvExportButton";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { csvFileName } from "../usage/csvExport";
import { ProvenanceBadge } from "../usage/ProvenanceBadge";
import { formatClock, formatModelId, formatTokenCount } from "../../lib/format";
import {
  LEDGER_CLASS_ORDER,
  buildCostLedger,
  classUnitPrice,
  formatLedgerRate,
  formatLedgerUsd,
  formatSharePercent,
  type CostLedger,
  type LedgerClassKey,
  type LedgerUnitPrice
} from "./costLedger";
import type { ParsedSession } from "./types";
import styles from "./CostLedgerView.module.css";

/** 四个科目在收据里的名字。顺序由 `LEDGER_CLASS_ORDER` 决定，不在界面重排。 */
const CLASS_LABELS: Record<LedgerClassKey, string> = {
  input: "输入",
  output: "输出",
  cacheWrite: "缓存写入",
  cacheRead: "缓存读取"
};

/** 档名只用于「按模型」的注脚与单价的读屏句。 */
const FAMILY_LABELS = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" } as const;

const RECEIPT_CAPTION =
  "会话账单：四类 token 的用量、单价、占比与小计，最后一行是合计";

const MODEL_FOOTNOTE =
  "分项为紧凑读数；逐位合计见上方收据。≈ 为按各模型实际用量加权的均价，各模型自己的确定单价见本表。";

const CACHE_FOOTNOTE =
  "按可定价调用计算。按同一模型的输入单价估算：读取量 ×（输入单价 − 缓存读取单价），只算可定价模型。";

/** 读屏句里的金额：`—` 读成「定价未知」，其余带着「美元」单位。 */
function moneySpeech(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return "定价未知";
  return `${formatLedgerUsd(usd).replace(/^\$/, "")} 美元`;
}

function rateSpeech(label: string, price: LedgerUnitPrice): string {
  if (price.kind === "none") return `${label}单价 无用量`;
  if (price.kind === "weighted") {
    return `${label}加权均价 ${price.value.toFixed(2)} 美元每百万 token，按各模型实际用量加权`;
  }
  return `${label}单价 ${price.value.toFixed(2)} 美元每百万 token（${
    FAMILY_LABELS[price.family]
  } 档）`;
}

/** 缓存命中率：分母为 0 是「无从谈起」，不是 0%。 */
function formatHitRate(hitRate: number | null): string {
  if (hitRate === null || !Number.isFinite(hitRate)) return "—";
  const percent = hitRate * 100;
  if (percent > 0 && percent < 0.05) return "<0.1%";
  return `${percent.toFixed(1)}%`;
}

function tokenTitle(tokens: number): string {
  return `${tokens.toLocaleString("en-US")} token`;
}

/**
 * 会话详情「账单」标签页（Round BB）：把一次会话的 token 用量估成一张收据。
 *
 * 数据与口径全部在 `costLedger.ts`（含三种金额/单价/占比格式化），本组件不
 * 自己算账、不再写第二套格式化——账单上的每一个数字都必须能对上同一个来源。
 *
 * 页面结构是「一张卡 + 卡内唯一滚动容器」：收据（四类科目 + 合计）在上，
 * 按模型 / 缓存经济学 / 最贵五次在下；常驻脚注留在滚动区外，滚到最贵的
 * 调用时「估算，不是账单」仍然可见。
 */
export function CostLedgerView({
  parsed,
  onLocateInLog
}: {
  parsed: ParsedSession;
  /** 点「最贵五次」的时刻跳回日志并定位该条记录；不新建跳转通道。 */
  onLocateInLog: (recordId: string) => void;
}) {
  const ledger = useMemo(() => buildCostLedger(parsed.records), [parsed]);

  // 状态 1：一次带 usage 的模型调用都没有。这与「有调用但定价未知」是
  // 两件事——后者 token 量真实存在，画成空态等于把数据藏起来。
  if (ledger.pricedCalls === 0 && ledger.unpricedCalls === 0) {
    return (
      <EmptyState
        size="panel"
        title="本会话没有模型调用"
        description="日志里没有带 usage 的助手记录，没有可估算的账单。"
      />
    );
  }

  return <LedgerCard ledger={ledger} onLocateInLog={onLocateInLog} />;
}

function LedgerCard({
  ledger,
  onLocateInLog
}: {
  ledger: CostLedger;
  onLocateInLog: (recordId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 静态滚动提示：只在「确实还有内容在折线以下」时出现，滚到底即消失。
  // jsdom 没有排版，真实溢出仍由 e2e 的 G10/G11 量。
  const [canScrollDown, setCanScrollDown] = useState(false);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const update = () => {
      setCanScrollDown(node.scrollHeight - node.scrollTop - node.clientHeight > 1);
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  const hasReceipt = ledger.pricedCalls > 0;
  const byKey = new Map(ledger.classes.map((line) => [line.key, line]));
  const unpricedModelRows = ledger.models.filter((line) => line.family === null).length;
  const topCalls = ledger.topCalls;
  // 状态 6：所有调用都是 $0.00（有 usage 但四类 token 全 0）时，排序毫无意义，
  // 与其画五条并列零，不如直说没有先后。
  const allTopZero = topCalls.length > 0 && topCalls.every((call) => call.usd === 0);
  const topEmptyText = !hasReceipt
    ? "没有可比较的金额，无法排序。"
    : allTopZero
      ? "本会话的调用金额都是 $0.00，没有可排的先后。"
      : null;
  const hitRate = ledger.cache.hitRate;
  const savedText = hasReceipt ? formatLedgerUsd(ledger.cache.savedUsd) : "—";

  // E5：「最贵的五次调用」表的 CSV。只导可定价调用——与表里能看到的行一一对应，
  // 未定价调用在收据脚注里已经说过「另有 N 次未计入」，导出里不再混一条空行。
  const topCallRows = useMemo(
    () =>
      topCalls.map((call) => [
        formatClock(call.timestamp, true),
        formatModelId(call.model),
        call.tokens.input,
        call.tokens.output,
        call.tokens.cacheWrite,
        call.tokens.cacheRead,
        call.usd
      ]),
    [topCalls]
  );

  return (
    <div className={styles.root} data-probe="cost-root">
      <Panel
        title="会话账单"
        ariaLabel="会话账单"
        actions={
          <>
            <CsvExportButton
              filename={csvFileName("top-calls", Date.now())}
              headers={["时刻", "模型", "输入", "输出", "缓存写入", "缓存读取", "小计（美元）"]}
              rows={topCallRows}
              probe="csv-export-top-calls"
            />
            <ProvenanceBadge
              provenance="estimated"
              detail={`快照日期 ${ledger.pricingAsOf}`}
            />
          </>
        }
      >
        <div className={styles.bodyWrap}>
          <div className={styles.scrollWrap}>
            <div
              ref={scrollRef}
              className={styles.scroll}
              tabIndex={0}
              aria-label="账单内容"
              data-probe="cost-scroll"
            >
              <section className={styles.receipt} aria-label="费用收据">
                {hasReceipt ? (
                  <table className={styles.receiptTable} data-probe="cost-receipt">
                    <caption className={styles.srOnly}>{RECEIPT_CAPTION}</caption>
                    <thead>
                      <tr>
                        <th scope="col">科目</th>
                        <th scope="col">Token</th>
                        <th scope="col">单价 / 百万</th>
                        <th scope="col">占比</th>
                        <th scope="col">小计</th>
                      </tr>
                    </thead>
                    <tbody>
                      {LEDGER_CLASS_ORDER.map((key) => {
                        const line = byKey.get(key);
                        if (!line) return null;
                        const label = CLASS_LABELS[key];
                        const price = classUnitPrice(ledger, key);
                        return (
                          <tr key={key} data-probe="cost-receipt-row" data-class={key}>
                            <th scope="row">
                              <span className={styles.subjectFlex}>
                                <span>{label}</span>
                                <span className={styles.leader} aria-hidden="true" />
                              </span>
                            </th>
                            <td aria-label={`${label} ${tokenTitle(line.tokens)}`}>
                              {line.tokens.toLocaleString("en-US")}
                            </td>
                            <td aria-label={rateSpeech(label, price)}>
                              {formatLedgerRate(price.value, price.kind === "weighted")}
                            </td>
                            <td>
                              <span className={styles.shareFlex}>
                                <span
                                  className={styles.bar}
                                  aria-hidden="true"
                                  data-probe="cost-bar"
                                >
                                  <span
                                    className={styles.fill}
                                    style={{ width: `${line.share * 100}%` }}
                                  />
                                </span>
                                <span className={styles.shareText}>
                                  {formatSharePercent(line.share, line.tokens)}
                                </span>
                              </span>
                            </td>
                            <td
                              className={styles.sum}
                              data-probe="cost-money"
                              data-col="sum"
                              aria-label={`小计 ${moneySpeech(line.usd)}`}
                            >
                              {formatLedgerUsd(line.usd)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr data-probe="cost-receipt-total">
                        <th scope="row">合计</th>
                        <td aria-label="合计 无用量">—</td>
                        <td aria-label="合计 无单价">—</td>
                        <td>
                          <span className={styles.shareFlex}>
                            <span className={styles.shareText}>100.0%</span>
                          </span>
                        </td>
                        <td
                          className={styles.totalAmount}
                          data-probe="cost-money"
                          data-col="sum"
                          aria-label={`合计 ${moneySpeech(ledger.totalUsd)}`}
                        >
                          {formatLedgerUsd(ledger.totalUsd)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  // 状态 2：有调用，但一次都没定价。token 量真实存在，只是钱未知。
                  <p className={styles.ledgerEmpty}>
                    {`${ledger.unpricedCalls} 次调用无法计价：没有可用的 token 读数，或模型定价未知。`}
                  </p>
                )}
                {hasReceipt && ledger.unpricedCalls > 0 ? (
                  <p className={styles.unpriced} data-probe="cost-unpriced">
                    {`另有 ${ledger.unpricedCalls} 次调用未计入（没有可用的 token 读数，或模型定价未知）`}
                  </p>
                ) : null}
              </section>

              <section className={styles.section} aria-labelledby="cost-models">
                <div className={styles.sectionHead}>
                  <h3 id="cost-models">按模型</h3>
                  <span className={styles.sectionMeta}>
                    {`${ledger.models.length} 个模型 · ${unpricedModelRows} 个定价未知`}
                  </span>
                </div>
                <table className={styles.grid} data-probe="cost-models">
                  <thead>
                    <tr>
                      <th scope="col">模型</th>
                      <th scope="col">输入</th>
                      <th scope="col">输出</th>
                      <th scope="col">缓存写入</th>
                      <th scope="col">缓存读取</th>
                      <th scope="col">小计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.models.map((line) => {
                      const priced = line.family !== null;
                      const meta =
                        line.family !== null
                          ? `· ${FAMILY_LABELS[line.family]} 档 · ${line.calls} 次调用`
                          : `· 定价未知 · ${line.calls} 次调用`;
                      return (
                        <tr key={line.model} data-probe="cost-model-row">
                          <th scope="row">
                            <strong
                              className={styles.modelName}
                              title={line.model}
                              aria-label={line.model}
                            >
                              {formatModelId(line.model)}
                            </strong>
                            <span className={styles.modelMeta}>{meta}</span>
                          </th>
                          {LEDGER_CLASS_ORDER.map((key) => (
                            <td
                              key={key}
                              aria-label={`${CLASS_LABELS[key]} ${tokenTitle(line.tokens[key])}`}
                              title={tokenTitle(line.tokens[key])}
                            >
                              {formatTokenCount(line.tokens[key])}
                            </td>
                          ))}
                          <td
                            className={priced ? styles.sum : styles.sumUnknown}
                            data-probe="cost-money"
                            data-col="sum"
                            aria-label={`小计 ${moneySpeech(line.usd)}`}
                          >
                            {formatLedgerUsd(line.usd)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className={styles.note}>{MODEL_FOOTNOTE}</p>
              </section>

              <section className={styles.section} aria-labelledby="cost-cache">
                <div className={styles.sectionHead}>
                  <h3 id="cost-cache">缓存经济学</h3>
                  <span className={styles.sectionMeta}>按可定价调用计算</span>
                </div>
                <dl className={styles.stats} data-probe="cost-cache">
                  <div className={styles.stat}>
                    <dt className={styles.statName}>缓存命中率</dt>
                    <dd className={styles.statValue}>{formatHitRate(hitRate)}</dd>
                  </div>
                  <div className={styles.stat}>
                    <dt className={styles.statName}>缓存读取（token）</dt>
                    <dd className={styles.statValue}>
                      {ledger.cache.readTokens.toLocaleString("en-US")}
                    </dd>
                  </div>
                  <div className={styles.stat}>
                    <dt className={styles.statName}>省下（估算）</dt>
                    <dd className={styles.statValue}>{savedText}</dd>
                  </div>
                </dl>
                <p className={styles.note}>
                  {hitRate === null
                    ? `${CACHE_FOOTNOTE}本会话没有输入类 token，命中率无从计算。`
                    : CACHE_FOOTNOTE}
                </p>
              </section>

              <section className={styles.section} aria-labelledby="cost-top">
                <div className={styles.sectionHead}>
                  <h3 id="cost-top">最贵的五次调用</h3>
                  {topEmptyText === null ? (
                    <span className={styles.sectionMeta}>
                      {`${topCalls.length} 笔 · 按小计降序`}
                    </span>
                  ) : null}
                </div>
                {topEmptyText === null ? (
                  <table className={`${styles.grid} ${styles.top}`} data-probe="cost-top">
                    <caption className={styles.srOnly}>
                      最贵的五次调用（均为模型调用，按小计降序）
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">时刻</th>
                        <th scope="col">模型</th>
                        <th scope="col">输入</th>
                        <th scope="col">输出</th>
                        <th scope="col">缓存写入</th>
                        <th scope="col">缓存读取</th>
                        <th scope="col">小计</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topCalls.map((call) => (
                        <tr key={call.recordId} data-probe="cost-top-row">
                          <td>
                            <button
                              type="button"
                              className={styles.jump}
                              aria-label={`跳到日志：${formatClock(
                                call.timestamp,
                                true
                              )} 的模型调用（${formatModelId(call.model)}，小计 ${moneySpeech(
                                call.usd
                              )}）`}
                              onClick={() => onLocateInLog(call.recordId)}
                            >
                              {formatClock(call.timestamp, true)}
                            </button>
                          </td>
                          <td className={styles.topModel} title={call.model}>
                            {formatModelId(call.model)}
                          </td>
                          {LEDGER_CLASS_ORDER.map((key) => (
                            <td
                              key={key}
                              aria-label={`${CLASS_LABELS[key]} ${tokenTitle(
                                call.tokens[key]
                              )}`}
                              title={tokenTitle(call.tokens[key])}
                            >
                              {formatTokenCount(call.tokens[key])}
                            </td>
                          ))}
                          <td
                            className={styles.sum}
                            data-probe="cost-money"
                            data-col="sum"
                            aria-label={`小计 ${moneySpeech(call.usd)}`}
                          >
                            {formatLedgerUsd(call.usd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <EmptyState size="inline" title={topEmptyText} />
                )}
              </section>
            </div>
            {canScrollDown ? (
              <div className={styles.fade} data-probe="cost-fade" aria-hidden="true" />
            ) : null}
          </div>

          <p className={styles.footnote} data-probe="cost-footnote">
            {`估算，不是账单 · 定价快照 ${ledger.pricingAsOf}`}
          </p>
        </div>
      </Panel>
    </div>
  );
}
