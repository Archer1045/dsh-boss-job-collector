/**
 * 技能词典：从 JD 正文里识别技术关键词，按六类归类。
 *
 * 设计取舍：
 * - 只用规则，不调模型。模型归纳放在报告阶段做，插件只交结构化数据（见二期计划 3.2）。
 * - 英文词用词边界匹配，避免 go 命中 google、rag 命中 storage。
 * - 中文词直接包含匹配，JD 里很少出现拆分写法。
 * - 别名归一到同一个规范名，统计按规范名去重。
 */

/**
 * 词条定义。
 * category 六类固定：编程语言 / Agent 与编排 / 模型与算法 / 工程基础 / 评测与质量 / 领域与加分。
 * aliases 里的英文项按词边界匹配，中文项按包含匹配。
 */
const DICT = [
  // 编程语言
  { name: "Python", category: "编程语言", aliases: ["python"] },
  { name: "Go", category: "编程语言", aliases: ["go", "golang"] },
  { name: "Java", category: "编程语言", aliases: ["java"] },
  { name: "TypeScript", category: "编程语言", aliases: ["typescript", "ts"] },
  { name: "JavaScript", category: "编程语言", aliases: ["javascript", "js"] },
  { name: "C++", category: "编程语言", aliases: ["c++", "cpp"] },
  { name: "Rust", category: "编程语言", aliases: ["rust"] },
  { name: "SQL", category: "编程语言", aliases: ["sql"] },

  // Agent 与编排
  { name: "LangGraph", category: "Agent 与编排", aliases: ["langgraph"] },
  { name: "LangChain", category: "Agent 与编排", aliases: ["langchain"] },
  { name: "ReAct", category: "Agent 与编排", aliases: ["react"] },
  { name: "Planning", category: "Agent 与编排", aliases: ["planning", "任务规划", "规划"] },
  { name: "Checkpointer", category: "Agent 与编排", aliases: ["checkpointer", "检查点"] },
  { name: "HITL", category: "Agent 与编排", aliases: ["hitl", "human-in-the-loop", "人工介入"] },
  { name: "MCP", category: "Agent 与编排", aliases: ["mcp"] },
  { name: "Tool Calling", category: "Agent 与编排", aliases: ["tool calling", "function calling", "工具调用"] },
  { name: "Memory", category: "Agent 与编排", aliases: ["memory", "记忆", "上下文管理"] },
  { name: "多 Agent", category: "Agent 与编排", aliases: ["multi-agent", "多 agent", "多智能体"] },
  { name: "AutoGen", category: "Agent 与编排", aliases: ["autogen"] },
  { name: "CrewAI", category: "Agent 与编排", aliases: ["crewai"] },
  { name: "Dify", category: "Agent 与编排", aliases: ["dify"] },
  { name: "Coze", category: "Agent 与编排", aliases: ["coze", "扣子"] },

  // 模型与算法
  { name: "RAG", category: "模型与算法", aliases: ["rag", "检索增强"] },
  { name: "LLM", category: "模型与算法", aliases: ["llm", "大模型", "大语言模型"] },
  { name: "微调", category: "模型与算法", aliases: ["微调", "finetune", "fine-tune"] },
  { name: "LoRA", category: "模型与算法", aliases: ["lora"] },
  { name: "SFT", category: "模型与算法", aliases: ["sft"] },
  { name: "DPO", category: "模型与算法", aliases: ["dpo", "rlhf"] },
  { name: "Embedding", category: "模型与算法", aliases: ["embedding", "向量化"] },
  { name: "Reranker", category: "模型与算法", aliases: ["rerank", "重排"] },
  { name: "向量库", category: "模型与算法", aliases: ["向量库", "faiss", "milvus", "pgvector", "chroma"] },
  { name: "Prompt", category: "模型与算法", aliases: ["prompt", "提示词"] },
  { name: "多模态", category: "模型与算法", aliases: ["多模态", "vlm", "视觉语言"] },
  { name: "模型推理优化", category: "模型与算法", aliases: ["vllm", "推理加速", "量化", "蒸馏"] },

  // 工程基础
  { name: "FastAPI", category: "工程基础", aliases: ["fastapi"] },
  { name: "异步", category: "工程基础", aliases: ["异步", "asyncio", "协程"] },
  { name: "数据库", category: "工程基础", aliases: ["数据库", "mysql", "postgresql", "mongodb", "sqlite"] },
  { name: "Redis", category: "工程基础", aliases: ["redis"] },
  { name: "Docker", category: "工程基础", aliases: ["docker", "容器化"] },
  { name: "K8s", category: "工程基础", aliases: ["k8s", "kubernetes"] },
  { name: "消息队列", category: "工程基础", aliases: ["消息队列", "kafka", "rabbitmq", "rocketmq"] },
  { name: "微服务", category: "工程基础", aliases: ["微服务", "gRPC", "grpc", "服务治理"] },
  { name: "Linux", category: "工程基础", aliases: ["linux", "shell"] },
  { name: "Git", category: "工程基础", aliases: ["git", "版本控制"] },

  // 评测与质量
  { name: "RAGAS", category: "评测与质量", aliases: ["ragas"] },
  { name: "评测集", category: "评测与质量", aliases: ["评测集", "测试集", "evalset", "benchmark"] },
  { name: "Bad Case", category: "评测与质量", aliases: ["bad case", "badcase"] },
  { name: "召回率", category: "评测与质量", aliases: ["召回率", "recall", "recall@"] },
  { name: "准确率", category: "评测与质量", aliases: ["准确率", "precision", "准确度"] },
  { name: "幻觉", category: "评测与质量", aliases: ["幻觉", "hallucination"] },
  { name: "效果监控", category: "评测与质量", aliases: ["监控", "可观测", "日志分析", "trace"] },
  { name: "A/B 测试", category: "评测与质量", aliases: ["a/b", "ab 测试", "abtest"] },

  // 领域与加分
  { name: "金融", category: "领域与加分", aliases: ["金融", "投研", "证券", "基金", "银行"] },
  {
    name: "金融量化",
    category: "领域与加分",
    // 裸「量化」在技术岗多指模型量化，会与「模型推理优化」互抢，这里只认明确写法。
    aliases: ["量化交易", "量化投资", "量化策略", "因子", "行情", "回测"],
  },
  { name: "风控", category: "领域与加分", aliases: ["风控", "合规", "反欺诈"] },
  { name: "开源", category: "领域与加分", aliases: ["开源", "github", "open source"] },
  { name: "论文", category: "领域与加分", aliases: ["论文", "paper", "顶会"] },
  { name: "推荐/搜索", category: "领域与加分", aliases: ["推荐系统", "搜索引擎", "召回排序"] },
];

/** 六类的固定顺序，报告按这个顺序输出。 */
export const CATEGORIES = [
  "编程语言",
  "Agent 与编排",
  "模型与算法",
  "工程基础",
  "评测与质量",
  "领域与加分",
];

/** 英文词条预编译成词边界正则，避免 go 命中 google。 */
const COMPILED = DICT.map((entry) => ({
  ...entry,
  matchers: entry.aliases.map((alias) => {
    const isAscii = /^[\x20-\x7E]+$/.test(alias);
    if (!isAscii) return { alias, re: null };
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { alias, re: new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "i") };
  }),
}));

/**
 * 从一段 JD 文本里抽出技能名（按词典规范名去重）。
 * @param {string} text JD 正文。
 * @returns {string[]}
 */
export function extractSkills(text) {
  const plain = String(text ?? "");
  if (!plain) return [];
  const hits = [];
  for (const entry of COMPILED) {
    const matched = entry.matchers.some(({ alias, re }) =>
      re ? re.test(plain) : plain.includes(alias),
    );
    if (matched) hits.push(entry.name);
  }
  return hits;
}

/**
 * 汇总所有岗位的技能频次。
 * 频次按「提到该技能的岗位数」计算，不按出现次数（见二期计划 8.5）。
 * @param {object[]} jobs 岗位数组，每项可带 skills。
 * @returns {{totalJobs:number, withJd:number, skills:Array, categories:Array}}
 */
export function summarizeSkills(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const withJd = list.filter((job) => Array.isArray(job.skills) && job.skills.length > 0).length;
  const counter = new Map();

  for (const job of list) {
    const seen = new Set(job.skills ?? []);
    for (const name of seen) {
      const entry = DICT.find((item) => item.name === name);
      const category = entry?.category ?? "未归类";
      const current = counter.get(name) ?? { name, category, jobs: 0 };
      current.jobs += 1;
      counter.set(name, current);
    }
  }

  const skills = [...counter.values()]
    .map((item) => ({
      ...item,
      ratio: withJd > 0 ? Number((item.jobs / withJd).toFixed(3)) : 0,
    }))
    .sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name));

  const categories = CATEGORIES.map((category) => {
    const names = skills.filter((item) => item.category === category);
    return {
      category,
      skillCount: names.length,
      jobs: Math.max(0, ...names.map((item) => item.jobs)),
      top: names.slice(0, 5).map((item) => item.name),
    };
  });

  return { totalJobs: list.length, withJd, skills, categories };
}
