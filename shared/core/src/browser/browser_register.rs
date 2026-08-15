//! 自定义浏览器检测器注册（注册式，业务项目启动时调用 register_browser_detector）

use crate::browser::BrowserInfo;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

// ── 自定义浏览器检测器注册表（注册式） ──

/// 自定义浏览器检测器：由业务项目注册（如 003 注册易得客6）
#[derive(Clone)]
pub struct BrowserDetector {
    /// 生成完整浏览器信息（含 exe 路径、用户数据目录、版本、children 等）
    pub detect: Arc<dyn Fn() -> BrowserInfo + Send + Sync>,
    /// 浏览器进程名（用于 kill 全部进程），如 "edecker.exe"
    pub process_name: Arc<dyn Fn() -> String + Send + Sync>,
}

pub(crate) static CUSTOM_DETECTORS: OnceLock<Mutex<HashMap<String, BrowserDetector>>> = OnceLock::new();

/// 注册自定义浏览器检测器（应用启动时调用）
pub fn register_browser_detector(browser_type: &str, detector: BrowserDetector) {
    CUSTOM_DETECTORS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap()
        .insert(browser_type.to_string(), detector);
}

pub(crate) fn custom_detector(browser_type: &str) -> Option<BrowserDetector> {
    CUSTOM_DETECTORS
        .get()?
        .lock()
        .ok()?
        .get(browser_type)
        .cloned()
}

/// 查询注册的进程名（供 kill 全部进程等场景使用）
pub fn registered_process_name(browser_type: &str) -> Option<String> {
    custom_detector(browser_type).map(|d| (d.process_name)())
}

/// 查询注册的自定义类型列表
pub fn registered_browser_types() -> Vec<String> {
    match CUSTOM_DETECTORS.get() {
        Some(reg) => reg.lock().unwrap().keys().cloned().collect(),
        None => Vec::new(),
    }
}

