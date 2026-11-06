# Vein 磁盘清理

面向 Windows 10/11 的磁盘空间清理与分析工具，参考 CCleaner、驱动精灵等业内工具的核心体验，聚焦三件事：**安全清理垃圾、看清磁盘占用、找出重复文件**。

> 默认浅色主题，可在设置中切换深色、护眼绿或跟随系统。

## 功能

### 一键垃圾清理

- **系统**：用户临时文件、Windows 临时文件、Windows Update 残留、传递优化缓存、缩略图与图标缓存、字体缓存、错误报告、内存转储、系统网络缓存、7 天前日志、预读取文件
- **浏览器**：Chrome / Edge / Firefox 的网页缓存、代码缓存、GPU 缓存、Service Worker 缓存（不触碰书签、密码、Cookies、Local Storage）
- **回收站**：一键清空（高风险，二次确认）
- **用户文件**：下载目录旧文件（移入回收站）、最近使用记录（默认关闭）

流程固定为 **扫描 → 查看明细 → 勾选 → 确认 → 清理**，清理后展示成功 / 失败 / 跳过清单及原因。

### 磁盘空间分析

- 驱动器容量概览（总容量 / 已用 / 可用），也可直接选择任意文件夹分析
- 目录占用 **矩形树图 / 环形图** 可视化，支持面包屑下钻
- 目录子项按大小排序分页展示
- 全局大文件 Top 500，双击定位到资源管理器
- 全程只读，不删除任何文件

### 重复文件查找

- 三级比对：按大小分组 → 前/后 16KB 部分哈希 → 完整流式哈希（SHA-256）
- `worker_threads` 多线程哈希，可取消
- 保留规则：最新修改 / 最早创建 / 路径最短 / 手动选择
- 删除时 **强制每组至少保留一个文件**，统一移入回收站，可恢复

## 安全设计

- 清理目标来自主进程内的固定规则表，渲染进程只能传规则 ID，无法构造任意路径
- 删除前再次校验路径必须位于规则根目录内，并拒绝受保护目录（`System32`、`WinSxS`、用户文档 / 桌面等）
- 绝不跟随符号链接 / 目录联接，避免误删链接目标
- 支持超长路径（`\\?\` 前缀）
- 被占用 / 无权限文件**跳过并说明原因**，不中断其余清理，也不强改 ACL
- Electron 安全基线：`contextIsolation`、`sandbox`、无 `nodeIntegration`、严格 CSP、IPC 来源校验
- 权限策略：默认普通权限运行；需要管理员的功能在界面标注，可一键提权重启并续跑原任务；未提权时受限项自动跳过

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面运行时 | Electron 45 |
| 构建 | electron-vite 6 / Vite 8 / electron-builder 26 |
| 渲染层 | Vue 3.5（`<script setup>`）+ TypeScript + Pinia + Vue Router |
| UI | Element Plus 2.14（`elp-` 命名空间，按需自动导入）+ ECharts 6 |
| 自动导入 | unplugin-auto-import（Vue Composition API / Pinia / Router / 图标）+ unplugin-vue-components（本地组件 + Element Plus） |
| 测试 | Vitest 5 |

## 样式与主题

Element Plus 组件标签保持标准 `el-*` 写法（如 `<el-button>`），仅将运行时类名与 CSS 变量切换为 `elp-*`：由 `ElConfigProvider` 的 `namespace: 'elp'` 与 SCSS `$namespace: 'elp'` 同步控制。因此自定义样式选择器使用 `.elp-*` / `--elp-*` 前缀。

Element Plus 主题通过 `styles/element/index.scss` 一次性全局编译引入（未按组件拆分样式），以保证 `elp` 命名空间、暗色变量与全部组件样式一致；对桌面应用体积影响可忽略。

```
src/renderer/src/styles/
├─ index.scss              # 汇总入口
├─ element/index.scss      # Element Plus 主题（elp 命名空间，含暗色变量）
└─ themes/
   ├─ tokens.scss          # 与主题无关的设计令牌（圆角、尺寸、字体）
   ├─ light/index.scss     # 浅色主题（默认）
   ├─ green/index.scss     # 护眼绿主题
   └─ dark/index.scss      # 深色主题
```

自动导入约定：

- 自动导入：Vue Composition API（`ref`/`computed`/`onMounted` 等）与 Pinia
- 手动导入：Vue Router、Element Plus API（`ElMessage`/`ElMessageBox`）与图标、stores/composables/lib、`src/shared`、中文语言包 `zhCn`
- Element Plus 模板组件（`<el-button>` 等）与本地组件由 unplugin-vue-components 自动注册，页面无需显式 import 组件

## 开发

```bash
pnpm install        # 安装依赖
pnpm dev            # 开发模式（HMR）
pnpm typecheck      # 主进程 + 渲染进程类型检查
pnpm test           # 单元 / 集成测试
pnpm build          # 构建到 build/
pnpm dist           # 构建并打包 Windows 安装包到 dist/
```

> 若 Electron 二进制下载失败，可设置镜像后重试：
> `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js`

### 构建产物

- `build/main/` 主进程
- `build/preload/` 预加载脚本
- `build/renderer/` 渲染层静态资源
- `dist/` 安装包（NSIS + portable）

### 应用图标

源图为项目根目录 `vein.jpg`，执行 `pnpm icon` 会生成：

- `resources/icon.ico`（256，圆角透明，用于 exe / 安装器）
- `resources/icon.png`（512，开发窗口与通用用途）
- `resources/icon-1024.png`（1024，高清备用）

图标使用抗锯齿圆角遮罩，圆角外为透明区域。

### 日志位置

日志默认写入安装目录下的 `logs/`：

- 安装版：`<安装目录>\logs\vein.log`（用户级安装目录可写）
- 便携版：便携 exe 同级的 `logs\vein.log`
- 若目录不可写（例如安装到 `Program Files`），自动回退到 `%APPDATA%\Vein\logs\vein.log`

可在「设置 → 日志」中自定义日志目录并点击「保存并迁移」：现有 `vein.log` / `vein.old.log` 会迁移到新目录，目标文件已存在时采用追加，避免覆盖历史日志。留空并保存则恢复默认目录。

单文件超过 2MB 时轮转为 `vein.old.log`。设置页会显示当前实际生效的日志目录。

### 开发调试截图

设置环境变量 `VEIN_CAPTURE=1` 时，应用启动后会自动逐页截图到项目根目录；追加 `VEIN_CAPTURE_SCAN=1` 会额外执行一次清理扫描（不确认删除）与分析扫描（自动取消），用于界面回归。

```bash
VEIN_CAPTURE=1 VEIN_CAPTURE_SCAN=1 pnpm dev
```

该能力仅在非打包环境生效。

## 目录结构

```
src/
├─ shared/                 主/渲染进程共享类型、IPC 通道、格式化工具
├─ preload/                contextBridge 白名单 API
├─ main/
│  ├─ core/                任务管理、并发、路径守卫、设置、日志
│  ├─ platform/            管理员检测、提权续跑、PowerShell、驱动器、服务
│  ├─ fs/                  目录遍历、安全删除、哈希
│  ├─ clean/               清理规则、规则展开、扫描器、清理器
│  ├─ analyze/             目录树存储、空间分析
│  ├─ duplicates/          候选索引、哈希池、分组与回收站删除
│  └─ ipc/                 IPC 注册与入参校验
└─ renderer/src/           Vue 页面、组件、状态管理、主题
```

## 代码签名

发布前建议配置 Windows 代码签名，避免 SmartScreen「未知发布者」提示。支持 PFX、Azure Trusted Signing 与自定义签名钩子三种方式，详见 [docs/code-signing.md](docs/code-signing.md)。

## 已知边界

- Windows Update 缓存清理不会强制停止系统服务之外的持久修改：清理前停止 `wuauserv/bits/dosvc`，完成后在 `finally` 中恢复；异常退出时会通过服务恢复日志在下次启动时自动恢复
- 缩略图 / 字体缓存常被系统进程占用，被占用的文件会跳过并在结果中列出
- 重复文件按内容哈希判定，不校验文件扩展名；删除前会复核大小，扫描后发生变化的文件会跳过
- 未做代码签名，首次安装可能触发 SmartScreen 提示

## 免责声明

请在使用「下载目录旧文件」「回收站」等高风险清理项前确认内容。工具会尽量通过回收站与安全校验降低风险，但删除操作仍可能造成数据丢失。
