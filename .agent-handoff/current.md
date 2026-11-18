# BOSS 岗位采集 当前状态

最后更新：2026-11-16 23:22 · DSH 阿渔

## 仓库

- 地址：`https://github.com/Archer1045/dsh-boss-job-collector`
- 本地：`D:\workSpace\code\boss-job-collector`
- 首次提交 `f5131de`（34 文件 / 4067 行），`main` 已同步到远程（`git ls-remote` 与本地一致）。
- `.gitignore` 排除：`node_modules/`、`.agent-handoff/`、`.tmp/`、`reports/`、`last-run.log`、`*.log`。

## 结构（2026-11-16 深夜改造完成）

仓库根即 DSH 插件，浏览器扩展移到 `extension/`：

```
package.json  index.js  cordis.patch.yml  icon.svg  README.md
src/        插件源码（cdp / collect / detail / skills / boss-adapter）
docs/       DETAIL.md、执行计划 v1/v2、复核意见、薪资验证记录
extension/  浏览器扩展（manifest + src + tests）
locale/
```

- `src/collect.js:21` → `const ADAPTER_URL = new URL("./boss-adapter.js", import.meta.url);`（适配器随包分发，不再依赖仓库结构）
- `extension/tests/v2-unit.mjs` → 从 `../../src/` 引插件模块
- `package.json` 的 `files` 无需改（都在根）

## 一期（已完成、可冻结）

- 浏览器扩展：脱机回归 37/37（`extension/tests/test-page.html`）。
- DSH 插件：工具 `collect_boss_jobs`。
- 薪资：私有区字体按码点还原，`数字 = 码点 − 0xE031`；真实页面 15/15。
- **加载链路三个坑**（`docs/DETAIL.md` 排查表）：`inject` 不能写 `tools`（静默不激活）、宿主包必须绝对路径 import、改完必须重启且工具列表在会话启动时定死。

## 二期（已实施、渔渔复核后返工已完成，待末轮确认）

计划：`docs/execution-plan-v2.md`（v2.2，含渔渔 8.1–8.7 约束）。

### 已完成

| 文件 | 改动 |
| --- | --- |
| `src/detail.js` | 新增。后台标签页打开详情、读 `.job-detail-body`、读完即关；`truncateDescription`（4000 字）、`normalizeCjk`、`titleMatches` 身份校验 |
| `src/collect.js` | `withDetail` / `detailLimit` / `detailOffset`；800ms 节流、单条失败记 `jd_error`、连续 3 条或遇验证码停止 |
| `src/skills.js` | 58 条六类词典、英文词边界正则、`summarizeSkills` 按去重岗位数 |
| `index.js` | 输出加 `detail_*` / `raw_path` / `skill_summary`；每条 JD 只带前 300 字，全文写 `reports/raw/*.json` |
| `src/boss-adapter.js` | `parseSalaryBounds` → `salary_min` / `salary_max` / `salary_unit` |

### 验证（证据：`.agent-handoff/artifacts/20261116-boss-plugin-v2-r3.log`）

- 单元测试 22/22；报告与原始数据一致性断言 7/7。
- 真实页面两批各 20 条：**40/40 详情成功**，0 风控，49 条岗位 39 条抽出技能。
- 一期回归 37/37 仍全过。
- 产出 `reports/boss-jobs-20261116-merged.md` + `reports/raw/boss-jobs-20261116-merged.json`（SHA-256 `f2da11e4…d61ce`）。

### 与计划 8.1 的偏差（已获复核接受）

计划写「点击卡片打开右侧详情面板」，实测不成立（点卡片整页导航、`preventDefault` 后面板为空），改为「后台新标签页打开详情页、读完即关」。其余约束不变。

### 明确保留的限制

1. **跨机器验证只有离线替代，没有第二台真机**——2026-11-16 23:21 用临时 profile + 副本路径 + 假宿主工具包做了四组验证（见下节）。2026-11-17 主人告知另一台电脑连不上 GitHub，真机验证暂时搁置。
2. **8.7 部分端到端用例未测**——连续失败、重复职位、面板未关闭需 mock CDP；纯函数层已覆盖空 JD / 超长 JD / 身份不匹配。
3. 浏览器扩展按约定冻结在一期。

## 插件重装（2026-11-16 23:16 已完成安装，待重启生效）

- 旧注册 `@local/dsh-plugin-boss-jobs`（link 到 `D:\workSpace\code\boss-job-collector\dsh-plugin`）已移除，原因是结构改造后解析失败：
  `dsh: cannot resolve profile bundle "@local/dsh-plugin-boss-jobs" from the dsh installation or C:\Users\Admin\.dsh\profiles\desktop`。
- 用 Plugins 安装本地目录 `D:\workSpace\code\boss-job-collector` → `dsh-boss-job-collector@0.1.0`；写入 `C:\Users\Admin\.dsh\profiles\desktop\package.json`：
  `"dsh-boss-job-collector": "link:D:/workSpace/code/boss-job-collector"`，`dsh.profile.bundles` 末项同名。
- `plugin_manager list_bundles` 复核：availability=profile、enabled=true、installed=true、无 error。
- 顺带修 bug：`index.js:85` 的 `RAW_DIR` 原为 `new URL("../../reports/raw/", import.meta.url)`（旧结构插件在 `dsh-plugin` 子目录时才对），改为 `new URL("./reports/raw/", import.meta.url)`，注释同步改成「插件根目录下的 reports/raw」。
- **生效方式**：desktop profile 由 Electron 独占，`dsh --profile desktop --dump-config` 报
  `error: profile "desktop" is managed exclusively by the Electron application`，所以只能重启 DSH 宿主。

## 跨机器验证（2026-11-16 23:21 离线替代；2026-11-17 起真机验证搁置）

脚本：`.tmp/cross-machine-check.mjs`（假 ctx：`systemPrompt.section` 收集 section、`inject` 直接回调 child、`tools.register` 收集工具名；`CROSS_SERVICE=1` 模拟宿主自带 `defineTool`）。

| 组 | 插件路径 | 宿主 defineTool | DSH_TOOLS_ROOT | 结果 |
| --- | --- | --- | --- | --- |
| A | 原仓库 | 无 | 默认 | `registered=[]`；日志 `Cannot find module 'D:\APP\deepseek\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tools\lib\index.js'` |
| B | 原仓库 | 有 | 默认 | `registered=["collect_boss_jobs"]` ✓ |
| C | 副本 `%TEMP%\boss-cross\repo` | 有 | 默认 | 同 B ✓（与仓库位置无关） |
| D | 副本 | 无 | 假包 `%TEMP%\boss-cross\fake-tools` | `registered=["collect_boss_jobs"]` ✓（覆盖机制有效） |

- 结论：插件不依赖仓库绝对路径，换机器 checkout 后重装 bundle 即可；宿主里 `ctx.tools` 自带 `defineTool`（`index.js:122` 第一分支），A 的失败只出现在「裸 node + asar 单文件」场景。
- 真配置装配验证：`dsh bossverify --from-default-profile headless --dump-config`（临时 profile `C:\Users\Admin\.dsh\profiles\bossverify`，独立 node_modules，`package.json` 加 link 依赖与 bundles）输出含
  ```
  # == dsh-boss-job-collector
  - id: dsh-boss-job-collector
    name: dsh-boss-job-collector
    config:
      port: 9222
      maxBatches: 5
  ```
  说明 bundle 的 `cordis.patch.yml` 在该 profile 装配链里正确合并。临时 profile 验完已删除。
- 未覆盖：headless 里让模型实跑被凭证拦住（`MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"`，账号登录凭证只在 Electron 侧），所以「模型真的调用工具」这层没验；第二台真机仍无（2026-11-17 起搁置，见待办 4）。

## 首次实跑验证（2026-11-17 10:20 通过）

- 今早宿主实际已于 07:36 重启（主进程 PID 40944，GUI `http://127.0.0.1:5413`），会话工具列表里已出现 `collect_boss_jobs`，说明 bundle 加载成功。
- Edge 157 的默认 profile 会忽略 `--remote-debugging-port`（Chromium 136+ 的限制）。绕过办法：建 junction `D:\workSpace\code\boss-job-collector\.tmp\edge-profile-link` → `%LOCALAPPDATA%\Microsoft\Edge\User Data`，用 `--user-data-dir=<junction> --remote-debugging-port=9222` 启动，登录态保留、CDP 可用；BOSS 搜索页（北京 / 后端开发）渲染出 15 张 `li.job-card-box`。
- 首次调用失败：`tool "collect_boss_jobs" returned invalid output: "value.jobs[0].salary_min" is not a declared property (additionalProperties: false)`，`salary_max`、`salary_unit` 同。原因：`src/boss-adapter.js:209-211` 已返回这三个字段，但 `index.js` 的 `JOB_SCHEMA` 没声明，且 `additionalProperties: false`。
- 修复：`index.js` 的 `JOB_SCHEMA` 补 `salary_min` / `salary_max`（number）、`salary_unit`（string），均 required；`node --check index.js` 通过。
- 重启宿主（10:20 前后）后复验：`collect_boss_jobs(batches=1)` 返回 15 条，薪资全部还原（如 `15-25K·14薪`、`45-55K·15薪`），raw 写入 `D:\workSpace\code\boss-job-collector\reports\raw\boss-jobs-20261117-1020.json`，确认 `RAW_DIR` 修复也生效。
- 详情链路复验：`withDetail=true, detailLimit=3` → 详情 3/3 成功，JD 253/300/300 字，技能统计正常（Python 3 / Java 2 / K8s 2 / MCP 2 / RAG 2）。
- 端点验证记录：Edge 157 + junction profile 下 CDP 9222 一直可用；宿主重启不影响 Edge 与页面。

## 剩余待办

1. **（小问题）raw 文件名时间戳只到分钟**：同一分钟内连采两次会互相覆盖（本次批次即遇到）。需要时把 `writeRaw` 的 stamp 加到秒。
2. 技能词典扩充（58 条覆盖不全）。
3. 若要再迭代：把详情页的「任职要求」段落单独切出来做更细的技能归因。
4. **（搁置）真机跨机器实跑**：2026-11-17 主人告知另一台电脑连不上 GitHub，暂时搁置。恢复条件：那台机器网络可用后克隆 `https://github.com/Archer1045/dsh-boss-job-collector` 并 `dsh plugin install`，或改用 U 盘 / 局域网拷贝整个仓库目录（离线验证已证明插件不依赖仓库绝对路径）。

## 教训（写给下一个接手的人）

- **没跑过的输出不许写进结论**。报告里 10 个技能数字是凭印象估的，被渔渔用 SHA-256 锁原始数据抓出来。
- **移动 + 删除不要放在同一个脚本里**。`Move-Item` 因目标已存在失败后，后续 `Remove-Item` 照样执行，删掉了 `docs/DETAIL.md`。
- 声称「已推送」之前必须贴 `git log` / `git remote -v` / `git ls-remote` 的实际输出。
