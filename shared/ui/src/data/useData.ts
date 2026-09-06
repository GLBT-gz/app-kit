// ============================================================
// useData
//
// 统一前端 localStorage 数据读写 hook。
// 替代旧的 useCache，直接内联以避免对 cache/ 目录的依赖。
// ============================================================

import { useEffect, useState, useCallback } from "react";
import type { DataKeyRef } from "./types";

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* 存储满或受限 */ }
}
function lsRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* 静默失败 */ }
}

function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function deserialize<T>(raw: string | null, keyRef: DataKeyRef<T>): T {
  if (raw === null || raw === undefined) return keyRef.default;
  const defaultVal = keyRef.default;
  if (typeof defaultVal === "number") {
    const n = Number(raw);
    return (isNaN(n) ? defaultVal : n) as unknown as T;
  }
  if (typeof defaultVal === "boolean") {
    return (raw === "true") as unknown as T;
  }
  if (typeof defaultVal === "string") {
    return raw as unknown as T;
  }
  // default 为 null 时（如平台配置），值就是纯字符串，直接返回
  if (defaultVal === null) {
    if (raw === "") return null as unknown as T;
    try { return JSON.parse(raw) as T; } catch { /* 非 JSON 字符串，原样返回 */ }
    return raw as unknown as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return keyRef.default;
  }
}

export function useData<T>(
  keyRef: DataKeyRef<T>,
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = lsGet(keyRef.key);
    if (raw === null) {
      lsSet(keyRef.key, serialize(keyRef.default));
    }
    return deserialize(raw, keyRef);
  });

  const forceUpdate = useCallback(() => {
    setValue(deserialize(lsGet(keyRef.key), keyRef));
  }, [keyRef]);

  // 跨标签页同步（导航/视图类状态可通过 syncCrossTab:false 关闭，各标签页独立）
  useEffect(() => {
    if (keyRef.syncCrossTab === false) return;
    const handler = (e: StorageEvent) => {
      if (e.key === keyRef.key) forceUpdate();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [keyRef.key, keyRef.syncCrossTab, forceUpdate]);

  // 同标签页同步（DataManager 删除数据后通知）
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ key: string }>;
      if (ce.detail?.key === keyRef.key) forceUpdate();
    };
    window.addEventListener("ls-changed", handler);
    return () => window.removeEventListener("ls-changed", handler);
  }, [keyRef.key, forceUpdate]);

  // 全局刷新通知：App 层切 Tab / 后台任务完成时广播，强制重读 localStorage。
  // 兜底覆盖「后台运行时 ls-changed 事件丢失」导致的手动页与自动化数据不同步。
  useEffect(() => {
    const handler = () => forceUpdate();
    window.addEventListener("ls-refresh-all", handler);
    return () => window.removeEventListener("ls-refresh-all", handler);
  }, [forceUpdate]);

  const setAndPersist = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
        lsSet(keyRef.key, serialize(resolved));
        return resolved;
      });
    },
    [keyRef.key],
  );

  const reset = useCallback(() => {
    lsRemove(keyRef.key);
    setValue(keyRef.default);
  }, [keyRef]);

  return [value, setAndPersist, reset];
}
