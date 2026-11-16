/**
 * 适配器与导出工具的断言集（不依赖 chrome API）。
 * 用法：在 tests/test-page.html 里加载后调 BossAssertions.run()。
 */

(function () {
  "use strict";

  const results = [];

  function check(name, actual, expected) {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ name, pass, actual, expected });
    return pass;
  }

  function checkTrue(name, cond, detail) {
    results.push({ name, pass: Boolean(cond), actual: detail, expected: "truthy" });
    return Boolean(cond);
  }

  /** 把码点数字串转成 PUA 字符，避免源码里出现不可见字符。 */
  function pua(text) {
    return text.replace(/\{([0-9A-Fa-f]{4})\}/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  function run() {
    results.length = 0;
    const A = globalThis.BossAdapter;
    const E = globalThis.Exporters;

    checkTrue("适配器已加载", Boolean(A), typeof A);
    checkTrue("导出工具已加载", Boolean(E), typeof E);

    // 薪资还原：40-70K·15薪
    check(
      "restoreSalary 还原带薪字与中点",
      A.restoreSalary(pua("{E035}{E031}-{E038}{E031}K·{E032}{E036}薪")),
      "40-70K·15薪"
    );
    check("restoreSalary 还原纯 K 区间", A.restoreSalary(pua("{E033}{E035}-{E035}{E036}K")), "24-45K");
    check(
      "restoreSalary 还原日薪",
      A.restoreSalary(pua("{E036}{E031}{E031}-{E036}{E036}{E031}元/天")),
      "500-550元/天"
    );
    check("restoreSalary 无 PUA 时原样返回", A.restoreSalary("20-30K"), "20-30K");
    checkTrue("hasPua 能识别私有区字符", A.hasPua(pua("{E031}{E032}")), true);
    check("hasPua 对普通数字为假", A.hasPua("20-30K"), false);

    // 薪资检查
    checkTrue("checkSalary 接受区间薪", A.checkSalary("20-30K").ok, A.checkSalary("20-30K"));
    checkTrue("checkSalary 接受带薪数字", A.checkSalary("40-70K·15薪").ok, A.checkSalary("40-70K·15薪"));
    checkTrue("checkSalary 接受日薪", A.checkSalary("500-550元/天").ok, A.checkSalary("500-550元/天"));
    checkTrue("checkSalary 接受面议", A.checkSalary("面议").ok, A.checkSalary("面议"));
    checkTrue("checkSalary 拒绝未还原的 PUA", !A.checkSalary(pua("{E031}{E032}K")).ok, A.checkSalary(pua("{E031}{E032}K")));
    checkTrue("checkSalary 拒绝空值", !A.checkSalary("").ok, A.checkSalary(""));
    checkTrue("checkSalary 拒绝区间倒挂", !A.checkSalary("50-30K").ok, A.checkSalary("50-30K"));

    // 链接与 ID
    check(
      "jobIdFromUrl 提取 ID",
      A.jobIdFromUrl("https://www.zhipin.com/job_detail/87892214777757a10nJz3925EFRX.html"),
      "87892214777757a10nJz3925EFRX"
    );
    check(
      "jobIdFromUrl 忽略 query",
      A.jobIdFromUrl("https://www.zhipin.com/job_detail/abc123.html?lid=x&securityId=y"),
      "abc123"
    );
    check("jobIdFromUrl 非职位页返回空", A.jobIdFromUrl("https://www.zhipin.com/web/geek/jobs"), "");

    // 卡片解析
    const root = document.getElementById("fixture");
    const cards = A.findCards(root);
    check("findCards 找到 3 张卡片", cards.length, 3);

    const first = A.extractCard(cards[0]);
    check("extractCard 职位名", first.title, "Agent 开发工程师");
    check("extractCard 薪资已还原", first.salary, "40-70K·15薪");
    checkTrue("extractCard 薪资通过检查", first.salary_unverified === false, first.salary_unverified);
    check("extractCard 公司", first.company, "北京智研科技有限公司");
    check("extractCard 地区", first.location, "北京·朝阳区");
    check("extractCard 经验", first.experience, "3-5年");
    check("extractCard 学历", first.education, "本科");
    check("extractCard job_id", first.job_id, "87892214777757a10nJz3925EFRX");
    check("extractCard 链接已去 query", first.url, "https://www.zhipin.com/job_detail/87892214777757a10nJz3925EFRX.html");

    const missingSalary = A.extractCard(cards[2]);
    checkTrue("extractCard 标记无法识别的薪资", missingSalary.salary_unverified === true, missingSalary.salary_unverified);

    const scan = A.scan(root);
    check("scan 返回 3 条", scan.items.length, 3);
    check("scan 无解析失败", scan.failed.length, 0);

    // 导出
    const csv = E.toCsv(scan.items);
    checkTrue("CSV 含 BOM", csv.charCodeAt(0) === 0xfeff, csv.charCodeAt(0));
    checkTrue("CSV 表头正确", csv.includes("职位名") && csv.includes("薪资"), csv.split("\r\n")[0]);
    check("CSV 行数 = 表头 + 3", csv.trim().split("\r\n").length, 4);
    check("guardFormula 给 = 开头加引号", E.guardFormula("=1+1"), "'=1+1");
    check("escapeCell 给含逗号的单元格加引号", E.escapeCell("a,b"), '"a,b"');
    check("escapeCell 把内部引号翻倍", E.escapeCell('say "hi"'), '"say ""hi"""');

    const failed = results.filter((r) => !r.pass);
    return { results, passed: results.length - failed.length, failed: failed.length, allPass: failed.length === 0 };
  }

  globalThis.BossAssertions = { run, pua };
})();
