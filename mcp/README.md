# Mac 工作台任务 MCP

该服务通过标准输入和输出提供 MCP 工具，由客户端按需启动。它读取已有的工作台 SQLite，项目由启动者指定。桌面 App 是否打开与 stdio 服务是否被调用彼此独立。

## 启动

需要 Node.js 24+。在 `blackmamba-workbench/` 中，将以下命令直接作为 MCP 客户端的进程启动命令。使用独立的 command 和 args 字段时，command 填 Node 的绝对路径，args 依次填脚本的绝对路径、`--project` 和项目名。示例分区为“日常管理”。

```sh
node mcp/tasks.mjs --project 日常管理
```

默认数据库是工作台的 `data/tasks.sqlite`。使用独立数据库时追加 `--db /absolute/path/to/tasks.sqlite`，路径必须指向已有的任务库。默认以 SQLite 只读模式打开。经明确授权后，启动参数可追加 `--allow-status-update` 以启用单条状态更新。

在项目目录执行 `bash desktop/build.sh build/mcp` 可单独构建桌面版。新 App 的菜单“显示本机 MCP 启动器”可定位启动文件。其路径为 `build/mcp/黑曼巴工作台.app/Contents/Resources/mcp/mamba-mcp`。客户端以该文件作为 command，只需传上述项目和权限参数。启动器沿用构建时记录的 Node 和数据库路径。将来更换 Node 或移动数据库时需要重新构建或明确指定数据库。单独的构建目录可以保留正在运行的原版。

## 协议和数据范围

- MCP `2025-06-18`，stdio，每行一条 UTF-8 JSON-RPC 2.0 消息。支持 initialize、notifications/initialized、ping、tools/list 和 tools/call。
- `list_task_progress` 只返回指定项目、local-owner 的任务 ID、名称、状态和 revision。每页 25 条，使用返回的 next_after 翻页。任务名称可能包含客户信息，向 ChatGPT 开放真实分区前应确认范围。
- `update_task_status` 只在显式写模式公布。参数为 id、revision、status 和 request_id。状态限“进行中”“等待确认”“已完成”；已归档记录不可更新。客户端应先读取当前 revision，再提交用户明确要求的变更。
- 事务同时更新状态、版本、修改时间和最近请求标记。紧接上次写入的相同重试可跨进程重启返回同一结果；若期间已有新修改，旧 revision 会冲突，此时重新读取。每次写入的 request_id 使用新的 16 至 100 位字母、数字、下划线或连字符。
- 项目范围及写开关由本机启动者控制。工具无法更换数据库、分区或所有者，无法读写备注与成果、创建、删除、归档任务或分派 Codex 作业。现有 Web 服务继续将 HTTP MCP 路由与此 stdio 进程分开。

## 连接同一个制片助手

OpenAI 的 [dot 接入说明](https://learn.chatgpt.com/docs/dots/computers-and-apps)说明可用插件取决于账号、权限及运行环境。[ChatGPT Work 的 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp)说明云端 Work 使用已安装插件，网页端不会读取本机 Codex 配置。

私有服务可走 [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)。隧道客户端可启动本程序，需隧道 ID、运行密钥，以及目标组织和工作区的相应权限。按[自定义 MCP 插件说明](https://developers.openai.com/api/docs/guides/custom-mcp-server)，在 ChatGPT 网页插件中选择 Tunnel 并审查访问范围。连接后，请求和工具结果会经出站 HTTPS 往返 OpenAI。

当前未注册隧道或插件、未生成凭据、未发送本机任务。建议第一次仅接**隔离测试库的只读分区**。获得当次确认后才可进行隧道及插件注册；若需收费、管理员变更或扩大权限，先停下确认。在制片助手的原会话中读取一条具有独特名称的测试任务，核对真实返回，才能确认该 dot 可用。之后另行决定是否授权真实项目及状态写入。工作台中原有“未连接”指其直接对话连接；此 MCP 只提供工具访问。

## 验证

```sh
npm run test:mcp
MAMBA_TEST_MCP_LAUNCHER="$PWD/build/mcp/黑曼巴工作台.app/Contents/Resources/mcp/mamba-mcp" npm run test:mcp
```

两种测试均以独立子进程进行协议握手、发现、分页、只读校验、受限写入、失败与重复请求测试。夹具含不同 owner、项目、归档记录和私有字段；重启后核对 revision 及未授权字段与记录。测试只使用临时 SQLite。
