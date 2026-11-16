/**
 * BOSS 直聘页面适配器。
 *
 * 约定：本文件不依赖任何 chrome API，也不依赖外部库，
 * 可以直接在 tests/test-page.html 里当普通脚本加载做回归。
 */

(function () {
  "use strict";

  /**
   * 薪资数字被放在 Unicode 私有区，U+E031–U+E03A 依次对应 0–9。
   * 映射验证见 docs/salary-ocr-validation-result.md（搜索页 15/15 全部正确）。
   */
  const PUA_FIRST = 0xe031;
  const PUA_LAST = 0xe03a;
  const DIGIT_ZERO = 0x30;

  const SALARY_PATTERNS = [
    /^\d+(?:-\d+)?K$/, // 20-30K
    /^\d+(?:-\d+)?K·\d+薪$/, // 40-70K·15薪
    /^\d+(?:-\d+)?元\/天$/, // 500-550元/天
  ];

  const SALARY_PLAIN = ["面议", "薪资面议"];

  /** 把私有区码点还原成数字字符，其它字符原样保留。 */
  function restoreSalary(text) {
    if (!text) return "";
    let out = "";
    for (const ch of text) {
      const code = ch.codePointAt(0);
      if (code >= PUA_FIRST && code <= PUA_LAST) {
        out += String.fromCharCode(DIGIT_ZERO + (code - PUA_FIRST));
      } else {
        out += ch;
      }
    }
    return out;
  }

  /** 有没有私有区字符，用来判断这一条到底需不需要还原。 */
  function hasPua(text) {
    if (!text) return false;
    for (const ch of text) {
      const code = ch.codePointAt(0);
      if (code >= PUA_FIRST && code <= PUA_LAST) return true;
    }
    return false;
  }

  /**
   * 薪资合理性与格式检查。
   * 返回 { ok, reason }。ok 为 false 时，调用方不应把它当确定值导出。
   */
  function checkSalary(text) {
    const value = (text || "").trim();
    if (!value) return { ok: false, reason: "薪资为空" };
    if (SALARY_PLAIN.includes(value)) return { ok: true, reason: "" };

    const matched = SALARY_PATTERNS.some((re) => re.test(value));
    if (!matched) return { ok: false, reason: `格式不认识：${value}` };

    // 区间检查：下限不得大于上限。K 月薪上限 500，元/天上限 5000
    const range = value.match(/^(\d+)(?:-(\d+))?/);
    if (range) {
      const low = Number(range[1]);
      const high = range[2] ? Number(range[2]) : low;
      if (!Number.isFinite(low) || !Number.isFinite(high)) {
        return { ok: false, reason: "数值解析失败" };
      }
      if (low > high) return { ok: false, reason: `下限大于上限：${value}` };
      const isDaily = value.includes("元/天");
      const upper = isDaily ? 5000 : 500;
      if (low < 1 || high > upper) return { ok: false, reason: `数值超出范围：${value}` };
    }
    return { ok: true, reason: "" };
  }

  /** 从职位链接里取稳定 ID，取不到返回空串。 */
  function jobIdFromUrl(href) {
    if (!href) return "";
    try {
      const path = new URL(href, location.href).pathname;
      const m = path.match(/\/job_detail\/([^/.]+)\.html/);
      return m ? m[1] : "";
    } catch (e) {
      return "";
    }
  }

  /** 规范化为不带查询参数的绝对链接，用于去重和导出。 */
  function normalizeUrl(href) {
    if (!href) return "";
    try {
      const u = new URL(href, location.href);
      return u.origin + u.pathname;
    } catch (e) {
      return href;
    }
  }

  function textOf(el) {
    return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  /** 依次尝试多个选择器，返回第一个命中的元素。 */
  function pick(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /**
   * 定位卡片。
   * 先按已知容器类名取，取不到再退回「从职位链接向上找最近的列表项」。
   * 这样类名变了也不至于整页扫空。
   */
  function findCards(root) {
    const byClass = Array.from(root.querySelectorAll("li.job-card-box"));
    if (byClass.length > 0) {
      return byClass.map((card) => ({
        card,
        link: card.querySelector('a[href*="/job_detail/"]'),
      }));
    }

    const links = Array.from(root.querySelectorAll('a[href*="/job_detail/"]'));
    const seen = new Set();
    const out = [];
    for (const link of links) {
      const card = link.closest("li") || link.closest('div[class*="job-card"]');
      if (!card || seen.has(card)) continue;
      seen.add(card);
      out.push({ card, link });
    }
    return out;
  }

  /**
   * 把薪资文本拆成可统计的区间。
   * 月薪与日薪分开记，`·15薪` 单独体现在 unit 里，避免和普通月薪混算。
   * @param {string} text 已还原的薪资文本。
   * @returns {{min:number, max:number, unit:string}}
   */
  function parseSalaryBounds(text) {
    const value = String(text || "").trim();
    const empty = { min: 0, max: 0, unit: "" };
    if (!value || SALARY_PLAIN.includes(value)) return empty;

    const daily = value.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*元\/天/);
    if (daily) {
      return { min: Number(daily[1]), max: Number(daily[2]), unit: "日薪" };
    }

    const monthly = value.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*K\s*(?:·\s*(\d+)\s*薪)?/);
    if (monthly) {
      const unit = monthly[3] ? `月薪·${monthly[3]}薪` : "月薪";
      return { min: Number(monthly[1]), max: Number(monthly[2]), unit };
    }

    const single = value.match(/^(\d+(?:\.\d+)?)\s*K$/);
    if (single) {
      const n = Number(single[1]);
      return { min: n, max: n, unit: "月薪" };
    }

    return empty;
  }

  /** 解析单张卡片。缺字段时写进 warnings，不抛异常。 */
  function extractCard(entry) {
    const { card, link } = entry;
    const warnings = [];

    const titleEl = pick(card, [".job-name", 'a[href*="/job_detail/"]']);
    const title = textOf(titleEl);

    const href = link ? link.getAttribute("href") : titleEl?.getAttribute("href");
    const url = normalizeUrl(href);
    const jobId = jobIdFromUrl(href);

    const rawSalary = textOf(pick(card, [".job-salary", 'span[class*="salary"]']));
    const salary = hasPua(rawSalary) ? restoreSalary(rawSalary) : rawSalary;
    const salaryCheck = checkSalary(salary);
    const salaryBounds = parseSalaryBounds(salary);

    const tags = Array.from(card.querySelectorAll(".tag-list li"))
      .map((li) => textOf(li))
      .filter(Boolean);

    const company = textOf(pick(card, [".boss-name", ".company-name"]));
    const locationText = textOf(pick(card, [".company-location", ".job-area"]));

    if (!title) warnings.push("缺职位名");
    if (!url) warnings.push("缺职位链接");
    if (!jobId) warnings.push("缺稳定职位 ID，去重可靠性下降");
    if (!salary) warnings.push("缺薪资");
    else if (!salaryCheck.ok) warnings.push(`薪资待确认（${salaryCheck.reason}）`);
    if (!company) warnings.push("缺公司");

    return {
      job_id: jobId,
      title,
      salary,
      salary_unverified: salary ? !salaryCheck.ok : false,
      salary_min: salaryBounds.min,
      salary_max: salaryBounds.max,
      salary_unit: salaryBounds.unit,
      company,
      location: locationText,
      experience: tags[0] || "",
      education: tags[1] || "",
      job_tags: tags,
      url,
      warnings,
    };
  }

  /** 扫描整页，返回结构化结果。 */
  function scan(root) {
    const doc = root || document;
    const cards = findCards(doc);
    const items = [];
    const failed = [];

    for (const entry of cards) {
      try {
        const item = extractCard(entry);
        if (!item.title && !item.url) {
          failed.push("有一张卡片既没标题也没链接，已跳过");
          continue;
        }
        items.push(item);
      } catch (err) {
        failed.push(`解析卡片出错：${err && err.message ? err.message : err}`);
      }
    }

    return {
      page: {
        url: location.href,
        path: location.pathname,
        title: document.title,
      },
      items,
      failed,
    };
  }

  /** 判断当前页面看起来是不是职位列表页。 */
  function looksLikeJobList(doc) {
    const d = doc || document;
    if (!/\/web\/geek\/jobs/.test(location.pathname)) return false;
    return d.querySelectorAll('a[href*="/job_detail/"]').length > 0;
  }

  globalThis.BossAdapter = {
    restoreSalary,
    hasPua,
    checkSalary,
    parseSalaryBounds,
    jobIdFromUrl,
    normalizeUrl,
    findCards,
    extractCard,
    scan,
    looksLikeJobList,
  };
})();
