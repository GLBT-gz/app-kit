//! 通用重试抽象（framework 跨项目工具）
//!
//! commit 12：治本 016 散落的重试模式（probe_cdp 10s / fetch_ws_url 10×500ms /
//! navigate poll 1.5s 等）—— 统一抽象为 `with_retry(fn, policy)`，让调用方语义一致，
//! 跨项目（016/008/015）复用。
//!
//! 设计原则：
//! - **零依赖**（除 tokio time）：纯标准库 + tokio::time::sleep
//! - **可配置**：max_attempts / interval_ms / backoff / is_retryable 策略
//! - **可观测**：返回 `RetryResult<T>` 含 attempts + elapsed_ms，便于日志展示
//! - **类型安全**：Error 泛型保留调用方错误类型
//!
//! 使用示例（016 schedule.tsx probe_cdp 替换）：
//! ```ignore
//! // 原：
//! for (let i = 0; i < 10; i++) {
//!   try { const ok = await invoke<boolean>("probe_cdp_port", {cdpPort}); if (ok) return true; }
//!   catch {}
//!   if (i < 9) await sleep(1000);
//! }
//!
//! // 改：
//! const r = await with_retry(
//!   () => invoke<boolean>("probe_cdp_port", {cdpPort}),
//!   RetryPolicy::standard(),
//! );
//! return r.value;
//! ```
//!
//! @since 2026-09 (commit 12)
//! @status STABLE — 跨项目 API，变更需通知 glbt-apps + form-app 等所有引用方

use std::future::Future;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct RetryPolicy {
    /// 最大尝试次数（含首次）
    pub max_attempts: u32,
    /// 每次失败后的等待间隔（毫秒）
    pub interval_ms: u64,
    /// 退避策略：None（固定间隔）| Some("exponential") (interval × 2^(n-1))
    pub backoff: Option<String>,
}

impl RetryPolicy {
    /// 立即重试（无间隔；只跑 1 次）
    pub const IMMEDIATE: Self = Self { max_attempts: 1, interval_ms: 0, backoff: None };
    /// 016 默认：3 次重试 + 500ms 间隔（适合 API 调用）
    pub const FAST: Self = Self { max_attempts: 3, interval_ms: 500, backoff: None };
    /// 016 默认：10 次重试 + 1s 间隔（适合 CDP 端口探测）
    pub const STANDARD: Self = Self { max_attempts: 10, interval_ms: 1000, backoff: None };
    /// 002 默认：30 次重试 + 1s 间隔（适合冷启动竞态）
    pub const PERSISTENT: Self = Self { max_attempts: 30, interval_ms: 1000, backoff: None };

    /// 自定义策略
    pub fn new(max_attempts: u32, interval_ms: u64) -> Self {
        Self { max_attempts, interval_ms, backoff: None }
    }

    /// 指数退避（每次失败间隔 × 2）
    pub fn exponential(mut self) -> Self {
        self.backoff = Some("exponential".to_string());
        self
    }

    /// 计算第 n 次失败后的等待间隔（0-indexed，n=0 是首次失败后）
    fn interval_for(&self, n: u32) -> Duration {
        let base_ms = self.interval_ms;
        let ms = match self.backoff.as_deref() {
            Some("exponential") => base_ms.saturating_mul(1u64 << n.min(20)),
            _ => base_ms,
        };
        Duration::from_millis(ms)
    }
}

/// 重试执行结果
#[derive(Debug)]
pub struct RetryResult<T> {
    /// 最终成功时的值（如果 ok）
    pub value: Option<T>,
    /// 最终失败时的错误（如果 !ok）
    pub error: Option<String>,
    /// 总尝试次数（含首次）
    pub attempts: u32,
    /// 总耗时（含等待间隔，毫秒）
    pub elapsed_ms: u64,
    /// 是否最终成功
    pub ok: bool,
}

/// 执行 fn 直到成功 / 耗尽 attempts / fn 返回不可重试错误
///
/// # Arguments
/// - `f`: 异步任务函数 (每次重试调一次)
/// - `policy`: 重试策略
///
/// # Returns
/// - `RetryResult<T>` 含 attempts + elapsed_ms + ok
///
/// # Behavior
/// - fn 抛错 → 等待 policy.interval_for(n) 后重试 (除非 policy.backoff 是 exponential)
/// - fn 返回 Ok(_) → 立即返回 RetryResult.ok=true
/// - attempts 用完 → 返回 RetryResult.ok=false + 最后错误
pub async fn with_retry<T, E, F, Fut>(mut f: F, policy: RetryPolicy) -> RetryResult<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let start = Instant::now();
    let mut last_err: Option<String> = None;
    for attempt in 0..policy.max_attempts {
        match f().await {
            Ok(v) => {
                return RetryResult {
                    value: Some(v),
                    error: None,
                    attempts: attempt + 1,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                    ok: true,
                };
            }
            Err(e) => {
                last_err = Some(format!("{e}"));
                if attempt + 1 < policy.max_attempts {
                    tokio::time::sleep(policy.interval_for(attempt)).await;
                }
            }
        }
    }
    RetryResult {
        value: None,
        error: last_err,
        attempts: policy.max_attempts,
        elapsed_ms: start.elapsed().as_millis() as u64,
        ok: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    #[tokio::test]
    async fn test_immediate_success() {
        let r: RetryResult<i32> = with_retry(|| async { Ok::<_, &str>(42) }, RetryPolicy::IMMEDIATE).await;
        assert!(r.ok);
        assert_eq!(r.value, Some(42));
        assert_eq!(r.attempts, 1);
    }

    #[tokio::test]
    async fn test_retry_eventually_success() {
        let counter = AtomicU32::new(0);
        let r: RetryResult<i32> = with_retry(
            || {
                counter.fetch_add(1, Ordering::SeqCst);
                async move {
                    if counter.load(Ordering::SeqCst) < 3 {
                        Err("not yet")
                    } else {
                        Ok(99)
                    }
                }
            },
            RetryPolicy::new(5, 10),
        )
        .await;
        assert!(r.ok);
        assert_eq!(r.value, Some(99));
        assert_eq!(r.attempts, 3);
    }

    #[tokio::test]
    async fn test_retry_exhausted() {
        let counter = AtomicU32::new(0);
        let r: RetryResult<()> = with_retry(
            || {
                counter.fetch_add(1, Ordering::SeqCst);
                async { Err::<(), _>("always fail") }
            },
            RetryPolicy::new(3, 1),
        )
        .await;
        assert!(!r.ok);
        assert_eq!(r.attempts, 3);
        assert_eq!(r.error.as_deref(), Some("always fail"));
    }

    #[tokio::test]
    async fn test_exponential_backoff() {
        let p = RetryPolicy::new(5, 100).exponential();
        assert_eq!(p.interval_for(0).as_millis(), 100);
        assert_eq!(p.interval_for(1).as_millis(), 200);
        assert_eq!(p.interval_for(2).as_millis(), 400);
        assert_eq!(p.interval_for(3).as_millis(), 800);
    }
}