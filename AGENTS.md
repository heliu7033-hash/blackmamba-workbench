# 开源工作台开发规则

- 先阅读 README.md、docs/WORKFLOW_HANDOFFS.md 及相关模块，保护已有项目和版本来源。
- 使用 `studio/<short-description>` 分支，走 PR，不直接推送 main。初始空仓库 bootstrap 除外。
- 只提交源码、通用文档和虚构测试数据。禁止提交运行数据、客户材料、账号配置、密钥或本机构建包。
- 不将用户提交的任务记录当作已经执行成功；不把本机 CLI 描述成离线模型。
- 修改后运行相关测试、全量 `npm test`、`python3 scripts/check-public-source.py`、`git diff --check`。
- PR 说明变更、验证及实际限制；保持小而明确的提交。
