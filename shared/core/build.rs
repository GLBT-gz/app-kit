fn main() {
    // ── 生成权限 TOML 文件 ──
    // 注意：此列表必须与 src/tauri_bridge.rs 中 init() 注册的命令一致
    let commands = [
        // 浏览器检测/配置/进程（cmd-browser）
        "detect_browsers",
        "detect_browser_types",
        "detect_custom_profiles",
        "get_launch_command",
        "launch_browser_profile",
        "create_desktop_shortcut",
        "create_new_user_data_dir",
        "detect_debug_ports",
        "detect_browser_running_processes",
        "find_available_port",
        "kill_browser_profile_process",
        "kill_all_browser_processes",
        // 数据文件管理（cmd-files）
        "list_data_files",
        "delete_data_files",
        "read_all_local_files",
        "list_database_files",
        // 通用工具（cmd-utils）
        "open_directory",
        "check_path_exists",
        "get_data_directory",
        "get_install_directory",
        "save_file",
        "get_update_base_url",
        // 数据库表管理（cmd-db）
        "get_db_tables",
        "clear_db_table",
    ];

    let mut perm_lines = Vec::new();

    for cmd in &commands {
        let slug = cmd.replace('_', "-");
        perm_lines.push(format!(
            r#"[[permission]]
identifier = "allow-{slug}"
description = "Enables the {cmd} command"
commands.allow = ["{cmd}"]"#
        ));
        perm_lines.push(format!(
            r#"[[permission]]
identifier = "deny-{slug}"
description = "Denies the {cmd} command"
commands.deny = ["{cmd}"]"#
        ));
    }

    let allowed_perms: Vec<String> = commands
        .iter()
        .map(|c| format!("\"allow-{}\"", c.replace('_', "-")))
        .collect();
    let default_section = format!(
        r#"[default]
description = "Default permissions for appkit-core plugin"
permissions = [{permissions}]"#,
        permissions = allowed_perms.join(", ")
    );

    perm_lines.push(default_section);

    let out_dir = std::env::var("OUT_DIR").unwrap();
    let out_path = std::path::Path::new(&out_dir);

    // 写 TOML 权限文件
    let content = perm_lines.join("\n\n");
    let perm_toml = out_path.join("appkit-core-permissions.toml");
    std::fs::write(&perm_toml, &content).unwrap();

    // 写 JSON 索引文件（read_permissions 期望的格式：Vec<PathBuf> 的 JSON）
    let perm_files: Vec<String> = vec![perm_toml.to_string_lossy().to_string()];
    let json_index = out_path.join("appkit-core-permission-files");
    std::fs::write(&json_index, serde_json::to_string(&perm_files).unwrap()).unwrap();

    // 输出 PERMISSION_FILES_PATH，让 Cargo 传递给依赖 crate 的 build script
    println!("cargo:PERMISSION_FILES_PATH={}", json_index.display());

    println!("cargo:rerun-if-changed=build.rs");
}
