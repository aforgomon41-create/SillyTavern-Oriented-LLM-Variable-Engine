# SOLVE 0.7 调试与恢复 API

调试界面通过本文件的接口工作。所有正式状态修改仍走操作归档；读取和预演不会直接写聊天。

## 绑定入口

原生扩展加载后使用 `SOLVE.register(definition, {characters, attach})`。`characters` 是明确绑定的角色头像文件名数组，例如 `['测试角色.png']`；`attach` 接收下方的控制器配置。页面刷新后需要作者脚本再次注册定义。已有聊天按定义指纹选取已注册版本，未绑定的新角色不自动初始化。

也可用 `SOLVE.attach(definition, options)` 手动绑定当前聊天。`SOLVE.controller` 返回当前控制器，未绑定时为 undefined。`SOLVE.sessions.getStatus()` 返回自动绑定状态及缺失定义等原因；`SOLVE.sessions.subscribe(listener)` 观察变化；`SOLVE.detach()` 停止自动绑定并释放实例。

缺少原定义时，`await SOLVE.sessions.inspectArchive(commitId?)` 可以只读查看归档和已执行状态；它不运行作者函数，也不允许用其他版本重放。

| 配置 | 说明 |
|---|---|
| `mode` | `in-band`（默认）或 `out-of-band` |
| `operatorFormat` | 独立操作模型接收 `json`（默认）或 `toon` |
| `operatorProfileId` | 独立连接预设 ID |
| `operatorRequest(prompt, signal)` | 自定义独立请求，替代连接预设服务 |
| `operatorTimeoutMs` | 超时毫秒数，默认 60,000 |
| `allowRequestsDuringOperatorBusy` | 是否允许同步忙碌期间发起新请求，默认 false |
| `cache` | 默认在支持 IndexedDB 的浏览器中启用；false 关闭，也可传自建 IndexedDbCache |
| `onError(error)` | 错误通知；回调抛错不会破坏归档 |

## 状态与定义

以下例子中的 `backend` 为 `SOLVE.controller`。

| 方法 | 返回内容 |
|---|---|
| `getStatus()` | 就绪/忙碌原因、聊天和提交身份、待保存数量、缓存与宿主能力 |
| `getState()` | 已恢复的逻辑状态安全拷贝，包含 data 与 engineState |
| `getValue('@alice.hp')` | 按实体或普通路径读取值 |
| `getProjectedState({view, paths})` | 应用视图和路径筛选后的结构 |
| `getDefinitionInfo()` | Schema 描述、实体、引用、模块、数值约束、披露规则、模板和预制 |
| `getModules()` | 模块偏好与实际启用状态，含父模块影响 |
| `getMessages()` | 当前消息、回复版本、提交指针和正文，楼层下标从 0 开始 |
| `subscribe(listener)` | 状态/诊断变化通知，返回取消订阅函数 |

`getState` 等状态读取在未就绪时拒绝。历史待修复时仍可调用 `inspectCommit` 查看已归档事实。`getStatus().ready` 额外检查当前选中历史与执行位置是否对齐；界面应据此启用写入按钮。

## 操作、预演与模块

```js
const batch = {$group: [
  {$inc: {'@player.gold': -30}},
  {$move: {'@sword': '@player.inventory'}}
]};
const candidate = await backend.preview(batch);
// 查看 candidate.feedback / dataPatch / enginePatch / state 后，再按需提交。
await backend.submit(batch, {expectedHead: candidate.baseHeadId});
```

预演会运行作者校验与变换函数，可能存在作者自行编写的外部行为；它保证不通过 SOLVE 写入正式聊天。预演后正式状态变化时，`expectedHead` 阻止提交过期候选。正式提交会重新执行规则，预演结果本身不直接成为提交。

`submit(batch,{index,actionId,authorInputs,expectedHead})` 默认操作最后一条角色消息；`setModule(name,enabled,{index,actionId})` 切换模块。相同动作的重试复用 actionId，不同点击使用不同编号。

## 历史与恢复

| 方法 | 行为 |
|---|---|
| `getHistory()` | 所有仍保留的提交，包括旧修订、父节点、变更与反馈；标记当前和选中版本 |
| `inspectCommit(id?)` | 校验并恢复指定提交，返回状态、实体和引用，不改变正式选中状态 |
| `compareCommits(beforeId,afterId)` | 两个历史状态的 dataPatch / enginePatch 差异 |
| `validateArchive()` | 校验各个保留 HEAD，分别返回成功或具体错误和耗时 |
| `refresh()` | 重新检查并恢复当前历史；正文变化时要求重放，不能绕过不一致检查 |
| `replayMessage(index)` | 重算指定楼层，保留旧修订 |
| `replayFrom(index)` | 在同一个控制器队列中逐楼重放，失败即停止 |
| `rebuildCache()` | 清除并重建派生快照，保留待保存草稿 |

原生删除末尾楼层会恢复剩余历史；删除中间楼层需要重放后续楼层。运行中的控制器会把仍被保留修订依赖的已删楼祖先放进存活回复的归档记录。没有控制器参与的第三方删除、且祖先从聊天文件中已彻底丢失时，不能凭缓存伪造恢复成功。

## 保存失败与请求

- `getPending()`：查看有效待保存候选。
- `retryPending()`：重用候选结果保存，不重跑操作或再次调用模型。需切回原回复版本；正文改变时拒绝覆盖。
- `discardPending()`：同步清理内存与本地草稿。若发现操作其实已经保存、仅响应丢失，会确认该事实并恢复正式结果，不把它当作未执行动作丢弃。
- `getStatus().pendingImportError`：本地草稿与当前历史不兼容或格式损坏；正式历史仍可检查，可明确放弃本地草稿后继续。
- `cancelOperator()`：取消独立操作模型请求，迟到结果不写回。

浏览器缓存失败不会改变正式聊天的权威地位，但未保存草稿可能无法跨刷新保留。放弃操作若无法清理本地缓存会返回错误，不能显示为已成功放弃。

## 上下文、日志与导出

`getContextPreview({view,paths})` 返回 JSON、TOON、指令说明、指南、当前反馈与独立操作模型的提示词预览。预览不会调用模型。

`journal.read()` 返回最多 300 条有时间和顺序的诊断记录，包含请求开始/结束、耗时、保存结果、异常与能力缺失。默认不记录 API 密钥、连接配置或原始模型提示词。`clearDiagnostics()` 清空当前控制器的内存日志。

`exportDebugReport({includeState,includeText})` 返回本地可导出的对象，默认不附完整状态与正文；历史动作及 Patch 仍可能含角色变量值。界面应说明导出内容，让用户自行决定是否分享，不自动上传。

调试面板已接入上述接口。`SOLVE.openDebugger()` 打开、`SOLVE.closeDebugger()` 关闭；扩展会显示右下角入口。SessionManager 状态额外包含当前 chatId，供界面隔离不同聊天的只读结果。世界书作者编译、完整 Facet 和复杂查询尚未交付。
