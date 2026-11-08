# 参与 SOLVE 开发

当前开发基线为 0.9.0-dev.8，运行环境为 Node.js 22 或更新版本。接手前先阅读当前状态和文档目录，确认任务涉及的能力与验证范围。[当前状态](docs/implementation-status.md) · [文档目录](docs/README.md)

## 准备开发环境

将仓库克隆到自己的目录，然后安装依赖并执行检查。

```sh
git clone https://github.com/aforgomon41-create/SillyTavern-Oriented-LLM-Variable-Engine.git
cd SillyTavern-Oriented-LLM-Variable-Engine
npm ci
npm run check:portable
```

自动检查覆盖类型、Node 回归、三个载体的构建和构建包运行。需要查看演示页面时执行下面的命令，再打开终端给出的本机链接。

```sh
npm run dev
```

演示使用内存聊天宿主。真实 SillyTavern 验收需要另外准备本机 1.19.x 环境和专用测试角色。[浏览器验收](docs/browser-acceptance.md)

## 分工与提交

目前由用户的两个 Agent 协作，每个 Agent 使用一个固定分支：

| Agent | 固定分支 |
| --- | --- |
| Codex | `codex/collaboration-baseline` |
| Claude | `claude/dev` |

1. 开始工作前，将最新的 `main` 同步到自己的分支。并行工作使用各自的本地目录，避免切换分支或未提交改动互相干扰。
2. 在自己的分支完成修改和相关检查，并同步受影响的文档、示例。
3. 完成后直接提交并推送到自己的分支，无需用户逐次许可，在聊天中说明改动和验证结果。
4. 用户说合并时，直接将相应分支合入 `main` 并推送，无需再次确认。解决冲突时保留双方有效改动并执行相关检查；合并后保留固定分支，供后续继续使用。

日常任务不要求建立 Issue、临时任务分支、PR 或另一位 Agent 审阅。不强制推送或改写他人的提交历史。

`main` 保存已合并的共同成果。安装包的版本标记、构建和发布按交付指南执行。[交付指南](docs/release-guide.md)

## 改动约定

- 历史与保存变更需要覆盖已有聊天、回复分支、失败重试和并发场景。提交说明中写出旧数据如何读取，以及事实历史、派生缓存和待保存草稿各自的处理方式。[存储格式](docs/storage-format.md)
- 作者入口和公共 API 变更需要提供调用示例，并说明现有调用方式的兼容情况。[作者接入](docs/authoring.md) · [调试与恢复 API](docs/debug-api.md)
- 前端布局或视觉变化先确认风格和布局预览，再更新前端设计文档并实施。当前确认的界面规则集中在设计文档中。[前端设计](docs/frontend-design.md)
- 性能改动要注明状态规模、历史长度、环境、预热和样本数，并在计时后核对结果。原始数据与汇总分别保存。[性能记录](docs/performance.md)
- 提交作者使用本人已关联 GitHub 的邮箱。共同作者信息使用经过确认的名称和邮箱。项目授权与历史许可记录见许可文档。[许可说明](docs/licensing.md)

## 提交前检查

代码修改执行完整自动检查。仅调整文档时，检查内容、链接和差异即可。涉及构建或交付内容时，再生成并核对安装包。

```sh
npm run check:portable
npm run package
npm run test:release
```

说明实际运行过的检查，以及需要外部环境才能继续验证的项目。自动测试、本机接口、真实页面和真实模型连接各自记录结果。[验证记录](docs/verification.md)

性能基准按受影响路径选择。benchmark:long-chat 测量恢复、运行时和保存适配器，benchmark:pipeline 测量完整控制器流程。后者使用前者准备的 M-1000 与 M-5000 夹具，具体环境变量和复现步骤见性能文档。[性能基准](docs/performance.md)

## 本机文件与证据

node_modules、dist、artifacts 和 test-results 由本机命令生成。Git 忽略规则将这些目录保留在各自的工作区。文档中的历史 test-results 路径指向验收者本机的原始报告，克隆仓库后可以依照对应命令重新生成。

共享证据时，提交经过整理的说明或图片，并标明日期、版本和范围。连接配置、密钥及真实聊天保存在个人环境中。部分历史实机辅助脚本依赖当时生成的夹具，运行前阅读脚本和验收文档，准备专用测试实例。

提交并推送到自己的固定分支属于日常工作；合并到 `main` 等用户指令，发布安装包另按交付指南执行。汇报时写清当前完成到哪一步。
