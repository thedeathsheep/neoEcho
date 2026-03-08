# Echo 构建与发布 (M3)

**说明**：生产构建使用 Next.js `output: 'export'` 生成静态 `out/` 供 Tauri 加载。此时 `/api/*` 为构建时预渲染，桌面版若需动态 AI 能力可后续改为 Tauri 命令或外部 API。

## 本地文件系统访问 (Tauri API)

已通过 Tauri 插件与能力配置实现：

- **插件**：`tauri-plugin-fs`、`tauri-plugin-dialog`
- **能力**：`capabilities/default.json` 中启用 `fs:allow-read-file`、`fs:allow-read-dir`、`fs:allow-open`、`dialog:allow-open`
- **作用域**：`$HOME/**`、`$DOCUMENT/**`、`$DOWNLOAD/**`（可读）
- **使用处**：知识库导入文件时通过 `open()` 选文件、`readFile()` 读内容（见 `knowledge-base.service.ts`）

## 应用图标

- 源图：`src-tauri/app-icon-square.png`（正方形，建议 1024×1024）
- 已生成多尺寸：`src-tauri/icons/`（32x32、128x128、icon.ico、icon.icns 等）
- 更换图标：替换 `app-icon-square.png` 后执行  
  `pnpm tauri icon src-tauri/app-icon-square.png`

## Windows .exe 打包

1. 在项目根目录（echo-app）执行：
   ```bash
   pnpm build
   pnpm tauri build
   ```
2. 产物位置：
   - 可执行文件：`src-tauri/target/release/echo-app.exe`
   - 安装包：`src-tauri/target/release/bundle/`
     - **NSIS**：`nsis/Echo_0.1.0_x64-setup.exe`
     - **MSI**：`msi/Echo_0.1.0_x64_en-US.msi`

如需生成**带签名的更新包**（用于自动更新），见下方「自动更新机制」。

## macOS .dmg 打包

需在 **macOS** 本机执行：

```bash
pnpm build
pnpm tauri build
```

产物：

- 应用包：`src-tauri/target/release/bundle/macos/Echo.app`
- 磁盘镜像：`src-tauri/target/release/bundle/dmg/Echo_0.1.0_x64.dmg`（Intel）或对应 aarch64

## 自动更新机制

已接入 `tauri-plugin-updater` + `tauri-plugin-process`（更新后重启）。

### 配置

- **tauri.conf.json**  
  - `bundle.createUpdaterArtifacts: true`  
  - `plugins.updater`：需填写有效的 `pubkey` 和 `endpoints`（当前为占位，见下）

### 1. 生成签名密钥（一次性）

```bash
pnpm tauri signer generate -w ~/.tauri/echo.key
```

会生成私钥（勿泄露）和公钥。将 **公钥文件内容** 整段复制到 `tauri.conf.json` → `plugins.updater.pubkey`（不能写文件路径，必须是内容）。

### 2. 构建时签名（生成 .sig）

**Windows (PowerShell)：**

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "C:\path\to\echo.key"   # 或直接粘贴私钥内容
# 如有密码： $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "your-password"
pnpm tauri build
```

**macOS/Linux：**

```bash
export TAURI_SIGNING_PRIVATE_KEY="/path/to/echo.key"
pnpm tauri build
```

构建完成后，在 `target/release/bundle/` 各子目录下会生成对应 `.sig` 文件（与 .exe/.msi/.dmg 等一一对应）。

### 3. 更新端点

将 `tauri.conf.json` 中 `plugins.updater.endpoints` 改为你的更新地址，例如：

- **静态 JSON**（如 GitHub Releases）：  
  上传每平台的安装包 + 对应 `.sig`，并提供一个 `latest.json`，格式见 [Tauri 文档](https://v2.tauri.app/plugin/updater/) 的 “Static JSON File”。
- **动态服务**：  
  端点返回 204 表示无更新，200 + JSON（含 `version`、`url`、`signature` 等）表示有更新。

### 4. 前端检查更新（可选）

在需要的地方（如设置页）调用：

```ts
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

const update = await check()
if (update) {
  await update.downloadAndInstall((event) => { /* 进度 */ })
  await relaunch()
}
```

需在 Tauri 能力中已启用 `updater:default` 与 `process:allow-restart`（已配置于 `capabilities/desktop.json`）。
