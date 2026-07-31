//! 通用 JSON 文件存储
//!
//! 提供原子写入的 JSON 文件持久化能力，适用于任意 `Serialize + Deserialize + Default` 类型。
//! 文件不存在时返回 `Default::default()`，不会报错。

use serde::de::DeserializeOwned;
use serde::Serialize;
use std::path::Path;

/// 保存数据到 JSON 文件（原子写入：先写 `.json.tmp` 临时文件，再重命名）
pub fn save<T: Serialize>(data: &T, path: &Path) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| "路径没有父目录".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {}", e))?;

    let tmp_path = path.with_extension("json.tmp");
    let content =
        serde_json::to_string_pretty(data).map_err(|e| format!("序列化失败: {}", e))?;

    std::fs::write(&tmp_path, &content)
        .map_err(|e| format!("写入临时文件失败: {}", e))?;
    std::fs::rename(&tmp_path, path).map_err(|e| format!("重命名失败: {}", e))?;
    Ok(())
}

/// 从 JSON 文件加载数据，文件不存在时返回默认值
pub fn load<T: DeserializeOwned + Default>(path: &Path) -> T {
    if !path.exists() {
        return T::default();
    }
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return T::default(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}
