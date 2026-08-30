// ============================================================
//  Profile 右键菜单（从 CurrentBrowserCards.tsx 拆出）
//
//  独立组件：内部自管状态，通过自定义事件接收「打开」指令。
//  打开/关闭只重渲染本组件，不触发父组件（卡片网格）重渲染，
//  保证菜单响应即时。
// ============================================================

import { useState, useEffect, memo } from "react";
import type { BCPBrowser, BCPProfile } from "../BrowserConfigPanel";
import { isDefaultUserDir, isMainEntryProfile } from "../../utils/profile-rules";

/** 右键菜单事件名 */
export const CTX_MENU_EVENT = "appkit:profile-ctx-menu";

/** 菜单状态（事件 detail） */
export interface CtxMenuDetail {
  x: number;
  y: number;
  bt: string;
  p: BCPProfile;
}

interface ProfileContextMenuProps {
  browsers: BCPBrowser[];
  onOpen: (bt: string, p: BCPProfile) => void;
  onDebugOpen: (bt: string, p: BCPProfile) => void;
  onClose: (bt: string, p: BCPProfile) => void;
  onKillAll: (bt: string, p: BCPProfile) => void;
  onShowCommand: (bt: string, p: BCPProfile) => void;
  onShortcut: (bt: string, p: BCPProfile) => void;
}

export const ProfileContextMenu = memo(function ProfileContextMenu({
  browsers,
  onOpen,
  onDebugOpen,
  onClose,
  onKillAll,
  onShowCommand,
  onShortcut,
}: ProfileContextMenuProps) {
  const [menu, setMenu] = useState<CtxMenuDetail | null>(null);

  // 接收卡片右键事件
  useEffect(() => {
    const onCtx = (e: Event) => {
      const d = (e as CustomEvent<CtxMenuDetail>).detail;
      if (d) setMenu({ x: d.x, y: d.y, bt: d.bt, p: d.p });
    };
    window.addEventListener(CTX_MENU_EVENT, onCtx);
    return () => window.removeEventListener(CTX_MENU_EVENT, onCtx);
  }, []);

  // 关闭：点击空白 / Esc / 滚轮
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as HTMLElement;
      // 菜单容器 className 为 ctx-menu（见下方渲染）：class 不匹配会导致
      // mousedown 点击菜单项时误判为「点击空白」而关闭菜单，使 click 事件丢失，
      // 表现为「打开/调试打开」不生效且无提示
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

  const { x, y, bt, p } = menu;
  const ctxBrowser = browsers.find(b => b.browser_type === bt);
  const ctxIsDefault = ctxBrowser ? isDefaultUserDir(ctxBrowser, p) : false;
  const ctxIsMain = ctxBrowser ? isMainEntryProfile(ctxBrowser, p) : false;
  // 菜单高度按项数估算（每项约 32px + 上下 padding 8px），与通用 ContextMenu 保持一致
  // 主程序入口：打开主程序（1 项）；默认目录：启动/全部终止/命令/快捷方式（4 项）；
  // 普通：打开/调试打开/关闭/命令/快捷方式（5 项）
  const itemCount = ctxIsMain ? 1 : ctxIsDefault ? 4 : 5;
  const menuHeight = itemCount * 32 + 8;
  const menuStyle = {
    left: Math.max(4, Math.min(x, window.innerWidth - 180)),
    top: Math.max(4, Math.min(y, window.innerHeight - menuHeight)),
  };
  const run = (fn: (bt: string, p: BCPProfile) => void) => {
    setMenu(null);
    fn(bt, p);
  };

  return (
    <div className="ctx-menu" style={menuStyle} onContextMenu={e => e.preventDefault()}>
      {ctxIsMain ? (
        <button
          className="ctx-item"
          onClick={() => run(onOpen)}
          title="打开主程序（浏览器主入口，非可控环境）"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
          打开主程序
        </button>
      ) : ctxIsDefault ? (
        <>
          <button
            className="ctx-item"
            onClick={() => run(onOpen)}
            title={`正常启动「${p.name}」（不带调试端口）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            启动
          </button>
          <button
            className="ctx-item danger"
            onClick={() => run(onKillAll)}
            title={`全部终止「${p.name}」所属浏览器（关闭全部窗口与进程，含独立目录实例）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            全部终止
          </button>
          <button
            className="ctx-item"
            onClick={() => run(onShowCommand)}
            title="获取启动命令（复制 / 启动）"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5M8 3H3v5M3 16v5h5M16 21h5v-5" /><path d="M21 3l-7 7M3 21l7-7" /></svg>
            命令
          </button>
          <button
            className="ctx-item"
            onClick={() => run(onShortcut)}
            title="创建桌面快捷方式"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            快捷方式
          </button>
        </>
      ) : (
        <>
          <button
            className="ctx-item"
            onClick={() => run(onOpen)}
            title={`正常启动「${p.name}」（不带调试端口）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            打开
          </button>
          <button
            className="ctx-item"
            onClick={() => run(onDebugOpen)}
            title={`以随机可用端口调试启动（--remote-debugging-port）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
            调试打开
          </button>
          <button
            className="ctx-item"
            onClick={() => run(onClose)}
            title={`关闭「${p.name}」（只关闭该配置自己的进程）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            关闭
          </button>
          <button
            className="ctx-item"
            onClick={() => run(onShowCommand)}
            title="获取启动命令（复制 / 启动）"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5M8 3H3v5M3 16v5h5M16 21h5v-5" /><path d="M21 3l-7 7M3 21l7-7" /></svg>
            命令
          </button>
          <button
            className="ctx-item"
            onClick={() => run(onShortcut)}
            title="创建桌面快捷方式"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            快捷方式
          </button>
        </>
      )}
    </div>
  );
});
