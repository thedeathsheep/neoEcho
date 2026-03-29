# Echo

> 面向写作者的本地优先 AI 写作工作台。

Echo 把写作、提示、资料检索和整理放在同一个空间里，尽量不打断创作节奏。

## 当前状态

- 核心写作、知识库、织带提示、设置与帮助流程已可用。
- 默认是本地优先：文稿和大部分设置保存在当前设备的 `localStorage`，知识库分片与嵌入保存在 `IndexedDB`。
- `src/data/db.ts` 目前只是预留的数据层抽象，不是应用主链路里的真实持久化来源。
- AI 请求只会在你主动配置模型服务后发送到你填写的接口地址。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 桌面壳 | Tauri v2 |
| 前端 | Next.js 16 (App Router) |
| 编辑器 | Tiptap + ProseMirror |
| 样式 | Tailwind CSS v4 |
| 动画 | Framer Motion |
| 校验 | Zod |
| 文稿存储 | localStorage |
| 知识库存储 | IndexedDB |

## 本地开发

### 环境要求

- Node.js >= 20
- pnpm >= 9
- Rust >= 1.77

### 安装依赖

```bash
pnpm install
```

### 配置环境变量

```bash
cp .env.example .env.development
```

按需填写你自己的模型服务配置，例如 `AI_API_KEY`。

### 启动开发环境

```bash
pnpm dev
pnpm tauri:dev
```

### 常用命令

```bash
pnpm exec eslint .
pnpm typecheck
pnpm build
pnpm tauri:build
```

## 目录说明

```text
src/
  app/               Next.js 页面与路由
  components/        编辑器、织带、帮助与通用 UI
  hooks/             自定义 hooks
  lib/               本地存储、日志、设置、工具函数
  services/          AI、知识库、RAG、解析等业务逻辑
  data/              预留数据层抽象
  types/             共享类型定义
```

## 存储说明

- 文稿标题、正文、最近打开文稿等信息保存在 `localStorage`
- 大部分用户设置保存在 `localStorage`
- 知识库分片、嵌入向量等较大数据保存在 `IndexedDB`
- 清理浏览器或应用站点数据会导致这些本地内容被移除

## 发布前建议

- 保持 `pnpm exec eslint .`、`pnpm typecheck`、`pnpm build` 全部通过
- 核对帮助文案是否与真实行为一致
- 手测首次启动、文稿恢复、知识库导入、设置保存、API 配置验证等主链路

## License

MIT
