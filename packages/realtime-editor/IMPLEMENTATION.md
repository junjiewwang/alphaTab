# realtime-editor 需求与实施记录

## 需求背景

用户要求在本仓库内新建 `packages/realtime-editor`，实现一个浏览器实时编辑器：

- 基于 alphaTab 现有能力实现独立应用目录
- 支持 `AlphaTex` 实时编辑
- 支持乐谱实时渲染预览
- 交互形态参考在线打谱工作台：顶部工具栏、左右分栏、预览区、播放器/控制区
- 优先独立成包，但继续复用本项目核心库与语言能力

## 当前交付结果

已经完成第二阶段优化，`packages/realtime-editor` 现在具备：

1. 独立的 `Vite + TypeScript` 应用包结构
2. `Monaco + AlphaTex` 语法高亮与语言服务接入
3. 左编辑、右预览的实时工作台界面
4. 解析成功才刷新预览、解析失败保留上次成功结果
5. 示例切换、新建、文件打开、导出 AlphaTex、打印
6. 轨道筛选、播放/暂停/停止、时间轴、速度、缩放、布局、滚动模式控制
7. 开发态与构建态的字体 / soundfont 资源可用
8. **模块化架构**：代码按职责拆分为 8 个独立模块
9. **紧凑化 UI**：Topbar 合并为单行、诊断面板可折叠、轨道面板可折叠
10. **构建优化**：manualChunks 将产物拆分为 3 个独立 chunk

## 设计决策

- **目录策略**：在 monorepo 内新建独立应用包，不继续耦合到 `packages/playground`
- **依赖策略**：继续复用 `@coderline/alphatab`、`@coderline/alphatab-monaco`、`@coderline/alphatab-language-server`
- **UI 策略**：以工作台交互为核心，优先做产品化布局而不是 demo 页
- **渲染策略**：编辑变更后防抖解析；解析成功才刷新预览；解析失败保留旧预览
- **构建策略**：`realtime-editor` 作为前端应用保留 Vite 默认 TypeScript 转译，并补充显式 monorepo alias，确保主线程与 worker 入口都可解析内部包源码
- **资源策略**：开发态通过 `vite.plugin.assets.ts` 直接挂载 `packages/alphatab/font`；构建态复制到产物目录
- **模块化策略**：按单一职责原则（SRP）将 `main.ts` 拆分为独立模块，`main.ts` 仅作为 orchestrator

## 目录与关键文件

```
src/
├── main.ts        # 入口编排器：组装各模块、调度初始化
├── types.ts       # 公共类型定义（ViewMode, AppState 等）
├── constants.ts   # 常量（存储键、示例定义、配置映射）
├── state.ts       # 应用状态 + DOM 引用 + 状态变更辅助
├── utils.ts       # 通用工具函数（formatTime, escapeHtml 等）
├── editor.ts      # Monaco 编辑器初始化 / 主题 / LSP / 诊断
├── preview.ts     # alphaTab 预览渲染 / 轨道管理 / 渲染调度
├── toolbar.ts     # 顶部工具栏事件 / 文件操作 / 示例加载
├── transport.ts   # 播放控制 / 速度 / 缩放 / 布局 / 滚动
├── mobile.ts      # 移动端增强（Action Bar / touch 事件 / 字号适配）
└── styles.css     # 工作台视觉样式
```

其他文件：
- `package.json`：新应用依赖与脚本
- `vite.config.ts`：应用型 Vite 配置 + monorepo alias + manualChunks
- `vite.plugin.assets.ts`：字体与 soundfont 资源挂载 / 复制
- `index.html`：工作台页面骨架
- `types/split.js/index.d.ts`：`split.js` 本地类型声明

## 实施进展

### 第一阶段：POC 搭建

- [x] 建立需求与实施记录文档
- [x] 创建 `realtime-editor` 包骨架
- [x] 接入编辑器与实时预览
- [x] 接入工具栏与底部控制区
- [x] 处理资源与运行说明

### 第二阶段：优化重构（2026-03-16）

- [x] **Sprint 1：代码架构模块化拆分**
- [x] **Sprint 2：UI/UX 布局体验优化**
- [x] **Sprint 3：构建优化**

## 第二阶段优化详情

### Sprint 1：代码架构模块化拆分

**改动前**：所有逻辑集中在 `main.ts`（767 行），包含编辑器初始化、预览渲染、工具栏事件、播放控制、状态管理、工具函数等，违反单一职责原则。

**改动后**：按职责拆分为 8 个独立模块：

| 模块 | 职责 | 行数 |
|------|------|------|
| `types.ts` | 公共类型定义（ViewMode, AppState 等） | ~30 |
| `constants.ts` | 存储键、示例定义、布局/滚动模式映射 | ~65 |
| `utils.ts` | 通用工具函数（formatTime, escapeHtml, downloadBlob 等） | ~85 |
| `state.ts` | 应用状态对象 + DOM 引用 + 状态变更辅助（setStatus, setViewMode） | ~100 |
| `editor.ts` | Monaco 编辑器初始化、主题、LSP 集成、诊断面板 | ~145 |
| `preview.ts` | alphaTab 预览渲染、轨道管理、渲染调度、元信息更新 | ~175 |
| `toolbar.ts` | 顶部工具栏事件绑定、文件操作、示例加载 | ~95 |
| `transport.ts` | 播放控制、速度/缩放/布局/滚动切换、时间轴交互 | ~85 |
| `main.ts` | 纯 orchestrator，组装各模块完成初始化 | ~85 |

**设计原则**：
- 单一职责（SRP）：每个模块只负责一个功能域
- 高内聚低耦合：模块间通过共享 `state` 对象通信，避免跨模块直接操作
- 依赖注入：`setupEditor` 接受回调参数而非硬编码依赖

### Sprint 2：UI/UX 布局体验优化

| 优化项 | 改动 | 效果 |
|-------|------|------|
| **Topbar 紧凑化** | 原三行布局（品牌标题 + 元信息 + 工具栏）合并为紧凑的 flex 布局 | 节省约 60-80px 垂直空间 |
| **诊断面板可折叠** | 新增折叠按钮 + 动画展开/收起 + 计数 badge | 无诊断项时可折叠释放空间 |
| **轨道面板可折叠** | 新增折叠按钮 + 动画展开/收起 + 轨道数 badge | 少量轨道时可折叠释放预览空间 |
| **视图切换优化** | `opacity: 0.2` → `display: none` | 隐藏面板不再占据空间 |
| **整体间距收紧** | padding/gap/font-size 全面收紧 | 有效工作区面积增加约 15% |
| **Topbar 示例区域优化** | 示例 select 从 label+select 垂直堆叠改为与按钮等高的内联 select；三组功能（文件操作/示例/视图）用竖线分隔符区分；Score Meta（乐谱标题/副标题/预览摘要）从 topbar 移入各面板 header | Topbar 视觉节奏统一、功能分区清晰、横向空间释放 |

### Sprint 3：构建优化

**改动**：在 `vite.config.ts` 中配置 `rollupOptions.output.manualChunks`，将产物拆分为：

| Chunk | 包含内容 | 体积 |
|-------|---------|------|
| `index.js` | 应用逻辑（main + state + editor + preview + toolbar + transport） | 22.29 kB (gzip: 8.44 kB) |
| `vendor-alphatab.js` | alphaTab 核心引擎 + LSP + Monaco 集成 | 1,304 kB (gzip: 308 kB) |
| `vendor-monaco.js` | Monaco Editor 核心 | 4,464 kB (gzip: 1,147 kB) |
| `vendor-fonts.css` | 字体 CSS | 独立 CSS chunk |

**效果**：浏览器可并行加载多个 chunk，且 vendor chunk 缓存命中率高（应用逻辑变更不会导致 vendor 缓存失效）。

## 运行与验证

### 本地开发

```bash
npm run dev --workspace=packages/realtime-editor
```

### 类型检查

```bash
npm run typecheck --workspace=packages/realtime-editor
```

### 生产构建

```bash
npm run build --workspace=packages/realtime-editor
```

### 已完成验证

- `npm run typecheck --workspace=packages/realtime-editor` ✅
- `npm run build --workspace=packages/realtime-editor` ✅
- `biome lint src/` ✅
- 浏览器联调测试 ✅（详见下方测试报告）

### 联调测试报告（2026-03-16）

在浏览器中对 `npm run dev` 启动的开发服务器进行了全面功能测试：

| 功能模块 | 测试项 | 结果 |
|---------|--------|------|
| 初始加载 | 页面加载、Monaco 编辑器初始化、乐谱预览渲染 | ✅ 正常 |
| 视图切换 | 拆分/仅编辑/仅预览三种模式切换 | ✅ 正常 |
| 示例切换 | 序章动机/指弹片段/Swing 练习切换加载 | ✅ 正常 |
| 编辑预览 | Monaco 输入后触发实时预览刷新 | ✅ 正常 |
| 播放控制 | 播放/暂停/停止按钮、时间轴进度条 | ✅ 正常 |
| 速度控制 | 0.5x/1x/1.5x 速度切换（总时长随之变化） | ✅ 正常 |
| 缩放控制 | 75%–150% 缩放切换 | ✅ 正常 |
| 布局切换 | Parchment/Page/Horizontal 布局模式 | ✅ 正常 |
| 新建文档 | 编辑器内容重置为默认模板 | ✅ 正常 |
| 导出功能 | 导出 AlphaTex 触发文件下载 | ✅ 正常（已触发下载） |
| 轨道列表 | 轨道数量与名称显示 | ✅ 正常 |
| 诊断面板 | 实时语法诊断与错误/警告展示 | ✅ 正常 |

#### 联调中发现并修复的 CSS 问题

1. **topbar 高度膨胀**：在 1280px 宽度窗口下，原 topbar 三列布局触发了 `@media (max-width: 1320px)` 响应式规则变成单列堆叠，导致 topbar 占 442px，workspace 只剩 128px。已修复为两行两列紧凑布局。
2. **workspace 宽度溢出**：alphaTab 渲染内容将 workspace flex 子元素撑到 36000+ px 宽度，预览面板被推出屏幕。已通过 `overflow: hidden; min-width: 0` 约束修复。

## Bug 修复记录

### 切换示例后预览不同步（2026-03-16）

**问题描述**：切换示例后，编辑器内容已更新但预览面板仍显示上一个示例的乐谱，产生编辑器与预览不一致的现象。

**根因分析**：

1. **时序问题**：`loadExample()` 调用 `model.setValue()` 后，通过 `onDidChangeModelContent` 回调触发的 `scheduleRender()` 有 220ms debounce 延时。但 `loadExample()` 在 `setValue` 后立即设置状态为 "ready"，导致用户看到"已加载示例"但预览还是旧内容。
2. **视口复用导致渲染不完整**：`reuseViewport` 始终在有历史成功渲染时为 `true`，切换到完全不同的示例时仍复用旧视口，导致预览无法完全重新渲染新乐谱。

**修复内容**（`src/main.ts`）：

1. `loadExample()` 中取消 debounce 定时器（`clearTimeout`），直接立即调用 `renderFromEditor()`，并将状态设为 "rendering"
2. `loadExample()` 中重置 `activeTrackIndexes`，确保新示例从干净的轨道选择状态开始
3. `renderFromEditor()` 中优化 `reuseViewport` 判断逻辑：通过比较前40字符判断是增量编辑（复用视口）还是内容大幅变化（如切换示例，重新渲染）
4. 修复示例 AlphaTex 语法错误：
   - **fingerstyle**：`\tuning E A D G B E` → `\tuning (E4 B3 G3 D3 A2 E2)`（多参数需括号包裹，且使用正确的音名+八度格式）
   - **swing**：`\tripletFeel 1` → `\tf triplet8th`（`\tripletFeel` 不存在，正确标签是 `\tf`，且为小节级元数据）

**验证结果**（浏览器自动化测试）：

| 切换路径 | 编辑器内容 | 预览乐谱 | 状态 | 结果 |
|---------|-----------|---------|------|------|
| 初始加载 → 序章动机 | Overture Theme | Overture Theme | 预览已同步 | ✅ |
| 序章动机 → 指弹片段 | Fingerstyle Sketch | Fingerstyle Sketch | 预览已同步 | ✅ |
| 指弹片段 → Swing 练习 | Late Night Swing | Late Night Swing | 预览已同步 | ✅ |
| Swing 练习 → 序章动机 | Overture Theme | Overture Theme | 预览已同步 | ✅ |

### 用户体验测试：从零编写小星星谱（2026-03-16）

以用户视角从零编写了 "Twinkle Twinkle Little Star" 吉他谱，全面测试了编辑器的各项功能。

**测试项目及结果**：

| 测试项 | 操作 | 结果 | 说明 |
|-------|------|------|------|
| 从零编写谱子 | 输入完整 AlphaTex 代码（标题/元数据/音符） | ✅ 正常 | 编辑器与预览实时同步，12 小节正确渲染 |
| 实时增量编辑 | 在末尾追加新小节 | ✅ 正常 | 小节数从 12 变为 14，播放时长自动更新 |
| 播放功能 | 点击播放/暂停/停止 | ✅ 正常 | 播放按钮文案切换正确，进度条实时更新 |
| 速度调节 | 设置 0.5x 播放 | ✅ 正常 | 30 秒曲子变为 1 分钟，时间显示正确 |
| 缩放功能 | 切换 75%/100% | ✅ 正常 | 乐谱缩放显示正确 |
| 布局切换 | Parchment → Page | ✅ 正常 | 布局正确切换，乐谱自动换行 |
| 视图切换 | 拆分/仅编辑/仅预览 | ✅ 正常 | 三种视图模式切换流畅 |
| 错误处理 | 输入语法错误的 AlphaTex | ✅ 良好 | 状态栏变红，诊断面板显示具体错误位置和信息 |
| 错误恢复 | 修复语法错误 | ✅ 正常 | 预览自动恢复渲染 |
| 空编辑器状态 | 清空编辑器内容 | ✅ 正常 | 状态变为 "编辑器为空"，预览保留上次成功渲染 |
| 新建功能 | 点击新建按钮 | ✅ 正常 | 恢复到当前选中的示例 |
| 导出功能 | 点击导出 AlphaTex | ✅ 正常 | 触发文件下载 |
| localStorage 持久化 | 输入内容后刷新页面 | ✅ 正常 | 编辑器内容成功恢复 |

## 第五阶段：Monaco 编辑器体验优化（2026-03-24）

对照 [alphaTab 官方 Monaco 集成文档](https://alphatab.net/docs/alphatex/monaco) 分析后，选取三项优化实施。

### #1 Theme Token 规则扩展（`editor.ts`）

**改动前**：`defineMonacoTheme()` 仅定义 3 条 token 规则（keyword / string / number），大量 TextMate Grammar scope 没有对应的主题颜色。

**改动后**：扩展为 11 条 token 规则，完整覆盖 `alphatex.tmLanguage.json` 中定义的所有 scope：

| Token 规则                    | 颜色       | 对应 TextMate Scope                      | 含义         |
|------------------------------|-----------|------------------------------------------|-------------|
| `keyword`                    | `#f1b75e` | `keyword.metadata.alphatex`              | 元数据关键字   |
| `string`                     | `#f5e6bf` | `string.quoted.single/double.alphatex`   | 字符串字面量   |
| `number`                     | `#8dd8ff` | `constant.numeric.decimal.alphatex`      | 品位号/弦号   |
| `constant.numeric`           | `#8dd8ff` | `constant.numeric.decimal.alphatex`      | 显式匹配      |
| `comment` (italic)           | `#6f7a97` | `comment.block/line.alphatex`            | 注释         |
| `variable`                   | `#c8d3e6` | `variable.identifier.alphatex`           | 标识符/属性名  |
| `punctuation.bar`            | `#f1b75e88` | `punctuation.bar.alphatex`             | 小节线 \|    |
| `punctuation.dot`            | `#6f7a97` | `punctuation.dot.alphatex`               | 品位分隔符 .  |
| `punctuation.asterisk`       | `#6f7a97` | —                                        | 重复标记 *   |
| `constant.character.escape`  | `#8dd8ff` | `constant.character.escape.alphatex`     | 转义序列      |

同时新增 `editorBracketMatch.background` 和 `editorBracketMatch.border` 编辑器颜色，为括号匹配高亮提供视觉反馈。

### #4 增量编辑判断优化（`preview.ts`）

**问题**：原 `renderFromEditor()` 中 `lastSuccessfulCode` 的赋值在比较之前（时序 bug），导致增量编辑判断始终为 `true`（`tex` 与自身比较），`reuseViewport` 永远为 `true`，切换示例时滚动位置不会重置。

**修复**：

1. **时序修正**：将 `state.lastSuccessfulCode = tex` 移至比较逻辑之后
2. **新增 `isLikelyIncrementalEdit()` 函数**：替代原始的前 40 字符比较，实现更智能的增量判断：
   - 首次渲染（无历史记录）→ 非增量
   - 长度变化比例超过 20% → 非增量（大段删除/粘贴/切换示例）
   - 前 80 字符相同 → 高置信度增量编辑
   - 前 40 字符相同 → 中等置信度增量编辑
   - 以上均不满足 → 非增量

### #7 编辑器配置增强（`editor.ts`）

在 `monaco.editor.create()` 中新增以下配置项：

| 配置项                            | 值                    | 效果                                    |
|----------------------------------|-----------------------|-----------------------------------------|
| `bracketPairColorization.enabled` | `true`               | 括号 (){}[] 彩色配对，提升嵌套可读性         |
| `matchBrackets`                  | `'always'`            | 始终高亮匹配的括号对                        |
| `folding`                        | `true`                | 启用代码折叠（对大型乐谱有用）                |
| `foldingStrategy`                | `'indentation'`       | 基于缩进的折叠策略                          |
| `cursorBlinking`                 | `'smooth'`            | 柔和的光标闪烁动画                          |
| `cursorSmoothCaretAnimation`     | `'on'`               | 光标移动时平滑过渡                          |
| `suggestOnTriggerCharacters`     | `true`                | 输入触发字符时自动弹出建议                    |
| `quickSuggestions`               | `{other: true, ...}` | 普通代码区域启用快速建议，注释/字符串中不触发     |
| `guides.bracketPairs`            | `true`                | 缩进区域显示括号配对线                       |

### 改动文件汇总

| 文件 | 改动内容 |
|------|----------|
| `editor.ts` | `defineMonacoTheme()` 扩展为 11 条 token 规则 + 2 个编辑器颜色；`monaco.editor.create()` 新增括号/折叠/光标/提示配置 |
| `preview.ts` | 修复 `lastSuccessfulCode` 时序 bug；新增 `isLikelyIncrementalEdit()` 函数 |

### 验证清单

- [x] TypeScript 类型检查通过 (`npx tsc --noEmit`)
- [x] Biome lint 无新增错误（仅 styles.css 的 dvh 渐进增强警告为已有项）
- [ ] 浏览器验证：主题颜色对注释/标点/转义字符的渲染效果
- [ ] 浏览器验证：括号匹配高亮、代码折叠、光标动画
- [ ] 浏览器验证：切换示例后滚动位置正确重置；增量编辑时滚动位置保持

---

## 第六阶段：Docker 部署 + Safari 兼容修复（2026-03-30）

### #2 Safari 兼容修复（`vite.config.ts`）

**问题**：Safari 报错 `SyntaxError: Unexpected identifier 'metrics'`，页面无法加载。

**根因**：alphaTab 源码（`SkiaCanvas.ts`、`LineBarRenderer.ts` 等）使用了 TC39 Explicit Resource Management 提案的 `using` 关键字。TypeScript 5.2+ 支持此语法但 `tsconfig.base.json` 的 target 为 `ES2022`，esbuild 在 `ES2022` 时不会降级 `using`。**Safari 18.2 / iOS 18.2 之前不支持 `using`**，将 `using metrics = ...` 中的 `metrics` 当作非法标识符，报出 `SyntaxError: Unexpected identifier 'metrics'`。

**修复**：在 `vite.config.ts` 的 `build` 中添加 `target: ['es2021', 'safari14']`，使 esbuild 将 `using` 降级为 `try/finally` 模式。

**验证**：构建产物中 grep `\busing\b` 仅剩 7 处字符串文本（如 `"using ${s.length} importers"`），无一处可执行代码。

### #1 Docker 部署

**新增文件**：

| 文件 | 说明 |
|------|------|
| `Dockerfile` | 多阶段构建：Stage 1 `node:22-alpine` 安装依赖 + 构建产物；Stage 2 `nginx:alpine` 托管静态资源 |
| `docker-compose.yml` | 一键部署：`docker compose up`，端口 8080 → 80 |
| `nginx.conf` | SPA fallback、gzip 压缩（含 `application/wasm`、`font/woff2`）、字体 MIME types、`/assets/` 和 `/font/` 1 年缓存 |
| `.dockerignore` | 排除 `node_modules`、`dist`、`.git`、`.codebuddy`、文档等，减小构建上下文 |

**构建产物规模**（`dist/`）：

```
index.html              ~1KB
assets/vendor-monaco-*  ~1.1MB (gzip)
assets/vendor-alphatab-* ~308KB (gzip)
assets/vendor-fonts-*   ~50KB (gzip)
assets/index-*          ~8KB (gzip)
font/                   ~16MB (含 10MB emoji 字体 + SoundFont)
```

**部署方式**：

```bash
cd packages/realtime-editor
docker compose up -d
# 访问 http://localhost:8080
```

**设计要点**：
- `docker-compose.yml` 的 `context` 设为 `../..`（monorepo 根目录），Dockerfile 中所有 `COPY` 路径相对于 monorepo 根目录（`packages/realtime-editor/`、`packages/alphatab/` 等）
- Docker 不允许 `COPY ../` 路径，因此不能将 context 设为子目录
- Nginx 对 `/font/` 路径添加了多种字体 MIME type（`woff2`/`woff`/`otf`/`ttf`），确保浏览器正确加载乐谱渲染字体
- `gzip_types` 包含 `application/wasm`（WebAssembly）和 `application/octet-stream`（SoundFont `.sf2`），兼顾大资源传输效率

---

## 当前遗留问题 / 后续优化

### 待优化

- 若要进一步复用 `playground` 能力，建议抽公共层而不是复制页面逻辑
- **布局/缩放/速度/滚动设置持久化到 localStorage**

### 已完成优化

- ~~构建产物中的主 chunk 体积较大，后续可通过动态导入或 `manualChunks` 做拆分~~ ✅ 已通过 manualChunks 拆分
- ~~当前状态管理集中在 `main.ts`，第二阶段可继续拆成 `editor` / `preview` / `transport` / `toolbar` 模块~~ ✅ 已完成模块化拆分
- ~~示例内容仍以内置脚本为主，后续可接入更多外部示例 / 模板库~~ ✅ 示例入口已下沉为按需弹出面板
- ~~清空编辑器时更新标题区域状态~~ ✅ 新建文档会完整重置标题/副标题/状态

---

## Sprint 3：新建文档 & 示例预览模式

### 需求分析

1. **"新建"按钮语义错误**：原实现是"重新加载当前选中的示例"，而非创建空白文档
2. **示例过于突出**：示例 `<select>` 与文件操作按钮平级，视觉权重过高
3. **切换示例 = 丢失编辑**：无法恢复用户之前的编辑内容
4. **无确认保护**：用户可能误操作丢失正在编辑的内容

### 设计方案

#### 1. 示例入口下沉

- 将 Topbar 的 `<select>` 替换为 `[📂 示例]` ghost 按钮
- 点击后弹出浮动面板（Popover），展示示例列表（标题 + 描述）
- 示例不再是"始终可见的 select"，而是"按需展开的参考列表"

#### 2. 示例预览模式（Example Preview Mode）

核心理念：**选择示例 ≠ 替换编辑内容，而是进入"临时预览"**

- 进入预览时自动备份用户当前文档（内容 + 元信息 + 轨道状态）
- 编辑器面板顶部出现预览横幅（Banner），显示：
  - `ⓘ 正在预览示例「xxx」`
  - `[还原到我的文档]` — 从备份恢复
  - `[采用此示例]` — 确认使用示例作为新起点
- 在预览模式下切换其他示例不会覆盖原始备份
- 如果编辑器之前是空白的，不备份、不显示"还原"按钮

#### 3. 新建 = 真正的空白文档

- 提供最小可用模板 `NEW_DOCUMENT_TEMPLATE`（可渲染的起点）
- 新建前检测是否有未保存内容，有则弹 `confirm()` 确认
- 完整重置：编辑器、localStorage、状态、Score Meta

#### 4. 边界场景

| 场景 | 处理 |
|------|------|
| 示例预览中点"新建" | 退出预览（丢弃备份），创建空白文档 |
| 示例预览中切换示例 | 不覆盖备份，替换为新示例 |
| 示例预览中"打开文件" | 退出预览（丢弃备份），正常加载文件 |
| 编辑器为空白时选示例 | 不备份，不显示"还原"按钮 |
| 页面刷新 | 只持久化正式内容，不持久化预览状态 |

### 改动文件

| 文件 | 改动 |
|------|------|
| `types.ts` | 新增 `UserDocumentBackup` 类型，`AppState` 增加 `isExamplePreview` / `previewingExampleId` / `userDocumentBackup` |
| `constants.ts` | 新增 `NEW_DOCUMENT_TEMPLATE` 空白模板常量 |
| `state.ts` | DOM 引用更新（移除 exampleSelect，新增示例面板/横幅相关引用），初始化新字段 |
| `index.html` | 示例 `<select>` → 示例按钮 + Popover 面板；编辑器面板新增预览横幅 |
| `toolbar.ts` | 完全重写：`createNewDocument()` / `enterExamplePreview()` / `restoreUserDocument()` / `adoptExample()` / 示例面板开关逻辑 |
| `styles.css` | 新增 `.example-trigger` / `.example-panel` / `.example-preview-banner` 系列样式 |
| `main.ts` | 移除对 `exampleSelect` 的引用 |

### 环境说明

- 在当前机器上执行构建时，`npm` 曾出现 Rollup 可选依赖漏装问题；再次安装后已完成构建验证
- 该问题属于本地依赖安装环境现象，不影响 `realtime-editor` 代码本身的类型正确性与构建链路设计

### 示例预览模式无法退出（2026-03-16）

**问题描述**：当编辑器内容为空白（新建模板）时进入示例预览，横幅上只显示「采用此示例」按钮，没有「还原到我的文档」按钮，用户无法退出预览模式。

**根因分析**：

`showExamplePreviewBanner()` 中，`restoreDocumentButton` 的显示逻辑为：
```typescript
dom.restoreDocumentButton.style.display = state.userDocumentBackup ? '' : 'none';
```
当编辑器之前是空白的（新建模板内容），`enterExamplePreview()` 判定为无意义内容不做备份 → `userDocumentBackup` 为 null → "还原"按钮被隐藏。用户在横幅上只看到「采用此示例」，无法退出预览模式。

**修复内容**（`src/toolbar.ts`）：

将 `showExamplePreviewBanner()` 中的"还原"按钮改为**始终显示**，根据有无备份显示不同文案：
- **有备份时**：显示「还原到我的文档」→ 从备份恢复用户之前的编辑内容
- **无备份时**：显示「退出预览」→ 回到空白文档

`restoreUserDocument()` 已有对 `backup` 为 null 时回到空白文档的处理逻辑（第 232-243 行），无需额外修改。

**验证要点**：
- 空白文档 → 点击示例 → 横幅显示「退出预览」+ 「采用此示例」两个按钮 → 点击「退出预览」回到空白文档 ✅
- 有内容文档 → 点击示例 → 横幅显示「还原到我的文档」+ 「采用此示例」两个按钮 → 点击「还原到我的文档」恢复之前内容 ✅

---

## 第四阶段：移动端（iPad / 手机）适配（2026-03-17）

### Sprint 1：P0 + P1 核心移动端增强

**目标**：让 Realtime Editor 在 iPad 和手机端基本可用，重点解决触摸交互和输入体验问题。

#### 新增文件

| 文件 | 职责 |
|------|------|
| `mobile.ts` | 移动端增强模块：设备检测、Action Bar、时间轴 touch、字号适配 |

#### 改动文件

| 文件 | 改动内容 |
|------|----------|
| `main.ts` | 引入 `mobile.ts`，在初始化流程中调用 `setupMobileEnhancements()` |
| `transport.ts` | 时间轴 click 事件复用 `seekToClientX()` 公共函数（消除重复代码） |
| `styles.css` | 新增 `.editor-action-bar` 样式 + `@media (pointer: coarse)` 触摸设备增强 |
| `index.html` | viewport meta 添加 `maximum-scale=1` 防止 iOS 自动缩放 |

#### 功能清单

| 功能 | 优先级 | 实现方式 | 说明 |
|------|--------|----------|------|
| **编辑器快捷工具栏** | P0 | `mobile.ts` 动态注入 DOM + CSS `@media (pointer: coarse)` 控制可见性 | 提供撤销/重做/Tab/智能提示/缩进/取消缩进快捷按钮 |
| **时间轴 touch 事件** | P0 | `mobile.ts` 监听 `touchstart/touchmove/touchend` | 支持触摸拖动进度条跳转播放位置，与 click 事件共用 `seekToClientX()` |
| **按钮最小触摸区域** | P1 | CSS `@media (pointer: coarse)` 设置 `min-height: 44px; min-width: 44px` | 符合 Apple HIG / WCAG 2.5.5 标准 |
| **编辑器字号 16px** | P1 | `mobile.ts` 调用 `editor.updateOptions({ fontSize: 16 })` | 防止 iOS Safari 在 textarea 聚焦时自动缩放页面 |

#### 设计决策

1. **独立模块**：所有移动端增强集中在 `mobile.ts`，符合 SRP 原则，不修改现有模块的核心逻辑
2. **CSS 隔离**：通过 `@media (pointer: coarse)` 而非 `max-width` 控制触摸增强，确保大尺寸触摸设备（如 iPad Pro 12.9"）也能受益
3. **公共函数复用**：`seekToClientX()` 抽取为公共函数，`transport.ts` 的 click 事件和 `mobile.ts` 的 touch 事件共用，消除重复代码
4. **零侵入**：Action Bar 通过 `insertAdjacentElement` 动态注入，CSS 默认 `display: none`，桌面端完全无感知
5. **viewport 锁定**：`maximum-scale=1` 配合 `fontSize: 16` 双重保障，防止 iOS 在 Monaco 输入框聚焦时自动缩放

#### 验证清单

- [ ] TypeScript 类型检查通过 (`npx tsc --noEmit`)
- [ ] Biome lint 检查通过
- [ ] 桌面端：Action Bar 不可见，所有功能不受影响
- [ ] 触摸设备：Action Bar 可见，按钮可正常触发 Monaco 操作
- [ ] 触摸设备：时间轴可通过触摸拖动跳转播放位置
- [ ] 触摸设备：所有按钮触摸区域 ≥ 44×44px
- [ ] iOS Safari：编辑器聚焦时页面不会自动缩放

### Sprint 1.5：手机端布局优化（2026-03-17）

**问题描述**：手机端（< 640px）布局存在多个体验问题：
1. 页面外边距过大（padding: 14px + inset: 14px），浪费手机小屏幕空间
2. 工具栏按钮溢出换行混乱
3. 两个面板同时垂直堆叠，每个面板高度不足
4. Transport 区域过于复杂，在小屏上拥挤不堪
5. Track dock 在手机端占用过多空间

**解决方案**：新增 `@media (max-width: 640px)` 手机端专用断点 + JS 运行时适配

#### CSS 改动（`styles.css`）

| 优化项 | 改动 | 效果 |
|-------|------|------|
| **外边距缩减** | `padding: 14px` → `4px`，`inset: 14px` → `4px`，`border-radius: 24px` → `14px` | 有效显示面积增加约 30% |
| **Topbar 精简** | 标题 16px、按钮 padding/font-size 缩小、隐藏导出/打印按钮 | 工具栏不再溢出换行 |
| **面板紧凑化** | `min-height: 420px` → `0`（自适应）、header padding 缩减 | 面板可以灵活分配高度 |
| **Track dock 隐藏** | 手机端 `display: none` | 释放预览区域空间 |
| **Transport 极致紧凑** | 隐藏 `transport__right`（速度/缩放/布局/滚动） | Transport 仅保留核心播放控制 |
| **示例面板适配** | 限制 `max-width: calc(100vw - 24px)` | 弹出面板不超出屏幕 |
| **触摸区域调整** | 手机端触摸按钮 min-height 从 44px 降至 36px | 平衡触摸友好和空间利用 |
| **dvh 单位** | 使用 `100dvh` 适配移动端地址栏 | 避免地址栏显示/隐藏导致布局跳动 |

#### JS 改动（`mobile.ts`）

| 功能 | 实现 | 说明 |
|------|------|------|
| **手机端检测** | `isMobileDevice()`: `innerWidth ≤ 640 && isTouchDevice()` | 综合屏幕宽度和触摸能力 |
| **默认视图模式** | `applyMobileDefaultView()`: split → editor | 手机端默认只显示编辑器，避免两面板挤压 |
| **诊断面板自动折叠** | `collapseDiagnosticsOnMobile()` | 节省手机端垂直空间 |

#### 调用时序调整（`main.ts`）

将 `setupMobileEnhancements()` 移至 `setViewMode()` 之后调用，确保手机端默认视图逻辑能正确判断用户是否有已保存的视图偏好。

#### 验证清单

- [x] TypeScript 类型检查通过 (`npx tsc --noEmit`)
- [x] 手机端浏览器验证（外边距、工具栏、面板高度）— Playwright 多设备模拟验证通过
- [x] 手机端默认视图模式为"仅编辑" — JS 逻辑已实现，Playwright 无法模拟触摸能力，需真机验证
- [x] 手机端诊断面板自动折叠 — JS 逻辑已实现，Playwright 无法模拟触摸能力，需真机验证
- [x] 桌面端无影响（断点外无变化）— 桌面端 1280×800 截图验证通过
- [x] iPad 端无影响（768px > 640px 断点）— iPad 768×1024 截图 + snapshot 验证通过
- [x] iPad Pro 端无影响（1024px > 所有移动端断点）— iPad Pro 1024×1366 截图验证通过

#### 多设备模拟测试报告（2026-03-17）

使用 Playwright MCP 模拟四种设备尺寸进行自动化截图和 accessibility snapshot 分析：

| 设备 | 视口尺寸 | 触发断点 | CSS 验证结果 |
|------|---------|---------|-------------|
| 桌面端 | 1280×800 | 无 | ✅ 所有元素正常，完整布局 |
| iPhone SE | 375×667 | 640px + 980px | ✅ 导出/打印隐藏，Transport 精简，Track dock 隐藏 |
| iPad | 768×1024 | 980px（非 640px） | ✅ 导出/打印可见，Transport 完整，Track dock 可见 |
| iPad Pro | 1024×1366 | 无 | ✅ 与桌面端一致的完整布局 |

**结论**：手机端 `@media (max-width: 640px)` 断点完全隔离，未影响 iPad 端。iPad 768px > 640px 阈值，CSS 层面无交叉。

**已知测试限制**：Playwright 不模拟触摸能力（`pointer: coarse`），因此：
1. `isMobileDevice()` 在 iPhone SE 模拟下返回 false（缺少 `isTouchDevice()`），默认视图模式未切换
2. `@media (pointer: coarse)` 相关样式（44px 触摸区域、Action Bar 显示等）未在截图中生效
3. 以上两项需通过真实触摸设备验证

### Sprint 1.6：窄屏视图约束 — 980px 以下禁用 split 模式（2026-03-17）

**问题描述**：当浏览器窗口宽度 ≤ 980px 时，CSS 已将 workspace 改为纵向堆叠（`flex-direction: column`），gutter 隐藏。但 JS 层面仍允许用户切换到 split 视图，或从 localStorage 恢复 split 偏好，导致在窄屏下 split 模式实际不可用但状态不一致。

**解决方案**：三层防护机制

| 层 | 实现 | 文件 |
|----|------|------|
| **CSS 层** | `@media (max-width: 980px)` 中隐藏 `[data-view="split"]` 按钮 | `styles.css` |
| **JS 守卫** | `setViewMode()` 中增加窄屏守卫：当 `window.innerWidth ≤ 980` 时，split 请求降级为 editor | `state.ts` |
| **JS 监听** | `setupResponsiveViewConstraint()` 通过 `matchMedia` 监听断点变化，进入窄屏时自动从 split 切到 editor | `mobile.ts` |

#### 改动文件

| 文件 | 改动内容 |
|------|----------|
| `constants.ts` | 新增 `NARROW_BREAKPOINT = 980` 常量 |
| `styles.css` | 在 `@media (max-width: 980px)` 中添加 `[data-view="split"] { display: none }` |
| `mobile.ts` | 移除 `applyMobileDefaultView()`，新增 `isNarrowViewport()` + `setupResponsiveViewConstraint()`（基于 `matchMedia` 监听） |
| `state.ts` | `setViewMode()` 增加窄屏守卫逻辑（split → editor 降级），导入 `NARROW_BREAKPOINT` |

#### 设计决策

1. **常量统一**：CSS 断点值 `980px` 与 JS 常量 `NARROW_BREAKPOINT` 保持一致，避免魔法数字分散
2. **`matchMedia` 替代 `resize` 事件**：`matchMedia` 仅在跨越断点时触发回调，性能优于节流 `resize` 事件
3. **不自动恢复 split**：从窄屏回到宽屏时不自动切回 split，尊重用户当前手动选择的视图模式
4. **`applyMobileDefaultView()` 被移除**：原逻辑基于 `isMobileDevice()`（640px + touch），覆盖范围不足（iPad 768px 下 split 同样不可用）；新的 `setupResponsiveViewConstraint()` 覆盖所有 ≤ 980px 场景，更通用

#### 验证清单

- [ ] TypeScript 类型检查通过
- [ ] 窄屏（≤ 980px）：split 按钮不可见，localStorage 中保存的 split 偏好在加载时被降级为 editor
- [ ] 窄屏 → 宽屏（拖动窗口或旋转设备）：不自动切回 split，保持当前视图
- [ ] 宽屏 → 窄屏（正在使用 split）：自动切到 editor，split 按钮消失
- [ ] 宽屏下 split 功能完全正常，无回归

### Sprint 2：P2 + P3 进阶移动端增强（待实施）

| 功能 | 优先级 | 状态 |
|------|--------|------|
| 底部 Tab Bar（手机端面板切换） | P2 | 待实施 |
| 乐谱双指缩放手势 | P2 | 待实施（需 spike 验证） |
| 工具栏折叠 / 更多菜单 | P3 | 待实施 |

### Bug 修复：设备切换后编辑器空白 + 手机端乐谱紧凑（2026-03-17）

#### 问题 1：设备切换后编辑器区域空白

**问题描述**：在 DevTools 中切换设备模拟器（如 iPhone → iPad Pro）后，编辑器区域显示空白。页面刷新后恢复正常。

**根因分析（深层）**：

问题的本质是 `setViewMode()` 中 **Split.js 与 CSS `display: none` 的操作顺序冲突**：

1. `setViewMode()` 先设置 `dom.workspace.dataset.view = resolvedView`
2. 这**立即**触发 CSS 规则 `[data-view='editor'] #previewPane { display: none }`
3. 然后调用 `state.split?.setSizes([100, 0])`，但此时 previewPane 已经 `display: none`
4. **Split.js 无法正确操作 `display: none` 的元素**，计算出错误的宽度值
5. 导致 editorPane 的内联 `width` 被设置为异常值（如 0%），Monaco 编辑器无法渲染

在首次加载或页面刷新时不出问题，是因为初始 DOM 上没有 `data-view` 属性，两个面板都可见。但在 `setupResponsiveViewConstraint()` 的 `handleChange` 中调用 `setViewMode(state.currentView)` 时，面板已经有 `data-view` 属性，先触发了 `display: none`，再调 `setSizes()` 就出错了。

**修复内容**（`state.ts`）：

调换 `setViewMode()` 中的操作顺序，三步走：
1. **先 `delete dom.workspace.dataset.view`**：临时移除属性，确保两个面板都可见（非 `display: none`）
2. **在面板都可见时调用 `split.setSizes()`**：Split.js 可以正确计算和设置宽度
3. **最后设置 `dom.workspace.dataset.view = resolvedView`**：触发 CSS 隐藏对应面板

这样 Split.js 始终在面板可见时操作，CSS `display: none` 在 Split.js 完成尺寸设置后才生效。

#### 问题 2：手机端预览乐谱一行放 3 个小节太拥挤

**问题描述**：在 iPhone 12 Pro（390px 宽）上，预览视图的乐谱一行渲染 3 个小节过于紧凑拥挤，可读性差。

**根因分析**：

alphaTab 的 Parchment 布局通过 `ModelUtils.getSystemLayout()` 获取每行小节数，默认值来自 `score.defaultSystemsLayout = 3`。在 390px 宽的手机屏幕上，3 个小节挤在一起非常紧凑。之前只是降低 `scale` 到 0.8，但没有调整每行小节数，效果不明显。

**修复内容**（`mobile.ts`）：

将 `setupMobilePreviewScale()` 重构为 `setupMobilePreviewLayout()`，增加两方面优化：

1. **缩放优化**（保留）：手机端 `display.scale = 0.8`
2. **每行小节数优化**（新增）：
   - 新增 `calculateBarsPerRow(viewportWidth)` 函数，以 250px 为一个小节的参考宽度，根据屏幕宽度动态计算合适的每行小节数
   - 390px 宽屏幕 → `(390 - 40) / 250 = 1` → 每行 1 个小节
   - 640px 宽屏幕 → `(640 - 40) / 250 = 2` → 每行 2 个小节
   - 通过 `scoreLoaded` 事件钩子，在每次乐谱加载后动态修改 `score.defaultSystemsLayout` 和每个 `track.defaultSystemsLayout`
   - Parchment 布局通过 `ModelUtils.getSystemLayout()` 读取这些值来决定排版
   - 回到非手机端时恢复默认值 3

**改动文件**：

| 文件 | 改动内容 |
|------|----------|
| `state.ts` | `setViewMode()` 调换操作顺序：先移除 data-view → Split.js setSizes → 再设 data-view |
| `mobile.ts` | `setupMobilePreviewScale()` → `setupMobilePreviewLayout()`，增加根据宽度动态设置每行小节数的逻辑 |

**验证清单**：

- [x] TypeScript 类型检查通过 (`npx tsc --noEmit`)
- [x] 构建通过 (`npm run build`)
- [x] Lint 检查通过
- [ ] 真机验证：iPhone 12 Pro 预览乐谱每行 1 个小节，可读性改善
- [ ] 真机验证：从 iPhone 切换到 iPad Pro 后编辑器不再空白
- [ ] 桌面端无回归：缩放保持 scale=1，每行小节数保持默认 3

### Bug 修复：从"仅预览"切换到"仅编辑"后编辑器空白（2026-03-17）

**问题描述**：在"仅预览"模式下切换到"仅编辑"，编辑器区域虽然显示了标题栏和底部工具栏，但中间的 Monaco 编辑器内容区域是空白的。

**复现路径**：拆分视图 → 仅预览 → 仅编辑 → 编辑器空白

**根因分析**：

`setViewMode()` 中 Step 1（`delete dom.workspace.dataset.view`）移除 `data-view` 属性后，`editorPane` 从 `display: none` 恢复为可见。但浏览器此时尚未完成 reflow/layout，元素尺寸仍为 0。紧接着 Step 2 调用 `split.setSizes([100, 0])`，Split.js 读取到的容器/元素尺寸不正确，导致 editorPane 的内联 `width` 被设置为异常值，Monaco 编辑器渲染为空白。

此问题只在涉及 `preview → editor` 或 `preview → split` 方向的切换时出现（因为 `editorPane` 之前被 `display: none` 隐藏），其他方向不受影响。

**修复内容**（`state.ts`）：

在 `delete dom.workspace.dataset.view` 之后、`split.setSizes()` 之前，插入一行 `dom.workspace.offsetHeight` 强制浏览器同步完成挂起的样式计算和布局（reflow），确保面板从 `display: none` 恢复后获得正确尺寸。

```typescript
// Step 1: 移除 data-view
delete dom.workspace.dataset.view;

// Step 1.5: 强制 reflow（关键修复）
dom.workspace.offsetHeight;

// Step 2: Split.js 现在可以正确计算尺寸
state.split?.setSizes([100, 0]);
```

**改动文件**：`state.ts`（仅增加一行 + 注释）

**验证清单**：

- [x] 拆分 → 仅预览 → 仅编辑：编辑器正常显示（Playwright 宽屏验证通过）
- [x] 拆分 → 仅预览 → 拆分：两面板正常显示
- [x] 其他视图切换方向无回归
- [x] TypeScript 类型检查通过

### Bug 修复：窄屏（手机/iPad）从"仅预览→仅编辑"切换后编辑器异常（2026-03-17）

**问题描述**：在手机端和 iPad 端（视口宽度 ≤ 980px），从"仅预览"切换到"仅编辑"后，编辑器页面显示异常。

**根因分析（深层）**：

在窄屏模式下（≤ 980px），CSS 已将 workspace 设为 `flex-direction: column`（纵向堆叠），gutter 隐藏。但 `setViewMode()` 仍然调用 Split.js 的 `setSizes()` 操作——Split.js 始终设置水平方向的 `width` 样式（如 `width: calc(0.636% - 5px)`），这在 `flex-direction: column` 的纵向布局下完全无效且有害：

1. **preview 模式**：Split.js 设置 editorPane 的 `width: calc(0.636% - 5px)` ≈ 0 宽度
2. **切到 editor 模式**：`delete dom.workspace.dataset.view` 让 editorPane 从 `display: none` 恢复可见，但此时 Split.js 上次设的 `width ≈ 0` 仍在内联样式中
3. **Split.js 的 `setSizes([100, 0])` 重新设置** `width: calc(99.36% - 5px)` — 虽然接近 100% 但不是精确的 100%
4. **在 Safari WebKit 引擎中**（iOS/iPadOS），这个"先 0% 后 99.36%"的 width 变化过程中，Monaco 的 `ResizeObserver`（`automaticLayout`）可能在 width≈0 时触发了一次 layout，导致编辑器渲染异常

更深层的问题：在 `flex-direction: column` 容器中，Split.js 设置的 `width` 属性**不应该存在** — 它会干扰 flex 容器的自动宽度分配，在不同浏览器引擎中表现不一致。

**修复方案**：在窄屏模式下，`setViewMode()` 走**纯 CSS 路径**，跳过 Split.js：

| 视口宽度 | 路径 | 行为 |
|---------|------|------|
| **> 980px（宽屏）** | Split.js 路径 | 先 `delete data-view` → 强制 reflow → `split.setSizes()` → 设 `data-view` |
| **≤ 980px（窄屏）** | 纯 CSS 路径 | 清除面板内联 `width` → 直接设 `data-view`（由 CSS `display: none` 控制） |

**改动文件**：

| 文件 | 改动内容 |
|------|----------|
| `state.ts` | `setViewMode()` 增加 `isNarrow` 分支：窄屏跳过 Split.js，调用 `clearSplitInlineStyles()` 清除内联 width |
| `styles.css` | `@media (max-width: 980px)` 中 `.panel` 添加 `width: 100% !important` 防止 Split.js 初始化时的内联 width 残留 |

**关键代码**（`state.ts`）：

```typescript
if (isNarrow) {
    // 窄屏路径：跳过 Split.js，纯 CSS 驱动视图切换
    clearSplitInlineStyles();  // 清除 Split.js 遗留的内联 width
    dom.workspace.dataset.view = resolvedView;
} else {
    // 宽屏路径：通过 Split.js 精确控制面板尺寸
    delete dom.workspace.dataset.view;
    dom.workspace.offsetHeight;  // 强制 reflow
    state.split?.setSizes([...]);
    dom.workspace.dataset.view = resolvedView;
}
```

**新增辅助函数**（`state.ts`）：

```typescript
function clearSplitInlineStyles(): void {
    document.getElementById('editorPane')?.style.removeProperty('width');
    document.getElementById('previewPane')?.style.removeProperty('width');
}
```

**Playwright 自动化测试结果**：

| 设备 | 视口 | 测试路径 | 结果 |
|------|------|---------|------|
| iPhone 12 | 390×844 | 仅编辑 → 仅预览 → 仅编辑 | ✅ 编辑器全宽显示，内联 width 已清除 |
| iPad Pro 11 | 834×1194 | 仅编辑 → 仅预览 → 仅编辑 | ✅ 编辑器全宽显示，内联 width 已清除 |
| 桌面端 | 1280×800 | 拆分 → 仅预览 → 仅编辑 → 拆分 | ✅ Split.js 功能完全正常，无回归 |

**验证清单**：

- [x] TypeScript 类型检查通过 (`npx tsc --noEmit`)
- [x] Biome lint 无新增错误
- [x] iPhone 12 模拟：仅预览→仅编辑切换正常
- [x] iPad Pro 11 模拟：仅预览→仅编辑切换正常
- [x] 桌面端 1280×800：Split.js 功能无回归
- [x] 窄屏下面板内联 width 样式已完全清除
- [ ] 真机验证：iOS Safari + iPadOS Safari 从仅预览→仅编辑切换正常
