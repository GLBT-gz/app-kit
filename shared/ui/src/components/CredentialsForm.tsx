import { useCallback, useEffect, useRef, useState } from "react";

// ── 类型定义 ──

export interface CredentialField {
  /** 字段名（唯一标识） */
  name: string;
  /** 显示标签 */
  label: string;
  /** placeholder */
  placeholder: string;
  /** input type，默认 "text" */
  type?: string;
  /** 可选校验 */
  validator?: (v: string) => boolean;
}

export interface CredentialGroup {
  /** 组标题 */
  title: string;
  /** 该组包含的字段 */
  fields: CredentialField[];
}

export interface CredentialsFormProps {
  /** 各平台凭证组 */
  groups: CredentialGroup[];
  /** 加载已保存的凭证，返回所有字段的值 */
  loadCredentials: () => Promise<Record<string, string>>;
  /** 保存凭证 */
  saveCredentials: (values: Record<string, string>) => Promise<void>;
  /** 标题 */
  title?: string;
  /** 说明文字 */
  note?: string;
}

type FieldStatus = "idle" | "saving" | "saved";

// ── 内部辅助：单组字段卡片 ──

function CredsCard(props: {
  title: string;
  fields: CredentialField[];
  fieldStatus: Record<string, FieldStatus>;
  values: Record<string, string>;
  onValueChange: (name: string, value: string) => void;
}) {
  return (
    <div className="creds-card">
      <div className="creds-card-title">{props.title}</div>
      {props.fields.map(f => (
        <div className="creds-field" key={f.name}>
          <span className="creds-label">{f.label}</span>
          <input
            className={
              "creds-input" +
              (f.validator && props.values[f.name] && !f.validator(props.values[f.name])
                ? " creds-input-invalid"
                : "")
            }
            type={f.type || "text"}
            placeholder={f.placeholder}
            value={props.values[f.name] || ""}
            onChange={e => props.onValueChange(f.name, e.target.value)}
          />
          <CredsStatus status={props.fieldStatus[f.name]} />
        </div>
      ))}
    </div>
  );
}

function CredsStatus({ status }: { status?: FieldStatus }) {
  if (status === "saving") return <span className="creds-status creds-status-saving">⟳</span>;
  if (status === "saved") return <span className="creds-status creds-status-saved">✓</span>;
  return null;
}

const DEFAULT_NOTE = "账号密码将通过 AES-256-GCM 加密后存储在本地，不会上传到任何服务器。";

/**
 * CredentialsForm —— 通用凭证管理表单，收敛 002/003/006/007 各项目重复实现。
 * 各子项目通过 groups 声明需要哪些平台和字段，
 * 通过 loadCredentials / saveCredentials 注入项目特定的读写逻辑。
 * 样式沿用本地类名 creds-*（共享 components.css 已含权威样式）。
 */
export function CredentialsForm({ groups, loadCredentials, saveCredentials, title, note }: CredentialsFormProps) {
  const [loaded, setLoaded] = useState(false);
  const [fieldStatus, setFieldStatus] = useState<Record<string, FieldStatus>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const valuesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  useEffect(() => {
    if (loaded) return;
    loadCredentials()
      .then(creds => {
        const init: Record<string, FieldStatus> = {};
        Object.entries(creds).forEach(([k, v]) => {
          if (v) init[k] = "saved";
        });
        setFieldStatus(init);
        setValues(creds);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [loaded, loadCredentials]);

  const doSave = useCallback(async () => {
    const v = valuesRef.current;
    const saving: Record<string, FieldStatus> = {};
    Object.keys(v).forEach(k => {
      saving[k] = "saving";
    });
    setFieldStatus(prev => ({ ...prev, ...saving }));
    try {
      await saveCredentials(v);
      const saved: Record<string, FieldStatus> = {};
      Object.keys(v).forEach(k => {
        saved[k] = "saved";
      });
      setFieldStatus(prev => ({ ...prev, ...saved }));
    } catch {
      const idle: Record<string, FieldStatus> = {};
      Object.keys(v).forEach(k => {
        idle[k] = "idle";
      });
      setFieldStatus(prev => ({ ...prev, ...idle }));
    }
  }, [saveCredentials]);

  const onValueChange = (name: string, value: string) => {
    setValues(prev => ({ ...prev, [name]: value }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(doSave, 500);
  };

  return (
    <>
      <div className="creds-section">
        {title && <div className="creds-section-title">{title}</div>}
        <div className="creds-note">{note || DEFAULT_NOTE}</div>
      </div>
      <div className="creds-cards">
        {groups.map(g => (
          <CredsCard
            key={g.title}
            title={g.title}
            fields={g.fields}
            fieldStatus={fieldStatus}
            values={values}
            onValueChange={onValueChange}
          />
        ))}
      </div>
    </>
  );
}
