import type { ZiniaoAgentBrowser } from "../../ziniao-api";

/**
 * 紫鸟店铺列表表格（公共组件）
 *
 * 展示店铺名称/平台/browserId/登录账号/运行状态，并提供
 * 打开/关闭/CDP 验证操作按钮与截图预览。
 * 状态与操作由外部受控，适合嵌入自动化主界面与测试页。
 */
export interface ZiniaoStoreListProps {
  shops: ZiniaoAgentBrowser[];
  /** 已打开的环境 browserId 集合 */
  running: Set<number>;
  /** 全局忙碌标记（操作进行中禁用按钮） */
  busy: boolean;
  /** 各店铺截图 base64 缓存（browserId -> png base64） */
  shots: Record<string, string>;
  /** 各店铺操作状态文案（browserId -> 文案） */
  shopState: Record<string, string>;
  onOpen: (shop: ZiniaoAgentBrowser) => void;
  onClose: (shop: ZiniaoAgentBrowser) => void;
  onCdp: (shop: ZiniaoAgentBrowser) => void;
}

export function ZiniaoStoreList(props: ZiniaoStoreListProps) {
  const { shops, running, busy, shots, shopState, onOpen, onClose, onCdp } = props;

  return (
    <table className="zn-table">
      <thead>
        <tr>
          <th style={{ width: 180 }}>店铺</th>
          <th style={{ width: 90 }}>平台</th>
          <th style={{ width: 120 }}>browserId</th>
          <th style={{ width: 170 }}>登录账号</th>
          <th style={{ width: 76 }}>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {shops.map((s) => {
          const on = running.has(s.browserId);
          return (
            <tr key={s.browserId}>
              <td>
                <div style={{ fontWeight: 600 }}>{s.browserName}</div>
                <div style={{ opacity: 0.6, fontSize: 11 }}>{s.browserIp}</div>
              </td>
              <td>{s.platform_name}</td>
              <td className="mono">{s.browserId}</td>
              <td style={{ fontSize: 11 }}>{s.store_username}</td>
              <td>
                <span className={`zn-shop-state ${on ? "on" : "off"}`}>
                  {on ? "● 已打开" : "○ 未打开"}
                </span>
              </td>
              <td>
                <div className="zn-shop-ops">
                  {on ? (
                    <button className="zn-btn danger" disabled={busy} onClick={() => onClose(s)}>
                      关闭
                    </button>
                  ) : (
                    <button className="zn-btn" disabled={busy} onClick={() => onOpen(s)}>
                      打开
                    </button>
                  )}
                  <button className="zn-btn" disabled={busy} onClick={() => onCdp(s)}>
                    CDP 验证
                  </button>
                  <span className="zn-hint">{shopState[String(s.browserId)] ?? ""}</span>
                </div>
                {shots[String(s.browserId)] && (
                  <div className="zn-shot">
                    <img
                      src={`data:image/png;base64,${shots[String(s.browserId)]}`}
                      alt={s.browserName}
                    />
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
