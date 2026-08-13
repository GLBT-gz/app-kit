/// Windows 下把盘符统一为大写（`c:\...` → `C:\...`）。
///
/// 背景：`std::env::current_exe()` 返回的路径盘符可能是小写，而
/// `app.path().app_data_dir()`（dirs crate）返回规范大小写，导致「关于」
/// 面板中安装目录与数据目录的盘符大小写不一致。本函数用于展示/对外
/// 返回路径前统一盘符（Windows 路径大小写不敏感，不影响实际使用）。
pub fn normalize_drive_letter(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        let bytes = path.as_bytes();
        // 匹配 "<小写字母>:\" 前缀
        if bytes.len() >= 3
            && bytes[0].is_ascii_lowercase()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/')
        {
            let mut chars = path.chars();
            let first = chars.next().unwrap_or_default();
            return format!("{}{}", first.to_ascii_uppercase(), chars.as_str());
        }
    }
    path.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_uppercases_lowercase_drive() {
        assert_eq!(normalize_drive_letter(r"c:\Users\me\app"), r"C:\Users\me\app");
        assert_eq!(normalize_drive_letter(r"c:/Users/me/app"), r"C:/Users/me/app");
    }

    #[test]
    fn keeps_other_paths_unchanged() {
        assert_eq!(normalize_drive_letter(r"C:\Users\me\app"), r"C:\Users\me\app");
        assert_eq!(normalize_drive_letter(r"\\server\share\app"), r"\\server\share\app");
        assert_eq!(normalize_drive_letter(r"unknown"), "unknown");
    }
}
