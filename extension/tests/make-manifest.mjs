/**
 * 生成制品清单：路径、字节数、SHA-256、读回结果。
 * 运行：node tests/make-manifest.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const TARGETS = ["reports", ".agent-handoff/artifacts"];
const OUT = ".agent-handoff/artifacts/manifest.json";

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const entries = [];
for (const t of TARGETS) {
  const base = join(ROOT, t);
  let files = [];
  try {
    files = walk(base);
  } catch {
    continue;
  }
  for (const file of files) {
    if (file.endsWith("manifest.json")) continue;
    const buf = readFileSync(file);
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const entry = {
      path: rel,
      bytes: buf.byteLength,
      sha256: createHash("sha256").update(buf).digest("hex"),
    };
    // 读回：JSON 要能解析，markdown/log 要能按 UTF-8 解码且无替换字符
    if (rel.endsWith(".json")) {
      try {
        const parsed = JSON.parse(buf.toString("utf8"));
        entry.readback = { kind: "json", ok: true, keys: Object.keys(parsed).slice(0, 8) };
      } catch (err) {
        entry.readback = { kind: "json", ok: false, error: String(err.message) };
      }
    } else {
      const text = buf.toString("utf8");
      entry.readback = {
        kind: "text",
        ok: !text.includes("\uFFFD"),
        lines: text.split(/\r?\n/).length,
        head: text.slice(0, 60).replace(/\s+/g, " "),
      };
    }
    entries.push(entry);
  }
}

const manifest = {
  generated_at: new Date().toISOString(),
  root: ROOT,
  count: entries.length,
  entries,
};
mkdirSync(join(ROOT, ".agent-handoff/artifacts"), { recursive: true });
writeFileSync(join(ROOT, OUT), JSON.stringify(manifest, null, 2), "utf8");

console.log(`manifest: ${OUT}`);
console.log(`files: ${entries.length}`);
for (const e of entries) {
  console.log(`  ${e.sha256.slice(0, 12)}  ${String(e.bytes).padStart(8)}  ${e.readback.ok ? "ok " : "BAD"}  ${e.path}`);
}
