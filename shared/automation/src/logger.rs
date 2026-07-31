use std::sync::Arc;

/// 前端日志回调：接收 (level, message)
///
/// level 取值: "info", "success", "warn", "error", "step"
pub type EmitFn = Arc<dyn Fn(String, String) + Send + Sync>;

/// 多目标日志器
///
/// 同时输出到：
/// - `tracing`（后端控制台）
/// - 可选的 `EmitFn` 回调（Tauri 事件 → 前端日志面板）
///
/// # 示例
/// ```ignore
/// let log = Logger::with_emitter(callback).with_prefix("[Temu] ");
/// log.info("正在执行...");
/// log.success("操作完成 ✅");
/// log.error("出错了 ❌");
/// ```
#[derive(Clone)]
pub struct Logger {
    emit: Option<EmitFn>,
    prefix: String,
}

impl Logger {
    /// 创建只输出到控制台的日志器
    pub fn new() -> Self {
        Self {
            emit: None,
            prefix: String::new(),
        }
    }

    /// 创建带前端事件回调的日志器
    pub fn with_emitter(emit: EmitFn) -> Self {
        Self {
            emit: Some(emit),
            prefix: String::new(),
        }
    }

    /// 设置日志前缀（如 `"[Temu] "`）
    pub fn with_prefix(mut self, prefix: &str) -> Self {
        self.prefix = prefix.to_string();
        self
    }

    fn log(&self, level: &str, msg: &str) {
        let full = format!("{}{}", self.prefix, msg);
        match level {
            "warn" => tracing::warn!("{}", full),
            "error" => tracing::error!("{}", full),
            _ => tracing::info!("{}", full),
        }
        if let Some(emit) = &self.emit {
            emit(level.to_string(), full);
        }
    }

    /// 普通信息
    pub fn info(&self, msg: impl std::fmt::Display) {
        self.log("info", &msg.to_string());
    }

    /// 警告
    pub fn warn(&self, msg: impl std::fmt::Display) {
        self.log("warn", &msg.to_string());
    }

    /// 成功（前端显示绿色）
    pub fn success(&self, msg: impl std::fmt::Display) {
        self.log("success", &msg.to_string());
    }

    /// 错误（前端显示红色）
    pub fn error(&self, msg: impl std::fmt::Display) {
        self.log("error", &msg.to_string());
    }

    /// 步骤（前端显示蓝色/高亮）
    pub fn step(&self, msg: impl std::fmt::Display) {
        self.log("step", &msg.to_string());
    }

    // ── 带操作类型标签的便捷方法 ──
    // 这些方法在消息前添加【标签】前缀，帮助快速定位日志类型

    /// 【导航】页面跳转、路由切换
    pub fn nav(&self, msg: impl std::fmt::Display) {
        self.log("info", &format!("【导航】{}", msg));
    }

    /// 【元素】定位/查找页面元素
    pub fn elem(&self, msg: impl std::fmt::Display) {
        self.log("info", &format!("【元素】{}", msg));
    }

    /// 【操作】点击、输入、选择等交互操作
    pub fn act(&self, msg: impl std::fmt::Display) {
        self.log("info", &format!("【操作】{}", msg));
    }

    /// 【校验】验证/检查操作结果
    pub fn verify(&self, msg: impl std::fmt::Display) {
        self.log("info", &format!("【校验】{}", msg));
    }

    /// 【数据】数据提取、读取页面数据
    pub fn data(&self, msg: impl std::fmt::Display) {
        self.log("info", &format!("【数据】{}", msg));
    }
}

impl Default for Logger {
    fn default() -> Self {
        Self::new()
    }
}
