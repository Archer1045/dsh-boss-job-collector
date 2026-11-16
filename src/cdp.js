/**
 * 极简 CDP 客户端：只做本插件需要的事——列目标、连上页面、执行表达式。
 * 不引入第三方依赖，Node 24 自带全局 WebSocket。
 */

/** CDP 调用超时（毫秒）。页面渲染慢时可以适当放宽。 */
const CALL_TIMEOUT = 30_000;

/**
 * 列出浏览器的可调试目标。
 * @param {number} port 调试端口。
 * @returns {Promise<Array<{id:string,type:string,title:string,url:string,webSocketDebuggerUrl:string}>>}
 */
export async function listTargets(port) {
  const url = `http://127.0.0.1:${port}/json/list`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  } catch (err) {
    throw new Error(
      `连不上 ${url}，请先用 --remote-debugging-port=${port} 启动浏览器（详见文档 README）。`,
    );
  }
  if (!res.ok) {
    throw new Error(`读取 ${url} 失败：HTTP ${res.status}`);
  }
  const targets = await res.json();
  if (!Array.isArray(targets)) throw new Error("调试端点返回的不是目标列表");
  return targets;
}

/**
 * 在目标列表里找 BOSS 直聘页面，优先搜索页。
 * @param {Array} targets CDP 目标列表。
 * @returns {object|null}
 */
export function pickBossTarget(targets) {
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const zhipin = pages.filter((t) => /(^|\.)zhipin\.com/.test(safeHost(t.url)));
  if (zhipin.length === 0) return null;
  const search = zhipin.find((t) => t.url.includes("/web/geek/jobs"));
  return search || zhipin[0];
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/**
 * 打开一条 CDP 会话。
 * @param {string} wsUrl webSocketDebuggerUrl。
 * @returns {Promise<{call:(method:string,params?:object)=>Promise<any>, close:()=>void}>}
 */
export async function openSession(wsUrl) {
  if (typeof globalThis.WebSocket !== "function") {
    throw new Error("当前 Node 没有全局 WebSocket（需要 Node 24+）");
  }
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("连接 CDP 超时")), 5000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(new Error(`连接 CDP 失败：${event?.message ?? "WebSocket error"}`));
    });
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      return;
    }
    if (!msg || typeof msg.id !== "number") return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) entry.reject(new Error(`${msg.error.message ?? "CDP error"}（${msg.error.code ?? "?"}）`));
    else entry.resolve(msg.result);
  });

  ws.addEventListener("close", () => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("CDP 连接已关闭"));
    }
    pending.clear();
  });

  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP 调用超时：${method}`));
      }, CALL_TIMEOUT);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });

  return {
    call,
    close() {
      try {
        ws.close();
      } catch {
        /* 忽略重复关闭 */
      }
    },
  };
}

/**
 * 在页面里执行一段表达式并取回 JSON 值。
 * @param {object} session openSession 的返回值。
 * @param {string} expression 要执行的表达式。
 * @returns {Promise<any>}
 */
export async function evaluateJson(session, expression) {
  const result = await session.call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: false,
  });
  if (result?.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "未知错误";
    throw new Error(`页面执行出错：${text}`);
  }
  const value = result?.result?.value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}
