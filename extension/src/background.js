/**
 * Service worker：只做一件事——点扩展图标时打开侧边栏。
 * 扫描、去重、导出都在 panel 里完成。
 */

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("设置侧边栏行为失败", error));
