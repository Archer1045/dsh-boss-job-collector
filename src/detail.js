/**
 * 详情页采集：在后台新标签页打开职位详情、读取正文、关掉。
 *
 * 为什么不是「点开列表页的详情面板」：
 * 2026-11-16 阶段 0 实测（.tmp/probe-detail.mjs、.tmp/probe-click2.mjs）表明，
 * 列表页点卡片会整页导航到 /job_detail/xxx.html，没有 SPA 内嵌面板，
 * 阻断默认导航后也没有任何面板出现。所以这里用「后台新标签页」：
 * Target.createTarget({background:true}) 不抢焦点，读完即关。
 *
 * 对外只暴露 openDetailTab / readDetail / closeDetailTab 三个函数，
 * 具体选择器与截断规则都收在本文件里，便于页面改版时集中修改。
 */

import { listTargets, openSession, evaluateJson } from "./cdp.js";

/** 单次采集默认打开的详情条数上限：一次点太多容易触发风控。 */
export const DEFAULT_DETAIL_LIMIT = 20;

/** 单条 JD 正文字符上限，超出截断并标记。 */
export const MAX_DETAIL_CHARS = 4000;

/** 两条详情之间的间隔，给页面留出渲染与风控判定的余地。 */
export const THROTTLE_MS = 800;

/** 连续失败达到这个数量就停止本批。 */
export const CONSECUTIVE_FAIL_LIMIT = 3;

/** 详情页导航后等待渲染的时间。 */
const DETAIL_WAIT_MS = 3500;

/** 新标签页出现的轮询次数与间隔。 */
const TAB_POLL_TIMES = 20;
const TAB_POLL_MS = 150;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 在详情页里读取标题、正文与风控标志。
 * 返回值做 JSON.stringify，交给 Node 侧解析。
 */
const READ_DETAIL_EXPR = `(() => {
  const text = (el) => (el ? String(el.innerText || "").trim() : "");
  const pick = (list) => {
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el && text(el)) return el;
    }
    return null;
  };
  const body = pick([".job-detail-body", ".job-sec-text", ".job-detail-section", ".detail-content"]);
  const head = pick([".job-detail-header", ".job-banner", ".job-primary"]);
  const pageText = String(document.body ? document.body.innerText : "");
  const blocked = /验证码|安全验证|访问过于频繁|请完成验证|拖动滑块/.test(pageText);
  return JSON.stringify({
    ok: Boolean(body),
    href: location.href,
    title: document.title,
    header: text(head).slice(0, 300),
    description: text(body),
    blocked,
    hasPua: /[\\uE031-\\uE03A]/.test(pageText),
  });
})()`;

/**
 * 新建一个后台标签页作为详情读取容器。
 * @param {object} mainSession 列表页的 CDP 会话。
 * @param {number} port 调试端口。
 * @returns {Promise<{targetId:string, session:object}>}
 */
export async function openDetailTab(mainSession, port) {
  const created = await mainSession.call("Target.createTarget", {
    url: "about:blank",
    background: true,
  });
  const targetId = created?.targetId;
  if (!targetId) throw new Error("创建详情标签页失败：没有返回 targetId");

  for (let i = 0; i < TAB_POLL_TIMES; i += 1) {
    const targets = await listTargets(port);
    const hit = targets.find((t) => t.id === targetId);
    if (hit?.webSocketDebuggerUrl) {
      const session = await openSession(hit.webSocketDebuggerUrl);
      await session.call("Page.enable", {});
      return { targetId, session };
    }
    await sleep(TAB_POLL_MS);
  }
  throw new Error("详情标签页没有出现在调试目标列表里");
}

/**
 * 在已打开的详情标签页里加载一个职位详情并读取内容。
 * @param {object} tabSession openDetailTab 返回的 session。
 * @param {string} url 职位详情地址。
 * @returns {Promise<object>} 含 ok / description / blocked / header 等字段。
 */
/**
 * 只还原康熙部首与兼容汉字，不动标点。
 * 整段做 NFKC 会把全角逗号等一起转成半角，中文阅读体验变差。
 * @param {string} text 原文。
 * @returns {string}
 */
export function normalizeCjk(text) {
  return String(text ?? "").replace(/[\u2F00-\u2FD5\uF900-\uFAFF]/g, (ch) => ch.normalize("NFKC"));
}

/**
 * 规范化职位名，用于和详情页标题比对。
 * 去掉空白与常见括号、连接符，只留文字和数字。
 * @param {string} text
 * @returns {string}
 */
export function normalizeTitle(text) {
  return String(text ?? "")
    .replace(/\s+/g, "")
    .replace(/[「」『』【】\[\]（）()·、,，。.\-_/|+＋#＆&]/g, "")
    .toLowerCase();
}

/**
 * 详情页标题是否对应这条职位。
 * BOSS 详情页标题形如「「AI agent 开发招聘」_涛峰资本招聘-BOSS直聘」，
 * 只要职位名出现在标题里就算匹配。
 * @param {string} jobTitle 列表里的职位名。
 * @param {string} pageTitle 详情页 document.title。
 * @param {string} [header] 详情页头部文本（兜底）。
 * @returns {boolean}
 */
export function titleMatches(jobTitle, pageTitle, header = "") {
  const want = normalizeTitle(jobTitle);
  if (want.length < 2) return false;
  const page = normalizeTitle(pageTitle);
  const head = normalizeTitle(header);
  return page.includes(want) || head.includes(want);
}

export async function readDetail(tabSession, url, expectTitle = "") {
  await tabSession.call("Page.navigate", { url });
  await sleep(DETAIL_WAIT_MS);
  const data = await evaluateJson(tabSession, READ_DETAIL_EXPR);
  if (!data || typeof data !== "object") throw new Error("详情页没有返回数据");
  // 站点会把部分常用字替换成康熙部首（如 U+2F0A「⼊」代替「入」）做反爬，
  // 这里还原成正常汉字，否则报告里会出现怪字。
  data.description = normalizeCjk(data.description);
  data.header = normalizeCjk(data.header);
  // 身份校验：详情页可能因为导航失败仍停在上一条，写错比读不到更糟。
  if (expectTitle && data.ok) {
    data.title_matched = titleMatches(expectTitle, data.title, data.header);
  }
  return data;
}

/**
 * 关闭详情标签页；失败不抛，避免影响主流程。
 * @param {object} mainSession 列表页的 CDP 会话。
 * @param {string} targetId 目标标签页 ID。
 */
export async function closeDetailTab(mainSession, targetId) {
  try {
    await mainSession.call("Target.closeTarget", { targetId });
  } catch {
    /* 关闭失败不影响已经取到的数据 */
  }
}

/**
 * 按字符上限截断正文。
 * @param {string} text 原文。
 * @returns {{text:string, truncated:boolean}}
 */
export function truncateDescription(text) {
  const raw = String(text ?? "");
  if (raw.length <= MAX_DETAIL_CHARS) return { text: raw, truncated: false };
  return { text: raw.slice(0, MAX_DETAIL_CHARS), truncated: true };
}
