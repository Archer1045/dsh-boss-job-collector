/**
 * 采集流程：连 CDP → 注入适配器 → 反复「扫描 + 滚动」→ 按职位 ID 合并去重。
 * 开启 withDetail 时，再逐条在后台标签页打开详情页读 JD 正文。
 * 适配器源码随插件一起分发（src/boss-adapter.js），与 extension/src/boss-adapter.js 保持同一份实现。
 */

import { readFile } from "node:fs/promises";
import { listTargets, openSession, pickBossTarget, evaluateJson } from "./cdp.js";
import { extractSkills } from "./skills.js";
import {
  CONSECUTIVE_FAIL_LIMIT,
  DEFAULT_DETAIL_LIMIT,
  THROTTLE_MS,
  closeDetailTab,
  openDetailTab,
  readDetail,
  truncateDescription,
} from "./detail.js";

/** 适配器与本插件同目录，安装时随包一起分发，不依赖仓库结构。 */
const ADAPTER_URL = new URL("./boss-adapter.js", import.meta.url);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 采集当前 BOSS 直聘页面上的职位。
 * @param {object} options
 * @param {number} options.port CDP 调试端口。
 * @param {number} options.batches 扫描批次（含首屏），1 表示不滚动。
 * @param {number} options.scrollWaitMs 每次滚动后等待渲染的时间。
 * @param {boolean} [options.withDetail] 是否读取职位详情正文。
 * @param {number} [options.detailLimit] 最多读多少条详情。
 * @param {number} [options.detailOffset] 从第几条开始读详情（用于分两批）。
 * @param {(msg:string)=>void} [options.log] 进度回调。
 * @returns {Promise<object>}
 */
export async function collectJobs({
  port,
  batches,
  scrollWaitMs,
  withDetail = false,
  detailLimit = DEFAULT_DETAIL_LIMIT,
  detailOffset = 0,
  log,
}) {
  const note = log ?? (() => {});
  const targets = await listTargets(port);
  const target = pickBossTarget(targets);
  if (!target) {
    throw new Error(
      "没找到 BOSS 直聘标签页。请先在带调试端口的浏览器里打开 zhipin.com 的搜索结果页。",
    );
  }

  const adapterSrc = await readFile(ADAPTER_URL, "utf8");
  const session = await openSession(target.webSocketDebuggerUrl);
  const merged = new Map();
  let scrolls = 0;

  try {
    note(`已连接：${target.title || target.url}`);
    // 注入适配器；重复注入只会覆盖同名对象，不影响页面状态。
    await evaluateJson(session, `${adapterSrc}\n;0`);
    const ready = await evaluateJson(
      session,
      "JSON.stringify({ ok: Boolean(globalThis.BossAdapter), list: globalThis.BossAdapter ? globalThis.BossAdapter.looksLikeJobList(document) : false })",
    );
    if (!ready?.ok) throw new Error("适配器注入失败，页面可能禁止了脚本执行");

    for (let i = 0; i < batches; i += 1) {
      const scan = await evaluateJson(
        session,
        "JSON.stringify(globalThis.BossAdapter.scan(document))",
      );
      if (!scan || typeof scan !== "object") throw new Error("扫描没有返回结果");
      for (const item of scan.items ?? []) {
        const key = item.job_id || item.url || `${item.title}|${item.company}`;
        if (key) merged.set(key, item);
      }
      note(`第 ${i + 1} 批：页面 ${scan.items?.length ?? 0} 条，累计 ${merged.size} 条`);
      if (i === batches - 1) break;

      const before = await evaluateJson(
        session,
        "JSON.stringify({ h: document.documentElement.scrollHeight, y: window.scrollY })",
      );
      await evaluateJson(session, "window.scrollTo(0, document.documentElement.scrollHeight); 0");
      await sleep(scrollWaitMs);
      scrolls += 1;
      const after = await evaluateJson(
        session,
        "JSON.stringify({ h: document.documentElement.scrollHeight, y: window.scrollY })",
      );
      const grew = after && before && after.h > before.h;
      if (!grew) {
        note("页面高度没有变化，停止滚动");
        break;
      }
    }

    const jobs = [...merged.values()];
    const detail = withDetail
      ? await collectDetails(session, port, jobs, detailLimit, note, detailOffset)
      : { attempted: 0, ok: 0, stopped: "", failures: 0 };

    return {
      jobs,
      url: target.url,
      title: target.title || "",
      batches: Math.min(batches, scrolls + 1),
      scrolls,
      detail_attempted: detail.attempted,
      detail_ok: detail.ok,
      detail_stopped: detail.stopped,
      detail_failures: detail.failures,
    };
  } finally {
    session.close();
  }
}

/**
 * 逐条打开详情页读 JD 正文，结果写回 jobs 里对应条目。
 * 单条失败记 jd_error 继续；连续失败达上限或遇到风控立即停止。
 * @param {object} mainSession 列表页会话。
 * @param {number} port 调试端口。
 * @param {object[]} jobs 已采集的职位。
 * @param {number} limit 最多处理多少条。
 * @param {(msg:string)=>void} note 进度回调。
 * @param {number} offset 从第几条开始处理（分两批时用）。
 */
async function collectDetails(mainSession, port, jobs, limit, note, offset = 0) {
  const start = Math.max(0, offset);
  const queue = jobs
    .filter((job) => job.url)
    .slice(start, start + Math.max(0, limit));
  if (queue.length === 0) {
    return { attempted: 0, ok: 0, stopped: "没有可打开的职位链接", failures: 0 };
  }

  let tab;
  let ok = 0;
  let failures = 0;
  let consecutive = 0;
  let stopped = "";
  note(`开始读取详情：共 ${queue.length} 条，间隔 ${THROTTLE_MS}ms`);

  try {
    tab = await openDetailTab(mainSession, port);
    for (let i = 0; i < queue.length; i += 1) {
      const job = queue[i];
      try {
        const data = await readDetail(tab.session, job.url, job.title);
        if (data.blocked) {
          stopped = "遇到验证码或安全校验，已停止";
          job.jd_error = stopped;
          break;
        }
        if (!data.ok) {
          throw new Error("页面里没有找到 JD 正文容器");
        }
        if (data.title_matched === false) {
          throw new Error(`详情页标题对不上（页面：${String(data.title).slice(0, 40)}）`);
        }
        const { text, truncated } = truncateDescription(data.description);
        job.description = text;
        job.description_truncated = truncated;
        job.skills = extractSkills(text);
        delete job.jd_error;
        ok += 1;
        consecutive = 0;
        note(`详情 ${i + 1}/${queue.length}：${job.title}（${text.length} 字）`);
      } catch (err) {
        failures += 1;
        consecutive += 1;
        job.jd_error = String(err?.message ?? err);
        note(`详情 ${i + 1}/${queue.length} 失败：${job.jd_error}`);
        if (consecutive >= CONSECUTIVE_FAIL_LIMIT) {
          stopped = `连续 ${consecutive} 条失败，已停止`;
          break;
        }
      }
      if (i < queue.length - 1) await sleep(THROTTLE_MS);
    }
  } finally {
    if (tab) await closeDetailTab(mainSession, tab.targetId);
  }

  return { attempted: ok + failures, ok, stopped, failures };
}
