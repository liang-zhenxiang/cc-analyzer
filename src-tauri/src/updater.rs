//! 双渠道自动更新：beta（AI 每轮自动发 prerelease）与 stable（维护者从
//! 选中的 beta 一键晋升）。渠道是设置里的运行时状态，所以 endpoint 不能
//! 写死在 tauri.conf.json——用 `UpdaterBuilder` 按 channel 动态拼。
//!
//! 更新检查是对 GitHub 发布资产的一次 GET（见 SECURITY.md）：无遥测、无
//! 数据上行；下载的更新包经 minisign 公钥强校验（公钥在 tauri.conf.json）。

use std::sync::Mutex;
use tauri::{AppHandle, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

const REPO_RELEASES: &str = "https://github.com/liang-zhenxiang/cc-analyzer/releases/download";

/// 渠道 → 更新源。rolling release（固定 tag `beta` / `stable`）的资产 URL
/// 恒定，GitHub 没有「最新 prerelease」别名，rolling tag 是通行解法。
pub fn channel_endpoint(channel: &str) -> Result<Url, String> {
    let path = match channel {
        "stable" => "stable/latest-stable.json",
        "beta" => "beta/latest-beta.json",
        other => return Err(format!("未知更新渠道：{other}")),
    };
    Url::parse(&format!("{REPO_RELEASES}/{path}")).map_err(|err| err.to_string())
}

/// 一次 check 得到的待安装更新；install 命令从这里取。
/// 跨渠道连续 check 时后一次覆盖前一次（旧句柄作废，不装错渠道的包）。
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub notes: Option<String>,
}

impl UpdateInfo {
    fn none(current_version: String) -> Self {
        Self {
            available: false,
            current_version,
            version: None,
            notes: None,
        }
    }

    fn from_update(update: &Update) -> Self {
        Self {
            available: true,
            current_version: update.current_version.clone(),
            version: Some(update.version.clone()),
            notes: update.body.clone(),
        }
    }
}

fn app_version_of(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn app_version(app: AppHandle) -> Result<String, String> {
    Ok(app_version_of(&app))
}

#[tauri::command]
pub async fn check_updates(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    channel: String,
) -> Result<UpdateInfo, String> {
    let endpoint = channel_endpoint(&channel)?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|err| err.to_string())?
        .build()
        .map_err(|err| err.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|err| format!("更新检查失败：{err}"))?;
    match update {
        Some(update) => {
            let info = UpdateInfo::from_update(&update);
            *pending.0.lock().map_err(|_| "更新状态锁中毒")? = Some(update);
            Ok(info)
        }
        None => {
            *pending.0.lock().map_err(|_| "更新状态锁中毒")? = None;
            Ok(UpdateInfo::none(app_version_of(&app)))
        }
    }
}

/// 下载并安装最近一次 check 到的更新；完成后由前端确认重启。
#[tauri::command]
pub async fn install_update(pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .map_err(|_| "更新状态锁中毒")?
        .take()
        .ok_or("没有待安装的更新（请先检查更新）")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|err| format!("更新安装失败：{err}"))
}

/// 安装完成后重启进新版本。
#[tauri::command]
pub fn relaunch_app(app: AppHandle) {
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::channel_endpoint;

    #[test]
    fn stable_and_beta_map_to_rolling_releases() {
        assert_eq!(
            channel_endpoint("stable").unwrap().as_str(),
            "https://github.com/liang-zhenxiang/cc-analyzer/releases/download/stable/latest-stable.json"
        );
        assert_eq!(
            channel_endpoint("beta").unwrap().as_str(),
            "https://github.com/liang-zhenxiang/cc-analyzer/releases/download/beta/latest-beta.json"
        );
    }

    #[test]
    fn unknown_channel_is_rejected_with_the_name() {
        let err = channel_endpoint("nightly").unwrap_err();
        assert!(err.contains("nightly"), "错误里应带上渠道名：{err}");
    }
}
