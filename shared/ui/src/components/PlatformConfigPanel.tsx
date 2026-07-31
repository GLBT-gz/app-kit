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
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useData } from "../data";

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

// ── CustomSelect（portal 下拉框） ──

function CustomSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: BrowserOption[];
  value: string | null;
  onChange: (key: string | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    if (dropdownRef.current) {
      dropdownRef.current.style.position = "fixed";
      dropdownRef.current.style.top = `${rect.bottom + 4}px`;
      dropdownRef.current.style.left = `${rect.left}px`;
      dropdownRef.current.style.width = `${rect.width}px`;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let rafId: number | null = null;

    const handle = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };

    const onScroll = () => {
      if (rafId !== null) return; // 已排入 RAF，下一帧统一更新
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!triggerRef.current || !dropdownRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        dropdownRef.current.style.top = `${rect.bottom + 4}px`;
        dropdownRef.current.style.left = `${rect.left}px`;
        dropdownRef.current.style.width = `${rect.width}px`;
      });
    };

    document.addEventListener("mousedown", handle);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      document.removeEventListener("mousedown", handle);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const selected = options.find((o) => o.key === value);

  return (
    <div className="custom-select" ref={triggerRef}>
      <div
        className="custom-select-trigger"
        onClick={() => setOpen((v) => !v)}
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span className={`custom-select-value${selected ? "" : " placeholder"}`}>
          {selected ? selected.displayName : placeholder || "选择配置"}
        </span>
        <span className={`custom-select-arrow${open ? " open" : ""}`}>▼</span>
      </div>
      {open &&
        createPortal(
          <div className="custom-select-dropdown" ref={dropdownRef}>
            {options.length === 0 ? (
              <div className="custom-select-option disabled">暂无可用配置</div>
            ) : (
              options.map((opt) => (
                <div
                  key={opt.key}
                  className={`custom-select-option${opt.key === value ? " active" : ""}`}
                  onClick={() => {
                    onChange(opt.key);
                    setOpen(false);
                  }}
                >
                  {opt.displayName}
                </div>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
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
