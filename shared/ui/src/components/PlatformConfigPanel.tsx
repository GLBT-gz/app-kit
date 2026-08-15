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
import { useData } from "../data";
import { CustomSelect } from "./CustomSelect";

// ── 类型定义 ──

export interface PlatformDef {
  /** 平台唯一标识（如 "temu-gz"） */
  key: string;
  /** 平台显示名称（如 "Temu 广州"） */
  label: string;
}

export interface BrowserOption {
  key: string;
  displayName: string;
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
}: {
  label: string;
  tooltip?: string;
  options: BrowserOption[];
  value: string | null;
  onChange: (key: string | null) => void;
}) {
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
}

/**
 * 平台配置面板。
 * 根据 registerPlatforms() 注册的平台列表，自动渲染每个平台的选择器。
 * 每个平台的选中值通过 useData("platform-profile-{key}") 持久化到 localStorage。
 */
export function PlatformConfigPanel({ options }: PlatformConfigPanelProps) {
  const platforms = getRegisteredPlatforms();

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

  return (
    <div className="platform-section">
      <div className="platform-section-title">请为每个平台指定一个浏览器环境</div>
      <div className="platform-selectors">
        {platforms.map((p) => (
          <PlatformProfileSelector
            key={p.key}
            label={p.label}
            options={options}
            value={selections[p.key]}
            onChange={(v) => setters[p.key](v)}
          />
        ))}
      </div>
    </div>
  );
}
