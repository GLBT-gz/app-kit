import { useState, useEffect, useRef } from "react";

export interface TabItem {
  id: string;
  label: string;
}

interface TabBarProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  disabled?: boolean;
  /** 附加到 tb-bar 的类名（用于局部定制，如数据管理页首个 tab 对齐标题） */
  className?: string;
}

/**
 * 通用标签页组件，支持：
 * - 底栏滑块跟随文本宽度动画滑动
 *
 * 滚轮切换由父组件通过 onWheel 决定范围（详见 DataManagerPanel / AppLayout）。
 */
export function TabBar({ tabs, activeTab, onTabChange, disabled, className }: TabBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  // 初始为 null：首次不渲染滑块，等布局稳定测量到正确位置后再渲染，
  // 避免从 (0,0) 滑动到正确位置的闪烁，也消除 getBoundingClientRect 在布局未稳定时的误差。
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  // ── 滑块位置跟随 activeTab ──
  useEffect(() => {
    if (!barRef.current) return;

    const updateIndicator = () => {
      if (!barRef.current) return;
      const activeBtn = barRef.current.querySelector(".tb-btn.active") as HTMLElement | null;
      if (!activeBtn) return;
      const textSpan = activeBtn.querySelector("span") as HTMLElement | null;
      if (textSpan) {
        const barRect = barRef.current.getBoundingClientRect();
        const textRect = textSpan.getBoundingClientRect();
        setIndicator({
          left: textRect.left - barRect.left,
          width: textRect.width,
        });
      } else {
        // 兜底：取按钮宽度 60% 居中
        const bw = activeBtn.offsetWidth;
        const iw = Math.round(bw * 0.6);
        setIndicator({
          left: activeBtn.offsetLeft + Math.round((bw - iw) / 2),
          width: iw,
        });
      }
    };

    // 双层 requestAnimationFrame：确保首次布局完全稳定后再测量
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(updateIndicator);
    });

    // 持续监听布局变化（字体加载、容器尺寸变化等）
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(barRef.current);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [activeTab, tabs]);

  return (
    <div className={`tb-bar${disabled ? " disabled" : ""}${className ? ` ${className}` : ""}`} ref={barRef}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`tb-btn ${tab.id === activeTab ? "active" : ""}`}
          disabled={disabled}
          onClick={() => !disabled && onTabChange(tab.id)}
        >
          <span>{tab.label}</span>
        </button>
      ))}
      {!disabled && indicator && (
        <div
          className="tb-indicator"
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
    </div>
  );
}
