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
                "app_version",
                "check_updates",
                "install_update",
                "relaunch_app",
                "update_tray_readout",
                "set_tray_visible",
                "export_archive_bundle",
                "import_archive_bundle",
                "remove_import_staging",
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
