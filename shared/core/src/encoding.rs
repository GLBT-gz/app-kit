/// 解码 Windows 进程输出（PowerShell ConvertTo-Json 输出 UTF-16LE，wmic 输出 OEM 代码页）
pub fn decode_windows_stdout(bytes: &[u8]) -> String {
    // 1. UTF-16LE with BOM (0xFF 0xFE) — PowerShell ConvertTo-Json 输出
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let utf16: Vec<u16> = bytes[2..]
            .chunks(2)
            .filter(|c| c.len() == 2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&utf16);
    }
    // 2. 纯 UTF-8（最常见情况）
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    // 3. 回退: 用系统 OEM 代码页解码（wmic 输出，避免中文字符乱码）
    #[cfg(windows)]
    {
        return decode_oem_to_utf8_lossy(bytes);
    }
    #[cfg(not(windows))]
    {
        String::from_utf8_lossy(bytes).to_string()
    }
}

/// 使用 Windows API 将 OEM 代码页字节转为 UTF-8
#[cfg(windows)]
pub fn decode_oem_to_utf8_lossy(bytes: &[u8]) -> String {
    extern "system" {
        fn GetOEMCP() -> u32;
        fn MultiByteToWideChar(
            CodePage: u32,
            dwFlags: u32,
            lpMultiByteStr: *const u8,
            cbMultiByte: i32,
            lpWideCharStr: *mut u16,
            cchWideChar: i32,
        ) -> i32;
    }
    unsafe {
        let cp = GetOEMCP();
        // 计算需要的宽字符缓冲区大小
        let needed = MultiByteToWideChar(
            cp, 0,
            bytes.as_ptr(), bytes.len() as i32,
            std::ptr::null_mut(), 0,
        );
        if needed <= 0 {
            return String::from_utf8_lossy(bytes).to_string();
        }
        let mut wide = vec![0u16; needed as usize];
        MultiByteToWideChar(
            cp, 0,
            bytes.as_ptr(), bytes.len() as i32,
            wide.as_mut_ptr(), needed,
        );
        String::from_utf16_lossy(&wide)
    }
}
