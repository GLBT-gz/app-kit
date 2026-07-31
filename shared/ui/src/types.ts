/** 持久化配置 - 对应 Rust 端 AppConfig */
export interface AppConfig {
  /** 是否显示历史面板 */
  show_history?: boolean;
}

/** 主题配置 */
export interface ThemeConfig {
  dark_mode: boolean;
  accent_hue: number;
  always_on_top: boolean;
  /** 数据时间戳，用于双端同步。保存时可选（Rust 后端自动填充），加载时必有 */
  _ts?: number;
}

/** 全量应用数据（对应 Rust 端的 AppData，通过 get_all_data 一次 IPC 获取） */
export interface AppData {
  theme: ThemeConfig;
  config: AppConfig;
}
