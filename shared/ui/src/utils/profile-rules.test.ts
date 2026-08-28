// ============================================================
//  profile-rules 单测：三档受限规则 / key 生成 / 目录显示名
//
//  三档规则源自踩坑记录 2026-08-19 的实测结论：
//    默认路径 = 完全受限（不可自动化）
//    同 user-data-dir 多用户 = 部分受限（单实例锁）
//    单用户目录 = 完全可用
// ============================================================

import { describe, it, expect } from "vitest";
import {
  mkKey,
  isDefaultUserDir,
  isMultiUserDir,
  isZiniaoMain,
  countProfilesPerDir,
  getSortGroup,
  getDirDisplayName,
} from "./profile-rules";
import type { BCPBrowser, BCPProfile } from "../components/BrowserConfigPanel";

function makeBrowser(overrides: Partial<BCPBrowser> = {}): BCPBrowser {
  return {
    browser_type: "chrome",
    browser_name: "Google Chrome",
    exe_paths: [],
    user_data_dirs: [],
    default_user_data_dir: "C:\\browsers\\chrome\\User Data",
    ...overrides,
  } as unknown as BCPBrowser;
}

function makeProfile(overrides: Partial<BCPProfile> = {}): BCPProfile {
  return {
    id: "Default",
    name: "Default",
    user_data_dir: "D:\\custom\\user01",
    ...overrides,
  };
}

describe("mkKey", () => {
  it("由 browserType|user_data_dir|id 组成", () => {
    expect(mkKey("edge", { user_data_dir: "D:\\x", id: "P1" })).toBe("edge|D:\\x|P1");
  });

  it("user_data_dir 含分隔符时不做转义（原样拼接）", () => {
    expect(mkKey("bt", { user_data_dir: "D:\\a|b", id: "i" })).toBe("bt|D:\\a|b|i");
  });
});

describe("isDefaultUserDir", () => {
  const b = makeBrowser();

  it("profile 目录等于默认目录 → true", () => {
    expect(isDefaultUserDir(b, makeProfile({ user_data_dir: b.default_user_data_dir }))).toBe(true);
  });

  it("profile 目录不同 → false", () => {
    expect(isDefaultUserDir(b, makeProfile({ user_data_dir: "D:\\custom\\u1" }))).toBe(false);
  });

  it("浏览器无默认目录 → false", () => {
    expect(isDefaultUserDir(makeBrowser({ default_user_data_dir: undefined }), makeProfile())).toBe(false);
  });

  it.each(["edecker", "ziniao"])("%s 的默认路径视为可用主配置 → false", (bt) => {
    const special = makeBrowser({ browser_type: bt });
    expect(isDefaultUserDir(special, makeProfile({ user_data_dir: b.default_user_data_dir }))).toBe(false);
  });
});

describe("isMultiUserDir", () => {
  const b = makeBrowser();
  const dir = "D:\\shared";
  const counts = { [dir]: 3 };

  it("同目录多用户 → true", () => {
    expect(isMultiUserDir(b, makeProfile({ user_data_dir: dir }), counts)).toBe(true);
  });

  it("单用户目录 → false", () => {
    expect(isMultiUserDir(b, makeProfile(), { [makeProfile().user_data_dir]: 1 })).toBe(false);
  });

  it("未提供 counts → false", () => {
    expect(isMultiUserDir(b, makeProfile({ user_data_dir: dir }))).toBe(false);
  });

  it("默认路径优先判定为受限，不算多用户目录", () => {
    const p = makeProfile({ user_data_dir: b.default_user_data_dir! });
    expect(isMultiUserDir(b, p, { [p.user_data_dir]: 5 })).toBe(false);
  });

  it.each(["edecker", "ziniao"])("%s 不适用多用户限制", (bt) => {
    const special = makeBrowser({ browser_type: bt });
    expect(isMultiUserDir(special, makeProfile({ user_data_dir: dir }), counts)).toBe(false);
  });
});

describe("countProfilesPerDir", () => {
  it("按 user_data_dir 计数", () => {
    const counts = countProfilesPerDir([
      makeProfile({ user_data_dir: "D:\\a" }),
      makeProfile({ id: "P2", user_data_dir: "D:\\a" }),
      makeProfile({ user_data_dir: "D:\\b" }),
    ]);
    expect(counts).toEqual({ "D:\\a": 2, "D:\\b": 1 });
  });

  it("空列表 → 空对象", () => {
    expect(countProfilesPerDir([])).toEqual({});
  });
});

describe("isZiniaoMain", () => {
  const ziniao = makeBrowser({ browser_type: "ziniao" });

  it("紫鸟 id=Default → true", () => {
    expect(isZiniaoMain(ziniao, makeProfile({ id: "Default" }))).toBe(true);
  });

  it("紫鸟环境（id=containerId）→ false", () => {
    expect(isZiniaoMain(ziniao, makeProfile({ id: "12345678" }))).toBe(false);
  });

  it("非紫鸟 → false", () => {
    expect(isZiniaoMain(makeBrowser(), makeProfile({ id: "Default" }))).toBe(false);
  });
});

describe("getSortGroup", () => {
  const b = makeBrowser();
  const ziniao = makeBrowser({ browser_type: "ziniao" });
  const sharedCounts = { "D:\\shared": 2 };

  it("紫鸟主程序入口 → 0（排最前）", () => {
    expect(getSortGroup(ziniao, makeProfile({ id: "Default", user_data_dir: ziniao.default_user_data_dir! }), sharedCounts)).toBe(0);
  });

  it("紫鸟环境 → 2（非默认路径）", () => {
    expect(getSortGroup(ziniao, makeProfile({ id: "123", user_data_dir: "D:\\env\\chrome_123" }), sharedCounts)).toBe(2);
  });

  it("默认路径 → 0（最前）", () => {
    expect(getSortGroup(b, makeProfile({ user_data_dir: b.default_user_data_dir! }), sharedCounts)).toBe(0);
  });

  it("多用户目录 → 1（其次）", () => {
    expect(getSortGroup(b, makeProfile({ user_data_dir: "D:\\shared" }), sharedCounts)).toBe(1);
  });

  it("单用户目录 → 2（最后）", () => {
    expect(getSortGroup(b, makeProfile(), sharedCounts)).toBe(2);
  });
});

describe("getDirDisplayName", () => {
  it("取父目录\\目录名", () => {
    expect(getDirDisplayName("D:\\browsers\\user01")).toBe("browsers\\user01");
  });

  it("支持正斜杠路径", () => {
    expect(getDirDisplayName("D:/browsers/user01")).toBe("browsers\\user01");
  });

  it("末尾分隔符先归一化再截取", () => {
    expect(getDirDisplayName("D:\\browsers\\user01\\")).toBe("browsers\\user01");
  });

  it("无父目录时返回原名", () => {
    expect(getDirDisplayName("user01")).toBe("user01");
  });
});
