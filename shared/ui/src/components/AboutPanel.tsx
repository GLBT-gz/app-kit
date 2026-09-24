import { useState, useEffect, useRef } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { installVersion, getDataDirectory, getInstallDirectory, openDir } from "../api";
import { appIdToDir, nasBaseDir } from "../data/nas-app-id";
import { Button } from "./controls/Button";

interface VersionEntry {
  version: string;
  notes: string;
  pub_date: string;
  url: string;
  signature: string;
  /** SMB 直读路径（ca72113b release 重构后引入；旧版本可缺省回退 url） */
  smb_path?: string;
}

function formatDate(isoStr: string): string {
  const m = isoStr.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  return isoStr.slice(0, 19);
}

interface AboutPanelProps {
  appId?: string;
  appName?: string;
}

export function AboutPanel({ appId = "template", appName = "GLBT" }: AboutPanelProps) {
  const [appVersion, setAppVersion] = useState("—");
  const [dataDir, setDataDir] = useState("");
  const [installDir, setInstallDir] = useState("");
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [versionsErr, setVersionsErr] = useState<string>("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);
  const [resultMsg, setResultMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const v = await getVersion();
        setAppVersion(v);
      } catch { setAppVersion("0.1.0"); }
      try { setDataDir(await getDataDirectory()); } catch {}
      try { setInstallDir(await getInstallDirectory()); } catch {}
    })();
    fetchVersions();
  }, []);

  const fetchVersions = async () => {
    try {
      const text = await invoke<string>("fetch_versions");
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        setVersions(data);
      } else {
        setVersionsErr("返回非数组: " + String(text).slice(0, 200));
      }
    } catch (e: any) {
      setVersionsErr("fetch_versions ERR: " + String(e?.message || e));
    }
  };

  const doDownload = async (v: VersionEntry) => {
    setInstalling(v.version);
    setResultMsg(null);
    setDownloadPercent(0);
    setIsDownloading(true);
    try {
      const nameClean = appName.replace(/[^a-zA-Z\u4e00-\u9fff0-9]+/g, "-").replace(/^-|-$/g, "");
      // 默认文件名直接取安装包原名（versions.json 的 url 最后一段），
      // 与发布流程「安装包保持打包原名」一致，避免硬编码前缀导致命名不一致
      const urlName = (v.smb_path || v.url).split(/[\\/]/).pop();
      const defaultName = urlName ? decodeURIComponent(urlName) : `${nameClean}-${v.version}-x64-setup.exe`;
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: "安装程序", extensions: ["exe"] }],
      });
      if (!savePath) { setInstalling(null); setIsDownloading(false); return; }

      const unlisten = await listen<{downloaded: number; total: number; percent: number}>("download-progress", (event) => {
        setDownloadPercent(event.payload.percent);
      });
      unlistenRef.current = unlisten;

      const result = await installVersion(v.url, savePath);
      setDownloadPercent(100);

      setResultMsg({
        type: "success",
        text: `文件已保存到：\n${result}`,
      });
      setSavedPath(result);
    } catch (e: any) {
      setResultMsg({ type: "error", text: `下载失败：${String(e?.message || e)}` });
    }
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    setInstalling(null);
    setIsDownloading(false);
  };

  return (
    <div className="about-panel">
      <h2 className="about-title">关于 {appName}</h2>
      <div className="about-section">
        <div className="about-info-row">
          <span className="about-label">应用标识</span>
          <span className="about-value"><code>{appId}</code></span>
        </div>
        <div className="about-info-row">
          <span className="about-label">当前版本</span>
          <span className="about-value">{appVersion}</span>
        </div>
        <div className="about-info-row">
          <span className="about-label">更新来源</span>
          <span className="about-value">
            <code>\\Nas2025\Rpa数据\#软件发行\{appIdToDir(appId)}</code>
            <Button
              size="sm"
              style={{ marginLeft: 8 }}
              onClick={async () => {
                setOpenErr(null);
                try {
                  await openDir(`${nasBaseDir}\\${appIdToDir(appId)}`);
                } catch (e: any) {
                  setOpenErr(`打开更新来源失败：${String(e?.message || e)}`);
                }
              }}
            >
              打开
            </Button>
          </span>
        </div>
        {installDir && (
          <div className="about-info-row">
            <span className="about-label">安装目录</span>
            <span className="about-value">
              <code style={{ fontSize: 11 }} className="selectable">{installDir}</code>
              <Button
                size="sm"
                style={{ marginLeft: 8 }}
                onClick={async () => {
                  setOpenErr(null);
                  try {
                    await openDir(installDir);
                  } catch (e: any) {
                    setOpenErr(`打开安装目录失败：${String(e?.message || e)}`);
                  }
                }}
              >
                打开
              </Button>
            </span>
          </div>
        )}
        {dataDir && (
          <div className="about-info-row">
            <span className="about-label">数据目录</span>
            <span className="about-value">
              <code style={{ fontSize: 11 }} className="selectable">{dataDir}</code>
              <Button
                size="sm"
                style={{ marginLeft: 8 }}
                onClick={async () => {
                  setOpenErr(null);
                  try {
                    await openDir(dataDir);
                  } catch (e: any) {
                    setOpenErr(`打开数据目录失败：${String(e?.message || e)}`);
                  }
                }}
              >
                打开
              </Button>
            </span>
          </div>
        )}
        {openErr && (
          <div style={{ fontSize: 12, color: "var(--error-color, #d4453d)", marginTop: 8 }}>
            {openErr}
          </div>
        )}
      </div>

      {resultMsg && (
        <div className="about-section about-update-result">
          <div className={`about-update-badge ${resultMsg.type === "error" ? "about-up-to-date" : ""}`}>
            {resultMsg.type === "success" ? "下载完成" : "下载失败"}
          </div>
          <div style={{ fontSize: 12, whiteSpace: "pre-wrap", margin: "8px 0 0", lineHeight: 1.6, color: "var(--text-primary)" }}>
            {resultMsg.text}
          </div>
          {resultMsg.type === "success" && savedPath && (
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <Button
                onClick={async () => {
                  try {
                    await openDir(savedPath);
                  } catch (e: any) {
                    setResultMsg({ type: "error", text: `运行安装包失败：${String(e?.message || e)}` });
                  }
                }}
              >
                运行安装包
              </Button>
              <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center" }}>
                运行后将自动安装，请先关闭当前程序
              </span>
            </div>
          )}
        </div>
      )}

      {/* 下载进度条 */}
      {isDownloading && (
        <div className="about-section" style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>正在下载...</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--accent-color)" }}>{downloadPercent}%</span>
          </div>
          <div style={{
            width: "100%",
            height: 8,
            background: "var(--bg-tertiary)",
            borderRadius: 4,
            overflow: "hidden",
          }}>
            <div style={{
              width: `${downloadPercent}%`,
              height: "100%",
              background: "var(--accent-color)",
              borderRadius: 4,
              transition: "width 0.3s ease",
            }} />
          </div>
        </div>
      )}

      <h3 className="about-section-title">版本历史</h3>
      <div className="about-section about-history">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>点击「下载此版本」选择保存路径</span>
          <Button size="sm" onClick={fetchVersions} style={{ marginLeft: "auto" }}>
            刷新列表
          </Button>
        </div>
        {versions.length === 0 ? (
          <div className="about-history-empty">
              {versionsErr ? `错误: ${versionsErr}` : "暂无版本记录（服务器未开启或网络不可达）"}
            </div>
        ) : (
          versions.map((v) => {
            const isCurrent = v.version === appVersion;
            return (
              <div key={v.version} className={`about-history-item ${isCurrent ? "current" : ""}`}>
                <div className="about-history-top">
                  <span className="about-history-version">{v.version}</span>
                  {isCurrent && <span className="about-history-badge">当前版本</span>}
                  <span className="about-history-date">{formatDate(v.pub_date)}</span>
                </div>
                {v.notes && <p className="about-history-notes">{v.notes}</p>}
                <Button
                  size="sm"
                  className="about-history-btn"
                  onClick={() => doDownload(v)}
                  disabled={installing === v.version || isDownloading}
                >
                  {installing === v.version ? "下载中…" : isCurrent ? "重新下载" : "下载此版本"}
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
