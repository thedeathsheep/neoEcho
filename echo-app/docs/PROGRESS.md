# 开发进度表

## 里程碑

| 阶段 | 内容 | 目标日期 | 状态 |
|------|------|----------|------|
| M0 | 基建搭建 | - | ✅ 完成 |
| M1 | 编辑器核心 + 织带交互 | - | 📋 待开发 |
| M2 | 本地 RAG 引擎 | - | 📋 待开发 |
| M3 | Tauri 打包发布 | - | ✅ 完成 |
| M4 | 体验打磨 + 付费集成 | - | 📋 待开发 |

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

## M1: 编辑器核心 + 织带交互

- [x] Tiptap 自定义 Schema (Block NodeID) — `node-id-extension.ts` 完成
- [x] Block NodeID 与 Echo 关联 — `echo-editor.tsx` 已传递 blockId 到 API
- [x] 织带流动动画优化 — layout 动画、入场/退场、边缘渐变
- [x] 织带内容与编辑器 Selection 联动 — currentBlockId 高亮当前段落回声
- [x] 心流历史记录存储 — `flow-history.ts` + localStorage 按 documentId 存储/恢复
- [x] 编辑器快捷键绑定 — Ctrl+S 保存，Alt+I 触发意象
- [x] 文档标题 + 自动保存 — `document-storage.ts`，标题受控，内容 2s 防抖保存

## M2: 本地 RAG 引擎

- [x] PDF 解析 (pdf.js) — `file-parser.service.ts`
- [x] Markdown/TXT 解析 — 支持 .md/.txt 文件
- [x] 文本分块 (意象原子化) — `chunking.service.ts` 句子级分块 + 重叠
- [x] 本地 Embedding (transformers.js) — `embedding.service.ts`，Xenova/all-MiniLM-L6-v2，仅浏览器
- [x] 向量存储 — 当前 chunk+embedding 存 localStorage，内存中 `searchVectors` 检索；sqlite-vec 可选后续
- [x] 混合检索 (向量 + 关键词) — `rag.service.ts` 关键词评分
- [x] 语义抖动算法 — 已实现 0.2 jitter
- [x] 知识库 UI 面板 — `knowledge-panel.tsx` 文件管理
- [x] Tauri FS 文件读取 — 已配置权限和插件

## M3: Tauri 打包发布

- [x] 本地文件系统访问 (Tauri API) — fs + dialog 插件，能力见 `capabilities/default.json`，使用见 `knowledge-base.service.ts`
- [x] 应用图标设计 — `src-tauri/icons/` 已生成（含 icon.ico / icon.icns），源图 `app-icon-square.png`
- [x] Windows .exe 打包 — `pnpm tauri build`，产物见 `src-tauri/target/release/bundle/`（NSIS/MSI）
- [x] macOS .dmg 打包 — 需在 macOS 本机执行 `pnpm tauri build`，详见 `docs/BUILD.md`
- [x] 自动更新机制 — `tauri-plugin-updater` + `tauri-plugin-process`，配置与签名见 `docs/BUILD.md`

## M4: 体验打磨 + 付费集成

- [ ] UI 动效精调
- [ ] 环境音合成
- [ ] License Key 验证 (Lemon Squeezy)
- [ ] 落地页
