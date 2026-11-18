/**
 * DSH 插件：把 BOSS 直聘页面上的岗位列表读进对话。
 *
 * 通过 CDP 连接用户自己打开的浏览器标签页，不启动新实例、不复制 Cookie。
 * 注意：cordis 加载器按同步方式加载模块，顶层 import 宿主包会失败；
 * 另外本插件在 profile 层、路径在工作区，相对解析不到 @deepseek-ai/dsh-tools，
 * 所以要按「服务自带 → 相对 → 宿主绝对路径」的顺序找 defineTool。
 *
 * 启动过程写入 last-run.log，用于定位「工具没注册」这类问题。
 */

import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { collectJobs } from "./src/collect.js";
import { summarizeSkills } from "./src/skills.js";

export const name = "boss-jobs";

// 只注入确定就绪的 systemPrompt；tools 用 ctx.inject 动态等待，
// 否则插件会在启动时卡在依赖上、apply 永远不被调用。
export const inject = ["systemPrompt"];

const LOG_FILE = fileURLToPath(new URL("./last-run.log", import.meta.url));

/** 把启动过程写进文件：桌面版看不到 stderr，只能靠日志定位。 */
function trace(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, "utf8");
  } catch {
    // 日志写不进去也不能影响插件加载
  }
}

trace("[module] loaded");

// 宿主里的工具包路径，允许用环境变量覆盖（换机器或换版本时改这里）。
const HOST_TOOLS_ROOT = process.env.DSH_TOOLS_ROOT
  || "D:\\APP\\deepseek\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-tools";

const HOST_TOOLS_URLS = [
  `file:///${HOST_TOOLS_ROOT.replace(/\\/g, "/")}/lib/index.js`,
];

const USAGE_HINT = [
  "【BOSS 岗位采集】",
  "用户要求查看、采集或分析 BOSS 直聘上的岗位时，必须先调用 collect_boss_jobs 读真实页面，",
  "不要凭常识编造岗位名、薪资或公司；没有调用工具就不要给出岗位数据。",
  "工具依赖浏览器以 --remote-debugging-port 启动且页面已加载出结果。",
  "调用失败时如实说明原因并给启动命令，不要用假设数据代替。",
].join("");

const DESCRIPTION =
  "读取当前已打开的 BOSS 直聘搜索结果页里的岗位列表。"
  + "薪资用站点私有区字体编码，工具会按码点映射还原成可读数字。"
  + "只读页面，不翻页、不调接口、不改动页面。"
  + "浏览器必须带 --remote-debugging-port 启动，且页面上已经加载出结果。";

const JOB_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    job_id: { type: "string", required: true },
    title: { type: "string", required: true },
    salary: { type: "string", required: true },
    salary_unverified: { type: "boolean", required: true },
    salary_min: { type: "number", required: true },
    salary_max: { type: "number", required: true },
    salary_unit: { type: "string", required: true },
    company: { type: "string", required: true },
    location: { type: "string", required: true },
    experience: { type: "string", required: true },
    education: { type: "string", required: true },
    job_tags: { type: "array", required: true, items: { type: "string" } },
    url: { type: "string", required: true },
    warnings: { type: "array", required: true, items: { type: "string" } },
    description: { type: "string" },
    description_truncated: { type: "boolean" },
    skills: { type: "array", items: { type: "string" } },
    jd_error: { type: "string" },
  },
};

/** 工具结果里每条 JD 最多带多少字，全文写进 raw 文件。 */
const BRIEF_CHARS = 300;

/** 原始数据目录：插件根目录下的 reports/raw（结构改造后仓库根即插件根）。 */
const RAW_DIR = fileURLToPath(new URL("./reports/raw/", import.meta.url));

/**
 * 把完整结果写到本地 JSON，供模型需要全文时按路径读取。
 * @param {object} result collectJobs 的返回值。
 * @returns {Promise<string>} 写好的文件路径，失败返回空串。
 */
async function writeRaw(result) {
  try {
    await mkdir(RAW_DIR, { recursive: true });
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const file = `${RAW_DIR}boss-jobs-${stamp}.json`;
    const payload = {
      collected_at: now.toISOString(),
      page_url: result.url,
      page_title: result.title,
      count: result.jobs.length,
      detail_attempted: result.detail_attempted ?? 0,
      detail_ok: result.detail_ok ?? 0,
      detail_stopped: result.detail_stopped ?? "",
      summary: result.skill_summary ?? null,
      jobs: result.jobs,
    };
    await writeFile(file, JSON.stringify(payload, null, 2), "utf8");
    return file;
  } catch {
    return "";
  }
}

/**
 * 找宿主提供的 defineTool：服务自带 → 相对解析 → 宿主绝对路径。
 * @param tools ctx.tools 服务实例。
 * @returns defineTool 函数，找不到返回 null。
 */
async function resolveDefineTool(tools) {
  if (tools && typeof tools.defineTool === "function") {
    trace("[tools] defineTool from service");
    return tools.defineTool;
  }

  try {
    const mod = await import("@deepseek-ai/dsh-tools");
    if (mod && typeof mod.defineTool === "function") {
      trace("[tools] defineTool from relative import");
      return mod.defineTool;
    }
  } catch (err) {
    trace(`[tools] relative import failed: ${err?.code ?? err?.message ?? err}`);
  }

  for (const url of HOST_TOOLS_URLS) {
    try {
      const mod = await import(url);
      if (mod && typeof mod.defineTool === "function") {
        trace(`[tools] defineTool from ${url}`);
        return mod.defineTool;
      }
    } catch (err) {
      trace(`[tools] host import failed (${url}): ${err?.message ?? err}`);
    }
  }

  return null;
}

/**
 * 在 tools 服务就绪后注册采集工具。
 * @param tools ctx.tools 服务实例。
 * @param defaultPort CDP 默认端口。
 * @param maxBatches 允许的最大滚动批次。
 */
async function registerTools(tools, defaultPort, maxBatches) {
  try {
    const ownKeys = Object.keys(tools ?? {});
    let protoKeys = [];
    try {
      protoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(tools ?? {}));
    } catch {
      protoKeys = [];
    }
    trace(`[tools] service keys: own=${ownKeys.join(",")} proto=${protoKeys.join(",")}`);

    const defineTool = await resolveDefineTool(tools);
    if (typeof defineTool !== "function") {
      trace("[tools] defineTool unavailable");
      return;
    }

    tools.register(
      defineTool({
        name: "collect_boss_jobs",
        description: DESCRIPTION,
        parameters: {
          batches: {
            type: "integer",
            description: `扫描批次，1 只读当前已渲染的职位；更大值会滚动加载更多批次再合并。上限 ${maxBatches}。`,
          },
          port: {
            type: "integer",
            description: `CDP 调试端口，默认 ${defaultPort}，仅当浏览器用了别的端口时才传。`,
          },
          scrollWaitMs: {
            type: "integer",
            description: "每次滚动后等待内容加载的毫秒数，默认 2500，网络慢时调大。",
          },
          withDetail: {
            type: "boolean",
            description:
              "是否逐条打开职位详情读取 JD 正文。默认 false（与一期行为一致）。开启后在后台标签页打开、读完即关，单条约 3–4 秒。",
          },
          detailLimit: {
            type: "integer",
            description: `最多读多少条详情，默认 20。界面一次点太多容易触发风控，不要超过 ${maxBatches * 20}。`,
          },
          detailOffset: {
            type: "integer",
            description:
              "从第几条开始读详情，默认 0。要分两批读 40 条时，第二批传 20（配合 detailLimit=20）。",
          },
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              count: { type: "integer", required: true },
              batches: { type: "integer", required: true },
              page_title: { type: "string", required: true },
              page_url: { type: "string", required: true },
              detail_attempted: { type: "integer" },
              detail_ok: { type: "integer" },
              detail_stopped: { type: "string" },
              raw_path: { type: "string" },
              skill_summary: {
                type: "object",
                additionalProperties: false,
                properties: {
                  totalJobs: { type: "integer", required: true },
                  withJd: { type: "integer", required: true },
                  skills: {
                    type: "array",
                    required: true,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        name: { type: "string", required: true },
                        category: { type: "string", required: true },
                        jobs: { type: "integer", required: true },
                        ratio: { type: "number", required: true },
                      },
                    },
                  },
                  categories: {
                    type: "array",
                    required: true,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        category: { type: "string", required: true },
                        skillCount: { type: "integer", required: true },
                        jobs: { type: "integer", required: true },
                        top: { type: "array", required: true, items: { type: "string" } },
                      },
                    },
                  },
                },
              },
              jobs: { type: "array", required: true, items: JOB_SCHEMA },
            },
          },
          render: (_args, value) => {
            const head = `从「${value.page_title || value.page_url}」采集到 ${value.count} 条岗位（扫描 ${value.batches} 批）。`;
            const detail = value.detail_attempted
              ? `\n详情：尝试 ${value.detail_attempted} 条，成功 ${value.detail_ok} 条${value.detail_stopped ? `，${value.detail_stopped}` : ""}。`
              : "";
            const raw = value.raw_path ? `\n完整数据：${value.raw_path}` : "";
            const summary = value.skill_summary;
            const topSkills =
              summary && summary.skills?.length
                ? `\n高频技能（按岗位数）：${summary.skills
                    .slice(0, 8)
                    .map((item) => `${item.name} ${item.jobs}`)
                    .join(" · ")}`
                : "";
            const lines = value.jobs.slice(0, 15).map((job, i) => {
              const flag = job.salary_unverified ? "（薪资待核对）" : "";
              const jd = job.description ? ` · JD ${job.description.length} 字` : "";
              return `${i + 1}. ${job.title} · ${job.company} · ${job.location} · ${job.salary}${flag}${jd}`;
            });
            const tail =
              value.jobs.length > 15
                ? `\n…另有 ${value.jobs.length - 15} 条，完整数据见工具结果。`
                : "";
            return [{ type: "text", text: `${head}${detail}${raw}${topSkills}\n${lines.join("\n")}${tail}` }];
          },
        },
        execute: async (args) => {
          const batches = Math.min(Math.max(args.batches ?? 1, 1), maxBatches);
          const port = args.port ?? defaultPort;
          const scrollWaitMs = Math.min(Math.max(args.scrollWaitMs ?? 2500, 500), 15000);
          const withDetail = args.withDetail === true;
          const detailLimit = Math.min(Math.max(args.detailLimit ?? 20, 1), maxBatches * 20);
          const detailOffset = Math.min(Math.max(args.detailOffset ?? 0, 0), maxBatches * 20);
          const result = await collectJobs({
            port,
            batches,
            scrollWaitMs,
            withDetail,
            detailLimit,
            detailOffset,
          });
          const rawPath = await writeRaw(result);
          const jobs = result.jobs.map((job) => {
            if (!job.description) return job;
            const full = String(job.description);
            const brief = full.slice(0, BRIEF_CHARS);
            return {
              ...job,
              description: brief,
              description_truncated: job.description_truncated === true || full.length > BRIEF_CHARS,
            };
          });
          return {
            count: result.jobs.length,
            batches: result.batches,
            page_title: result.title,
            page_url: result.url,
            detail_attempted: result.detail_attempted ?? 0,
            detail_ok: result.detail_ok ?? 0,
            detail_stopped: result.detail_stopped ?? "",
            raw_path: rawPath,
            skill_summary: summarizeSkills(result.jobs),
            jobs,
          };
        },
        presentCall: (args) => ({
          card: "generic",
          title: `采集 BOSS 岗位（滚动 ${args.batches ?? 1} 批）`,
          kind: "other",
          rawInput: args,
        }),
      }),
    );
    trace("[tools] collect_boss_jobs registered");
  } catch (err) {
    trace(`[tools] register failed: ${err?.stack ?? err}`);
  }
}

/**
 * 注册使用约定与采集工具。
 * @param ctx 注册上下文。
 * @param config 来自 cordis.patch.yml 的配置，可能为空。
 */
export function apply(ctx, config) {
  const defaultPort = config?.port ?? 9222;
  const maxBatches = Math.max(1, config?.maxBatches ?? 5);
  trace(`[apply] called, inject=${JSON.stringify(inject)}`);

  try {
    ctx.systemPrompt.section({
      name: "boss-jobs:usage",
      order: 320,
      interpolate: false,
      text: () => USAGE_HINT,
    });
    trace("[apply] usage hint injected");
  } catch (err) {
    trace(`[apply] usage hint failed: ${err?.stack ?? err}`);
  }

  try {
    if (typeof ctx.inject !== "function") {
      trace("[tools] ctx.inject unavailable");
      return;
    }
    ctx.inject(["tools"], (child) => {
      trace("[tools] inject callback fired");
      void registerTools(child.tools, defaultPort, maxBatches);
    });
    trace("[tools] ctx.inject registered");
  } catch (err) {
    trace(`[tools] ctx.inject failed: ${err?.stack ?? err}`);
  }
}
