# Echo — 意识流 AI 写作伴生系统

> "Echo 不教你写作，它只是让你在荒原上听到万物的余震。"

Echo 是一款非生产导向的、服务于作者主体性的"沉思式"写作空间。基于 BYOK（Bring Your Own Key）模式，数据完全本地化，一次性买断。

## 技术栈

| 模块 | 技术 |
|------|------|
| 桌面壳 | Tauri v2 |
| 前端 | Next.js 15 (App Router) |
| 编辑器 | Tiptap + ProseMirror |
| 样式 | Tailwind CSS v4 |
| AI 调度 | Vercel AI SDK |
| 数据库 | SQLite (本地) |
| 校验 | Zod |
| 动画 | Framer Motion |

## 快速启动

### 环境要求

- Node.js >= 20
- pnpm >= 9
- Rust >= 1.77 (Tauri 开发需要，建议 1.88+ 或使用项目锁定的依赖)

### 安装依赖

```bash
pnpm install
```

### 配置环境变量

```bash
cp .env.example .env.development
# 编辑 .env.development，填入你的 AI_API_KEY
```

### 启动开发服务器

```bash
# Web 模式（仅前端）
pnpm dev

# Tauri 桌面模式（会自动清理 3000 端口与 Next 锁，再启动）
pnpm tauri:dev
```

若之前有残留的 Next 进程占用 3000 端口或 `.next/dev/lock`，`tauri:dev` 会先清理再启动，无需手动关进程。

### 其他命令

```bash
pnpm lint          # ESLint 检查 + 自动修复
pnpm format        # Prettier 格式化
pnpm typecheck     # TypeScript 类型检查
pnpm build         # 生产构建
pnpm tauri:build   # Tauri 打包 (.exe / .dmg)
```

**Tauri 构建产物位置**（执行 `pnpm tauri:build` 后）：

- **可执行文件**：`src-tauri/target/release/echo-app.exe`（Windows）
- **安装包**：`src-tauri/target/release/bundle/` 目录下  
  - Windows: `.msi`、或 NSIS 的 `.exe` 安装程序  
  - macOS: `.dmg`、`.app`

## 项目结构

```
src/
├── app/                # [入口层] Next.js App Router
│   ├── api/            # [接口层] Route Handlers
│   │   ├── health/     # 健康检查
│   │   ├── inspire/    # 意象激发
│   │   └── generate/   # AI 生成
│   ├── layout.tsx      # 根布局
│   ├── page.tsx        # 首页
│   └── globals.css     # 全局样式
├── components/         # UI 组件
│   ├── editor/         # Tiptap 编辑器
│   ├── ribbon/         # 回声织带
│   └── ui/             # 基础 UI 组件
├── services/           # [业务层] 业务逻辑
│   ├── ai.service.ts   # AI 调度
│   ├── rag.service.ts  # RAG 检索
│   └── inspire.service.ts
├── data/               # [数据层] 数据访问
│   ├── db.ts           # 数据库连接
│   ├── models/         # 数据模型
│   └── repositories/   # 数据仓库
├── lib/                # [工具层] 通用工具
│   ├── config/         # 环境配置
│   ├── logger/         # 统一日志
│   ├── errors/         # 统一异常
│   ├── response/       # 统一响应
│   └── utils/          # 工具函数
├── hooks/              # 自定义 Hooks
└── types/              # TypeScript 类型
```

## 架构原则

- **五层分层**: 入口层 → 接口层 → 业务层 → 数据层 → 工具层
- **非侵入性**: 灵感如背景音，不打断创作
- **互文性**: RAG 驱动的知识碰撞
- **去教育化**: 直接呈现原始素材，拒绝指导式语气
- **BYOK**: 用户自带 API Key，数据不出本地

## 故障排除

- **`time@0.3.47 requires rustc 1.88.0`**：当前 `Cargo.lock` 已锁定为兼容 rustc 1.87 的 `time` 0.3.45。若之后执行 `cargo update` 后再次报错，在 `src-tauri` 目录执行：  
  `cargo update -p time --precise 0.3.45`  
  或升级 Rust：`rustup update`。

## 许可

MIT
