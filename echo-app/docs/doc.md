这份文档不仅是写给“开发中的 AI 助手”看的指令，更是为你这款名为 **Echo** 的工具注入灵魂的**底层协议**。它融合了产品经理的严谨与创作者的审美。

---

# Echo：意识流 AI 写作伴生系统 (PRD)

## 1. 产品愿景与核心理念

> **"Echo 不教你写作，它只是让你在荒原上听到万物的余震。"**

- **定位：** 非生产导向的、服务于作者主体性的“沉思式”写作空间。
- **核心哲学：**
- **非侵入性 (Non-intrusive)：** 灵感应如背景音，而非指令。
- **互文性 (Intertextuality)：** 通过 RAG 技术让私人知识库与当前创作产生化学反应。
- **去教育化 (Un-pedagogical)：** 拒绝 AI 的爹味指导，只呈现原始素材与叙事标签。

---

## 2. 核心功能模块 (Functional Requirements)

### 2.1 沉浸式编辑器 (Core Editor)

基于 **Novel / Tiptap** 架构，剔除所有干扰创作的 UI 元素。

- **无感输入：** 默认全屏，无字数统计，无进度条。
- **结构化文档：** 每一个 Block（段落/句子）均具备唯一的 `NodeID`，用于高精度 RAG 触发。

### 2.2 回声织带 (The Ambient Ribbon - 核心交互)

位于编辑器顶部的较窄的横向流动区域。

- **流动逻辑：** 随着行数向下移动，顶部织带向左滚动，但是删除后织带不会回滚。
- **内容构成：**
- **1. 碎片化原典：** 从用户上传的 PDF/笔记 中提取的 100 字以内原句，“世界上只有一个人——博尔赫斯《xxxx》”。
- **2. 物理锚点：** 针对名词的客观物候描述（如：梧桐的发芽期为......——《大英百科全书》）。
- **3. 叙事标签：** 4-6 字的抽象式写作引导（如：`[虚饰的宁静]  [我们并不能完全相信]  [他有危险了。]`）。
- 4. 用户自定义：用户可在设置中规定，织带中出现制定的内容倾向。

- **交互动作：** 鼠标悬停时轻微增亮，支持左右滑动手滑回溯“心流历史”。点击跳出浮窗，浮窗中为AI对该文本的解释。

### 2.3 私人共鸣库 (Local RAG Engine)

- **数据隔离：** 支持用户上传本地文件夹（PDF, Markdown, TXT，后续支持更多内容的上传）但是需要考虑大小限制。
- **预处理协议：**
- **意象提取：** 预先将长文切碎为“意象原子”。
- **情感标注：** 自动为片段标记情绪基调。
- **检索权重：** 引入 `0.2` 的 **“语义抖动 (Semantic Jittering)”**，故意引入弱相关但具文学张力的素材。

---

## 3. 技术架构方案 (Technical Architecture)

为了体现项目专业度，采用 **BYOK + 本地存储** 的全栈架构：


| 模块        | 技术选型                         | 专业体现                                  |
| --------- | ---------------------------- | ------------------------------------- |
| **壳子**    | **Tauri v2**                 | 极小的内存占用，原生支持本地文件系统访问。                 |
| **前端**    | **Next.js 15 (App Router)**  | 利用 React Server Components 实现高性能流式渲染。 |
| **编辑器**   | **Tiptap + ProseMirror**     | 结构化文档控制，支持自定义 Schema。                 |
| **数据库**   | **SQLite + pgvector (WASM)** | 本地向量存储，无需后端服务器，数据不出本地。                |
| **AI 调度** | **Vercel AI SDK**            | 标准化模型接口，支持用户快速切换 Claude/GPT/DeepSeek。 |


### 项目目录结构建议 (Repo Structure)

```text
echo-app/
├── src/
│   ├── components/
│   │   ├── editor/          # Tiptap Extensions & Custom Nodes
│   │   ├── ribbon/          # 上方流动的“回声织带”组件
│   │   └── sidebar/         # 极简的本地库管理
│   ├── lib/
│   │   ├── rag/             # 向量检索逻辑、语义抖动算法
│   │   ├── prompts/         # 审美调教过的 System Prompts
│   │   └── hooks/           # useFlow: 监听心流状态的自定义 Hook
│   └── api/                 # Next.js Route Handlers (BYOK 转发)
├── tauri/                   # Rust 底层逻辑 (文件监听、安装包配置)
└── data/                    # 本地数据存储与索引

```

---

## 4. 关键体验设计 (User Experience)

### 4.1 触发算法 (The "Heartbeat" Trigger)

- **静默监测：** 监测输入停顿时间 $T > 500ms$ 时，触发静默检索。
- **意象过滤：** 优先提取当前句子的 `Noun`（名词）和 `Adjective`（形容词），构建检索向量。

### 4.2 审美调教 (Prompt Strategy)

系统 Prompt 严禁出现“Assistant”语气，需设定为：

> "Act as a silent collector of memories. Your output must be RAW snippets from the provided context. No intros, no explanations. If generating a tag, use max 6 words of high poetic tension."

---

## 5. 商业与分发模型

- **模式：** 一次性付费买断 (Pay-once-own-forever)。
- **交付物：** `.dmg` (Mac) / `.exe` (Windows) 安装包。
- **隐私声明：** “Echo 不拥有你的 API Key，不上传你的草稿，它只在你本地的意识里回荡。”

---

## 6. 后续迭代 (Roadmap)

- **v1.1:** 增加“环境音合成”功能（根据文字情绪实时生成背景白噪音）。
- **v1.2:** 接入本地 Embedding 模型，实现 100% 离线 RAG。
- **v1.5:** 增加“意识图谱”视图，可视化一篇文章的灵感来源分布。

