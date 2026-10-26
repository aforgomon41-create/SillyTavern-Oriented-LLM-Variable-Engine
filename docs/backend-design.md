# SOLVE 后端实施规范 V0.6

用户于 2026-10-25 确认开始后端实现：首版目标为 SillyTavern 1.19；TOON 与紧凑 JSON 宏并列，作者自行选择；新增 `$group` 原子组。本文是实施细则，优先于 V0.4 中与上述决定冲突的内容。

## 状态与边界

纯 TypeScript Core 不依赖酒馆 DOM、网络或 IndexedDB。固定定义包含 Zod Schema、实体集合/单例、引用、模块、投影、预制与模板。实际逻辑状态为 `{data, engineState}`；`engineState` 包含模块偏好与预制生命周期。所有状态、外部输入及归档必须可 JSON 表达。

公开执行使用异步接口，以支持作者异步校验；作者函数的版本指纹必须固定。外部时间、随机数、网络结果经调用方准备后作为 `authorInputs` 归档。Restore 只应用 Patch，不运行作者函数。自定义 transform/preprocess 只在输入边界运行；已归档状态不重复变换。任意跨字段规则需要校验完整候选状态。

## 算子与 group

普通操作对象保持五阶段固定顺序：createEntity；move/swap；set/inc/transfer；push/pull；unset/deleteEntity。每条操作以候选副本执行，成功后提交工作状态；失败不影响独立操作。自动升级 set→create、unset→delete 在计划阶段完成。

`$group` 接收有序操作数组，例如：

```json
{"$group":[{"$inc":{"@player.gold":-50}},{"$move":{"@sword":"@player.items"}}]}
```

数组项目按顺序执行，每个项目内部沿用五阶段。任何成员失败，整组数据、模块、预制生命周期、索引与 ID 消解回退；组外独立操作保留。组内数值越界直接失败，不用 Clamp 隐藏余额不足；默认填充与无歧义 ID 修正仍可成功。嵌套组遵守相同规则，最多 8 层。组外同一个对象中先执行普通五阶段，再执行 `$group`；需要明确前后次序时使用顶层有序操作数组。不同组使用多个数组项目表达。组不扩大到网络副作用；提交后通知不在 Restore/Replay 中重发。

休眠模块中被禁止的组内写入算失败。实体和反向引用索引始终基于真实状态，包括休眠字段；删除清理与 restrict 不被可见性遮罩绕过。

## 输出与宏

`solve_toon` 与 `solve_json` 使用完全相同的 full/narrative/operator 或路径投影，均遵循模块过滤、实体 @ 标记。JSON 使用紧凑序列化。保留 solve_val、solve_SOP、solve_guide、solve_feedback。宏只读已确认归档且与当前聊天/Swipe 对齐的内存状态；未恢复完成时阻止生成或返回明确未就绪诊断，不异步查询数据库。

## 归档与恢复

聊天 `.jsonl` 保存 Genesis 与所有仍被引用的不可变 Commit；当前 Swipe 只指向最新修订，旧修订继续留在归档中供下游/分支寻址，避免覆盖父链。`dataPatch` 和 `enginePatch` 分别是以 data 和 engineState 为根的 RFC 6902 Patch。共同从 baseHash 推导到 stateHash，哈希涵盖完整逻辑状态，使用键排序规范化 JSON。commitId 是身份，stateHash 可以重复。每个 Greeting 变体有独立 Genesis 身份与根提交。

动作记录是有序、带 actionId 的模型操作、玩家操作或模块内部事件。保存失败重试复用同一候选结果和 Commit，不重跑算子。相同 actionId 不重复执行；不同动作并行提交经过单会话写队列。绑定 chatId/messageId/swipeId/generationToken/expectedHead；身份过期的结果不落入新聊天。

保存状态为 preparing → pending → archived 或 failed。通过真实保存响应及回读核对 Commit 与正文版本后更新正式 HEAD；失败保留待保存草稿。读回只能证明该次读到的版本；多标签页写入需单写入者锁协调，不宣称服务器具备比较后原子交换。IndexedDB 只保存可重建快照与缓存。清空缓存必须能从聊天恢复。

## 1.19 Adapter

只支持单角色聊天，探测实际版本。每 Swipe 写入均同步 mes/extra 与 swipes/swipe_info。新生成不能沿用旧归档指针；从消息/Swipe 稳定身份与指令摘要判定执行归属。GENERATION_ENDED 只是检查机会，不是生成成功证明。

不依赖 saveChat() 的 void 返回值。保存请求遵循 1.19 chat integrity 校验，不强制覆盖；保存后回读校验。渲染过滤通过 1.19 MessageFormatter 同步钩子，不删除原始操作块；提示词副本移除历史操作块。原生请求准入与未适配插件入口分别记录能力，不承诺拦住直接联网的第三方脚本。

## 验收

覆盖十个原算子、group 成功/回退/嵌套、实体拥有/引用、模块恢复、重复动作、保存失败重试、历史分支、损坏检测、冷恢复与 Replay。宿主测试只使用独立测试聊天，不调用付费模型，不改已有聊天。前端布局与状态栏留待用户确认设计后开展。

## 当前交付补充（2026-10-26）

作者入口为分离式 Definition；提供输入 schema、可选纯校验 outputSchema 及 validateState。输入变换不会在 Restore 或已有状态校验中重复执行；变换后的类型约束无法自动推断时，由作者给出 outputSchema。完整 Facet、世界书自动编译和大规模性能仍为后续目标，以 README 的实现清单为准。

正式聊天级元数据只保存 Genesis/HEAD，提交修订存于对应 Swipe；保留被引用的旧提交。互相指向的选中楼层必须来自同一父链，历史 Swipe 变化后不能把旧下游直接接续。replayMessage/replayFrom 用于显式重建后继链。

## 0.6 会话与调试接口

作者可注册固定定义和明确的角色头像文件名绑定。自动会话管理以聊天身份和绑定轮次检查迟到结果，切换后释放旧控制器、监听和宏。已有聊天按归档指纹选择定义，不用最新版替代原定义；缺少执行定义时仍可只读 Patch Restore。

浏览器接入默认启用 IndexedDB，显式 `cache: false` 可关闭。缓存恢复以归档链证明与状态哈希校验为前提，失效时回退冷恢复。缓存异常通过诊断接口报告。损坏或冲突的本地草稿隔离处理，正式历史仍可检查。

正常操作与 Replay 的保存失败均保留已计算候选。Replay 草稿使用仅本地的 `prepared` 标记，重试只保存原候选，不重跑作者规则。放弃草稿先清理本地数据库；若操作实际已落盘，会确认正式事实，不假装撤销已经执行的操作。

原生删除末尾历史会恢复剩余选中链。删除中间楼层或回复版本时，运行中的控制器把存活旧修订所需的无载体祖先保存在存活 Swipe 的 commits 中；聊天头仍不存提交正文。重新打包时保留这些祖先并过滤已不存在的 HEAD。没有控制器参与、且祖先已物理丢失的文件不能承诺恢复。

编辑正文、分支冲突或重放中途失败进入待修复状态；refresh 不得代替 Replay。整个 replayFrom 经过同一控制器队列，停止后只能从修正处继续。所有保存继续核验原正文、归属、远端基线和回读结果。

调试 API 见 [debug-api.md](debug-api.md)。前端本轮定位为全面的调试面板，风格确认、设计文档及布局审阅仍按用户规则先行。
