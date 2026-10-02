fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&[
                "read_dir",
                "stat",
                "read_text",
                "read_head",
                "write_text",
                "run_lines",
                "cancel_lines",
                "exec_text",
                "spawn_detached",
                "home_dir",
                "app_data_dir",
                "monitor_port",
                "monitor_ping",
                "updater::app_version",
                "updater::check_updates",
                "updater::install_update",
                "updater::relaunch_app",
            ]))
            .plugin(
                "float",
                tauri_build::InlinedPlugin::new()
                    .commands(&["enter", "exit"])
                    .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
            ),
    )
    .expect("failed to build Tauri app");
}
