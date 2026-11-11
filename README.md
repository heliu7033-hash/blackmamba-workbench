# 黑曼巴工作台 · Black Mamba Workbench

面向小型影视与广告团队的本地制作工作台。把创意文案、素材、剪辑调色、包装和交付连接成可追溯的项目工作流。

这是**仅含源代码的开源版本**：首次打开没有项目，不含工作室项目、客户资料、素材、研究资料、账号配置或私有仓库历史。参考资料库由使用者自行添加。

## 功能

- 项目缩略卡与树状工作流：创意方案 → 素材制作 → 剪辑后期 → 交付归档。
- 问答式文案智能体：每轮提供至少三个方向，完成选择后才生成文案；支持本机 Codex CLI 与 Streamable HTTP MCP 对话工具。
- 分镜规划与图片生成、导入本地图片/视频、素材分类与大屏预览。
- 文案版本、素材批次、达芬奇导出、AE 包装与交付的来源追溯；上游改稿不会覆盖已制作版本。
- 本地素材检索、波形预览、可选的 DaVinci Resolve 素材导入，以及 macOS 原生外壳。

## 本地运行

需要 Node.js 24 或更高版本、Python 3.9+。媒体波形及完整测试还需要 PATH 中的 FFmpeg / ffprobe。

```sh
git clone https://github.com/heliu7033-hash/blackmamba-workbench.git
cd blackmamba-workbench
npm ci
npm run build
npm start
```

打开 <http://127.0.0.1:18771/>。停止服务使用 Ctrl+C。项目记录保存在当前浏览器的本地存储，服务侧对话、素材及任务保存在 `data/`；两者都应备份。JSON 项目备份不包含媒体文件。默认只监听本机，不适合作为互联网多用户服务直接部署。

可通过 `MAMBA_PORT` 和 `MAMBA_DATA_DIR` 指定端口及数据目录。不要同时在同一端口运行两份工作台。

## Windows 应用

Windows x64 桌面预览版与 Mac 共用核心代码。下载入口：[Releases](https://github.com/heliu7033-hash/blackmamba-workbench/releases)。安装包自带运行时，不含项目或账号；可选工具与验证范围见 [Windows 说明](docs/WINDOWS.md)。

开发者运行 npm run build:win 构建安装包。Windows CI 会安装、启动、验证工作流并检查重启后的数据。

## macOS 应用

安装 Xcode Command Line Tools 后运行：

```sh
npm run build:mac
open build/黑曼巴工作台.app
```

上述命令供本机开发，使用构建时的 Node 路径与数据目录。可转发的安装包使用 `bash scripts/package-mac.sh` 构建：需要已签名的通用 Node 24+ 可执行文件（默认 PATH 中的 node，也可指定 MAMBA_NODE_BINARY）。脚本打包 Apple 芯片与 Intel 原生外壳、自带 Node 及其许可证，并清空本地封面索引。产物位于 build/mac-share/，适用于 macOS 13+。

安装者将 DMG 内的应用拖入 Applications。运行数据位于当前用户 Library/Application Support/Black Mamba Workbench/workspace，项目记录另存于应用 WebKit 存储。应用是临时签名的测试版，尚未获得 Apple 开发者签名和公证。首次运行可能需要在系统设置「隐私与安全性」允许打开。

## 智能体与可选工具

- 本机 Codex 指 CLI 在本机运行，模型推理仍使用账号的在线服务。自行安装、登录；必要时通过 `MAMBA_CODEX_BIN` 指向 CLI。调用时才发送对应项目上下文，服务费用和账号权限由所选提供者决定。
- MCP 服务需提供对应的对话或出图工具；不是任意 MCP 工具都能完成创作。凭据通过本机环境变量配置，不提交到 Git。
- 分镜图片需要所用 Codex/服务支持图像生成；动态分镜另需匹配版本的 Remotion、`@remotion/cli` 和 Chrome。第三方工具不随源码附带。
- 达芬奇与 AE 主要通过用户导出的文件进行交接；这不代表工作台自动完成剪辑、调色或包装。
- `build:cloud` 是适配入口，需要自己的托管清单和基础设施；公开源码不附带可部署的云账号配置。

详见 [创意对话](docs/CREATIVE_CHAT.md)、[项目素材](docs/PROJECT_MATERIALS.md)、[后期版本](docs/POSTPRODUCTION.md)、[阶段交接](docs/WORKFLOW_HANDOFFS.md) 和 [本机 MCP](mcp/README.md)。

## 开发与验证

```sh
npm test
python3 scripts/check-public-source.py
```

测试使用隔离数据和模拟服务，不需要付费调用智能体。源码检查校验 Git 发布清单，阻止本地数据、导出包、凭据文件及典型密钥格式进入仓库；它不能替代人工检查。

请阅读 [贡献说明](CONTRIBUTING.md) 和 [安全说明](SECURITY.md)。提交截图、日志或复现材料前，请移除客户内容、密钥和本机私人路径。

## 许可证

代码采用 [MIT License](LICENSE)。第三方软件及服务适用各自的许可和条款；项目名称不表示第三方官方支持，也不授予商标使用权。
