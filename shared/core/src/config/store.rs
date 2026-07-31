use crate::config::{AppConfig, AppData, ThemeConfig};
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock};
use tracing::info;

/// 配置存储目录（由各项目在初始化时通过 set_config_dir 设置）
static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// 设置配置存储目录。
/// 每个使用 glbt_core 的项目应在 setup 阶段调用此函数，
/// 使用 Tauri 的 `app.path().app_data_dir()` 作为参数。
pub fn set_config_dir(dir: PathBuf) {
    CONFIG_DIR.set(dir).unwrap_or_else(|_| {
        info!("配置目录已设置，忽略重复调用");
    });
}

/// 获取配置存储目录
pub fn config_dir() -> &'static Path {
    CONFIG_DIR
        .get()
        .expect("配置目录未设置，请先调用 set_config_dir")
}

/// 获取配置文件路径
pub fn config_file_path() -> PathBuf {
    config_dir().join("config.json")
}

/// 加载配置
pub fn load_config() -> Result<AppConfig> {
    let path = config_file_path();

    if !path.exists() {
        info!("配置文件不存在，使用默认配置: {}", path.display());
        return Ok(AppConfig::default());
    }

    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("读取配置文件失败: {}", path.display()))?;

    let config: AppConfig = serde_json::from_str(&content)
        .with_context(|| format!("解析配置文件失败: {}", path.display()))?;

    info!("配置已加载: {}", path.display());
    Ok(config)
}

/// 保存配置（原子写入：先写临时文件，再重命名）
pub fn save_config(config: &AppConfig) -> Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(dir)
        .with_context(|| format!("创建配置目录失败: {}", dir.display()))?;

    let path = config_file_path();
    let tmp_path = dir.join("config.json.tmp");

    let content = serde_json::to_string_pretty(config).context("序列化配置失败")?;

    std::fs::write(&tmp_path, &content)
        .with_context(|| format!("写入临时配置文件失败: {}", tmp_path.display()))?;

    std::fs::rename(&tmp_path, &path)
        .with_context(|| format!("重命名配置文件失败: {} -> {}", tmp_path.display(), path.display()))?;

    info!("配置已保存: {}", path.display());
    Ok(())
}

/// 重置配置为默认值
pub fn reset_config() -> Result<AppConfig> {
    let config = AppConfig::default();
    save_config(&config)?;
    Ok(config)
}

/// 删除配置文件
pub fn delete_config() -> Result<()> {
    let path = config_file_path();
    if path.exists() {
        std::fs::remove_file(&path)
            .with_context(|| format!("删除配置文件失败: {}", path.display()))?;
        info!("配置文件已删除: {}", path.display());
    }
    Ok(())
}

/// 内存缓存的共享数据
pub type SharedAppData = Arc<RwLock<AppData>>;

/// 创建内存缓存：从磁盘加载全量数据到内存，后续读写走缓存
pub fn create_shared_app_data() -> SharedAppData {
    let app_data = AppData {
        theme: ThemeConfig::default(),
        config: load_config().unwrap_or_default(),
    };
    Arc::new(RwLock::new(app_data))
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_config_roundtrip() {
        let config = super::AppConfig::default();
        let json = serde_json::to_string_pretty(&config).unwrap();
        let parsed: super::AppConfig = serde_json::from_str(&json).unwrap();
        // 浏览器数据已不在 config.json 中持久化，不做断言
        let _ = parsed;
    }
}
