import { memo, useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";

/** 右键菜单事件名（共享：页面所有 ContextMenu 实例共用） */
export const CTX_MENU_EVENT = "appkit:ctx-menu";

/** 通用右键菜单项 */
export interface ContextMenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** 危险项（红色，用于关闭/删除类操作） */
  danger?: boolean;
  onClick: () => void;
}

/** 打开右键菜单（事件驱动：detail.data 传给 items 生成器，页面无需自己管理菜单状态） */
export function openContextMenu<T>(detail: { x: number; y: number; data: T }) {
  window.dispatchEvent(new CustomEvent(CTX_MENU_EVENT, { detail }));
}

interface ContextMenuProps<T> {
  /** 根据右键目标数据生成菜单项（每次打开菜单时调用） */
  items: (data: T) => ContextMenuItem[];
}

/**
 * 通用右键菜单（样式与「当前浏览器配置」卡片右键菜单一致，见 browser-config.css 的 .ctx-menu）。
 *
 * 独立 memo 组件 + 自定义事件接收打开指令：打开/关闭只重渲染本组件，
 * 不触发父组件重渲染，保证菜单响应即时（参考 CurrentBrowserCards 的 ProfileContextMenu）。
 */
function ContextMenuInner<T>({ items }: ContextMenuProps<T>) {
  const [menu, setMenu] = useState<{ x: number; y: number; data: T } | null>(null);

  // 接收页面派发的右键事件
  useEffect(() => {
    const onCtx = (e: Event) => {
      const d = (e as CustomEvent<{ x: number; y: number; data: T }>).detail;
      if (d) setMenu({ x: d.x, y: d.y, data: d.data });
    };
    window.addEventListener(CTX_MENU_EVENT, onCtx);
    return () => window.removeEventListener(CTX_MENU_EVENT, onCtx);
  }, []);

  // 关闭：点击空白 / Esc / 滚轮
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".ctx-menu")) setMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    const onWheel = () => setMenu(null);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("touchstart", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, [menu]);

  if (!menu) return null;

  const menuItems = items(menu.data);
  // 估算菜单高度：每项约 32px + 上下 padding 8px，用于边界钳制
  const menuHeight = menuItems.length * 32 + 8;
  const menuStyle = {
    left: Math.max(4, Math.min(menu.x, window.innerWidth - 180)),
    top: Math.max(4, Math.min(menu.y, window.innerHeight - menuHeight)),
  };

  return (
    <div className="ctx-menu" style={menuStyle} onContextMenu={(e) => e.preventDefault()}>
      {menuItems.map((it) => (
        <button
          key={it.key}
          className={`ctx-item${it.danger ? " danger" : ""}`}
          disabled={it.disabled}
          onClick={() => {
            setMenu(null);
            it.onClick();
          }}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** memo 化并保留泛型（memo 包裹后 TS 无法推导泛型，需 as 断言） */
export const ContextMenu = memo(ContextMenuInner) as <T>(
  props: ContextMenuProps<T>,
) => ReactElement | null;
