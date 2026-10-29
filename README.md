# Squeek Forge

把 Squeekchain 的链上 work 变成一座夜班锻造工坊：区块是钢锭，转速驱动砂轮和锻锤，结算是出炉记录。页面页脚署名 **@Despite_zmw**。

应用是单个 `index.html`，CSS、原生 JavaScript、铁匠 SVG 和 favicon 全部内联。没有框架、运行时依赖、钱包、交易、登录或后端。`assets/social.png` 仅供链接分享预览使用；正常页面不依赖外部字体或图片服务。

## 打开、预览与导出

**安装：无需安装依赖。** 直接双击根目录的 `index.html` 即可打开。读取实时数据需要联网；已在 Chromium 的 `file://` 环境验证公开接口的 CORS。

也可以使用任意静态文件服务器，例如：

```sh
python3 -m http.server 8000 --directory .
```

访问 `http://localhost:8000/` 查看源文件。生产导出已放在 `dist/`，无需重新构建即可部署。

修改 `index.html` 后，用 Node.js 20+ 复制生产导出：

```sh
npm run build
# 等价于 node scripts/build.mjs；不需要 npm install
python3 -m http.server 8000 --directory dist
```

`build` 是静态复制和完整性准备步骤，不是编译。它复制 `index.html` 和本地分享图；`dist/index.html` 与源文件逐字节相同。空依赖的 `package.json` / `package-lock.json` 用于记录项目与这些可选开发命令。

## 部署

把 **`dist/` 内的全部内容** 上传到任意静态托管或 IPFS。入口为 `index.html`，分享图使用相对路径 `./assets/social.png`，支持部署在子路径下。无需 SPA 路由重写、服务器密钥或环境配置。此交付包含静态导出，不执行发布或域名绑定。

分享图的可编辑源文件是 `assets/social.svg`；修改画面后应重新导出同尺寸的 `assets/social.png`，再运行复制导出。

## 数据源字段

所有数据均来自以下三个公开 GET 接口。小时的绝对时间统一显示为 **UTC**，相对时间来自记录本身的时间戳。源码的校验器旁也注明了 JSON 路径。

| 接口 | JSON 路径 | 页面用途 | 换算 / 处理规则 |
| --- | --- | --- | --- |
| [`/v1/status`](https://api.squeekchain.com/v1/status) | `measurement.cumulativeWorkUnits` | 累计锤击 | 非负整数，BigInt，千分位 |
| 同上 | `measurement.rpmMilli` | 风箱 rpm、砂轮与锻锤周期 | 除以 1,000；显示最多 3 位小数 |
| 同上 | `measurement.speedMmPerSecond` | 当前速度 | 原值 mm/s，千分位 |
| 同上 | `measurement.coreStatus` | FORGE 灯和炉火状态 | `SPINNING`：琥珀闪烁；`IDLE`：灰色静止；失败时熄灭 |
| 同上 | `builder.anchor.blockHeight` | 当前钢锭编号 / 炉号 | 使用已确认 anchor；不使用 projected |
| 同上 | `builder.anchor.blockProgress` | 熔炉温度条式完成度 | `ratio = Number(value) / 1e9`；文字严格 `Math.floor(ratio * 100) + "%"`，填充使用精确 `ratio` |
| [`/v1/settlements?range=24h`](https://api.squeekchain.com/v1/settlements?range=24h) | `buckets[].startAt` | 柱状图、小时表和悬浮/轻触详情的标签 | 直接读取真实时间戳并按时间排序；从不使用浏览器当前时间重建小时 |
| 同上 | `buckets[].workAdded` | 每小时柱高、演示工位分配 | 文本保留整数精度；canvas 比例计算使用 Number |
| 同上 | `buckets[].settlementCount` | 小时详情中的结算数 | 非负整数、千分位 |
| 同上 | `buckets[].completedBlockCount` | 小时详情中的区块数 | 非负整数、千分位 |
| 同上 | `summary.workAdded` | 24h work 合计 | 优先使用 summary；summary 整体缺失时由有效桶求和 |
| 同上 | `summary.settlementCount` | 24h 结算总数 | 同上，不使用单笔数组的长度冒充 24h 总数 |
| 同上 | `recentSettlements[].settledThroughRound` | 最近出炉轮次 | 优先展示真实单笔，按 `blockTimestamp` 降序 |
| 同上 | `recentSettlements[].workAdded` | 单笔 `+work` | 千分位；真实零 work 记录同样保留 |
| 同上 | `recentSettlements[].completedBlockCount` | 单笔完成区块数 | 千分位 |
| 同上 | `recentSettlements[].blockTimestamp` | 单笔出炉时间 | `<1` 分钟为“刚刚”；其余向下取整为“x 分钟前 / x 小时前”；完整原始时间在 `datetime` / 提示中保留 |
| [`/v1/economy/state`](https://api.squeekchain.com/v1/economy/state) | `supply.totalMintedBaseUnits` | 已铸 SQK | BigInt 除以 `10^18`；展示截取至 4 位小数，避免浮点精度损失；提示保留完整 base units |
| 同上 | `mining.processedThroughRound` | 已完成锻造轮次 | 非负整数、千分位 |

### 演示工位分配

**份额为演示分配，非链上真实矿工身份或地址排行。** 焰心、砺石、墨铁、赤砧、灰烬是固定的工坊角色。

每小时用 `startAt + workAdded + 固定铁匠代号` 做 FNV-1a 确定性哈希，生成五个权重，再以整数最大余数法分配该桶 work。五人总量严格等于桶 work，同一份数据重复刷新不会产生随机排名。排行榜的“增速”比较后 12 个桶与前 12 个桶的演示份额；前期为零时显示“新增”或“持平”。

工位按份额沿共享台面排列，预留自身宽度防止重叠。数据刷新通过 1,100ms 的 CSS transform / left 百分比过渡移动；百分比坐标随容器立即重算，避免桌面缩到手机时旧像素位置撑宽页面。

砂轮周期为 `60 / rpm` 秒，限制在 0.3–12 秒；锻锤周期为 `max(0.7, 砂轮周期 × 1.6)` 秒。只有三个接口均通过校验且状态为 `SPINNING` 时运行动画。可手动暂停，也遵循系统“减少动态效果”偏好。

### 校验、刷新与缓存

- 打开立即并行读取三个接口，每轮完成后 **10 秒**自动再试；“立即刷新”会重置重试计时。单次请求 7.5 秒超时，进行中禁用重复刷新。
- status 必须有非负累计 work、已知 `coreStatus`、anchor 高度和范围内的进度。rpm / speed 缺失时诚实显示“未提供”，不编造转速。
- settlements 必须有 24 个完整有效桶，或非空、完整可渲染的单笔数组。非空单笔数组若格式有误，判失败，不能偷偷改成小时记录。
- economy 必须有有效的 `totalMintedBaseUnits` 和 `processedThroughRound`。
- HTTP 失败、超时、坏 JSON、`200 {}`、缺少必需字段均保留**该接口**的上一份有效数据。其余接口的成功数据仍更新。任一失败都会熄灭 FORGE 灯并显示 **“数据拉取失败，10 秒后重试”**。
- 内存和浏览器 `localStorage` 保存有效缓存。重新打开先重新校验缓存；在网络重新验证成功之前不会标成在线。存储被禁用或损坏时仍可使用内存缓存。
- `recentSettlements` 缺失或为空时，才使用小时汇总，并明确显示“按小时汇总 · 接口暂无单笔记录”。如只有单笔记录而没有完整桶，保留并标注旧小时缓存；无旧缓存就显示小时数据不可用。

## 交互与响应式

顶部可立即刷新；锻造台与排行可相互定位同一位铁匠；右上角暂停 / 播放动画。柱图支持鼠标悬浮、轻触、左右方向键、Home / End、上一 / 下一小时按钮；下方有原生可展开的完整小时表。最近出炉默认五条，可展开接口返回的全部单笔记录。

桌面使用左工坊 / 右排行、左图表 / 右结算的双列。900px 及以下为单列，顺序为锻造台、排行、图表、出炉记录。390px 首屏能看到产品、刷新按钮、关键数字和五名铁匠，无横向滚动。实现细节见 [DESIGN.md](DESIGN.md)。

## 本地检查

基础检查不需要安装依赖：

```sh
npm run build
npm run check
```

可选的严格类型检查与浏览器测试使用仓库外的开发工具，**不要在项目内安装或提交 `node_modules`**。本次使用 Node 24.21、TypeScript 7.0.2、Playwright 1.64.1、axe Playwright 4.14.0：

```sh
npm install --prefix /tmp/squeek-tools --cache /tmp/squeek-npm-cache --ignore-scripts --no-audit --no-fund typescript@7.0.2 playwright@1.64.1 @axe-core/playwright@4.14.0
PLAYWRIGHT_BROWSERS_PATH=/tmp/squeek-browsers /tmp/squeek-tools/node_modules/.bin/playwright install chromium
SQUEEK_TSC=/tmp/squeek-tools/node_modules/.bin/tsc npm run typecheck
PLAYWRIGHT_BROWSERS_PATH=/tmp/squeek-browsers SQUEEK_PLAYWRIGHT=/tmp/squeek-tools/node_modules/playwright/index.mjs SQUEEK_AXE=/tmp/squeek-tools/node_modules/@axe-core/playwright/dist/index.mjs node scripts/validate.mjs
```

`typecheck` 提取内联 JavaScript，以 JSDoc + `checkJs --strict --noEmit` 检查 DOM 与数据类型。`validate.mjs` 自行启动并关闭临时静态服务器，在 `/preview/` 子路径测试实际 `dist/`；先测真实联网，再拦截响应验证错误、缓存、恢复、交互与视口。真实接口快照和临时报告仅写入不提交的 `test/scratch/`。

### 本次实际结果

2026-10-29 UTC，最终源文件与导出上执行：

| 检查 | 实际结果 |
| --- | --- |
| `npm run build` | 成功；完整静态导出 212,119 bytes |
| `npm run typecheck` | 成功；严格 checkJs，零类型错误 |
| `npm run check` | 成功；语法、元数据、静态 ID、确定性分配、零运行时脚本依赖、导出与源文件一致 |
| `node scripts/validate.mjs`（带上述工具环境） | **21 组通过**；真实 CORS 首次全部关键数字加载 **334ms**，正常联网零控制台 / 脚本错误；`file://` 也通过 |
| 断网 / HTTP 503 / 坏 JSON / 三接口各自 `200 {}` | 通过；保留旧值、图表及时间标签，灯熄灭；其他成功接口可更新 |
| 390px、320px、桌面及断点两侧 | 通过；无横向溢出，含立即从桌面缩窄的状态 |
| axe A / AA 扫描 | 390px 和 1440px 均零违规；不等同于人工屏幕阅读器认证 |
| 指定 `taste@1` 探针 | **16 / 16 通过**；涵盖布局、对比度、字体、目标尺寸、动效、元数据等 |
| WebKit | 已尝试启动；缺少 GTK / GStreamer 等宿主库，未完成该引擎验证 |

完整检查覆盖、实际发现与修复、截图和限制见 [artifacts/validation.md](artifacts/validation.md)。以上是本次本地检查记录，不代表外部服务未来的可用性或独立认证。

## 已知限制

- 五位铁匠的份额与增速是公开小时 work 的演示分配，不代表真实矿工、地址、收益或算力归属。
- 外部 API 的可用性、数据延迟与链上确认速度由数据提供方决定。无缓存又无法联网时，页面显示加载失败，不能生成真实数字。
- 缓存仅属于当前浏览器，不是共享后端；关掉浏览器或后台节流可能延迟轮询。小时图仍保留接口原始时间，不随时钟平移。
- 页面展示的是 Sepolia 测试网；SQK 显示截取 4 位小数，canvas 柱高使用浮点近似，完整 work 文本仍为整数。
- 分享图是静态品牌图，不是实时数字截图。部分分享平台可能要求托管后的绝对 `og:image` URL；部署地址未定时保留相对路径。
- 已完成 Chromium 渲染、键盘、模拟触摸、320–1440px 重排与减少动态效果测试。未完成 WebKit、真实手机、人工屏幕阅读器、浏览器原生 200% 缩放与强制高对比模式测试。

## 设计参考署名

设计与六领域复查参考 Jakub Krehel 的 [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface)（MIT）。设计文档方法参考 Paul Bakaus 的 [Impeccable document reference](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md)（Apache-2.0）。原许可证与署名保留于 [artifacts/design-guidance-licenses.txt](artifacts/design-guidance-licenses.txt)。这些是开发参考，不是网站运行时依赖。
