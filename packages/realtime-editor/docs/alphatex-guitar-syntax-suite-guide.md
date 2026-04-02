## AlphaTex Guitar Syntax Suite 指导手册

### 目标

这份示例不是为了写成一首“最复杂”的吉他曲，而是为了给 `AlphaTex` 使用者一份**可以直接复制、拆分、改写**的教学型总谱。

它遵循三个原则：

- **先可读**：每一段只承担一类语法目标。
- **再可演示**：尽量保证听感像一首完整的吉他练习曲。
- **后可扩展**：每个章节都能被单独拷贝到你的项目里做实验。

配套脚本文件：`alphatex-guitar-syntax-suite.alphatex`

---

## 文件结构

### 1. 总谱级目标

这份示例曲覆盖 `AlphaTex` 中与吉他最相关的五个层级：

- **score 元数据**：标题、作者、说明、系统布局
- **staff / structural 元数据**：轨道、谱表、调弦、变调夹、和弦图、voice
- **bar 元数据**：章节、拍号、速度、triplet feel
- **beat 属性**：动态、文本、歌词、tuplet、rasgueado、barre、fermata、tremolo bar
- **note 属性**：hammer-on / pull-off、slide、harmonic、bend、vibrato、staccato、dead note、tie、slur、fingering、string annotation

---

## 章节设计

### A 段：Open Chord Foundation

**目的**：建立最基础的吉他脚本骨架。

**重点语法**：

- `\track`
- `\staff {score tabs}`
- `\tuning (...)`
- `\capo`
- `\chord (...)`
- `\section`
- `\ts`
- `\tempo`
- beat 级 `ch` / `dy` / `txt`
- note 级 `lr`

**学习方法**：

- 如果你只想学“如何从 0 写一首吉他 AlphaTex”，先只看这 4 小节。
- 把和弦图定义换成你自己的和弦，通常就能很快改出一版新曲子。

---

### B 段：Rhythm Feel, Tuplets and Rasgueado

**目的**：展示节奏感和扫弦类写法。

**重点语法**：

- `\tf triplet8th`
- beat 级 `tu`
- note 级 `pm`
- beat 级 `rasg`
- beat 级 `barre`
- `\tempo (...)`
- beat 级 `beam`
- dead note `x`

**学习方法**：

- 先保留节奏，把音高全部换成你喜欢的 power chord。
- 再只保留 `pm` / `rasg` / `tu`，观察谱面和播放差异。

---

### C 段：Lead Space and Support

**目的**：展示主旋律进入前，节奏吉他如何留白、支撑和结束。

**重点语法**：

- 稀疏编配
- 动态过渡 `dy`
- 终止延长 `fermata`

**学习方法**：

- 这一段很适合学“怎样让节奏轨给 lead 让出空间”。

---

### D 段：Cadence and Outro

**目的**：把歌词、说明文字、barre 标记和尾声结合起来。

**重点语法**：

- `\lyrics` 元数据
- beat 级 `lyrics`
- beat 级 `txt`
- beat 级 `barre`
- `fermata long`

**学习方法**：

- 如果你想把 AlphaTex 当“教学谱注释语言”用，这一段最值得复用。

---

### Lead Track：Technique Demonstration

**目的**：集中展示主音吉他的常用技巧。

**重点语法**：

- beat 级 `gr`（grace beat）
- note 级 `h`
- note 级 `string`
- note 级 `lf` / `rf`
- note 级 `v` / `vw`
- note 级 `sl` / `ss`
- note 级 `sib` / `sia` / `sou` / `sod`
- note 级 `nh` / `ah` / `ph` / `th` / `sh`
- note 级 `b`
- note 级 `slur`
- tie：`-.2`
- beat 级 `tb` / `tbe`
- note / beat 级 `st` / `beam` / `dy`

**学习方法**：

- 不要一次学完。
- 最好的方式是按“技巧簇”拆开：
  - legato 组：`h`, `sl`, `ss`
  - harmonic 组：`nh`, `ah`, `ph`, `th`, `sh`
  - expressive 组：`b`, `v`, `vw`, `tb`, `tbe`
  - notational 组：`slur`, tie, `string`, `lf`, `rf`

---

### Poly Voice Lab

**目的**：补齐 `\voiceMode` 和 `\voice` 的最小可用结构。

**说明**：

这一轨更偏“语法实验”，不是主曲的一部分。它用最短的长度展示：

- `\voiceMode staffWise`
- `\voice`
- 同一 guitar track 下的双声部写法

**为什么单独做成 appendix track？**

因为 `voice` 在 AlphaTex 里是结构型语法，不适合强行塞进主旋律段落；分离出来更适合当教学样本。

---

## 语法覆盖矩阵

| 分类 | 已覆盖示例 | 典型位置 |
|---|---|---|
| Score 元数据 | `\title`, `\subtitle`, `\artist`, `\album`, `\music`, `\words`, `\wordsAndMusic`, `\copyright`, `\instructions`, `\notices`, `\defaultSystemsLayout` | 文件头部 |
| Track / Staff | `\track`, `\staff`, `\tuning`, `\capo`, `\chord` | Rhythm / Lead / Poly 三轨 |
| Structural | `\voiceMode`, `\voice` | `Poly Voice Lab` |
| Bar 元数据 | `\section`, `\ts`, `\tempo`, `\tf` | Rhythm Track 各段 |
| Beat 属性 | `ch`, `dy`, `txt`, `lyrics`, `tu`, `rasg`, `barre`, `fermata`, `tb`, `tbe`, `beam` | Rhythm + Lead |
| Note 属性 | `pm`, `lr`, `x`, `gr`, `h`, `string`, `lf`, `rf`, `v`, `vw`, `sl`, `ss`, `sib`, `sia`, `sou`, `sod`, `nh`, `ah`, `ph`, `th`, `sh`, `b`, `slur`, `st` | Lead Track 为主 |
| Tie / Sustaining | `-.2`, `lr` | Lead / Rhythm 尾声 |

---

## 如何使用这份示例

### 快速上手路径

如果你是第一次写 `AlphaTex` 吉他谱，建议按这个顺序读：

1. **先读头部**：看 score / track / staff 元数据怎么组织。
2. **再读 A 段**：理解最基本的和弦、调弦、节拍与文本。
3. **再读 Lead Track**：挑一个技巧簇单独拷贝测试。
4. **最后看 Poly Voice Lab**：把多声部当附加能力，不要一开始就用。

### 拷贝策略

推荐你每次只拷走一小段：

- 想写民谣：拷 A 段
- 想写扫弦 / 节奏练习：拷 B 段
- 想写 solo：拷 Lead Track 的中段
- 想研究双声部：拷 Poly Voice Lab

---

## 这份示例“没有”覆盖什么

这份文件已经尽量覆盖 **guitar 相关** 语法，但它刻意没有把所有冷门语法都塞进主曲，原因是会破坏教学可读性。

当前未重点覆盖的内容主要是：

- 偏排版/显示策略的稀有元数据
- 非吉他主场景（如 percussion / piano / numbered notation）
- 极少使用的 jump / barline / key signature 组合实验

如果你后续要，我可以继续基于这份总谱再扩一版：

- **Appendix B：Layout / Repeat / Navigation Lab**
- **Appendix C：Exotic Guitar Techniques Lab**

---

## 推荐的扩展方式

### 方式 1：改和声，不改语法

最适合初学者。保留节奏和属性，只把和弦与音高改掉。

### 方式 2：改技巧，不改旋律骨架

最适合练语法。把 `h` 改成 `sl`，把 `v` 改成 `vw`，把 `nh` 改成 `ph`，观察差异。

### 方式 3：拆成章节练习册

把 A/B/C/D 四段拆成独立 `.alphatex` 文件，你就得到一套迷你教学谱。

---

## 结语

这份示例曲的最佳用途，不是直接拿去当成品，而是当作你的：

- **AlphaTex 吉他模板库**
- **吉他技巧语法对照表**
- **教学谱脚手架**

如果你愿意，我下一步可以继续把它扩成：

- **更偏流行指弹版**
- **更偏金属技巧版**
- **更偏教学章节版（每段都能单独运行）**
