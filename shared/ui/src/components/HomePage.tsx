import { useRef, useLayoutEffect, type ReactNode } from "react";

export interface HomePageCard {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  action: "navigate" | "openSettings";
}

export interface HomePageProps {
  title: string;
  subtitle?: string;
  cards: HomePageCard[];
  onNavigate: (tab: string) => void;
  onOpenSettings: (tab: string) => void;
}

export function HomePage({ title, subtitle, cards, onNavigate, onOpenSettings }: HomePageProps) {
  const cardsRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = cardsRef.current;
    if (!el || cards.length === 0) return;

    const measure = () => {
      // 解除固定宽度，让自然布局生效
      el.style.width = "";
      // 强制同步 reflow，确保宽度重置已生效
      void el.offsetWidth;

      const items = Array.from(el.children) as HTMLElement[];
      if (items.length === 0) return;

      // top 值相同的卡片为同一行
      const firstTop = items[0].getBoundingClientRect().top;
      let lastInFirstRow = 0;
      for (let i = 1; i < items.length; i++) {
        if (Math.abs(items[i].getBoundingClientRect().top - firstTop) > 1) break;
        lastInFirstRow = i;
      }

      // 第一行宽度 = 最左到最右
      const left = items[0].getBoundingClientRect().left;
      const right = items[lastInFirstRow].getBoundingClientRect().right;
      el.style.width = `${right - left}px`;
    };

    // 同步测量：在浏览器首次绘制前锁定宽度，消除右移
    measure();

    // 用 ResizeObserver 监听父容器，处理窗口缩放
    const parent = el.parentElement;
    const ro = parent ? new ResizeObserver(measure) : null;
    if (ro && parent) ro.observe(parent);

    return () => {
      if (ro) ro.disconnect();
    };
  }, [cards.length]);

  return (
    <div className="main-content">
      <div className="home-panel">
        <div className="home-header">
          <h1>{title}</h1>
          {subtitle && <p className="home-subtitle">{subtitle}</p>}
        </div>
        <div ref={cardsRef} className="home-cards">
          {cards.map(card => (
            <div
              key={card.id}
              className="home-card"
              onClick={() => {
                if (card.action === "navigate") onNavigate(card.id);
                else onOpenSettings(card.id);
              }}
              tabIndex={0}
              role="button"
              onKeyDown={e => {
                if (e.key === "Enter") {
                  if (card.action === "navigate") onNavigate(card.id);
                  else onOpenSettings(card.id);
                }
              }}
            >
              <div className="home-card-icon">{card.icon}</div>
              <div className="home-card-title">{card.title}</div>
              <div className="home-card-desc">{card.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
