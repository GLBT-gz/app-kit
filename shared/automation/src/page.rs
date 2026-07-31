use crate::cdp::commands;
use crate::cdp::connection::CdpConnection;
use anyhow::{Context, Result};
use tracing::{debug, info};

/// 页面操作封装
pub struct Page<'a> {
    cdp: &'a CdpConnection,
}

impl<'a> Page<'a> {
    pub fn new(cdp: &'a CdpConnection) -> Self {
        Self { cdp }
    }

    /// 获取底层 CDP 连接引用
    pub fn cdp(&self) -> &'a CdpConnection {
        self.cdp
    }

    /// 导航到 URL
    pub async fn goto(&self, url: &str) -> Result<()> {
        info!("导航到: {}", url);
        commands::page_navigate(self.cdp, url).await?;
        Ok(())
    }

    /// 等待页面完全加载
    pub async fn wait_load(&self) -> Result<()> {
        info!("等待页面加载完成");
        commands::page_load_event(self.cdp).await
    }

    /// 通过 CSS 选择器查找元素
    pub async fn find_element(&self, css_selector: &str) -> Result<Option<Element<'_>>> {
        debug!("查找元素: {}", css_selector);
        let doc = commands::dom_get_document(self.cdp).await?;
        let node_id = commands::dom_query_selector(self.cdp, doc, css_selector).await?;
        Ok(node_id.map(|id| Element {
            cdp: self.cdp,
            node_id: id,
            selector: css_selector.to_string(),
        }))
    }

    /// 通过 CSS 选择器查找多个元素
    pub async fn find_elements(&self, css_selector: &str) -> Result<Vec<Element<'_>>> {
        debug!("查找元素列表: {}", css_selector);
        let doc = commands::dom_get_document(self.cdp).await?;
        let node_ids = commands::dom_query_selector_all(self.cdp, doc, css_selector).await?;
        Ok(node_ids
            .into_iter()
            .map(|id| Element {
                cdp: self.cdp,
                node_id: id,
                selector: css_selector.to_string(),
            })
            .collect())
    }

    /// 判断元素是否存在
    pub async fn element_exists(&self, css_selector: &str) -> Result<bool> {
        commands::runtime_element_exists(self.cdp, css_selector).await
    }

    /// 获取页面标题
    pub async fn title(&self) -> Result<String> {
        debug!("获取页面标题");
        let result = commands::runtime_evaluate(self.cdp, "document.title").await?;
        Ok(result["value"].as_str().unwrap_or("").to_string())
    }

    /// 获取当前 URL
    pub async fn current_url(&self) -> Result<String> {
        debug!("获取当前 URL");
        let result = commands::runtime_evaluate(self.cdp, "window.location.href").await?;
        Ok(result["value"].as_str().unwrap_or("").to_string())
    }

    /// 执行 JavaScript
    pub async fn evaluate(&self, js: &str) -> Result<serde_json::Value> {
        let snippet = if js.len() > 60 { &js[..60] } else { js };
        debug!("执行 JS: {}...", snippet);
        commands::runtime_evaluate(self.cdp, js).await
    }

    /// 执行异步 JavaScript（支持 Promise/async/await）
    pub async fn evaluate_async(&self, js: &str) -> Result<serde_json::Value> {
        let snippet = if js.len() > 60 { &js[..60] } else { js };
        info!("执行异步 JS: {}...", snippet);
        commands::runtime_evaluate_async(self.cdp, js).await
    }

    /// 截图
    pub async fn screenshot(&self) -> Result<Vec<u8>> {
        info!("截取页面截图");
        commands::page_capture_screenshot(self.cdp, "png").await
    }

    /// 等待指定毫秒
    pub async fn wait(&self, ms: u64) {
        tokio::time::sleep(tokio::time::Duration::from_millis(ms)).await;
    }

    /// 等待元素出现
    pub async fn wait_for_element(
        &self,
        css_selector: &str,
        timeout_secs: u64,
    ) -> Result<Element<'_>> {
        let start = std::time::Instant::now();
        loop {
            if let Some(elem) = self.find_element(css_selector).await? {
                info!("元素已找到: {} (耗时 {:?})", css_selector, start.elapsed());
                return Ok(elem);
            }
            if start.elapsed() > std::time::Duration::from_secs(timeout_secs) {
                anyhow::bail!("等待元素超时: {} ({}s)", css_selector, timeout_secs);
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        }
    }

    /// 获取页面上的所有 Cookie
    pub async fn get_cookies(&self) -> Result<Vec<serde_json::Value>> {
        commands::network_get_cookies(self.cdp).await
    }

    /// 设置 Cookie
    pub async fn set_cookie(&self, name: &str, value: &str, domain: &str) -> Result<()> {
        commands::network_set_cookie(self.cdp, name, value, domain).await
    }
}

/// 元素操作封装
pub struct Element<'a> {
    cdp: &'a CdpConnection,
    node_id: i64,
    selector: String,
}

impl<'a> Element<'a> {
    /// 获取元素文本
    pub async fn text(&self) -> Result<String> {
        let result = commands::runtime_evaluate(
            self.cdp,
            &format!(
                "document.querySelector('{}')?.textContent || ''",
                self.selector.replace('\'', "\\'"),
            ),
        )
        .await?;
        Ok(result["value"].as_str().unwrap_or("").to_string())
    }

    /// 获取属性值
    pub async fn get_attribute(&self, name: &str) -> Result<Option<String>> {
        commands::dom_get_attribute(self.cdp, self.node_id, name).await
    }

    /// 点击元素
    pub async fn click(&self) -> Result<()> {
        info!("点击元素: {}", self.selector);
        // 先通过 JS 获取元素位置
        let result = commands::runtime_evaluate(
            self.cdp,
            &format!(
                r#"(function() {{
                    const el = document.querySelector('{}');
                    if (!el) return null;
                    const rect = el.getBoundingClientRect();
                    return {{ x: rect.x + rect.width/2, y: rect.y + rect.height/2 }};
                }})()"#,
                self.selector.replace('\'', "\\'"),
            ),
        )
        .await?;

        let x = result["value"]["x"].as_f64().context("无法获取元素位置")?;
        let y = result["value"]["y"].as_f64().context("无法获取元素位置")?;

        commands::input_click(self.cdp, x, y).await
    }

    /// 输入文本（先清空再输入）
    pub async fn type_text(&self, text: &str) -> Result<()> {
        let display_text = if text.len() > 20 { format!("{}...", &text[..20]) } else { text.to_string() };
        info!("输入文本到 {}: {}", self.selector, display_text);
        // 选中元素并清空
        self.click().await?;

        // 全选 + 删除
        commands::runtime_evaluate(
            self.cdp,
            &format!(
                r#"document.querySelector('{}')?.select()"#,
                self.selector.replace('\'', "\\'"),
            ),
        )
        .await?;

        commands::input_insert_text(self.cdp, text).await
    }

    /// 获取元素是否可见
    pub async fn is_visible(&self) -> Result<bool> {
        let result = commands::runtime_evaluate(
            self.cdp,
            &format!(
                r#"(function() {{
                    const el = document.querySelector('{}');
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0;
                }})()"#,
                self.selector.replace('\'', "\\'"),
            ),
        )
        .await?;

        Ok(result["value"].as_bool().unwrap_or(false))
    }

    /// 获取元素外部 HTML
    pub async fn outer_html(&self) -> Result<String> {
        commands::runtime_get_text(self.cdp, self.node_id).await
    }
}
