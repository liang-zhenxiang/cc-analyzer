import { HOT_BURN_SHARE_PER_HOUR } from "./limitForecast";

/**
 * 「烧钱仪表」的纯逻辑（D6）：把 `buildLimitForecast` 已经算好的
 * `burnPerHour` / `projectedPct` 映射成表盘的档位与指针角度。
 *
 * 速率一律取 `LimitForecast.burnPerHour` 喂进来——本模块不做第二次除法，
 * 第二套速率迟早和预报行对不上。档位的 hot 下界与 `isHotBurn` 共用
 * `HOT_BURN_SHARE_PER_HOUR`（100%/h）：一个阈值只有一个定义。
 */

export type GaugeBand = "quiet" | "cruising" | "warm" | "hot";

/** 表盘刻度：`pct` 是百分比读数，`angle` 由 `gaugeNeedleAngle` 派生。 */
export type GaugeTick = { pct: number; angle: number; major: boolean };

/** quiet → cruising 的阈值：限额的 10% 每小时。 */
export const QUIET_BURN_SHARE_PER_HOUR = 0.1;
/** cruising → warm 的阈值：限额的 40% 每小时。 */
export const CRUISING_BURN_SHARE_PER_HOUR = 0.4;
/** warm → hot 的下界，与 `isHotBurn` 同源（100%/h）。 */
export const HOT_BAND_SHARE_PER_HOUR = HOT_BURN_SHARE_PER_HOUR;

/**
 * 表盘量程上限（刻度走到 200%）。指针在 100% 就到右端并封顶：100% 是
 * 「触顶」本身，之后的读数只剩「超了多少」一个信息，指针停在端点不撒谎。
 */
export const GAUGE_MAX_PCT = 200;

/** 指针的有效映射域：[0, 100] 线性映射到 [-90°, +90°]，超过按端点封顶。 */
const NEEDLE_FULL_SCALE_PCT = 100;
const NEEDLE_MIN_ANGLE = -90;
const NEEDLE_MAX_ANGLE = 90;

/**
 * 速率档位：burn < 10%限额/h → quiet；< 40% → cruising；< 100% → warm；
 * ≥ 100% → hot（边界值落高档，与 `isHotBurn` 的 `>=` 同向）。
 *
 * `planLimitTokens ≤ 0`（或非有限）永远 quiet：没有分母就没有热度，硬除
 * 出一个 Infinity%/h 会把「没设限额」画成「烧穿了」。`burnPerHour` 为 NaN
 * 或 ≤ 0 同样 quiet——零燃烧落不进任何比较分支，这里显式先挡；
 * +Infinity 是合法速率（正数除以正数），照常参与比较并落到 hot。
 */
export function gaugeBand(burnPerHour: number, planLimitTokens: number): GaugeBand {
  if (!Number.isFinite(planLimitTokens) || planLimitTokens <= 0) return "quiet";
  if (Number.isNaN(burnPerHour) || burnPerHour <= 0) return "quiet";
  const share = burnPerHour / planLimitTokens;
  if (share < QUIET_BURN_SHARE_PER_HOUR) return "quiet";
  if (share < CRUISING_BURN_SHARE_PER_HOUR) return "cruising";
  if (share < HOT_BAND_SHARE_PER_HOUR) return "warm";
  return "hot";
}

/**
 * 指针角度：projectedPct 的 [0, 100] 线性映射到 [-90°, +90°]
 * （-90° = 表盘左端，0° = 正上，+90° = 右端），100% 及以上封顶在 +90°，
 * 负数按 0 处理。NaN 落回左端——NaN 不可比较，指针停在起点比甩到随机
 * 角度诚实；+Infinity 可比较且恒 ≥ 100，照常 clamp 到右端。
 *
 * 100% 以上不继续往右转：半圆盘没有 90° 以外的位置，触顶后的差额由数字
 * 读数（projectedPct 本身）交代，指针只负责「到没到」。
 */
export function gaugeNeedleAngle(projectedPct: number): number {
  if (Number.isNaN(projectedPct)) return NEEDLE_MIN_ANGLE;
  const clamped = Math.min(Math.max(projectedPct, 0), NEEDLE_FULL_SCALE_PCT);
  const span = NEEDLE_MAX_ANGLE - NEEDLE_MIN_ANGLE;
  return NEEDLE_MIN_ANGLE + (clamped / NEEDLE_FULL_SCALE_PCT) * span;
}

/**
 * 刻度表：0/25/…/200% 共 9 根，全部 major。角度逐根派生自
 * `gaugeNeedleAngle`，不手写第二套角度表——两套表迟早一根对不上一根。
 * 100% 以上的刻度角度同为 +90°（指针已封顶），由界面决定如何排布标签。
 */
export const GAUGE_TICKS: ReadonlyArray<GaugeTick> = Array.from(
  { length: GAUGE_MAX_PCT / 25 + 1 },
  (_, index) => {
    const pct = index * 25;
    return { pct, angle: gaugeNeedleAngle(pct), major: true };
  }
);
