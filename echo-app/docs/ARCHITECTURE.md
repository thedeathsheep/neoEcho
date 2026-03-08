# 技术架构说明

## 分层架构

Echo 采用五层清晰分层架构，每层职责单一，依赖方向自上而下。

### 架构图

```
┌─────────────────────────────────────────────┐
│              Entry Layer (入口层)             │
│  src/app/page.tsx     src-tauri/src/lib.rs   │
├─────────────────────────────────────────────┤
│           Interface Layer (接口层)            │
│  src/app/api/health/  inspire/  generate/    │
├─────────────────────────────────────────────┤
│           Business Layer (业务层)             │
│  src/services/ai  rag  inspire               │
├─────────────────────────────────────────────┤
│             Data Layer (数据层)               │
│  src/data/db  repositories  models           │
├─────────────────────────────────────────────┤
│             Tool Layer (工具层)               │
│  src/lib/config  logger  errors  response    │
│  src/lib/utils/time  crypto  validation  http│
└─────────────────────────────────────────────┘
```

### 层级职责

| 层级 | 目录 | 职责 |
|------|------|------|
| 入口层 | `src/app/`, `src-tauri/` | 页面渲染、Tauri 命令、用户交互入口 |
| 接口层 | `src/app/api/` | HTTP 接口、请求校验、响应封装 |
| 业务层 | `src/services/` | 核心业务逻辑、AI 调度、RAG 检索 |
| 数据层 | `src/data/` | 数据库操作、数据模型定义 |
| 工具层 | `src/lib/` | 配置、日志、异常、工具函数 |

### 依赖规则

- 上层可以依赖下层，下层不可依赖上层
- 同层之间可以有限依赖
- 工具层被所有层依赖

## 技术栈表

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 运行时 | Node.js | 22+ | JavaScript 运行环境 |
| 框架 | Next.js | 15 | App Router + RSC |
| 桌面壳 | Tauri | v2 | 原生桌面应用 |
| 编辑器 | Tiptap | 3.x | 结构化富文本编辑 |
| UI | Tailwind CSS | v4 | 原子化样式 |
| AI SDK | Vercel AI SDK | 6.x | 多模型接口统一 |
| 校验 | Zod | 4.x | 运行时类型校验 |
| 动画 | Framer Motion | 12.x | 流畅交互动效 |
| 数据库 | SQLite | - | 本地数据持久化 |
| 语言 | TypeScript | 5.x | 类型安全 |
| 语言 | Rust | 1.77+ | Tauri 后端 |
| 规范 | ESLint + Prettier | 9.x / 3.x | 代码质量 |

## 数据流

```
用户输入 → Tiptap Editor → useHeartbeat (停顿检测)
  → POST /api/inspire → inspireService → ragService (知识检索)
  → 返回 EchoItem[] → AmbientRibbon (回声织带渲染)
```

## 关键设计决策

1. **BYOK 模式**: 用户自带 API Key，通过 Next.js Route Handlers 安全转发，前端不暴露密钥
2. **本地优先**: SQLite 本地存储，向量检索预留接口，数据不出用户设备
3. **语义抖动**: RAG 检索引入 0.2 的随机偏移，故意捕获弱相关但有文学张力的内容
4. **心跳触发**: 监测输入停顿 > 500ms 触发检索，不打断写作心流
