use anyhow::Result;
use tracing::info;

/// 将指定窗口激活到前台
pub fn activate_window(pid: u32) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        // 使用 PowerShell 激活窗口
        let ps_script = format!(
            r#"
$hwnd = (Get-Process -Id {pid} -ErrorAction SilentlyContinue).MainWindowHandle
if ($hwnd -and $hwnd -ne 0) {{
    Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {{
            [DllImport("user32.dll")]
            public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
            [DllImport("user32.dll")]
            public static extern bool SetForegroundWindow(IntPtr hWnd);
        }}
"@
    [Win32]::ShowWindowAsync($hwnd, 9) | Out-Null  # SW_RESTORE
    [Win32]::SetForegroundWindow($hwnd) | Out-Null
    Write-Host "OK"
}}
"#,
            pid = pid
        );

        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_script])
            .creation_flags(0x08000000)
            .output()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.contains("OK") {
                info!("窗口激活成功 (PID: {})", pid);
                return Ok(());
            }
        }

        anyhow::bail!("窗口激活失败 (PID: {})", pid)
    }

    #[cfg(not(windows))]
    {
        let _ = pid;
        Ok(())
    }
}

/// 获取窗口标题
pub fn get_window_title(pid: u32) -> Option<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        let output = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "(Get-Process -Id {} -ErrorAction SilentlyContinue).MainWindowTitle",
                    pid
                ),
            ])
            .creation_flags(0x08000000)
            .output()
            .ok()?;

        if output.status.success() {
            let title = crate::encoding::decode_windows_stdout(&output.stdout).trim().to_string();
            if !title.is_empty() {
                return Some(title);
            }
        }
        None
    }

    #[cfg(not(windows))]
    {
        let _ = pid;
        None
    }
}
