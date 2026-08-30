// app-kit/scripts/check-isolation.mjs
// 隔离门禁：扫描 appkit 代码中的公司平台名词。代码命中 => exit 1。
// 用法: node scripts/check-isolation.mjs [--strict] [--json]
//   --strict  文档命中也算失败
//   --json    输出机器可读结果
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');
const AS_JSON = process.argv.includes('--json');

// 公司平台名词。英文用词边界避免误报（如 edecker 含 deck、dxm 易撞随机串），中文直接匹配。
const WORD_PATTERNS = [
  'ziniao', 'ziniaobrowser', 'temu', 'dianxiaomi', 'dxm',
  'haiduoke', 'mabang', 'baishi', 'yuancang', 'kdocs',
  'edecker', 'yideke', 'glbt_core',
];
const RAW_PATTERNS = [
  '紫鸟', '店小秘', '海多客', '马帮', '百世', '元仓', '金山文档', '365.kdocs.cn',
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const RE = new RegExp(
  [...WORD_PATTERNS.map((w) => `\\b${w}\\b`), ...RAW_PATTERNS.map(escapeRe)].join('|'),
  'i'
);

const CODE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs', '.toml', '.css'];
const DOC_EXT = ['.md', '.json', '.yaml', '.yml'];
const IGNORE_DIRS = ['node_modules', 'target', '.git', 'dist', 'build', '.next', 'gen'];
// 允许豁免的具体文件（相对 ROOT，用 / 分隔）
const IGNORE_PATHS = [
  // 'shared/ui/src/utils/profile-rules.test.ts',
];

function classify(rel) {
  if (IGNORE_PATHS.includes(rel)) return null;
  const ext = path.extname(rel).toLowerCase();
  if (CODE_EXT.includes(ext)) return 'code';
  if (DOC_EXT.includes(ext)) return 'doc';
  return null;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (IGNORE_DIRS.includes(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (e.isFile()) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

const buckets = { code: [], doc: [] };
for (const abs of walk(ROOT)) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const kind = classify(rel);
  if (!kind) continue;
  let text;
  try {
    text = fs.readFileSync(abs, 'utf-8');
  } catch {
    continue;
  }
  const hits = [];
  text.split('\n').forEach((line, i) => {
    const m = line.match(RE);
    if (m) hits.push({ line: i + 1, word: m[0], text: line.trim().slice(0, 160) });
  });
  if (hits.length) buckets[kind].push({ file: rel, hits });
}

const codeHits = buckets.code.reduce((n, f) => n + f.hits.length, 0);
const docHits = buckets.doc.reduce((n, f) => n + f.hits.length, 0);

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        codeFiles: buckets.code.length,
        codeHits,
        docFiles: buckets.doc.length,
        docHits,
        detail: buckets,
      },
      null,
      2
    )
  );
} else {
  console.log('=== CODE (硬门禁) ===');
  for (const f of buckets.code) {
    console.log(`\n${f.file}  (${f.hits.length})`);
    for (const h of f.hits) console.log(`  ${h.line}: [${h.word}] ${h.text}`);
  }
  console.log('\n=== DOCS (提示) ===');
  for (const f of buckets.doc) console.log(`  ${f.file}  (${f.hits.length})`);
  console.log(`\n代码: ${buckets.code.length} 文件 / ${codeHits} 处`);
  console.log(`文档: ${buckets.doc.length} 文件 / ${docHits} 处`);
}

if (codeHits > 0) {
  console.error(`\n❌ 代码中存在公司名词（${codeHits} 处），不符合开源标准`);
  process.exit(1);
}
if (STRICT && docHits > 0) {
  console.error(`\n❌ --strict: 文档中存在公司名词（${docHits} 处）`);
  process.exit(1);
}
console.log('\n✅ 隔离检查通过');
