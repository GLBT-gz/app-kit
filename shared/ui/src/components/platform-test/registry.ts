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
      "010-产品上架": "已接入公共面板+命令已下沉平台层（标准薄壳）",
      "001-店小秘-采购": "已接入公共面板（阶段1b，2026-08-21）",
      "003-返单备货量自动化": "已接入公共面板（阶段1b，2026-08-21）",
      "004-店小秘-SKU成本计算": "已接入公共面板（阶段1b，2026-08-21）",
      "006-海外仓库存同步": "已接入公共面板（阶段1b，2026-08-21）",
    },
    note: "dxm_* 命令逻辑已下沉到 platforms/dianxiaomi（browser/verify/flow/monitor/cancel），010 为标准薄壳实现；001/003/004/006 已注册同名命令并接入公共 DxmTestPanel（事件统一为 dxm:progress / dxm:verify-code，项目私有业务测试经 extraSections 注入）。001/003/004/006 的旧 test_dxm_* 私有命令保留在项目内，未纳入公共契约。",
  },
  {
    key: "temu",
    label: "Temu",
    panelComponent: "TemuTestPanel",
    commands: [
      { name: "test_temu_auto_login", desc: "自动登录（可视化/后台模式）" },
      { name: "test_temu_close_popups", desc: "登录后关闭所有弹窗广告" },
      { name: "test_temu_get_shops", desc: "获取所有店铺列表" },
      { name: "test_temu_switch_shop", desc: "切换到指定店铺（targetMallName 取 load_cached_shops 缓存）" },
      { name: "test_temu_navigate_menu", desc: "左侧路由导航（menu1/menu2 预定义路由）" },
      { name: "load_cached_shops", desc: "加载缓存的店铺列表（gz_shops/hk_shops）" },
      { name: "test_temu_get_restock_data", desc: "备货数据（003 私有）" },
      { name: "test_temu_get_restock_data_api", desc: "API 备货数据（003 私有）" },
      { name: "test_temu_get_restock_data_api_multi", desc: "批量 API 备货数据（003 私有）" },
      { name: "test_temu_get_sales_7d", desc: "近7天销量（003 私有）" },
    ],
    usedBy: {
      "002-Temu-运营综合工具": "项目私有（命令为 test_get_*/testGetHomePageData 业务导向，未对齐公共契约，待定）",
      "003-返单备货量自动化": "已接入公共面板 + 私有业务注入（阶段4，2026-08-21）",
    },
    note: "公共契约对齐 003 实现（浏览器参数直接传 exePath/browserType/profileId/userDataDir，platform 为 gz/hk 对应 platformSelections 的 temu-gz/temu-hk，命令返回分步日志字符串）；003 私有业务（备货数据/近7天销量）经 extraSections 注入，本地 test-temu-basic.tsx 已删除；002 命令未对齐（店铺分析/测量数据/每月账单），待用户决策是否接入。",
  },
  {
    key: "kdocs",
    label: "多维表格",
    panelComponent: "KdocsTestPanel",
    commands: [
      { name: "test_kdocs_open", desc: "打开多维表格（URL 参数化）" },
      { name: "test_kdocs_sidebar", desc: "解析侧边栏树（只读）" },
      { name: "test_kdocs_parse_scripts", desc: "解析脚本列表（只读）" },
      { name: "test_kdocs_run_script", desc: "运行脚本并读取日志" },
      { name: "cancel_kdocs", desc: "终止当前多维表格自动化" },
    ],
    usedBy: {
      "006-海外仓库存同步": "已接入公共面板（阶段2，2026-08-21）",
      "007-库存周转": "已接入公共面板 + 私有业务注入（阶段2，2026-08-21）",
      "003-返单备货量自动化": "已接入公共面板（仅打开模块 + 私有业务注入，阶段2，2026-08-21）",
    },
    note: "公共契约对齐 007 实现（浏览器参数直接传，命令内部保证就绪）；事件统一 kdocs-test-progress（{message,level}）；006 原 cdpPort 前置签名已对齐；007 私有模块（路由导航/写脚本/菜单探测/dbapp 直读等）经 extraSections 注入；003 原 feishu 命名命令保留为私有业务。",
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
      "008-紫鸟运营工具": "已接入公共面板 + 私有业务注入（阶段3，2026-08-21）",
      "009-TK店铺自动化": "未使用测试页",
    },
    note: "公共 ZiniaoTestPanel 提供补丁/打开/店铺列表/开关/进入/CDP/侧边栏/TK01 通用模块；008 私有业务（树形路由选择/刷新全部店铺域名）经 extraSections 注入（共享 ZiniaoPanelCtx），本地 test-common.tsx 已删除。",
  },
];
