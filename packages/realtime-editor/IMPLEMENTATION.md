# realtime-editor 需求与实施记录

## 需求背景

用户要求在本仓库内新建 `packages/realtime-editor`，实现一个浏览器实时编辑器：

- 基于 alphaTab 现有能力实现独立应用目录
- 支持 `AlphaTex` 实时编辑
- 支持乐谱实时渲染预览
- 交互形态参考在线打谱工作台：顶部工具栏、左右分栏、预览区、播放器/控制区
- 优先独立成包，但继续复用本项目核心库与语言能力

## 当前交付结果

已经完成第一阶段可运行 POC，`packages/realtime-editor` 现在具备：

1. 独立的 `Vite + TypeScript` 应用包结构
2. `Monaco + AlphaTex` 语法高亮与语言服务接入
3. 左编辑、右预览的实时工作台界面
4. 解析成功才刷新预览、解析失败保留上次成功结果
5. 示例切换、新建、文件打开、导出 AlphaTex、打印
6. 轨道筛选、播放/暂停/停止、时间轴、速度、缩放、布局、滚动模式控制
7. 开发态与构建态的字体 / soundfont 资源可用
8. `typecheck` 与 `build` 验证通过

## 设计决策

- **目录策略**：在 monorepo 内新建独立应用包，不继续耦合到 `packages/playground`
- **依赖策略**：继续复用 `@coderline/alphatab`、`@coderline/alphatab-monaco`、`@coderline/alphatab-language-server`
- **UI 策略**：以工作台交互为核心，优先做产品化布局而不是 demo 页
- **渲染策略**：编辑变更后防抖解析；解析成功才刷新预览；解析失败保留旧预览
- **构建策略**：`realtime-editor` 作为前端应用保留 Vite 默认 TypeScript 转译，并补充显式 monorepo alias，确保主线程与 worker 入口都可解析内部包源码
- **资源策略**：开发态通过 `vite.plugin.assets.ts` 直接挂载 `packages/alphatab/font`；构建态复制到产物目录

## 目录与关键文件

- `package.json`：新应用依赖与脚本
- `vite.config.ts`：应用型 Vite 配置与 monorepo alias
- `vite.plugin.assets.ts`：字体与 soundfont 资源挂载 / 复制
- `index.html`：工作台页面骨架
- `src/main.ts`：编辑器、预览、状态、控制台主逻辑
- `src/styles.css`：工作台视觉样式
- `types/split.js/index.d.ts`：`split.js` 本地类型声明

## 实施进展

- [x] 建立需求与实施记录文档
- [x] 创建 `realtime-editor` 包骨架
- [x] 接入编辑器与实时预览
- [x] 接入工具栏与底部控制区
- [x] 处理资源与运行说明

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

**发现的体验优化点**：

1. **布局/缩放/速度等设置未持久化**（P2）：用户设置 Page 布局后刷新页面会恢复到默认的 Parchment，localStorage 只保存了 `document` 和 `view`（拆分模式），建议也持久化 `layout`/`zoom`/`speed`/`scroll` 等设置
2. **清空编辑器时标题区域未更新**（P3）：编辑器内容清空后，右上角仍显示上次的标题和轨道/小节信息，建议在空编辑器时更新标题区域
3. **诊断面板 `.` 分隔符 warning 始终存在**（P4）：所有示例和用户自定义谱子中使用 `.` 分隔符时都会产生 LSP warning "The dots separating score metadata, score contents and the sync points can be removed."，这个 warning 可能会让新用户困惑
4. **Monaco 编辑器无法通过浏览器标准键盘快捷键操作**（P4）：`Cmd+A` 等系统级快捷键在 Monaco 编辑器中不生效，需要使用 Monaco 自身的快捷键体系，这是 Monaco 的特性而非 bug

## 当前遗留问题 / 后续优化

### 待优化

- 构建产物中的主 chunk 体积较大，后续可通过动态导入或 `manualChunks` 做拆分
- 示例内容仍以内置脚本为主，后续可接入更多外部示例 / 模板库
- 当前状态管理集中在 `main.ts`，第二阶段可继续拆成 `editor` / `preview` / `transport` / `toolbar` 模块
- 若要进一步复用 `playground` 能力，建议抽公共层而不是复制页面逻辑
- **布局/缩放/速度/滚动设置持久化到 localStorage**
- **清空编辑器时更新标题区域状态**

### 环境说明

- 在当前机器上执行构建时，`npm` 曾出现 Rollup 可选依赖漏装问题；再次安装后已完成构建验证
- 该问题属于本地依赖安装环境现象，不影响 `realtime-editor` 代码本身的类型正确性与构建链路设计
