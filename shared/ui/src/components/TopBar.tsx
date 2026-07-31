import { useState, useEffect, useRef } from "react";

const presetColors = [
  { hue: 0, name: "红" }, { hue: 20, name: "橙" }, { hue: 40, name: "金" },
  { hue: 60, name: "柠" }, { hue: 120, name: "翠" }, { hue: 160, name: "绿" },
  { hue: 190, name: "青" }, { hue: 210, name: "蓝" }, { hue: 250, name: "靛" },
  { hue: 280, name: "紫" }, { hue: 320, name: "粉" }, { hue: 350, name: "玫" },
];

export function TopBar({
  showSettings,
  onToggleSettings,
  theme,
  onToggleTheme,
  accentHue,
  onChangeAccentHue,
  pinOnTop,
  onTogglePin,
  setWindowPin,
  tabBar,
  onWheel,
}: {
  showSettings: boolean;
  onToggleSettings: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  accentHue: number;
  onChangeAccentHue: (hue: number) => void;
  pinOnTop: boolean;
  onTogglePin: () => void;
  setWindowPin: (pin: boolean) => Promise<void>;
  /** 顶栏左侧的 tab 栏（项目自定义） */
  tabBar?: React.ReactNode;
  /** 顶栏滚轮事件（项目自定义，如切换 tab） */
  onWheel?: (e: React.WheelEvent) => void;
}) {
  const [showSkinPopover, setShowSkinPopover] = useState(false);
  const skinRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭皮肤弹窗
  useEffect(() => {
    if (!showSkinPopover) return;
    const handleClick = (e: MouseEvent) => {
      if (skinRef.current && !skinRef.current.contains(e.target as Node)) {
        setShowSkinPopover(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSkinPopover]);

  // 原生 wheel 监听（比 React onWheel 更可靠，避免合成事件 + data-tauri-drag-region 冲突）
  useEffect(() => {
    const el = topbarRef.current;
    if (!el || !onWheel) return;
    const handler = (e: WheelEvent) => { onWheel(e as unknown as React.WheelEvent); };
    el.addEventListener("wheel", handler, { passive: true });
    return () => el.removeEventListener("wheel", handler);
  }, [onWheel]);

  return (
    <div className="topbar" ref={topbarRef}>
      {tabBar && <div className="topbar-left">{tabBar}</div>}
      <div className="topbar-right" data-tauri-drag-region>
        {/* 设置按钮 */}
        <button
          className={`settings-btn ${showSettings ? "active" : ""}`}
          onClick={onToggleSettings}
          title="设置"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {/* 置顶按钮 */}
        <button
          className={`pin-btn ${pinOnTop ? "active" : ""}`}
          onClick={async () => { const next = !pinOnTop; onTogglePin(); try { await setWindowPin(next); } catch {} }}
          title={pinOnTop ? "取消置顶" : "窗口置顶"}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: pinOnTop ? 'rotate(0deg)' : 'rotate(45deg)' }}>
            <path d="M12 17v-6a4 4 0 0 0 4-4V5H8v2a4 4 0 0 0 4 4v6" /><line x1="8" y1="21" x2="16" y2="21" />
          </svg>
        </button>
        {/* 调色板 */}
        <div className="skin-popover-wrapper" ref={skinRef}>
          <button className="skin-btn" onClick={() => setShowSkinPopover(v => !v)} title="主题色">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
              <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
            </svg>
          </button>
          {showSkinPopover && (
            <div className="skin-popover">
              <div className="skin-popover-title">主题色</div>
              <div className="skin-preset-grid">
                {presetColors.map(c => (
                  <button key={c.hue} className="skin-preset-item" onClick={() => onChangeAccentHue(c.hue)}>
                    <div className={`skin-swatch ${accentHue === c.hue ? "active" : ""}`} style={{ background: `hsl(${c.hue}, 95%, 53%)` }} />
                    <span className="skin-swatch-label">{c.name}</span>
                  </button>
                ))}
              </div>
              <div className="skin-hue-slider-row">
                <input type="range" min="0" max="360" value={accentHue} onChange={e => onChangeAccentHue(parseInt(e.target.value, 10))} className="skin-hue-slider"
                  style={{ background: `linear-gradient(to right, hsl(0,95%,53%), hsl(60,95%,53%), hsl(120,95%,53%), hsl(180,95%,53%), hsl(240,95%,53%), hsl(300,95%,53%), hsl(360,95%,53%))` }} />
                <span className="skin-hue-value">{accentHue}°</span>
              </div>
            </div>
          )}
        </div>
        {/* 主题切换 */}
        <button className="theme-toggle" onClick={onToggleTheme} title="切换主题">
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
          )}
        </button>
      </div>
    </div>
  );
}
