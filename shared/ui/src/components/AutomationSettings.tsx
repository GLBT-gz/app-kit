import type { ReactNode } from "react";
import { PlatformConfigPanel } from "./PlatformConfigPanel";
import type { BrowserOption } from "./PlatformConfigPanel";

export interface AutomationSettingsProps {
  /** 浏览器配置选项（来自 CurrentBrowserCards 多选结果） */
  platformOptions: BrowserOption[];
  /** 已选卡片数（用于状态提示） */
  selectedCardCount: number;
  /** 最少需要几个卡片，默认 2 */
  minCards?: number;
  /** 凭证管理区域（项目自定义） */
  children?: ReactNode;
}

/**
 * 当前自动化设置面板。
 *
 * 各子项目只需：
 * 1. 调用 `registerPlatforms([...])` 声明平台
 * 2. 传入 `platformOptions` 和 `selectedCardCount`
 * 3. 通过 `children` 注入项目特定的凭证表单
 *
 * 示例：
 * ```tsx
 * <AutomationSettings platformOptions={platformOptions} selectedCardCount={selectedCardKeys.length}>
 *   <CredentialsForm groups={myGroups} loadCredentials={...} saveCredentials={...} />
 * </AutomationSettings>
 * ```
 */
export function AutomationSettings({ platformOptions, selectedCardCount, minCards = 2, children }: AutomationSettingsProps) {
  const enough = selectedCardCount >= minCards;

  return (
    <>
      <div className="automation-status">
        <span className="automation-status-text">
          {`请先在「当前浏览器配置」中勾选至少 ${minCards} 个浏览器配置`}
        </span>
        <span className={`automation-status-icon ${enough ? "ok" : "warn"}`}>
          {enough ? "✓" : "⚠"}
        </span>
      </div>
      {!enough && (
        <div className="automation-hint">当前勾选 {selectedCardCount} 个，至少需要 {minCards} 个</div>
      )}
      <PlatformConfigPanel options={platformOptions} />
      {!enough && (
        <div className="platform-hint" style={{ padding: "8px 28px 0" }}>请先在上方勾选至少 {minCards} 个浏览器配置</div>
      )}
      <div style={{ padding: "0 28px" }}>
        {children}
        {enough && <div style={{ height: 20 }} />}
      </div>
    </>
  );
}
