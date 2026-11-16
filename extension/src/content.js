/**
 * 页面注入入口。
 *
 * 由侧边栏在用户点击「扫描当前页」后注入，执行一次扫描并把结果挂到
 * globalThis.__bossLastScan，侧边栏再用第二个 executeScript 读回。
 */

(function () {
  "use strict";

  const adapter = globalThis.BossAdapter;
  if (!adapter) {
    globalThis.__bossLastScan = { error: "适配器未加载" };
    return;
  }

  try {
    if (!adapter.looksLikeJobList(document)) {
      globalThis.__bossLastScan = {
        error: "当前页面不是职位列表页，请打开 BOSS 直聘的职位搜索页后再扫描",
        page: { url: location.href, path: location.pathname, title: document.title },
      };
      return;
    }
    globalThis.__bossLastScan = adapter.scan(document);
  } catch (err) {
    globalThis.__bossLastScan = {
      error: `扫描出错：${err && err.message ? err.message : err}`,
    };
  }
})();
