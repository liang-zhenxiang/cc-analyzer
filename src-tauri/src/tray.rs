//! 菜单栏 / 托盘常驻限额读数（Issue #150）。
//!
//! 边界很硬：**数字全由 web 侧算好再推过来**（与用量页同一份口径），这里只做两件事——
//! 把读数排成标题 / 提示文本，以及驱动托盘图标与菜单。任何在这里重算 5h / 周窗口的冲动
//! 都会立刻造出「第二套口径」，所以本模块不碰窗口数学。
//!
//! 文案的权威来源是设计规格 `.trellis/workspace/liangyuxiang/design-round-p-tray.md`
//! （§2 标题 / §3 提示 / §4 菜单 / §6 状态表）。改这里的任何一句都要回去逐字对表。
//!
//! 时间口径：`std::time` 拿不到本地时区，硬转「本地时间」只会得到错的钟点。所以对外文本
//! 一律走**相对时长**（「还有 2 小时 15 分关闭」「3 分钟前」）；超过 24 小时只写
//! 「超过一天前」——**不输出任何日期**，跨日就不会因时区差一天。

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::menu::MenuBuilder;
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

/// 托盘是否真的建起来了。真机门禁要一条**来自 Rust 的事实**（探针里的
/// `tray_created`），而不是靠人眼看截图里有没有图标——判定放脚本，事实留在这里。
static TRAY_CREATED: AtomicBool = AtomicBool::new(false);

/// 托盘图标 id：`update_tray_readout` / `set_tray_visible` 靠它找回句柄。
const TRAY_ID: &str = "cc-analyzer-tray";
const MAIN_WINDOW: &str = "main";

/// 接近限额的阈值（规格 §6 的 `share ≥ 0.8`，换算到 0–100 百分数域）。
/// 只作用于**已有分母**的层——没有预算就没有百分比，「接近」「超出」都无从谈起。
const NEAR_LIMIT_PERCENT: f64 = 80.0;

/// 标题退回紧凑 token 的百分数上限（§2.4 的 `share ≥ 10`，换算到 0–100 域）：
/// 十几倍的百分比已不可读，token 数更诚实，也把标题宽度封在 5 个字符内。
const TITLE_TOKEN_FALLBACK_PERCENT: f64 = 1_000.0;

/// Windows `NOTIFYICONDATA.szTip` 的上限（§3.6，约 127 个 UTF-16 单元）。
const TOOLTIP_MAX_UTF16: usize = 127;

/// 菜单结构（§4）：`None` 是分隔线，数组顺序即显示顺序。三项恒定、不随读数状态增删。
const MENU_OPEN_LABEL: &str = "打开 CC Analyzer";
const MENU_USAGE_LABEL: &str = "用量总览";
const MENU_QUIT_LABEL: &str = "退出";
const TRAY_MENU: [Option<(&str, &str)>; 4] = [
    Some(("tray-open", MENU_OPEN_LABEL)),
    Some(("tray-usage", MENU_USAGE_LABEL)),
    None,
    Some(("tray-quit", MENU_QUIT_LABEL)),
];

/// 托盘创建成功与否，供真机探针读取。
///
/// 非 macOS 构建里没有调用方（探针代码不编译），但这是刻意保留的取证接口，
/// 不该因为当前没人调用就从编译里消失。
#[allow(dead_code)]
pub fn created() -> bool {
    TRAY_CREATED.load(Ordering::SeqCst)
}

/// 与 Issue #150 契约里的 TS 类型逐字对应。`rename_all = "camelCase"` 让前端直接
/// `invoke` 传过来的对象能对上字段。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayReadout {
    /// 5 小时计费窗口；没有任何活动时为 `null`。
    pub block: Option<BlockReadout>,
    /// 滚动 7 天。
    pub weekly: WeeklyReadout,
    /// 读数生成时刻（epoch 毫秒）。
    pub computed_at: u64,
    /// 本次读数里是否含估算 / 推算（provenance 语言，与页面一致）。
    pub has_estimate: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockReadout {
    pub used_tokens: u64,
    /// **0–100 的百分数**（不是 0–1 的小数），与用量页 `BillingWindowCard` 同单位
    /// （`consumed / limit * 100`）。文本用 `f64::round` 取整后拼 `%`。
    /// `null` = 没设预算（沿用「没有分母就没有比率」的立场，绝不填 0）。
    pub percent: Option<f64>,
    /// 窗口开启时刻。文本不渲染它，但它是契约的一部分（web 侧会传），
    /// 保留字段以免将来补「窗口从几点开始」时又要动契约。
    #[allow(dead_code)]
    pub starts_at: u64,
    pub ends_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyReadout {
    pub used_tokens: u64,
    /// 同 `BlockReadout::percent`：**0–100 的百分数**。
    pub percent: Option<f64>,
    pub days: u32,
}

/// 当前 epoch 毫秒。命令入口统一用它，纯函数则显式接收 `now_ms`（便于单测）。
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// 菜单栏标题（§2）。**只放一个读数**：主层是 5 小时窗口，`block === null` 时退回滚动
/// 7 天，两层都无 → 空标题（只留图标）。标题不含汉字、数字与单位无空格、≤5 个字符。
///
/// 这是纯排版，不含平台门——Windows 的「标题恒为空」在 `platform_title` 里处理，
/// 好让 §6 状态表在任意平台的 CI 上都能逐字断言。
pub fn title_text(readout: Option<&TrayReadout>) -> String {
    let Some(readout) = readout else {
        // 无读数：空标题，不写「尚未计算」——菜单栏没有放这句话的地方（§6 ①）。
        return String::new();
    };
    match readout.block.as_ref() {
        Some(block) => match block.percent {
            // 极端比率退回 token（§2.4）。
            Some(percent) if percent >= TITLE_TOKEN_FALLBACK_PERCENT => {
                format!("!{}", format_tray_tokens(block.used_tokens))
            }
            Some(percent) => {
                let text = percent_text(percent);
                // 接近限额 / 超预算：前置半角 `!`，与数字之间不留空格（§2.5）。
                if percent >= NEAR_LIMIT_PERCENT {
                    format!("!{text}")
                } else {
                    text
                }
            }
            // 没设预算：只给 token，不编一个百分比出来（§2.2）。
            None => format_tray_tokens(block.used_tokens),
        },
        // 本窗口无活动：退回周 token；周也没有量 → 空标题（§2.2 / §6 ⑥）。
        None => {
            if readout.weekly.used_tokens > 0 {
                format_tray_tokens(readout.weekly.used_tokens)
            } else {
                String::new()
            }
        }
    }
}

/// 平台标题：Windows 的托盘图标没有旁注文字（§2.1），标题**恒为空字符串**，不靠
/// `set_title` 在 Windows 上静默失败来兜。
fn platform_title(readout: Option<&TrayReadout>) -> String {
    if cfg!(target_os = "windows") {
        String::new()
    } else {
        title_text(readout)
    }
}

/// 悬停提示（§3）。行序固定：5 小时窗口 → 倒计时 → 滚动 7 天 → 数据时间·来源 →
/// （条件）估算标注。时间一律相对；Windows 长度上限见 `fit_tooltip`。
pub fn tooltip_text(readout: Option<&TrayReadout>, now_ms: u64) -> String {
    let Some(readout) = readout else {
        // 无读数：三行如实说明，第二行是唯一的动作指路（§3.2）。不显示 0。
        return "尚未计算\n打开应用并切到「用量总览」生成读数\n读自本地日志".to_string();
    };
    fit_tooltip(
        tooltip_body(readout, now_ms, true),
        tooltip_body(readout, now_ms, false),
    )
}

/// 拼出提示正文。`include_l1_status` 为假时省掉 L1 的 `（接近限额）` / `（已超预算）`
/// 括注（§3.6 的降级位；数字本身已自明）。
fn tooltip_body(readout: &TrayReadout, now_ms: u64, include_l1_status: bool) -> String {
    let mut lines: Vec<String> = Vec::new();

    // L1 5 小时窗口行 + L2 倒计时行。block 为 null 时没有窗口可倒计时，L2 整行省掉——
    // 造一句规格里没有的占位文案，不如不写（§3.1 的词表里没有它）。
    match readout.block.as_ref() {
        Some(block) => {
            let tokens = format_tray_tokens(block.used_tokens);
            match block.percent {
                Some(percent) => {
                    let mut line = format!("5 小时窗口 {tokens} · 已用 {}", percent_text(percent));
                    if include_l1_status {
                        if let Some(suffix) = status_suffix(percent) {
                            line.push_str(suffix);
                        }
                    }
                    lines.push(line);
                }
                None => lines.push(format!("5 小时窗口 {tokens}")),
            }
            lines.push(countdown_text(now_ms, block.ends_at));
        }
        None => lines.push("5 小时窗口内暂无活动".to_string()),
    }

    // L3：滚动 7 天行。
    let weekly_tokens = format_tray_tokens(readout.weekly.used_tokens);
    let days = readout.weekly.days;
    match readout.weekly.percent {
        Some(percent) => lines.push(format!(
            "滚动 {days} 天 {weekly_tokens} · 已用 {}",
            percent_text(percent)
        )),
        None => lines.push(format!("滚动 {days} 天 {weekly_tokens}（未设周预算）")),
    }

    // L4：数据时间 · 来源。来源如实（读自本地日志），时间必须每次写出（§3.3 / §3.4）。
    lines.push(format!(
        "读数生成于 {} · 读自本地日志",
        relative_time(now_ms, readout.computed_at)
    ));

    // L5：仅含估算时出现——百分比的**分母**是社区估算值（§3.4）。
    if readout.has_estimate {
        lines.push("百分比中的限额为社区估算值，非官方数字".to_string());
    }

    lines.join("\n")
}

/// §3.6：Windows 提示超过 127 个 UTF-16 单元时，先删 L1 的括注（数字本身已自明），
/// **绝不删 L4 / L5**（来源与估算不许藏）。抽成纯函数是为了让这条降级也能单测。
fn fit_tooltip(with_status: String, without_status: String) -> String {
    if utf16_len(&with_status) <= TOOLTIP_MAX_UTF16 {
        with_status
    } else {
        without_status
    }
}

/// Windows 计数用的是 UTF-16 单元，不是 Unicode 标量数（BMP 内两者相同，本模块全是 BMP）。
fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// 状态后缀（§3.1）：近 / 超预算并入 L1 以括号表达。入参是 0–100 的百分数。
fn status_suffix(percent: f64) -> Option<&'static str> {
    if percent >= 100.0 {
        Some("（已超预算）")
    } else if percent >= NEAR_LIMIT_PERCENT {
        Some("（接近限额）")
    } else {
        None
    }
}

/// 百分比文本。契约字段是 **0–100 的百分数**，取整规则用 `f64::round`
/// （四舍五入、`.5` 远离 0；对正数与前端 `Math.round` 一致）。**照实、不封顶**
/// （§2.4）——`112.0 → 112%`，绝不写 `100%` / `100%+`。
fn percent_text(percent: f64) -> String {
    format!("{}%", percent.round() as i64)
}

/// 紧凑 token（§2.3 的 `format_tray_tokens`）。无千分位、数字与单位无空格。
fn format_tray_tokens(tokens: u64) -> String {
    const THOUSAND: u64 = 1_000;
    const MILLION: u64 = 1_000_000;
    const BILLION: u64 = 1_000_000_000;

    if tokens < THOUSAND {
        return tokens.to_string();
    }
    if tokens < MILLION {
        let thousands = (tokens + 500) / THOUSAND;
        // 边界：999_500 四舍五入成 1000k → 规范化成 1M，绝不允许出现 1000k（§2.3）。
        if thousands >= THOUSAND {
            return "1M".to_string();
        }
        return format!("{thousands}k");
    }
    if tokens < 10_000_000 {
        return format!("{:.1}M", tokens as f64 / MILLION as f64);
    }
    if tokens < BILLION {
        return format!("{}M", (tokens + 500_000) / MILLION);
    }
    format!("{:.1}B", tokens as f64 / BILLION as f64)
}

/// 倒计时成句（§3.1 L2 / §3.3）：`还有 2 小时 15 分关闭` / `还有 45 分钟关闭` /
/// `还有 2 小时关闭`；`now > endsAt` → `已关闭`。
fn countdown_text(now_ms: u64, ends_at: u64) -> String {
    if now_ms > ends_at {
        return "已关闭".to_string();
    }
    let total_minutes = (ends_at - now_ms) / 60_000;
    let hours = total_minutes / 60;
    let minutes = total_minutes % 60;
    if hours > 0 {
        if minutes > 0 {
            format!("还有 {hours} 小时 {minutes} 分关闭")
        } else {
            format!("还有 {hours} 小时关闭")
        }
    } else {
        format!("还有 {minutes} 分钟关闭")
    }
}

/// 数据时间的相对档位（§3.3）：`刚刚` / `N 分钟前` / `N 小时前`；超过 24 小时写
/// 「超过一天前」——**不落任何日期**，免得靠 UTC 猜本地日期差一天。中文量词留空格
/// （`3 分钟前`）。时钟回拨时不显示负数，退回「刚刚」。
fn relative_time(now_ms: u64, ts_ms: u64) -> String {
    if ts_ms >= now_ms {
        return "刚刚".to_string();
    }
    let diff = now_ms - ts_ms;
    let minutes = diff / 60_000;
    if minutes < 1 {
        return "刚刚".to_string();
    }
    if minutes < 60 {
        return format!("{minutes} 分钟前");
    }
    let hours = diff / 3_600_000;
    if hours < 24 {
        return format!("{hours} 小时前");
    }
    "超过一天前".to_string()
}

/// 显示并聚焦主窗口。菜单里的「打开」与「用量总览」都要真的把窗口亮出来，
/// 不能只 emit 事件——应用可能整个被别的窗口盖住。
fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 创建托盘图标与菜单。失败不外抛给整个应用——托盘建不起来（例如 Linux 桌面没有
/// StatusNotifier 宿主）只意味着少了常驻读数，应用本身照常可用。
///
/// **不按 `target_os` 门控**：门控会让非 macOS 的 CI 连这段都编译不到，重蹈 #160。
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let mut menu = MenuBuilder::new(app);
    for entry in TRAY_MENU {
        menu = match entry {
            Some((id, label)) => menu.text(id, label),
            None => menu.separator(),
        };
    }
    let menu = menu.build()?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        // 左键点图标也弹菜单：菜单里两项都带「显示 + 聚焦」，行为一致。
        .show_menu_on_left_click(true)
        .tooltip(tooltip_text(None, now_ms()))
        .title(platform_title(None))
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => focus_main(app),
            "tray-usage" => {
                focus_main(app);
                // 切到用量标签页这件事归 web 侧；Rust 只发信号。
                let _ = app.emit("tray:navigate", "usage");
            }
            "tray-quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    // 没有图标时不设 icon，退化成纯标题（Linux 上标题还需配菜单才可见，菜单已给）。

    match builder.build(app) {
        Ok(_) => {
            TRAY_CREATED.store(true, Ordering::SeqCst);
            println!("tray: 已创建");
            Ok(())
        }
        Err(err) => {
            eprintln!("tray: 创建失败（{err}）");
            Err(err)
        }
    }
}

/// 前端把新读数推过来（`null` = 还没有读数）。
#[tauri::command]
pub fn update_tray_readout(app: AppHandle, readout: Option<TrayReadout>) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        // 开关关掉 / 平台不支持时托盘不存在，静默忽略即可：前端仍按契约推送。
        return Ok(());
    };
    let now = now_ms();
    tray.set_tooltip(Some(tooltip_text(readout.as_ref(), now)))
        .map_err(|err| err.to_string())?;
    // Windows 上标题恒为空（platform_title 已处理），set_title 的失败也一并忽略。
    let _ = tray.set_title(Some(platform_title(readout.as_ref())));
    Ok(())
}

/// 设置里的开关：显示 / 隐藏常驻读数。
#[tauri::command]
pub fn set_tray_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_visible(visible).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 固定「现在」，让相对时长可断言。
    const NOW: u64 = 1_700_000_000_000;
    const MINUTE: u64 = 60_000;
    const HOUR: u64 = 3_600_000;

    fn readout(
        block: Option<BlockReadout>,
        weekly: WeeklyReadout,
        has_estimate: bool,
    ) -> TrayReadout {
        TrayReadout {
            block,
            weekly,
            computed_at: NOW - 3 * MINUTE,
            has_estimate,
        }
    }

    /// 窗口在 `NOW + ends_in_ms` 关闭。
    fn block(used_tokens: u64, percent: Option<f64>, ends_in_ms: u64) -> BlockReadout {
        block_at(used_tokens, percent, NOW + ends_in_ms)
    }

    /// 窗口在绝对时刻 `ends_at` 关闭（`ends_at < NOW` 用来测「已关闭」）。
    fn block_at(used_tokens: u64, percent: Option<f64>, ends_at: u64) -> BlockReadout {
        BlockReadout {
            used_tokens,
            percent,
            starts_at: NOW - HOUR,
            ends_at,
        }
    }

    fn weekly(used_tokens: u64, percent: Option<f64>) -> WeeklyReadout {
        WeeklyReadout {
            used_tokens,
            percent,
            days: 7,
        }
    }

    fn first_line(text: &str) -> &str {
        text.lines().next().unwrap_or("")
    }

    fn has_cjk(text: &str) -> bool {
        text.chars().any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c))
    }

    /// §7.4：标题形状 `/^!?\d+(\.\d+)?(k|M|B|%)$/`，不引 regex 依赖，手写等价判定。
    fn looks_like_title_shape(text: &str) -> bool {
        let mut chars = text.chars().peekable();
        if chars.peek() == Some(&'!') {
            chars.next();
        }
        let mut digits = 0;
        while matches!(chars.peek(), Some(c) if c.is_ascii_digit()) {
            chars.next();
            digits += 1;
        }
        if digits == 0 {
            return false;
        }
        if chars.peek() == Some(&'.') {
            chars.next();
            let mut fraction = 0;
            while matches!(chars.peek(), Some(c) if c.is_ascii_digit()) {
                chars.next();
                fraction += 1;
            }
            if fraction == 0 {
                return false;
            }
        }
        matches!(chars.next(), Some('k' | 'M' | 'B' | '%')) && chars.next().is_none()
    }

    // --- §6 状态表：六个状态各一个夹具，标题与提示首行逐字对照 ---

    #[test]
    fn the_six_states_match_the_design_table() {
        let cases: [(&str, Option<TrayReadout>, &str, &str); 6] = [
            ("① 无读数", None, "", "尚未计算"),
            (
                "② 有读数 · 无预算",
                Some(readout(
                    Some(block(88_000, None, 2 * HOUR + 15 * MINUTE)),
                    weekly(246_000, None),
                    false,
                )),
                "88k",
                "5 小时窗口 88k",
            ),
            (
                "③ 有预算 · 正常",
                Some(readout(
                    Some(block(88_000, Some(42.0), 2 * HOUR + 15 * MINUTE)),
                    weekly(246_000, Some(42.0)),
                    false,
                )),
                "42%",
                "5 小时窗口 88k · 已用 42%",
            ),
            (
                "④ 接近限额",
                Some(readout(
                    Some(block(88_000, Some(91.0), 2 * HOUR + 15 * MINUTE)),
                    weekly(246_000, Some(42.0)),
                    false,
                )),
                "!91%",
                "5 小时窗口 88k · 已用 91%（接近限额）",
            ),
            (
                "⑤ 超预算",
                Some(readout(
                    Some(block(88_000, Some(112.0), 2 * HOUR + 15 * MINUTE)),
                    weekly(246_000, Some(42.0)),
                    false,
                )),
                "!112%",
                "5 小时窗口 88k · 已用 112%（已超预算）",
            ),
            (
                "⑥ 有读数 · 本窗口无活动",
                Some(readout(None, weekly(620_000, None), false)),
                "620k",
                "5 小时窗口内暂无活动",
            ),
        ];

        for (name, fixture, expected_title, expected_first_line) in cases {
            let readout_ref = fixture.as_ref();
            assert_eq!(
                title_text(readout_ref),
                expected_title,
                "{name}：标题与 §6 状态表不符"
            );
            let tooltip = tooltip_text(readout_ref, NOW);
            assert_eq!(
                first_line(&tooltip),
                expected_first_line,
                "{name}：提示首行与 §6 状态表不符（{tooltip}）"
            );
        }
    }

    #[test]
    fn null_readout_title_is_empty_and_has_no_zero() {
        assert_eq!(title_text(None), "");
        let tooltip = tooltip_text(None, NOW);
        assert!(tooltip.contains("尚未计算"), "{tooltip}");
        assert!(!tooltip.contains('0'), "无读数不该出现 0：{tooltip}");
    }

    #[test]
    fn both_layers_empty_gives_an_empty_title() {
        // block 为 null 且周窗口没有量 → 空标题（不是「尚未计算」）。
        let fixture = readout(None, weekly(0, None), false);
        assert_eq!(title_text(Some(&fixture)), "");
    }

    // --- §7.1 / §7.2 / §7.3 ---

    #[test]
    fn without_a_budget_no_percent_appears_anywhere() {
        let fixture = readout(
            Some(block(88_000, None, 2 * HOUR)),
            weekly(246_000, None),
            false,
        );
        let title = title_text(Some(&fixture));
        let tooltip = tooltip_text(Some(&fixture), NOW);
        assert!(!title.contains('%'), "无预算的标题不该有 %：{title}");
        assert!(!tooltip.contains('%'), "无预算的提示不该有 %：{tooltip}");
    }

    #[test]
    fn percent_is_shown_verbatim_and_never_clamped() {
        assert_eq!(
            title_text(Some(&readout(
                Some(block(88_000, Some(42.0), HOUR)),
                weekly(1, None),
                false
            ))),
            "42%"
        );
        assert_eq!(
            title_text(Some(&readout(
                Some(block(88_000, Some(112.0), HOUR)),
                weekly(1, None),
                false
            ))),
            "!112%"
        );
        let tooltip = tooltip_text(
            Some(&readout(
                Some(block(88_000, Some(112.0), HOUR)),
                weekly(246_000, Some(112.0)),
                false,
            )),
            NOW,
        );
        assert!(tooltip.contains("已用 112%"));
        for banned in ["100%+", "≥", "+"] {
            assert!(!tooltip.contains(banned), "不该出现 {banned}：{tooltip}");
        }
    }

    #[test]
    fn percent_field_is_a_zero_to_one_hundred_scale() {
        // 钉死单位：`percent` 是 0–100 的百分数（不是 0–1 的小数）。用整数夹具，
        // 这样一旦有人把它当小数，42.0 会变成 `0%`、91.0 会变成 `1%`，立刻红。
        let title = |percent: f64| {
            title_text(Some(&readout(
                Some(block(88_000, Some(percent), HOUR)),
                weekly(1, None),
                false,
            )))
        };
        assert_eq!(title(42.0), "42%");
        assert_eq!(title(91.0), "!91%");
        assert_eq!(title(112.0), "!112%");
    }

    #[test]
    fn percent_of_a_thousand_or_more_falls_back_to_tokens() {
        // §2.4 的 `share ≥ 10` 换算到百分数域 = `percent ≥ 1000`：标题改成 `!` + 紧凑 token。
        let fixture = readout(
            Some(block(1_200_000, Some(1_200.0), HOUR)),
            weekly(1, None),
            false,
        );
        assert_eq!(title_text(Some(&fixture)), "!1.2M");
    }

    // --- §7.4 / §7.5：标题形状、无汉字、≤5 字符 ---

    #[test]
    fn titles_are_compact_ascii_without_spaces() {
        let titles = [
            title_text(None),
            title_text(Some(&readout(
                Some(block(88_000, None, HOUR)),
                weekly(1, None),
                false,
            ))),
            title_text(Some(&readout(
                Some(block(88_000, Some(42.0), HOUR)),
                weekly(1, None),
                false,
            ))),
            title_text(Some(&readout(
                Some(block(88_000, Some(91.0), HOUR)),
                weekly(1, None),
                false,
            ))),
            title_text(Some(&readout(
                Some(block(88_000, Some(112.0), HOUR)),
                weekly(1, None),
                false,
            ))),
            title_text(Some(&readout(
                Some(block(1_200_000, Some(1_200.0), HOUR)),
                weekly(1, None),
                false,
            ))),
            title_text(Some(&readout(None, weekly(620_000, None), false))),
        ];
        for title in &titles {
            if title.is_empty() {
                continue; // 空标题在 §6 ① 单独断言。
            }
            assert!(
                looks_like_title_shape(title),
                "标题形状不符 §7.4：{title:?}"
            );
            assert!(!has_cjk(title), "标题不该含汉字（§2.6）：{title:?}");
            assert!(
                title.chars().count() <= 5,
                "标题超过 5 个字符（§2.6）：{title:?}"
            );
        }
    }

    // --- §7.6：提示行序与条件 L5 ---

    #[test]
    fn tooltip_line_order_is_fixed_and_estimate_line_is_conditional() {
        let with_estimate = tooltip_text(
            Some(&readout(
                Some(block(88_000, Some(42.0), 2 * HOUR + 15 * MINUTE)),
                weekly(246_000, Some(42.0)),
                true,
            )),
            NOW,
        );
        let lines: Vec<&str> = with_estimate.lines().collect();
        assert_eq!(lines.len(), 5, "{with_estimate}");
        assert_eq!(lines[0], "5 小时窗口 88k · 已用 42%");
        assert_eq!(lines[1], "还有 2 小时 15 分关闭");
        assert_eq!(lines[2], "滚动 7 天 246k · 已用 42%");
        assert_eq!(lines[3], "读数生成于 3 分钟前 · 读自本地日志");
        assert_eq!(lines[4], "百分比中的限额为社区估算值，非官方数字");

        let without_estimate = tooltip_text(
            Some(&readout(
                Some(block(88_000, Some(42.0), 2 * HOUR + 15 * MINUTE)),
                weekly(246_000, Some(42.0)),
                false,
            )),
            NOW,
        );
        assert_eq!(without_estimate.lines().count(), 4, "{without_estimate}");
        assert!(
            !without_estimate.contains("社区估算值"),
            "hasEstimate 为假时 L5 不得出现：{without_estimate}"
        );
    }

    #[test]
    fn weekly_without_budget_uses_the_budget_note() {
        let fixture = readout(
            Some(block(88_000, Some(42.0), HOUR)),
            weekly(246_000, None),
            false,
        );
        let tooltip = tooltip_text(Some(&fixture), NOW);
        let lines: Vec<&str> = tooltip.lines().collect();
        assert_eq!(lines[2], "滚动 7 天 246k（未设周预算）");
    }

    // --- §7.7：隐私红线 ---

    #[test]
    fn privacy_fixture_leaks_no_paths_projects_or_titles() {
        // 读数里本不该有这些字段；用带多余字段的 JSON 证明：即便 web 多传，排版也不会
        // 把它们带进标题 / 提示（serde 默认忽略未知字段，只认数字与布尔）。
        let json = r#"{
            "block": {
                "usedTokens": 88000,
                "percent": 91.0,
                "startsAt": 1,
                "endsAt": 1700007200000,
                "path": "~/.claude/projects/-Users-alice-secret/app.jsonl",
                "cwd": "/Users/alice/secret-project",
                "sessionTitle": "重构 billingWindow 的排查记录"
            },
            "weekly": { "usedTokens": 246000, "percent": 42.0, "days": 7 },
            "computedAt": 1700000000000,
            "hasEstimate": true,
            "projectName": "secret-project"
        }"#;
        let fixture: TrayReadout = serde_json::from_str(json).expect("含多余字段也能解析");
        let title = title_text(Some(&fixture));
        let tooltip = tooltip_text(Some(&fixture), NOW);
        for secret in [
            "~/.claude/projects",
            "/Users/alice",
            "secret-project",
            "app.jsonl",
            "重构",
            "sessionTitle",
            "cwd",
        ] {
            assert!(!title.contains(secret), "标题泄漏了 {secret}：{title}");
            assert!(!tooltip.contains(secret), "提示泄漏了 {secret}：{tooltip}");
        }
    }

    // --- §7.8：倒计时口径逐字 ---

    #[test]
    fn countdown_wording_matches_the_spec() {
        let make = |ends_at: u64| {
            let fixture = readout(
                Some(block_at(88_000, Some(42.0), ends_at)),
                weekly(1, None),
                false,
            );
            let lines: Vec<String> = tooltip_text(Some(&fixture), NOW)
                .lines()
                .map(str::to_string)
                .collect();
            lines[1].clone()
        };
        assert_eq!(make(NOW + 2 * HOUR + 15 * MINUTE), "还有 2 小时 15 分关闭");
        assert_eq!(make(NOW + 45 * MINUTE), "还有 45 分钟关闭");
        assert_eq!(make(NOW + 2 * HOUR), "还有 2 小时关闭");
        assert_eq!(make(NOW - 1), "已关闭");
    }

    // --- §7.9：菜单三项恒定、顺序固定 ---

    #[test]
    fn menu_items_are_exact_and_ordered() {
        assert_eq!(
            TRAY_MENU,
            [
                Some(("tray-open", "打开 CC Analyzer")),
                Some(("tray-usage", "用量总览")),
                None,
                Some(("tray-quit", "退出")),
            ]
        );
    }

    // --- §3.6：Windows 长度上限 ---

    #[test]
    fn the_longest_tooltip_stays_within_the_windows_limit() {
        // 最长组合：超预算 + 含估算 + 百万级数字 + 最长的倒计时。
        let fixture = readout(
            Some(block(220_000_000, Some(4_200.0), 23 * HOUR + 59 * MINUTE)),
            weekly(999_000_000, Some(4_200.0)),
            true,
        );
        let tooltip = tooltip_text(Some(&fixture), NOW);
        let len = utf16_len(&tooltip);
        assert!(
            len <= TOOLTIP_MAX_UTF16,
            "最长提示 {len} 个 UTF-16 单元，超过上限 {TOOLTIP_MAX_UTF16}：{tooltip}"
        );
        // 未触发降级：L1 的括注仍在。
        assert!(tooltip.contains("（已超预算）"), "{tooltip}");
    }

    #[test]
    fn an_overlong_tooltip_drops_only_the_l1_note() {
        // 合成两个超 / 不超限的正文，验证降级只挑「无 L1 括注」的版本。
        let long = format!(
            "{}\n{}",
            "5 小时窗口 88k · 已用 91%（接近限额）",
            "x".repeat(200)
        );
        let short = "5 小时窗口 88k · 已用 91%\n读数生成于 3 分钟前 · 读自本地日志";
        assert_eq!(fit_tooltip(long, short.to_string()), short);
        // 未超限时原样保留。
        assert_eq!(fit_tooltip(short.to_string(), "别的".to_string()), short);
    }

    // --- 排版的零件 ---

    #[test]
    fn format_tray_tokens_matches_the_spec_table() {
        assert_eq!(format_tray_tokens(0), "0");
        assert_eq!(format_tray_tokens(980), "980");
        assert_eq!(format_tray_tokens(1_000), "1k");
        assert_eq!(format_tray_tokens(88_000), "88k");
        assert_eq!(format_tray_tokens(980_000), "980k");
        assert_eq!(format_tray_tokens(1_200_000), "1.2M");
        assert_eq!(format_tray_tokens(22_000_000), "22M");
        assert_eq!(format_tray_tokens(220_000_000), "220M");
        assert_eq!(format_tray_tokens(1_100_000_000), "1.1B");
    }

    #[test]
    fn format_tray_tokens_never_emits_1000k() {
        // §2.3 边界：999_500 四舍五入成 1000k → 规范化为 1M。
        assert_eq!(format_tray_tokens(999_500), "1M");
        assert_eq!(format_tray_tokens(999_499), "999k");
    }

    #[test]
    fn relative_time_uses_the_spec_tiers() {
        assert_eq!(relative_time(NOW, NOW), "刚刚");
        assert_eq!(relative_time(NOW, NOW + 5_000), "刚刚");
        assert_eq!(relative_time(NOW, NOW - 30_000), "刚刚");
        assert_eq!(relative_time(NOW, NOW - 3 * MINUTE), "3 分钟前");
        assert_eq!(relative_time(NOW, NOW - 5 * HOUR), "5 小时前");
        // 超过 24 小时不落日期（本模块没有时区，UTC 会在临近午夜差一天）。
        assert_eq!(relative_time(NOW, NOW - 30 * HOUR), "超过一天前");
    }

    // --- 契约：camelCase 字段对齐 ---

    #[test]
    fn readout_deserializes_the_frontend_camel_case_shape() {
        let json = r#"{
            "block": { "usedTokens": 1200000, "percent": 62.0, "startsAt": 1000, "endsAt": 2000 },
            "weekly": { "usedTokens": 12000000, "percent": null, "days": 7 },
            "computedAt": 3000,
            "hasEstimate": true
        }"#;
        let parsed: TrayReadout = serde_json::from_str(json).expect("camelCase 契约应能解析");
        let block = parsed.block.expect("block 存在");
        assert_eq!(block.used_tokens, 1_200_000);
        assert_eq!(block.percent, Some(62.0));
        assert_eq!(block.starts_at, 1000);
        assert_eq!(block.ends_at, 2000);
        assert_eq!(parsed.weekly.used_tokens, 12_000_000);
        assert_eq!(parsed.weekly.percent, None);
        assert_eq!(parsed.weekly.days, 7);
        assert_eq!(parsed.computed_at, 3000);
        assert!(parsed.has_estimate);
    }

    #[test]
    fn a_null_block_is_accepted() {
        let json = r#"{
            "block": null,
            "weekly": { "usedTokens": 0, "percent": null, "days": 7 },
            "computedAt": 3000,
            "hasEstimate": false
        }"#;
        let parsed: TrayReadout = serde_json::from_str(json).expect("block 可为 null");
        assert!(parsed.block.is_none());
    }
}
