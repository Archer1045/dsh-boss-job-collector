# BOSS 岗位采集

两件东西，共用一个解析器 `extension/src/boss-adapter.js`：

| 形态 | 给谁用 | 怎么用 |
| --- | --- | --- |
| 浏览器扩展 | 人 | 打开 BOSS 列表页，点扩展图标，侧边栏里点「扫描当前页」，导 CSV / JSON |
| DSH 插件 | 对话 | 在 DSH 里说「扫一下 BOSS，滚两批」，自动采集 + 逐条读 JD + 出分析报告 |

解析逻辑（私有区字体还原、卡片字段抽取、薪资格式校验、技能词典）完全共用，两边只差「怎么拿到 DOM」。

---

## 一、DSH 插件

### 1. 前置条件

- DSH 桌面版已安装并至少启动过一次。
- 浏览器（Edge / Chrome）能用 `--remote-debugging-port` 启动。
- Node 24+（DSH 自带，插件本身零第三方依赖）。

### 2. 安装

把整个 `dsh-plugin` 目录装进 DSH 的 profile：

```
Plugins → Add plugin → 选择目录 D:\workSpace\code\boss-job-collector\dsh-plugin
```

或用命令行把 `package.json` 的 `dsh.profile.bundles` 加上：

```json
"dsh-boss-job-collector": "file:../boss-job-collector/dsh-plugin"
```

装完**必须重启 DSH**。工具列表在会话启动时就固定了，重启前开着的会话看不到新工具。

### 3. 启动浏览器（关键）

插件通过 CDP 连你已经打开的浏览器，**不会自己起一个复制 Cookie 的实例**（那样会被风控）。

Windows 下这样启动：

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\Users\<你>\AppData\Local\Microsoft\Edge\User"
```

要点：

- `--remote-debugging-port=9222` 是插件连的端口，改端口就改插件配置。
- 必须指定你平时用的 `user-data-dir`，否则是全新的空浏览器，没有登录态。
- 启动后手动打开 BOSS 搜索页，等职位卡片渲染出来，再让插件扫。

### 4. 用法

在 DSH 对话里直接说，例如：

- 「扫一下现在这个 BOSS 页面」
- 「扫一下，滚两批」
- 「扫描并读 20 条 JD，给我出分析报告」

对应工具参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `batches` | 1 | 滚动批次，每批滚到底等加载 |
| `port` | 9222 | CDP 端口 |
| `scrollWaitMs` | 1800 | 每批滚动后等待时间 |
| `withDetail` | false | 是否逐条打开详情页读 JD |
| `detailLimit` | 20 | 读多少条 JD（上限 = batches × 20） |
| `detailOffset` | 0 | 从第几条开始读；要分两批读 40 条时，第二批传 20 |

### 5. 配置

`cordis.patch.yml` 里可改：

```yaml
config:
  port: 9222        # CDP 端口
  maxBatches: 5     # 单次最多滚几批
```

**宿主工具包路径**（跨机器部署时要设）：

```powershell
$env:DSH_TOOLS_ROOT = "D:\APP\deepseek\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tools"
```

不设时插件按 `D:\APP\deepseek\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tools\lib\index.js` 找。

> 这条路径是本机安装位置，**换机器必须改**。目前只在当前这台机器上验证过，第二台机器尚未实测——按复核意见，这一项**明确保留为限制**，不声称「换机器即可用」。

### 6. 输出

- 对话里返回：摘要 + 前 15 条岗位 + Top 8 技能。
- 原始数据：`reports/raw/boss-jobs-YYYYMMDD-HHmm.json`（含 JD 全文，可按 `job_id` 回查）。
- 分析报告：由模型基于上面的 JSON 写 `reports/boss-jobs-YYYYMMDD-HHmm.md`。

---

## 二、浏览器扩展

### 加载

`edge://extensions` → 打开「开发人员模式」→「加载解压缩的扩展」→ 选仓库根目录 `boss-job-collector`。

### 使用

打开 BOSS 列表页，点扩展图标打开侧边栏：

- **扫描当前页**：读当前已渲染的卡片，去重合并进本地列表。
- **导出 CSV / JSON**：带 BOM 的 CSV，Excel 直接打开不乱码。
- **清空**：清掉本地已收集的岗位。

侧边栏数据存在 `chrome.storage.local`，上限 1000 条。

---

## 三、限制与边界

- 只读**已渲染**的 DOM，不调站点内部接口、不读 Cookie。
- 不自动翻页；BOSS 是无限滚动，滚到底会加载下一批，所以「扫一次拿不全」是正常的，多扫几次或用 `batches` 滚动。
- 详情逐条在**后台新标签页**打开、读完即关，间隔 800ms；单次上限 20 条，连续 3 条失败或遇到验证码会停。
- 薪资是站点私有区字体（U+E031–U+E03A），按 `码点 − 0xE031` 还原；还原失败的标 `salary_unverified`，不参与统计。
- 技能是用 56 条词典匹配出来的，词表外的表述（比如 Harness、拒答策略）不会自动进频次表，需要在报告里单独说明。

---

## 四、排查

### 工具没出现 / 调用不了

按顺序查：

1. **是否重启过 DSH** —— 工具列表在会话启动时定死，改了插件必须重启。
2. **`inject` 里是否写了 `tools`** —— 写进去会静默不激活（apply 永远不会被调用）。正确做法：`inject = ['systemPrompt']`，`tools` 用 `ctx.inject(['tools'], cb)` 动态等待。
3. **宿主包路径** —— 插件在工作区、宿主包在 `app.asar` 里，按包名 `import('@deepseek-ai/dsh-tools')` 会 `ERR_MODULE_NOT_FOUND`，必须用绝对路径或设 `DSH_TOOLS_ROOT`。
4. **`dsh-plugin/last-run.log`** —— 插件每次启动会写日志，能看到 `[apply] called` / `[tools] registered` / 失败堆栈。

### 连不上浏览器

```
Error: 连不上浏览器调试端口 9222
```

- 浏览器是不是用 `--remote-debugging-port=9222` 启动的。
- 浏览器是否已经在跑另一个实例（同一 `user-data-dir` 只会有一个进程，新启动的会直接退出）。
- 访问 `http://127.0.0.1:9222/json/list` 看有没有目标。

### 薪资是方块

`salary_unverified = true` 表示还有私有区字符没还原。检查 `restoreSalary` 的码点范围是否仍是 `U+E031–U+E03A`（站点换字体就会变）。

---

## 五、目录结构

```
boss-job-collector/
├── manifest.json              浏览器扩展清单
├── src/
│   ├── boss-adapter.js        解析器（零 chrome API，两边共用）
│   ├── exporters.js           CSV / JSON 导出
│   ├── content.js             扩展的注入入口
│   ├── background.js          侧边栏行为
│   ├── panel.html / panel.js  侧边栏界面
│   └── styles.css
├── dsh-plugin/                DSH 插件
│   ├── index.js               工具注册（collect_boss_jobs）
│   ├── cordis.patch.yml       插件配置
│   ├── src/cdp.js             CDP 连接
│   ├── src/collect.js         采集 + 详情
│   ├── src/detail.js          详情页读取与文本处理
│   ├── src/skills.js          技能词典与统计
│   └── docs/DETAIL.md         安装与排查细节
├── tests/                     扩展的脱机回归（双击 test-page.html）
├── reports/                   采集产物（raw/ 下是原始 JSON）
└── docs/                      计划与验证记录
```

---

## 六、验证现状

| 项 | 状态 |
| --- | --- |
| 扩展脱机回归 | 37/37 通过（`tests/test-page.html`） |
| 二期单元测试 | 22/22 通过（`node tests/v2-unit.mjs`） |
| 报告与 raw 一致性 | 7/7 通过（`node .tmp/check-report-vs-raw.mjs`） |
| 真实页面采列表 | 通过（49 条） |
| 真实页面读 JD | **40/40 成功**（分两批各 20 条），0 风控 |
| 制品清单 | `.agent-handoff/artifacts/manifest.json`（含 SHA-256 与读回结果） |
| 跨机器验证 | **未做，明确保留为限制** |
