# REEFSCAPE 优化记录

本次修改在 REEFSCAPE 自己的仓库内完成，运行时不依赖上级 REBUILT 项目。
物理引擎、比赛规则和 AI 权重保持原值。

## 稳定性与正确性

- 单场比赛和批次计算使用同一套 Worker 流程；不支持 Worker 时逐场让出主线程。
- Worker 故障会结束等待请求，后续任务可重新创建 Worker；计算本身报错时不重复执行。
- 取消任务会中止 Worker，或在本地降级路径的下一场比赛开始前停止；保留原回放。
- 修复批次结束引用未定义 `e` 的问题，恢复连续两批的对比。
- 阵容、策略、镜像开关及场景在开始计算时保存；回放、导出和结果标注使用实际输入。
- 补全 HUMAN PLAYER、CAGE 高度、接触犯规等批次对比字段。
- 修正均值置信区间被标成单场比赛波动范围、以及非 Greedy 策略被标成 Greedy 的文字。
- 导入先检查格式、时间顺序和必要数据，再替换当前回放；读取失败不影响已有比赛。

## 性能与体验

- Worker 和本地降级共用 `simulation.js`，批次聚合只保留所需的最终账本。
- 比分与库存按回放锚点更新；犯规条只在已发生犯规数量变化时更新。
- 画布尺寸仅在布局改变时重新测量，保留动态机器人与场地状态的逐帧绘制。
- 回放使用记录的时间戳，兼容不同采样间隔；调整速度时重新设置计时起点，避免跳帧。
- 增加任务取消、状态播报、进度语义和标签页方向键导航；原生按钮保留空格操作。
- 导入会停止旧播放，文件选择器复位后可以再次选择同一文件；导出延迟释放下载 URL。

## 模块与验证

`worker-client.js` 管理通信与取消；`simulation.js` 统一计算与降级执行；
`replay.js` 管理时间定位和导入校验。UI 专注配置、结果与操作反馈。

- `npm test`：Worker 生命周期、取消、降级调度、导入校验、时间定位及计算结果等价性。
- `npm run check`：编码、HTML 标签及脚本语法检查。
- `npm run verify`：原有引擎不变量、回放指纹、镜像及策略检查。
- `npm run validate`：check、test、audit、verify、rp。

本地降级只能在完整 MATCH 之间响应取消，无法中断正在执行的同步物理循环。
这不是逐帧的 Web Worker 替代方案；有 Worker 支持时仍优先后台执行。

## 2026-10-22 批次：能核对的数字、能保存的设置、能导入的记录

这一批没有改物理引擎：引擎指纹 `ad0911e7`（249-255 帧锚点）保持不动，改的是"页面说的数字能不能被
复现"，以及"能不能不用手填二十四个字段"。

### 把记住的数字变成测量

- `scripts/rp.mjs`（`npm run rp`）按 Table 6-2 逐场重判每个联盟侧的 RP，再和引擎记账的值对比；
  不一致就退出非零。结论：四道非胜利 RP 里有三道在同一批里没有区分力，CORAL 档在镜像里跟着对手的
  PROCESSOR 走。页面图例改成从 `POINTS` 常量生成，`npm run check` 盯住它不许再写死数字。
- `scripts/cards.mjs`（`npm run cards`）给 §6.6.2 的黄牌阶梯定价：规则实现了，但在出厂标定下
  144 场只产生 11 次警告、0 次升级；用 `contactImpairP: 0.5` 强制触发时才付出 −5.35 ± 1.43 到
  −6.81 ± 2.13 的代价。开关 `chk-cardladder` 默认开，关掉的臂是"另一场比赛"，不是同一场重掷。
- 批次卡片上"每场让出 X 分"长期打印 0：批次只保留 `final`，而 `aggregate()` 读 `foulLog`。已修。

### 设置变成字节

- `web/js/statestore.js`：一张卡按"预设序号 + 与预设不同的字段"编码，纯 JS 的 base64url，自动存进
  localStorage（600 ms 防抖），同一串字节也能写进 `#s=` 链接。链接里的一切都是敌意输入：未知字段
  丢弃并报名、`placeSec` 之类的嵌套对象拒绝、`__proto__` 作为自有键碰不到 `Object.prototype`、
  版本不符整份拒收、超长不截断而是报错。
- 卡片新增 `AUTO CORAL`（`autoCycles`）输入：§6.4 里 AUTO 是脚本，场数属于机器人而不是司机。
- 浏览器走查发现的真 bug：`buildSetup()` 重建 CAGE 行时把 §6.3.5 的深浅勾选抹回出厂样式，
  链接和 CSV 里的 CAGE 选择因此丢失。已改为携带现有勾选，`check_web.mjs` 同时锁住两半。

### scouting CSV 导入

- `web/js/scouting.js` + `#btn-import-scouting`：24 个表头、别名、逗号/分号/Tab、`#` 注释行、空单元格。
  过程量（速度、抓取、爬梯）写它自己那个时钟字段；结果量（`auto_coral`、`teleop_coral`、`barge_points`）
  按 `model.js` 已有的办法兑现——AUTO 列就是脚本场数，BARGE 列按 Table 6-2 的 4 分界决定要不要 DEEP，
  每场 CORAL 数用同一个 `REF_CORAL_PER_ROBOT = 16.5` 拟合缩放整条时间线。
- 越界必报：160 lb 变成 115 会把两个数和 R103 一起打印；`cycle_s`、`net_algae`、`opr` 这类列被点名拒绝并
  给出应该填哪一列（整圈耗时含行驶段，而行驶段是模型从场地算出来的，收进来就是付两遍）。
- `docs/scouting-example.csv` 是能被页面读的文件，`npm run check` 会重新解析它并要求每个表头都在 README 的
  表里出现；三个变异（改一个表头、加一列 `opr`、删一格 README）都能把守卫变红。

### 工程收口

- `scripts/audit.mjs`（`npm run audit`）：README、`web/index.html`、`OPTIMIZATION.md` 里每个小数和
  八位十六进制指纹，必须满足三条之一——出现在已提交的代码里；所在段落点名一条 `package.json` 真有的命令
  （`npm run measure`、`scripts/cards.mjs` 这类）；或者记进 `docs/uncited-numbers.txt` 的欠账表。
  欠账表只能变短：新数字要报错，条目对应的说法已经修好的也要报错。本次收口时表里记着 85 条来自 ad-hoc
  探针的说法。`scripts/record.mjs`（`npm run record`）把测量脚本重跑一遍写到 `.tmp/measurements.txt`
  （不入库），把这份文件交给 audit 后，检查就从"段落有没有点命令"升级成"这台机器上命令确实打印过这个数"。
- `.githooks/pre-push`：静态层（check + test + audit）每次都跑；只有本次推送范围碰到引擎文件才跑
  `npm run verify`。需要用户自己启用一次：`git config core.hooksPath .githooks`。
- 删掉 package.json 里没人文档化的 `all`；`npm run check` 现在要求文档里写出的每个 `npm run X` 都真的存在。
