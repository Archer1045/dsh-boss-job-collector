/**
 * 侧边栏逻辑：扫描、累积去重、渲染、删除、导出。
 */

(function () {
  "use strict";

  const STORAGE_KEY = "boss-jobs";
  const MAX_ITEMS = 1000;

  let items = [];

  const el = {
    rows: document.getElementById("rows"),
    empty: document.getElementById("empty"),
    status: document.getElementById("status"),
    counter: document.getElementById("counter"),
    scan: document.getElementById("scan"),
    exportCsv: document.getElementById("export-csv"),
    exportJson: document.getElementById("export-json"),
    clear: document.getElementById("clear"),
  };

  function setStatus(text, kind) {
    el.status.textContent = text || "";
    el.status.className = `status${kind ? " " + kind : ""}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  /** 去重键：优先稳定 ID，其次规范化链接；都没有则不参与去重。 */
  function keyOf(item) {
    return item.job_id || item.url || "";
  }

  function load() {
    chrome.storage.local.get(STORAGE_KEY).then((data) => {
      items = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      render();
    });
  }

  function save() {
    const payload = items.slice(0, MAX_ITEMS);
    return chrome.storage.local.set({ [STORAGE_KEY]: payload });
  }

  /** 合并新扫描结果：同键覆盖字段但保留首次采集时间。 */
  function mergeItems(incoming) {
    const map = new Map();
    for (const item of items) {
      const k = keyOf(item);
      if (k) map.set(k, item);
      else map.set(`anon-${Math.random()}`, item);
    }
    let added = 0;
    let updated = 0;
    for (const item of incoming) {
      const k = keyOf(item) || `anon-${Math.random()}`;
      const prev = map.get(k);
      if (prev) {
        map.set(k, Object.assign({}, prev, item, { collected_at: prev.collected_at }));
        updated += 1;
      } else {
        map.set(k, Object.assign({ collected_at: nowIso() }, item));
        added += 1;
      }
    }
    items = Array.from(map.values());
    return { added, updated };
  }

  function render() {
    el.rows.textContent = "";
    el.counter.textContent = `${items.length} 条`;
    el.empty.style.display = items.length ? "none" : "block";

    items.forEach((item, index) => {
      const tr = document.createElement("tr");

      const titleTd = document.createElement("td");
      if (item.url) {
        const a = document.createElement("a");
        a.href = item.url;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.textContent = item.title || "(无标题)";
        titleTd.appendChild(a);
      } else {
        titleTd.textContent = item.title || "(无标题)";
      }
      if (item.warnings && item.warnings.length) {
        const flag = document.createElement("span");
        flag.className = "flag";
        flag.title = item.warnings.join("；");
        flag.textContent = "!";
        titleTd.appendChild(flag);
      }

      const salaryTd = document.createElement("td");
      salaryTd.textContent = item.salary || "—";
      if (item.salary_unverified) {
        salaryTd.classList.add("warn");
        salaryTd.title = "薪资未通过格式或区间检查，导出时标记为待确认";
      }

      const companyTd = document.createElement("td");
      companyTd.textContent = item.company || "—";

      const locTd = document.createElement("td");
      locTd.textContent = item.location || "—";

      const tagsTd = document.createElement("td");
      tagsTd.textContent = [item.experience, item.education].filter(Boolean).join(" / ") || "—";

      const opTd = document.createElement("td");
      const del = document.createElement("button");
      del.className = "link";
      del.textContent = "删除";
      del.addEventListener("click", () => remove(index));
      opTd.appendChild(del);

      tr.append(titleTd, salaryTd, companyTd, locTd, tagsTd, opTd);
      el.rows.appendChild(tr);
    });
  }

  function remove(index) {
    items.splice(index, 1);
    save().then(render);
  }

  async function scanCurrentPage() {
    setStatus("正在扫描…");
    el.scan.disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        setStatus("找不到当前标签页", "error");
        return;
      }

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/boss-adapter.js", "src/content.js"],
      });

      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => globalThis.__bossLastScan || null,
      });

      if (!result) {
        setStatus("页面没有返回扫描结果，可能不是支持页面", "error");
        return;
      }
      if (result.error) {
        setStatus(result.error, "error");
        return;
      }

      const found = result.items || [];
      if (!found.length) {
        setStatus("当前页没有找到职位卡片", "error");
        return;
      }

      const { added, updated } = mergeItems(found);
      await save();
      render();

      const failed = (result.failed || []).length;
      const parts = [`本次识别 ${found.length} 条`, `新增 ${added}`, `更新 ${updated}`];
      if (failed) parts.push(`${failed} 张卡片解析失败`);
      parts.push("继续滚动页面可以加载更多职位，再点一次扫描即可追加");
      setStatus(parts.join("，"), "ok");
    } catch (err) {
      setStatus(`扫描失败：${err && err.message ? err.message : err}`, "error");
    } finally {
      el.scan.disabled = false;
    }
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function exportCsv() {
    if (!items.length) {
      setStatus("没有可导出的数据", "error");
      return;
    }
    const text = globalThis.Exporters.toCsv(items, true);
    download(`boss-jobs-${stamp()}.csv`, text, "text/csv;charset=utf-8");
    setStatus(`已导出 ${items.length} 条 CSV`, "ok");
  }

  function exportJson() {
    if (!items.length) {
      setStatus("没有可导出的数据", "error");
      return;
    }
    const text = globalThis.Exporters.toJson(items);
    download(`boss-jobs-${stamp()}.json`, text, "application/json;charset=utf-8");
    setStatus(`已导出 ${items.length} 条 JSON`, "ok");
  }

  function clearAll() {
    if (!items.length) {
      setStatus("列表已经是空的", "error");
      return;
    }
    if (!confirm(`确定清空 ${items.length} 条记录？此操作不可撤销。`)) return;
    items = [];
    save().then(() => {
      render();
      setStatus("已清空", "ok");
    });
  }

  el.scan.addEventListener("click", scanCurrentPage);
  el.exportCsv.addEventListener("click", exportCsv);
  el.exportJson.addEventListener("click", exportJson);
  el.clear.addEventListener("click", clearAll);

  load();
})();
