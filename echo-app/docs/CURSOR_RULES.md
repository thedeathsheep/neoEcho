# Cursor 协作规则

## 项目概述

Echo 是一款意识流 AI 写作伴生系统。技术栈为 Tauri v2 + Next.js 15 + Tiptap，采用五层分层架构。

## 架构规则

### 分层依赖

- **入口层** (`src/app/`): 页面和布局，只调用接口层或直接使用组件
- **接口层** (`src/app/api/`): Route Handlers，调用业务层，不直接操作数据库
- **业务层** (`src/services/`): 核心逻辑，调用数据层和工具层
- **数据层** (`src/data/`): 数据库操作，只被业务层调用
- **工具层** (`src/lib/`): 纯函数和配置，被所有层使用

### 禁止事项

- 上层不可反向依赖下层 (如 service 不可 import page 组件)
- 接口层不可直接操作数据库
- 组件不可包含业务逻辑，应通过 hooks 或 services 调用

## 编码规范

### 文件命名

- 组件: `kebab-case.tsx` (如 `echo-editor.tsx`)
- 服务: `kebab-case.service.ts` (如 `ai.service.ts`)
- 仓库: `kebab-case.repo.ts` (如 `document.repo.ts`)
- 模型: `kebab-case.model.ts` (如 `document.model.ts`)
- 工具: `kebab-case.ts` (如 `time.ts`)
- Hook: `use-kebab-case.ts` (如 `use-heartbeat.ts`)

### 代码风格

- 使用 `@/` 路径别名引用 `src/` 下的文件
- 接口使用 `withErrorHandler` 包裹
- 日志使用 `createLogger('module-name')` 创建
- 校验使用 Zod schema + `parseRequestBody` / `validate`
- 响应使用 `ok()` / `fail()` 封装
- 组件必须标注 `'use client'`（如果使用 hooks/state）
- 禁止在代码中硬编码 API Key

### 异常处理

- 业务异常使用 `AppError` 子类 (`ValidationError`, `NotFoundError`, `AIServiceError`)
- 接口层统一通过 `withErrorHandler` 捕获
- 前端静默失败（non-intrusive），不弹错误弹窗

### AI Prompt 风格

- System Prompt 严禁 "Assistant" 语气
- 输出必须是原始素材或极简标签
- 禁止解释、导语、建议性文字
- 叙事标签不超过 6 个字

## Vibe Coding 提示词

以下是与 Cursor 协作时常用的提示词模板：

### 添加新 API 接口

```
请在 src/app/api/{name}/route.ts 创建一个新的 POST 接口。
要求：
1. 使用 Zod schema 校验请求体
2. 使用 withErrorHandler 包裹
3. 调用对应的 service 层方法
4. 使用 ok() / fail() 返回统一响应
5. 添加 createLogger 日志
```

### 添加新业务服务

```
请在 src/services/{name}.service.ts 创建一个新的服务。
要求：
1. 导出一个对象，包含所有方法
2. 使用 createLogger 记录关键操作
3. 抛出 AppError 子类处理异常
4. 通过 repository 访问数据
```

### 添加新 UI 组件

```
请在 src/components/{category}/{name}.tsx 创建一个新组件。
要求：
1. 标注 'use client'（如果需要交互）
2. 使用 TypeScript Props 接口
3. 使用 Tailwind CSS 样式
4. 遵循 Echo 的视觉风格：纸质感、低对比度、衬线字体
```
