## AlphaTex Guitar Syntax Suite 实施记录

### 需求背景

用户希望基于 `AlphaTex` 的脚本语法，设计一首 **guitar 教学型示例曲**，要求它不仅能作为一段可运行的乐谱脚本，还要尽量承担“指导手册”的角色，帮助后续使用者理解：

- `AlphaTex` 的文档结构如何组织
- 吉他谱常见的 staff / bar / beat / note 级语法如何书写
- 如何把和弦、节奏、技巧与说明文本组合成一份可教学的示例曲

### 实施目标

本轮实施目标分为两部分：

1. **产出一份可直接试跑的 AlphaTex 吉他示例曲**
2. **产出一份对照式的 Markdown 指导手册**，解释每一段示例曲在讲什么、覆盖了哪些语法

### 方案选择

采用此前讨论的 **方案 B**：

- 不只停留在设计蓝图
- 直接落一份完整脚本初稿
- 在脚本里按章节组织教学段落
- 再用 Markdown 文档补齐“手册解释层”

### 语法边界分析结论

通过仓库中的 `packages/alphatex` 与 `packages/alphatab` 语法定义确认：

- `AlphaTex` 语法天然按 `score / staff / structural / bar / beat / note` 分层
- guitar 相关的核心能力主要集中在：
  - `\tuning`, `\capo`, `\chord`, `\staff {score tabs}`
  - `\section`, `\ts`, `\tempo`, `\tf`
  - beat 级的 `dy`, `txt`, `lyrics`, `tu`, `rasg`, `barre`, `fermata`, `tb`, `tbe`
  - note 级的 `pm`, `h`, `sl`, `ss`, `nh`, `ah`, `ph`, `th`, `sh`, `b`, `v`, `vw`, `st`, `slur`, `string`, `lf`, `rf`, `x`, `lr`
- `\voiceMode` / `\voice` 适合做独立 appendix track，而不适合强行塞进主旋律段落

### 当前实施进展

- [x] 梳理仓库中与 guitar 相关的 AlphaTex 语法定义与示例
- [x] 设计“主曲 + appendix track”的手册型结构
- [x] 创建 `alphatex-guitar-syntax-suite.alphatex`
- [x] 创建 `alphatex-guitar-syntax-suite-guide.md`
- [ ] 做浏览器或运行时层面的实际导入验证

### 产出文件

- `alphatex-guitar-syntax-suite.alphatex`
  - 手册型吉他总谱脚本
- `alphatex-guitar-syntax-suite-guide.md`
  - 章节说明、覆盖矩阵、使用建议
- `alphatex-guitar-syntax-suite-implementation.md`
  - 本记录文档

### 设计取舍说明

为了让示例曲既像乐曲、又像教学手册，本次实现做了以下取舍：

- **优先覆盖 guitar 相关高频语法**，而不是追求 parser 层面的“所有 tag 全覆盖”
- **把 `\voice` 放进 appendix track**，避免破坏主曲可读性
- **没有把大量偏排版或非吉他专用语法强行塞进主曲**，例如某些仅影响版式或非吉他场景的元数据

### 未完成任务

- [ ] 把示例曲导入 `realtime-editor` 做一次人工预览校验
- [ ] 如有需要，补充第二版 appendix：
  - `Layout / Repeat / Navigation Lab`
  - `Exotic Guitar Techniques Lab`
- [ ] 如有需要，将本示例接入 `realtime-editor` 的内置示例菜单

### 遗留问题 / 风险

- 当前示例曲是基于仓库内语法定义做的**静态设计与保守写法组合**，尚未在浏览器里逐小节人工回归
- 某些高级技巧（例如 `tb / tbe / slur / harmonic value`）在不同布局和播放模式下的视觉表现，仍建议用户在实际渲染器中逐段确认
- 如果后续用户要把这份示例曲升级成“官网级参考曲”，建议再做一次：
  - 逐段运行验证
  - 章节拆分验证
  - 文档与渲染截图配对补全

### 下一步建议

优先建议执行：

1. 把 `.alphatex` 文件导入 `realtime-editor`
2. 按章节逐段试听与渲染确认
3. 对不满足听感的段落，再做音乐性优化，但不要破坏语法覆盖结构
