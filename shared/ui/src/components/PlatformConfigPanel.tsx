/**
 * 平台-浏览器绑定组件
 *
 * 各子项目通过 registerPlatforms() 注册自己需要操作的平台，
 * PlatformConfigPanel 自动渲染每个平台的浏览器环境选择器。
 *
 * 用法：
 *   // data.ts 或初始化代码中
 *   import { registerPlatforms } from "@appkit/ui";
 *   registerPlatforms([
 *     { key: "temu-gz", label: "Temu 广州" },
 *     { key: "temu-hk", label: "Temu 香港" },
 *   ]);
 *
 *   // App.tsx 设置页面中
 *   import { PlatformConfigPanel } from "@appkit/ui";
 *   <PlatformConfigPanel />
 */
import { useMemo } from "react";
import { useData } from "../data";
import { CustomSelect, CustomMultiSelect } from "./CustomSelect";

/**
 * 用 canvas measureText 测量文本渲染宽度（与 .platform-picker-label 的
 * font: 600 13px system-ui 保持一致）。用作最长 label 宽度，用于统一
 * 所有 picker 的 label 列宽——避免"固定 min-width 100px"导致长短
 * label 不齐，或"grid max-content 跨行共享"在 Chromium 实际渲染中
 * 不可靠的问题（8953b58 回归实测）。
 */
let _measureCanvas: HTMLCanvasElement | null = null;
function measureLabel(text: string, fontSize = 13, fontWeight = 600): number {
  if (typeof document === "undefined") return 0;
  _measureCanvas ??= document.createElement("canvas");
  const ctx = _measureCanvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = `${fontWeight} ${fontSize}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  return ctx.measureText(text).width;
}

// ── 类型定义 ──

export interface PlatformDef {
  /** 平台唯一标识 */
  key: string;
  /** 平台显示名称 */
  label: string;
  /**
   * 多选模式（默认单选）。
   * 多选平台：选项可勾选多个，选中值以**逗号分隔字符串**存入
   * `platform-profile-{key}`（如 `"1003,1001"`；读取方用 parseMultiValue 解析）。
   * 注意：不用 JSON 数组字符串 —— useData 在 default=null 时会 JSON.parse 成真数组，
   * 与 string|null 的存储语义冲突。逗号分隔与单选同语义，双兼容。
   */
  multi?: boolean;
  /**
   * 从 options（浏览器配置）中排除的浏览器类型（如 ["ziniao"] 让跨境平台
   * 下拉不出现紫鸟配置）。仅作用于 options；extraOptions（每平台专用选项源）不过滤。
   *
   * 最佳实践（2026-09 用户规范）：
   * - `edge` / `chrome` 是通用自动化浏览器，每个平台默认就应可见 → 一般不写 excludeBt。
   * - `ziniao` / `yideke` 等专属浏览器有自己的店铺范围判断逻辑（走本地缓存 / 嗅探），
   *   不应混入通用平台的「当前浏览器配置」下拉 → 平台注册时建议加 `excludeBt: ["ziniao", "yideke"]`。
   */
  excludeBt?: string[];
}

export interface BrowserOption {
  key: string;
  displayName: string;
  /** 浏览器类型（edge/chrome 或注册类型），用于选项排序 */
  bt?: string;
}

/**
 * 解析多选存储值 → string[]。
 * 兼容两种格式：逗号分隔字符串（"1003,1001"）与旧版 JSON 数组字符串（["1003","1001"]）。
 */
export function parseMultiValue(value: string | null): string[] {
  if (!value) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  // 兼容旧版 JSON 数组字符串
  if (raw.startsWith("[")) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.map(String);
    } catch {
      /* fallthrough */
    }
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// ── 全局平台注册表 ──

let _platforms: PlatformDef[] = [];

/**
 * 注册当前项目需要操作的平台。
 * 建议在 data.ts 或 App.tsx 的模块顶层调用。
 */
export function registerPlatforms(platforms: PlatformDef[]): void {
  _platforms = platforms;
}

/** 获取当前已注册的平台列表 */
export function getRegisteredPlatforms(): PlatformDef[] {
  return _platforms;
}

// ── PlatformProfileSelector（单个平台选择器） ──

export function PlatformProfileSelector({
  label,
  tooltip,
  options,
  value,
  onChange,
  multi = false,
}: {
  label: string;
  tooltip?: string;
  options: BrowserOption[];
  value: string | null;
  onChange: (key: string | null) => void;
  /** 多选模式：用 CustomMultiSelect，值存 JSON 数组字符串 */
  multi?: boolean;
}) {
  // 多选模式
  if (multi) {
    const values = parseMultiValue(value);
    return (
      <div className="platform-picker">
        <div className="platform-picker-label" title={tooltip}>
          {label}
        </div>
        <div className="platform-picker-row">
          <CustomMultiSelect
            options={options}
            values={values}
            onChange={(keys) => onChange(keys.length ? keys.join(",") : null)}
            placeholder="选择（可多选）"
          />
          {values.length > 0 && (
            <button className="platform-picker-clear" onClick={() => onChange(null)} title="清除选择">
              ✕
            </button>
          )}
        </div>
      </div>
    );
  }

  // 单选模式（默认，保持原行为）
  return (
    <div className="platform-picker">
      <div className="platform-picker-label" title={tooltip}>
        {label}
      </div>
      <div className="platform-picker-row">
        <CustomSelect options={options} value={value} onChange={onChange} placeholder="选择配置" />
        {value && (
          <button className="platform-picker-clear" onClick={() => onChange(null)} title="清除选择">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

// ── PlatformConfigPanel（自动渲染所有已注册平台） ──

export interface PlatformConfigPanelProps {
  /** 可选的浏览器环境列表（来自 CurrentBrowserCards 的多选结果） */
  options: BrowserOption[];
  /**
   * 每平台额外选项源（key = 平台 key）。
   * 提供时该平台忽略 options，改用这里传入的选项（如「本土TK」的紫鸟店铺列表）。
   * 多选平台若未提供则回退 options。
   */
  extraOptions?: Record<string, BrowserOption[]>;
}

/**
 * 平台配置面板。
 * 根据 registerPlatforms() 注册的平台列表，自动渲染每个平台的选择器。
 * 每个平台的选中值通过 useData("platform-profile-{key}") 持久化到 localStorage。
 * 多选平台（PlatformDef.multi=true）用 CustomMultiSelect，值存 JSON 数组字符串。
 */
export function PlatformConfigPanel({ options, extraOptions }: PlatformConfigPanelProps) {
  const platforms = getRegisteredPlatforms();

  // ── 测量最长 label 实际像素宽度，注入 CSS 变量统一所有 picker 的 label 列宽 ──
  // 不用 grid max-content 的原因：8953b58 实测 Chromium 渲染中 grid track width
  // 按各 grid item 内容独立计算，未真正跨行共享——导致 label 列宽按行变化、
  // 下拉框起点不齐。flex + 显式 --max-label-width 变量是稳定方案。
  const maxLabelWidth = useMemo(() => {
    if (platforms.length === 0) return 0;
    return Math.max(...platforms.map((p) => Math.ceil(measureLabel(p.label))));
  }, [platforms]);

  // 每个平台对应一个 useData hook
  const selections: Record<string, string | null> = {};
  const setters: Record<string, (v: string | null) => void> = {};

  for (const platform of platforms) {
    const key = `platform-profile-${platform.key}`;
    const [value, setValue] = useData<string | null>({
      key,
      default: null,
      category: "config",
      desc: `${platform.label}浏览器配置`,
      storage: "localStorage",
    });
    selections[platform.key] = value;
    setters[platform.key] = setValue;
  }

  if (platforms.length === 0) {
    return (
      <div className="automation-status">
        <span className="automation-status-text">未注册任何平台，请在 data.ts 中调用 registerPlatforms()</span>
      </div>
    );
  }

  // 每平台选项：multi 平台优先用 extraOptions（专用选项源，不过滤）；
  // 其余用 options，并按平台 excludeBt 过滤（如跨境平台排除紫鸟配置）。
  const optionsFor = (p: PlatformDef): BrowserOption[] => {
    const base = p.multi ? extraOptions?.[p.key] ?? options : options;
    if (!p.excludeBt?.length) return base;
    const excluded = new Set(p.excludeBt);
    return base.filter((o) => !excluded.has(o.bt ?? ""));
  };

  return (
    <div className="platform-section">
      <div className="platform-section-title">请为每个平台指定一个浏览器环境</div>
      <div
        className="platform-selectors"
        style={{ "--max-label-width": `${maxLabelWidth}px` } as React.CSSProperties}
      >
        {platforms.map((p) => (
          <PlatformProfileSelector
            key={p.key}
            label={p.label}
            options={optionsFor(p)}
            value={selections[p.key]}
            onChange={(v) => setters[p.key](v)}
            multi={p.multi}
          />
        ))}
      </div>
    </div>
  );
}
