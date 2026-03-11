# 开发进度表

## 里程碑

| 阶段 | 内容 | 目标日期 | 状态 |
|------|------|----------|------|
| M0 | 基建搭建 | - | ✅ 完成 |
| M1 | 编辑器核心 + 织带交互 | - | ✅ 完成 |
| M2 | 本地 RAG 引擎 | - | ✅ 完成 |
| M3 | Tauri 打包发布 | - | ✅ 完成 |
| M4 | 体验打磨 + 付费集成 | - | 🔄 进行中 |

## M0: 基建搭建（已完成）

- [x] Next.js 15 项目初始化
- [x] Tauri v2 初始化
- [x] 五层目录结构
- [x] 统一配置 (Zod 校验 + 环境区分)
- [x] 统一日志 (分级 + 彩色输出)
- [x] 统一异常处理 (AppError 体系)
- [x] 统一响应格式 (ApiResponse + withErrorHandler)
- [x] 工具库 (time / crypto / validation / http)
- [x] ESLint + Prettier 配置
- [x] 示例模块 (health check)
- [x] 编辑器组件骨架 (Tiptap)
- [x] 回声织带组件骨架
- [x] 心跳触发 Hook
- [x] API 接口 (inspire / generate)
- [x] 业务层 (AI / RAG / Inspire)
- [x] 数据层 (DB / Repository)
- [x] 文档 (README / ARCHITECTURE / REQUIREMENTS / CURSOR_RULES)

## M1: 编辑器核心 + 织带交互（已完成）

- [x] Tiptap 自定义 Schema (Block NodeID) — `node-id-extension.ts` 完成
- [x] Block NodeID 与 Echo 关联 — `echo-editor.tsx` 已传递 blockId 到 API
- [x] 织带流动动画优化 — layout 动画、入场/退场、边缘渐变
- [x] 织带内容与编辑器 Selection 联动 — currentBlockId 高亮当前段落回声
- [x] 心流历史记录存储 — `flow-history.ts` + localStorage 按 documentId 存储/恢复
- [x] 编辑器快捷键绑定 — Ctrl+S 保存，Alt+I 触发意象
- [x] 文档标题 + 自动保存 — `document-storage.ts`，标题受控，内容 2s 防抖保存
- [x] 织带多模块配置 — 支持 RAG、AI 意象、AI 润色等多模块同时启用
- [x] 织带固定来源 — 最多 5 个固定来源（共鸣库最多 3 本）
- [x] 织带格数配置 — 支持 5-8 格
- [x] 织带详情面板 — Alt+Q 切换单元，右侧显示原文
- [x] 开发者面板 — 实时查看工作流日志

## M2: 本地 RAG 引擎（已完成）

- [x] PDF 解析 (pdf.js) — `file-parser.service.ts`
- [x] Markdown/TXT 解析 — 支持 .md/.txt 文件
- [x] 文本分块 (意象原子化) — `chunking.service.ts` 句子级分块 + 重叠
- [x] 本地 Embedding (transformers.js) — `embedding.service.ts`，Xenova/all-MiniLM-L6-v2，仅浏览器
- [x] API Embedding — 支持硅基流动、OpenRouter、AIHubMix 等服务商
- [x] 向量存储 — IndexedDB 存储 chunk + embedding，内存中 `searchVectors` 检索
- [x] 混合检索 (向量 + 关键词) — `rag.service.ts` 关键词评分
- [x] 语义抖动算法 — 已实现 0.2 jitter，但前 2 条强相关结果不参与抖动
- [x] 强制书目 — 支持 1-3 本强制检索
- [x] 知识库 UI 面板 — `knowledge-panel.tsx` 文件管理
- [x] Tauri FS 文件读取 — 已配置权限和插件
- [x] 语义扩展查询 — AI 扩展查询词提升召回率（可开关）
- [x] 织带 AI 过滤 — 检索后过滤低价值片段（页眉页脚等）

## M3: Tauri 打包发布（已完成）

- [x] 本地文件系统访问 (Tauri API) — fs + dialog 插件，能力见 `capabilities/default.json`，使用见 `knowledge-base.service.ts`
- [x] 应用图标设计 — `src-tauri/icons/` 已生成（含 icon.ico / icon.icns），源图 `app-icon-square.png`
- [x] Windows .exe 打包 — `pnpm tauri build`，产物见 `src-tauri/target/release/bundle/`（NSIS/MSI）
- [x] macOS .dmg 打包 — 需在 macOS 本机执行 `pnpm tauri build`，详见 `docs/BUILD.md`
- [x] 自动更新机制 — `tauri-plugin-updater` + `tauri-plugin-process`，配置与签名见 `docs/BUILD.md`

## M4: 体验打磨（进行中）

- [x] Query Expansion 开关优化 — 更清晰的 UI 文案，说明速度与召回的权衡
- [x] Chunk 策略优化 — 大小 200→280，重叠 30→100，提升语义完整性
- [ ] RAG 检索质量持续优化 — 强相关优先、减少随机填充
- [ ] UI 动效精调
- [ ] 环境音合成
- [ ] License Key 验证 (Lemon Squeezy)
- [ ] 落地页

## 最近更新

### 2025-03-07
- 优化 Query Expansion 开关 UI，增加「速度优先/召回优先」状态提示
- 优化 Chunk 分块策略：maxChunkSize 200→280，overlap 30→100

### 2025-03-06
- 实现织带多模块配置（RAG + AI 模块同时生效）
- 实现固定来源机制（最多 5 个，共鸣库最多 3 本）
- 实现织带详情面板（Alt+Q 切换，右侧显示原文）
- 实现开发者面板（实时日志）
- 移除未使用的 AI 灵感倾向单选，统一为内容模块配置
