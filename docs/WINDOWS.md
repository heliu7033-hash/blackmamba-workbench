# Windows 版

Windows 与 Mac 共用界面、服务和工作流模型。Windows 使用 Electron 桌面外壳，Mac 原生 Swift 外壳保留。

## 安装与运行

面向 Windows 10/11 x64 的预览版。在本仓库 Releases 下载 Black-Mamba-Workbench-win-x64.exe，可选择当前用户的安装位置。安装包自带运行时，基础工作流不需要另装 Node.js。目前没有代码签名证书。

数据位于当前用户的应用数据目录：%APPDATA%\blackmamba-workbench\workspace 保存任务、对话和素材，应用配置目录还保存浏览器项目记录。菜单「工作台 → 打开数据目录」可查看文件。卸载默认保留用户数据；项目 JSON 导出不包含媒体，换电脑应同时备份媒体目录。Windows 和 Mac 不会自动同步项目。

## 可选工具

- 文案智能体：自行安装并登录 Codex CLI。支持 PATH 中的 codex.exe 和通常的 npm 全局 @openai/codex/bin/codex.js；也可设置 MAMBA_CODEX_BIN 指定位置。每台电脑使用自己的账号，安装包不携带凭据。
- 生成图片转换、波形和兼容预览：安装 FFmpeg 并加入 PATH，或设置 MAMBA_FFMPEG / MAMBA_FFPROBE。没有这些工具时，基础工作流及浏览器可直接解码的媒体仍可使用。
- 达芬奇素材导入：安装 Python 3 和 DaVinci Resolve，开启本地外部脚本。可通过 MAMBA_PYTHON3 指定 Python，通过 RESOLVE_SCRIPT_API 指定包含 Modules 的脚本目录。接收达芬奇或 AE 导出文件不要求脚本桥接。
- 动态分镜：自行安装兼容版本的 Remotion / @remotion/cli；MAMBA_REMOTION_CLI 指向其 package.json，MAMBA_CHROME 指向浏览器。安装版读取用户环境变量，修改后应退出并重开。

MCP 功能取决于配置的工具和账号权限。本机 CLI 不代表离线模型。

## 开发构建

安装 Node.js 24、Python 3 和 FFmpeg 后依次运行：

    npm ci
    node node_modules/electron/install.js
    npm test
    npm run build:win

安装程序在 build/windows/。运行 npm run desktop:dev 可打开桌面开发版。打包只复制明确列出的源文件，重新生成不含本地封面的网页资源，不复制 data/、浏览器记录、账号或用户素材。

## 验证范围

Windows CI 执行全量回归，再构建并静默安装到含中文与空格的目录。桌面测试覆盖首次空项目库、文案接收、图片导入与解码、视频播放、素材批次、达芬奇/AE 文件版本和交付来源；退出重启后再次检查项目和素材持久化。

智能体在 CI 使用模拟服务，不调用真实付费模型；CI 未安装真实达芬奇/AE。真实 Codex 出图权限、外部软件桥接、不同显卡和用户机器上的体验仍需单独验收。悬浮球目前仅在 Mac 原生版提供。
