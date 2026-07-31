fn main() {
    let attrs = tauri_build::Attributes::new().plugin(
        "appkit-core",
        tauri_build::InlinedPlugin::new()
            .commands(&[
                "get_all_data",
                "set_app_theme",
                "set_app_config",
                "delete_data_files",
                "write_local_file",
                "read_all_local_files",
                "list_data_files",
                "list_database_files",
                "open_directory",
                "check_path_exists",
                "get_app_version",
                "save_file",
            ])
            .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
    );
    tauri_build::try_build(attrs).unwrap()
}
