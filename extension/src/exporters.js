/**
 * 导出工具：CSV / JSON。
 * 不依赖 chrome API，方便在浏览器里单独测。
 */

(function () {
  "use strict";

  const CSV_HEADERS = [
    ["job_id", "职位ID"],
    ["title", "职位名"],
    ["salary", "薪资"],
    ["company", "公司"],
    ["location", "地区"],
    ["experience", "经验"],
    ["education", "学历"],
    ["job_tags", "职位标签"],
    ["url", "职位链接"],
    ["source_page", "来源页"],
    ["collected_at", "采集时间"],
    ["note", "备注"],
  ];

  /** 以 = + - @ 开头的单元格会被 Excel 当公式执行，前面补一个单引号。 */
  function guardFormula(value) {
    const s = String(value == null ? "" : value);
    return /^[=+\-@]/.test(s) ? `'${s}` : s;
  }

  /** CSV 单元格转义：含分隔符或引号时用双引号包裹，内部引号翻倍。 */
  function escapeCell(value) {
    const s = guardFormula(value);
    if (/[",\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function cellValue(row, key) {
    const v = row[key];
    if (Array.isArray(v)) return v.join(" / ");
    return v == null ? "" : v;
  }

  /** 生成 CSV 文本（含 BOM，Excel 打开中文不乱码）。 */
  function toCsv(rows, withBom) {
    const lines = [CSV_HEADERS.map(([, label]) => escapeCell(label)).join(",")];
    for (const row of rows) {
      lines.push(CSV_HEADERS.map(([key]) => escapeCell(cellValue(row, key))).join(","));
    }
    const body = lines.join("\r\n");
    return withBom === false ? body : `\ufeff${body}`;
  }

  /** 生成 JSON 文本（UTF-8 无 BOM）。 */
  function toJson(rows) {
    return JSON.stringify(rows, null, 2);
  }

  globalThis.Exporters = { toCsv, toJson, guardFormula, escapeCell };
})();
