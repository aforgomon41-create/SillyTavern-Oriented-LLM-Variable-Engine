# SOLVE 后端 0.5

面向 **SillyTavern 1.19.x 单角色聊天**的结构化变量引擎。模型输出 JSON 指令，Core 执行与校验，聊天文件保存实际结果。当前交付为无界面后端。

## 运行

要求 Node.js 22 或更新版本。

```sh
npm ci
npm run check
npm run test:host
```

`test:host` 默认连接 `http://localhost:11451`，只创建和清理本次 UUID 命名的临时角色及聊天，不调用模型。地址通过 `SOLVE_TEST_URL` 环境变量修改，只允许本机。最新实测结果位于 `test-results/host-1.19.json`。

## 已实现

- Zod 定义编译、会话指纹、开局状态、默认值、异步校验、输入变换与输出校验分离。
- 原十算子、`$valueOf`、五阶段流水线、局部失败隔离。
- `$group` 有序原子组，支持嵌套和完整回退。
- 实体 ID、拥有关系、移动/交换、反向引用及删除清理；初始数据、预制、模板。
- 模块休眠与开启补默认值；TOON/紧凑 JSON 同一投影、双宏输出。
- 不可变历史修订、累计 Patch、Restore、Replay、Greeting 变体与旧分支保留。
- 单会话队列、动作去重、保存失败草稿和迟到请求检查；IndexedDB 派生快照与草稿。
- 酒馆 1.19 保存/回读确认、Swipe 同步、原生请求准入、渲染与提示词过滤。
- 随正文和独立操作模型模式；独立连接预设、自定义请求函数、超时、取消。

## group

```json
{"$group":[
  {"$inc":{"@player.gold":-30}},
  {"$move":{"@sword":"@player.inventory"}}
]}
```

任一步失败撤回整组。组内越界直接失败，避免截断数值掩盖余额不足。普通组外 `$inc` / `$set` 按上下限截断；`$transfer` 为保持守恒，在任何位置都不截断。

数组成员按序执行，每个成员内部沿用五阶段。同一对象中先执行普通五阶段，再执行 group；需明确前后顺序时使用顶层有序数组。

## 作者入口

完整示例：`examples/rpg-definition.ts`。核心入口：`src/index.ts`。酒馆入口：`src/host/controller.ts`。

```ts
import { compile, SolveCore, toJson, toToon } from './src/index.js';
import { rpgDefinition, buySword } from './examples/rpg-definition.js';
const definition = await compile(rpgDefinition);
const core = new SolveCore(definition);
const result = await core.execute(buySword, await core.initialize());
console.log(toJson(definition, result.state));
console.log(toToon(definition, result.state));
```

构建后的 `dist/solve.js` 是浏览器核心 ESM，`sillytavern.js` 是绑定入口，`index.js` 和 `manifest.json` 是无界面原生扩展，`rpg-example.js` 是可直接导入的示例定义。

将 `dist/` 文件放进酒馆自定义扩展目录的独立 `solve/` 文件夹，重载后由作者脚本绑定：

```js
// 路径按实际安装位置替换。
const { rpgDefinition } = await import('/scripts/extensions/third-party/solve/rpg-example.js');
const backend = await SOLVE.attach(rpgDefinition);
await backend.submit({$inc:{'@player.hp':-10}});
```

扩展加载不会自动初始化角色卡。切到不同聊天时原控制器停止写入；作者脚本调用 `SOLVE.detach()` 后重新绑定。旧聊天使用原定义 ID、版本和规则。

控制器方法：`processMessage(index)` 同步模型回复；`submit(batch,{actionId,index})` 提交玩家动作；`setModule(name,enabled)` 切换模块；`replayMessage(index)` 重算指定楼层；`replayFrom(index)` 重算后续选中楼层；`dispose()` 释放控制器。重试使用相同 actionId，不同点击使用不同编号。

## 宏

| 宏 | 内容 |
|---|---|
| `{{solve_toon}}` / `{{solve_json}}` | 完整启用模块状态 |
| `{{solve_toon::narrative}}` / `{{solve_json::narrative}}` | 去除 internal 字段 |
| `{{solve_toon::operator}}` / `{{solve_json::operator}}` | 去除 readonly 长文本 |
| `{{solve_toon::@player.hp, world.weather}}` / 相同参数的 solve_json | 局部投影 |
| `{{solve_val::@player.hp}}` | 单值 |
| `{{solve_SOP}}` / `{{solve_guide}}` / `{{solve_feedback}}` | 指令说明、指南、反馈 |

两种格式使用相同筛选规则，由作者选择。readonly/internal 是披露策略，不是写权限。`@` 只标记投影，真实 Key 不带 @。宏只读已归档且对应选中历史的状态。数组局部投影用 null 占位，保留原下标。

## 作者函数与历史

输入 schema 的 transform/preprocess 只在输入边界运行。改变输出类型时提供纯校验 `outputSchema`；程序无法从任意 JS 函数推断输出约束。`validateState(state,context)` 支持跨字段异步规则，在组的最终候选上校验。函数行为、默认值、闭包捕获值或依赖变化必须更新定义版本；编译阶段不会调用动态默认函数来采样指纹。

时间、随机数、远程结果在调用前准备并以 authorInputs 归档。普通 Replay 复用这些值；Restore 不执行作者函数、模型请求或外部写入。外部副作用不在变量回退保证内。

聊天元数据保存 Genesis/HEAD，每条消息的 Swipe 元数据保存不可变提交修订。清缓存后可离线恢复；缓存不能掩盖归档损坏。

## 当前边界

已验证 1.19.0 单聊。原生拦截器覆盖原生生成入口，不承诺拦住助手或第三方自行联网。服务端没有版本比较后原子写入接口；浏览器锁与回读协调 SOLVE 实例，第三方绕过队列保存仍可能竞争。

世界书自动编译、完整 Facet/内联作者 DSL、多分发自动加载握手、复杂查询和大规模性能验收仍在规划中。当前采用分离式作者定义，不把企划全部目标标为已完成。前端状态栏和工作台尚未开始。

实施规范：`docs/backend-design.md`。主企划保留原文件名并已更新本轮决定。
