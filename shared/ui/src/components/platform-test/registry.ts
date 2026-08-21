// ============================================================
// 平台测试注册表（Platform Test Registry）
//
// 统筹各平台共享测试功能的依据：记录每个平台有哪些测试命令、
// 公共测试面板组件、被哪些项目使用。
//
// 原则：一个平台被多个项目用到时，其测试功能应收拢到公共层
// （dxm-api / DxmTestPanel 等），各项目 Rust 侧注册同名命令即可复用。
// ============================================================

export interface PlatformTestCommand {
  /** tauri 命令名（裸名） */
  name: string;
  /** 功能描述 */
  desc: string;
}

export interface PlatformTestRecord {
  /** 平台 key（与 registerPlatforms 的 key 一致） */
  key: string;
  /** 平台名 */
  label: string;
  /** 公共测试面板组件（@appkit/ui 导出名；无则项目自建） */
  panelComponent?: string;
  /** 平台测试命令集（Rust 侧需注册同名命令） */
  commands: PlatformTestCommand[];
  /** 使用该平台的项目（项目名 → 接入状态说明） */
  usedBy: Record<string, string>;
  /** 备注 / 迁移计划 */
  note?: string;
}

export const PLATFORM_TEST_REGISTRY: PlatformTestRecord[] = [
  {
    key: "dianxiaomi",
    label: "店小秘",
    panelComponent: "DxmTestPanel",
    commands: [
      { name: "save_dxm_credentials", desc: "保存店小秘登录凭证" },
      { name: "load_dxm_credentials", desc: "加载店小秘登录凭证" },
      { name: "ensure_browser_dianxiaomi", desc: "启动/连接店小秘浏览器，返回 CDP 端口" },
      { name: "dxm_login", desc: "打开登录页并自动登录（含图形验证码）" },
      { name: "dxm_open_page", desc: "前往指定业务页面（未登录自动登录）" },
      { name: "dxm_submit_verify_code", desc: "提交图形验证码" },
      { name: "cancel_dxm_automation", desc: "终止当前店小秘自动化" },
      { name: "dxm_monitor_start", desc: "启动/连接被监控浏览器" },
      { name: "dxm_monitor_status", desc: "查询监控会话状态" },
      { name: "dxm_monitor_reconnect", desc: "探测并恢复监控连接" },
      { name: "dxm_list_tabs", desc: "列出被控浏览器全部标签页" },
      { name: "dxm_tab_activate", desc: "切换标签页" },
      { name: "dxm_tab_close", desc: "关闭标签页" },
      { name: "dxm_tab_open", desc: "打开新标签页" },
      { name: "dxm_tab_rename", desc: "重命名标签页" },
    ],
    usedBy: {
      "010-产品上架": "已接入公共面板+命令已下沉平台层",
      "001-店小秘-采购": "命令待统一",
      "003-返单备货量自动化": "命令待统一",
      "004-店小秘-SKU成本计算": "命令待统一",
      "006-海外仓库存同步": "命令待统一",
    },
    note: "dxm_* 命令逻辑已下沉到 platforms/dianxiaomi（browser/verify/flow/monitor），010 为标准薄壳实现；001/003/004/006 注册同名命令即可接入公共 DxmTestPanel（注意事件名需统一为 dxm:progress / dxm:verify-code）。",
  },
  {
    key: "temu",
    label: "Temu",
    commands: [
      { name: "temu_auto_get_data", desc: "Temu 自动化抓取（003）" },
      { name: "test_temu_switch_shop", desc: "切换店铺（003）" },
      { name: "test_temu_navigate_menu", desc: "菜单导航（003）" },
      { name: "test_temu_get_restock_data", desc: "备货数据（003）" },
    ],
    usedBy: {
      "002-Temu-运营综合工具": "项目私有",
      "003-返单备货量自动化": "项目私有",
    },
    note: "002 与 003 的 Temu 测试命令未对齐，暂未收拢到公共层。",
  },
  {
    key: "kdocs",
    label: "多维表格",
    commands: [
      { name: "test_kdocs_open", desc: "打开多维表格（003/006/007）" },
      { name: "test_kdocs_parse_scripts", desc: "解析脚本（006/007）" },
      { name: "test_kdocs_run_script", desc: "执行脚本（006/007）" },
    ],
    usedBy: {
      "003-返单备货量自动化": "项目私有",
      "006-海外仓库存同步": "项目私有",
      "007-库存周转": "项目私有",
    },
    note: "kdocs 被 3 个项目使用，测试命令以 test_kdocs_* 为主，具备收拢条件（无平台 crate 独立命令）。",
  },
  {
    key: "haiduoke",
    label: "海多客",
    commands: [
      { name: "test_haiduoke_open_login", desc: "打开登录（006/007）" },
      { name: "test_haiduoke_fetch_stock", desc: "获取库存（007）" },
      { name: "test_haiduoke_latest_order", desc: "最近订单（006）" },
    ],
    usedBy: {
      "006-海外仓库存同步": "项目私有",
      "007-库存周转": "项目私有",
    },
  },
  {
    key: "ziniao",
    label: "紫鸟浏览器",
    panelComponent: "ZiniaoTestPanel",
    commands: [
      { name: "ziniao_patch_status", desc: "补丁状态检测" },
      { name: "ziniao_patch_apply", desc: "安装补丁" },
      { name: "ziniao_agent_launch", desc: "打开紫鸟" },
      { name: "ziniao_agent_browser_list", desc: "获取店铺列表" },
      { name: "ziniao_agent_start_browser", desc: "打开店铺" },
      { name: "ziniao_agent_stop_browser", desc: "关闭店铺" },
      { name: "ziniao_agent_cdp_port", desc: "获取 CDP 端口" },
    ],
    usedBy: {
      "008-紫鸟运营工具": "项目私有（公共 ZiniaoTestPanel 未接线）",
      "009-TK店铺自动化": "未使用测试页",
    },
    note: "公共 ZiniaoTestPanel 已存在但 008 使用自有 test-common.tsx（内容重叠），待二选一。",
  },
];
