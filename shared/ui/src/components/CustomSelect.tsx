import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** 下拉选项（key 唯一） */
export interface CustomSelectOption {
  key: string;
  displayName: string;
}

/**
 * CustomSelect —— 自定义单选框（portal + position:fixed，完全脱离父容器限制）。
 * 收敛 app-kit PlatformConfigPanel 私有实现与 002/003 各项目 ui.tsx 的重复实现；
 * 相比旧版增加 RAF 合并滚动定位更新。样式沿用本地类名 custom-select*。
 */
export function CustomSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: CustomSelectOption[];
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

  const selected = options.find(o => o.key === value);

  return (
    <div className="custom-select" ref={triggerRef}>
      <div className="custom-select-trigger" onClick={() => setOpen(v => !v)} tabIndex={0}
        aria-expanded={open}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(v => !v); } }}>
        <span className={`custom-select-value${selected ? "" : " placeholder"}`}>
          {selected ? selected.displayName : (placeholder || "选择配置")}
        </span>
        <span className={`custom-select-arrow${open ? " open" : ""}`}>▼</span>
      </div>
      {open && createPortal(
        <div className="custom-select-dropdown" ref={dropdownRef}>
          {options.length === 0 ? (
            <div className="custom-select-option disabled">暂无可用配置</div>
          ) : (
            options.map(opt => (
              <div key={opt.key}
                className={`custom-select-option${opt.key === value ? " active" : ""}`}
                onClick={() => { onChange(opt.key); setOpen(false); }}>
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

/**
 * CustomMultiSelect —— 自定义多选框（002 版：custom-select-dropdown + multi-select-all 全选行）。
 * 样式沿用本地类名 custom-select / multi-select-all。
 */
export function CustomMultiSelect({
  options,
  values,
  onChange,
  placeholder,
}: {
  options: CustomSelectOption[];
  values: string[];
  onChange: (keys: string[]) => void;
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
    const handle = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = () => {
      if (!triggerRef.current || !dropdownRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      dropdownRef.current.style.top = `${rect.bottom + 4}px`;
      dropdownRef.current.style.left = `${rect.left}px`;
      dropdownRef.current.style.width = `${rect.width}px`;
    };
    document.addEventListener("mousedown", handle);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handle);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const toggle = (key: string) => {
    if (values.includes(key)) {
      onChange(values.filter(k => k !== key));
    } else {
      onChange([...values, key]);
    }
  };

  const selectedLabels = options.filter(o => values.includes(o.key)).map(o => o.displayName);
  const displayText = selectedLabels.length === 0
    ? (placeholder || "选择...")
    : selectedLabels.length === 1
      ? selectedLabels[0]
      : `已选 ${selectedLabels.length} 项`;

  return (
    <div className="custom-select" ref={triggerRef}>
      <div className="custom-select-trigger" onClick={() => setOpen(v => !v)} tabIndex={0}
        aria-expanded={open}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(v => !v); } }}>
        <span className={`custom-select-value${selectedLabels.length === 0 ? " placeholder" : ""}`}>
          {displayText}
        </span>
        <span className={`custom-select-arrow${open ? " open" : ""}`}>▼</span>
      </div>
      {open && createPortal(
        <div className="custom-select-dropdown" ref={dropdownRef}>
          {options.length === 0 ? (
            <div className="custom-select-option disabled">暂无可用选项</div>
          ) : (
            <>
              <div className="custom-select-option multi-select-all"
                onClick={() => onChange(values.length === options.length ? [] : options.map(o => o.key))}>
                <input type="checkbox" readOnly checked={values.length === options.length && options.length > 0} />
                <span>全选 / 取消</span>
              </div>
              {options.map(opt => (
                <div key={opt.key}
                  className={`custom-select-option${values.includes(opt.key) ? " active" : ""}`}
                  onClick={() => toggle(opt.key)}>
                  <input type="checkbox" readOnly checked={values.includes(opt.key)} />
                  <span>{opt.displayName}</span>
                </div>
              ))}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * MultiSelect —— 自定义多选框（003 版：multi-select-dropdown + 全选/清空 actions）。
 * 样式沿用本地类名 custom-select / multi-select-*。
 */
export function MultiSelect({
  options,
  values,
  onChange,
  placeholder,
}: {
  options: CustomSelectOption[];
  values: string[];
  onChange: (keys: string[]) => void;
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
      dropdownRef.current.style.width = `${Math.max(rect.width, 200)}px`;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = () => {
      if (!triggerRef.current || !dropdownRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      dropdownRef.current.style.top = `${rect.bottom + 4}px`;
      dropdownRef.current.style.left = `${rect.left}px`;
      dropdownRef.current.style.width = `${Math.max(rect.width, 200)}px`;
    };
    document.addEventListener("mousedown", handle);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handle);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const toggle = (key: string) => {
    if (values.includes(key)) {
      onChange(values.filter(v => v !== key));
    } else {
      onChange([...values, key]);
    }
  };

  const displayText = values.length === 0
    ? (placeholder || "选择店铺...")
    : values.length === 1
      ? options.find(o => o.key === values[0])?.displayName || values[0]
      : `已选 ${values.length} 个店铺`;

  return (
    <div className="custom-select" ref={triggerRef}>
      <div className="custom-select-trigger" onClick={() => setOpen(v => !v)} tabIndex={0}
        aria-expanded={open}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(v => !v); } }}>
        <span className={`custom-select-value${values.length === 0 ? " placeholder" : ""}`}>
          {displayText}
        </span>
        <span className={`custom-select-arrow${open ? " open" : ""}`}>▼</span>
      </div>
      {open && createPortal(
        <div className="multi-select-dropdown" ref={dropdownRef}>
          {options.length === 0 ? (
            <div className="custom-select-option disabled">暂无可用配置</div>
          ) : (
            <>
              <div className="multi-select-actions">
                <span className="multi-select-action" onClick={() => onChange(options.map(o => o.key))}>全选</span>
                <span className="multi-select-action" onClick={() => onChange([])}>清空</span>
              </div>
              {options.map(opt => (
                <label key={opt.key} className="multi-select-option">
                  <input type="checkbox" checked={values.includes(opt.key)}
                    onChange={() => toggle(opt.key)} />
                  <span>{opt.displayName}</span>
                </label>
              ))}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
