# SOLVE · SillyTavern-Oriented-LLM-Variable-Engine

[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-365c49.svg)](LICENSE)
[![Version: 0.7.1](https://img.shields.io/badge/Version-0.7.1-647063.svg)](https://github.com/aforgomon41-create/SillyTavern-Oriented-LLM-Variable-Engine/releases)

面向 **SillyTavern 1.19.x 单角色聊天**的结构化变量引擎。模型输出 JSON 指令，Core 执行与校验，聊天文件保存实际结果。现包含 React + Radix 调试工作台，松绿与暖灰配色，支持浅色/深色以及电脑/手机。

![SOLVE 调试工作台](docs/images/debug-desktop-light.jpg)

当前版本 **0.7.1**，属于持续开发中的首版。本次更新改用强互惠开源协议 AGPL-3.0-only，功能与 0.7.0 一致。已通过 90 项自动测试，完整真实聊天流程与长期企划的其余范围见 [验证记录](docs/verification.md) 和 [开发计划](docs/development-plan.md)。

## 安装到酒馆

从 [Releases](https://github.com/aforgomon41-create/SillyTavern-Oriented-LLM-Variable-Engine/releases) 下载 `SOLVE-0.7.1.zip`，解压到酒馆自定义扩展目录下的独立 `solve/` 文件夹，确保 `manifest.json` 直接位于该文件夹内。重载酒馆后，右下角会出现 **◈ SOLVE** 入口。作者定义的注册方式见下方“作者入口”。

如果使用源码安装，运行 `npm ci` 和 `npm run build`，然后将 `dist/` 的全部文件复制到上述目录。

## 先试用调试面板

```sh
npm ci
npm run dev
```

打开终端给出的本机演示链接，默认 `http://127.0.0.1:4173/debug.html?demo=1`。如果端口占用，用环境变量 `SOLVE_DEBUG_PORT` 换端口。

演示使用真实 Core 与 Controller、内存聊天宿主，刷新即重置，不调用模型、不访问真实聊天。`/host-preview.html` 可验证同源嵌入、关闭与未绑定时的只读检查。

- 状态探索：可展开/搜索的状态树、JSON、路径查询、实体与引用、模块和作者约束。
- 操作实验室：JSON 格式提示与格式化、示例、作者输入、预演变更/反馈/状态/别名、绑定基线后正式提交。
- 历史与恢复：旧修订检查、双版本差异、楼层/回复信息、单层和后续重放、归档校验与缓存重建。
- 上下文预览：视图与路径筛选，JSON/TOON/指南/指令/反馈/独立操作提示词，字符和字节统计。
- 诊断：日志搜索与级别过滤、宿主能力、请求取消、本地报告下载、保存失败草稿重试/放弃。

界面里的查询和预演不会保存聊天；正式提交、模块切换与重放会保存。报告里的历史变更可能含变量值，分享前请检查。

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
- 作者定义注册与按角色绑定；切聊天自动释放旧控制器并恢复原定义。
- 浏览器默认启用快照与草稿缓存；草稿重试、放弃与损坏隔离。
- 调试接口：状态/实体/引用、定义与模块、操作预演、历史对比、归档检查、上下文预览和有界日志。
- 原生删除后的恢复与重放；被保留旧修订依赖的已删楼祖先，随存活回复归档。

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

构建后的 `dist/solve.js` 是浏览器核心 ESM，`sillytavern.js` 是绑定入口，`index.js` 和 `manifest.json` 是原生扩展；`debug.html`、`debug.js`、`debug.css` 是调试面板，必须一起复制。`rpg-example.js` 是可直接导入的示例定义。

将 `dist/` 文件放进酒馆自定义扩展目录的独立 `solve/` 文件夹，重载后由作者脚本绑定：

```js
// 路径按实际安装位置替换。
const { rpgDefinition } = await import('/scripts/extensions/third-party/solve/rpg-example.js');
const backend = await SOLVE.attach(rpgDefinition);
await backend.submit({$inc:{'@player.hp':-10}});
```

扩展加载不会自动初始化未绑定的角色卡。推荐作者脚本注册固定定义，并明确绑定角色文件名：

```js
await SOLVE.register(rpgDefinition, {
  characters: ['你的角色文件名.png'],
  attach: { mode: 'in-band' }
});
```

注册后切换聊天会自动恢复；旧聊天按定义指纹寻找原版本，缺少时不会自动套用新版。作者脚本仍需在页面加载时运行一次注册。单次手动使用可继续调用 `SOLVE.attach()`；`SOLVE.detach()` 停止自动绑定，后续注册或绑定可重新开启。缓存默认开启，可用 `cache: false` 关闭。

控制器方法：`processMessage(index)` 同步模型回复；`submit(batch,{actionId,index})` 提交玩家动作；`setModule(name,enabled)` 切换模块；`replayMessage(index)` 重算指定楼层；`replayFrom(index)` 重算后续选中楼层；`dispose()` 释放控制器。重试使用相同 actionId，不同点击使用不同编号。

调试与恢复接口的完整说明见 [调试 API](docs/debug-api.md)。扩展加载后，点击酒馆右下角 **◈ SOLVE** 打开面板，也可调用 `SOLVE.openDebugger()`；关闭使用面板按钮或 Escape。样式在同源 iframe 内隔离，关闭后焦点回到入口。没有绑定定义时会显示具体原因，并提供只读归档检查。

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

世界书自动编译、完整 Facet/内联作者 DSL、多分发自动加载握手、复杂查询和大规模性能验收仍在规划中。当前采用分离式作者定义，不把企划全部目标标为已完成。调试工作台已实现；面向玩家的状态栏和作者可视化制作工具仍属后续范围。

实施规范：`docs/backend-design.md`。实施与验证进度见 [当前交付](docs/implementation-status.md)。主企划保留原文件名。

## 开源协议

从 **0.7.1** 开始，本项目采用 **[GNU AGPL v3，仅限第 3 版（AGPL-3.0-only）](LICENSE)**，具有强互惠性（通常称“开源传染力”）：分发修改版或构成同一程序的衍生作品时，需按协议提供对应源码并保留相同许可；修改版若支持通过网络与用户交互，还须向这些用户显著提供免费获取该版本对应源码的机会。协议允许商用。

源码与构建入口见本仓库，面板页脚提供源码及协议链接。独立作品仅与本项目一同存放、普通聊天数据或单纯使用本项目，并不会因此自动全部改为 AGPL；具体范围以协议正文为准。分发或部署修改版时，应提供自己的实际对应源码，不能只链接未修改的上游版本。详见 [授权与版本说明](docs/licensing.md)。

**已发布的 0.7.0 曾采用 Apache-2.0，已授出的许可无法追溯撤回。** 其标签与历史安装包保留原许可；当前版本和后续版本以各自声明为准。

第三方依赖继续遵循各自协议。浏览器构建包中的 `THIRD_PARTY_NOTICES.txt` 保留所包含依赖的授权内容，项目声明见 [NOTICE](NOTICE)。
