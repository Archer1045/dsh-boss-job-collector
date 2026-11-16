/**
 * 二期单元测试（不联网、不需要浏览器）。
 * 运行：node tests/v2-unit.mjs
 */
import { readFileSync } from "node:fs";
import { extractSkills, summarizeSkills } from "../../src/skills.js";
import {
  MAX_DETAIL_CHARS,
  normalizeCjk,
  normalizeTitle,
  titleMatches,
  truncateDescription,
} from "../../src/detail.js";

const src = readFileSync(new URL("../src/boss-adapter.js", import.meta.url), "utf8");
new Function(src)();
const A = globalThis.BossAdapter;

let pass = 0;
let fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`FAIL  ${name}  -> ${err.message}`);
    fail += 1;
  }
}

console.log(`# 二期单元测试  ${new Date().toISOString()}`);
console.log("");

// --- 薪资结构化 ---
check("parseSalaryBounds 月薪区间", () => {
  const got = A.parseSalaryBounds("20-30K");
  if (!eq(got, { min: 20, max: 30, unit: "月薪" })) throw new Error(JSON.stringify(got));
});

check("parseSalaryBounds 15 薪单独成组", () => {
  const got = A.parseSalaryBounds("40-70K·15薪");
  if (!eq(got, { min: 40, max: 70, unit: "月薪·15薪" })) throw new Error(JSON.stringify(got));
});

check("parseSalaryBounds 日薪与月薪分开", () => {
  const got = A.parseSalaryBounds("500-550元/天");
  if (!eq(got, { min: 500, max: 550, unit: "日薪" })) throw new Error(JSON.stringify(got));
});

check("parseSalaryBounds 单值 K", () => {
  const got = A.parseSalaryBounds("30K");
  if (!eq(got, { min: 30, max: 30, unit: "月薪" })) throw new Error(JSON.stringify(got));
});

check("parseSalaryBounds 面议不计入统计", () => {
  const got = A.parseSalaryBounds("面议");
  if (!eq(got, { min: 0, max: 0, unit: "" })) throw new Error(JSON.stringify(got));
});

// --- 薪资还原 ---
check("restoreSalary 带薪数字与中点", () => {
  const got = A.restoreSalary("\uE035\uE031-\uE038\uE031K·\uE032\uE036薪");
  if (got !== "40-70K·15薪") throw new Error(got);
});

check("restoreSalary 无 PUA 原样返回", () => {
  if (A.restoreSalary("20-30K") !== "20-30K") throw new Error("被改动了");
});

// --- 技能抽取 ---
check("extractSkills 基础命中", () => {
  const got = extractSkills("熟悉 Python，有 RAG 与 LangGraph 经验");
  if (!got.includes("Python") || !got.includes("RAG") || !got.includes("LangGraph")) {
    throw new Error(got.join(","));
  }
});

check("extractSkills 词边界：google 不算 Go", () => {
  const got = extractSkills("我们用 google 搜索");
  if (got.includes("Go")) throw new Error(got.join(","));
});

check("extractSkills 中文别名归一", () => {
  const got = extractSkills("做过检索增强和向量化");
  if (!got.includes("RAG") || !got.includes("Embedding")) throw new Error(got.join(","));
});

check("extractSkills 模型量化不误判金融量化", () => {
  const got = extractSkills("负责模型量化与推理加速");
  if (got.includes("金融量化")) throw new Error(got.join(","));
  if (!got.includes("模型推理优化")) throw new Error(got.join(","));
});

check("extractSkills 空文本返回空数组", () => {
  const got = extractSkills("");
  if (got.length !== 0) throw new Error(got.join(","));
});

// --- 文本处理 ---
check("normalizeCjk 还原部首但不改标点", () => {
  const got = normalizeCjk("\u2F0A\u2F00\u2F3F，测试");
  if (got !== "入一手，测试") throw new Error(got);
});

check(`truncateDescription 超过 ${MAX_DETAIL_CHARS} 字标截断`, () => {
  const long = "字".repeat(MAX_DETAIL_CHARS + 10);
  const got = truncateDescription(long);
  if (!got.truncated || got.text.length !== MAX_DETAIL_CHARS) {
    throw new Error(JSON.stringify({ len: got.text.length, truncated: got.truncated }));
  }
});

check("truncateDescription 空 JD 不抛错", () => {
  const got = truncateDescription("");
  if (got.text !== "" || got.truncated) throw new Error(JSON.stringify(got));
});

// --- 详情身份校验 ---
check("titleMatches 正向：职位名出现在标题里", () => {
  const ok = titleMatches("AI agent 开发", "「AI agent 开发招聘」_涛峰资本招聘-BOSS直聘");
  if (!ok) throw new Error("应匹配");
});

check("titleMatches 反向：标题是别的职位", () => {
  const ok = titleMatches("Agent开发工程师", "「前端开发招聘」_某公司-BOSS直聘");
  if (ok) throw new Error("不应匹配");
});

check("titleMatches 用 header 兜底", () => {
  const ok = titleMatches("Agent harness 研发工程师", "BOSS直聘", "Agent harness 研发工程师 30-50K");
  if (!ok) throw new Error("应通过 header 匹配");
});

check("titleMatches 职位名过短不硬匹配", () => {
  const ok = titleMatches("A", "「AI agent 开发招聘」-BOSS直聘");
  if (ok) throw new Error("过短不应匹配");
});

check("normalizeTitle 去掉括号与空格", () => {
  const got = normalizeTitle("【高阶+AI Agent开发】");
  if (got !== "高阶aiagent开发") throw new Error(got);
});

// --- 汇总 ---
check("summarizeSkills 按去重岗位数而不是词频", () => {
  const jobs = [
    { skills: ["Python", "RAG"] },
    { skills: ["Python"] },
    { skills: ["Python", "RAG", "RAG"] },
  ];
  const got = summarizeSkills(jobs);
  const python = got.skills.find((s) => s.name === "Python");
  const rag = got.skills.find((s) => s.name === "RAG");
  if (python.jobs !== 3) throw new Error(`Python=${python.jobs}`);
  if (rag.jobs !== 2) throw new Error(`RAG=${rag.jobs}`);
  if (got.withJd !== 3) throw new Error(`withJd=${got.withJd}`);
});

check("summarizeSkills 跳过没有 skills 的岗位", () => {
  const got = summarizeSkills([{ skills: ["Python"] }, {}, { skills: [] }]);
  if (got.withJd !== 1) throw new Error(`withJd=${got.withJd}`);
});

console.log("");
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exitCode = fail === 0 ? 0 : 1;
