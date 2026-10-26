# SOLVE 项目完整企划案 V0.5（1.19 后端实施修订）

> **2026-10-26 实施进度**：用户确认按后续规划落地，并明确无需继续确认布局、直接开始。当前 0.7 已包含会话管理、草稿恢复、调试 API 与 React + Radix 调试面板，采用松绿＋暖灰并适配电脑/手机；实际交付和待验收范围见 [当前交付](docs/implementation-status.md)。本主企划仍保留长期目标。

> **2026-10-25 用户确认，2026-10-26 实施更新**：首版适配 SillyTavern **1.19.x**；提供 `solve_toon` 和 `solve_json` 两套并列宏，作者自由选择；新增 `$group` 有序原子操作组，成员要么全部成功，要么全部失败。原文件名保留，避免已有链接失效。具体语法、归档与测试约定见 [后端实施规范](docs/backend-design.md)，已实现范围及运行方法见 [README](README.md)。历史版本标记仍用于说明设计来源，不代表所有规划功能已经实现。

> **SillyTavern-Oriented-LLM-Variable-Engine**  
> 面向 SillyTavern 的 LLM 友好型结构化变量、确定性操作与交互数据引擎

| 文档属性 | 内容 |
|---|---|
| 版本 | **V0.5（2026-10-26 后端实施修订）** |
| 编制日期 | **2026-10-19** |
| 本次决策补充 | **2026-10-25**：适配 1.19、TOON/紧凑 JSON 双宏、`$group` 原子组；2026-10-26 实施 |
| 基线文档 | 《SOLVE 项目完整企划案 V0.3（架构审计定稿版）》2026-10-16 |
| 文档性质 | **完整产品企划 + 后端逻辑规范 + 开发指引**；不是已实现功能说明 |
| 项目阶段 | 后端首版 0.5 已进入实现与宿主验证；实际交付范围以 README 为准 |
| 目标读者 | SOLVE 核心开发者、SillyTavern 适配器开发者、角色卡作者、UI/蓝图开发者 |

**阅读说明**

- **【规范】**：V0.4 期望遵守的行为约束，适合实现及测试。
- **【注释】**：解释设计动机、特殊边界、容易踩坑的地方，不增加作者使用负担。
- **【沿用 V0.3】**：保留原企划既定能力与设计意图。
- **【V0.4 修订】**：根据架构审计及后续需求澄清作出的明确调整。
- **【待宿主验证】**：依赖目标版本的 SillyTavern / 酒馆助手实际接口；属于实施前的适配验证事项，不是对宿主已有 API 的保证。
- **【示意】**：伪代码、字段布局或 TOON 例子用于描述逻辑；真实接口及编码以目标 SDK/规范测试为准。

> **设计优先级**：LLM 使用简单、作者零额外负担、状态确定性、历史可恢复、低聊天文件体积、IndexedDB 高性能、模块长期可扩展。SOLVE 不计划成为通用分布式数据库，也不自行替代 SillyTavern 的社区代码信任机制。

---

# 第一章：产品定位、边界与 V0.4 决策

## 1.1 项目定位【沿用 V0.3】

SOLVE 面向 SillyTavern（酒馆）生态：以 LLM 作为**状态变更意图的提出者**，以确定性 JavaScript 引擎作为**唯一实际执行者**，并为玩家状态栏交互和作者数据结构制作提供统一接口。

要解决的问题：

1. LLM 直接维护大段 JSON 时容易写错、漏改、跨字段不同步。
2. 复杂 JSON 在 Prompt 中消耗 Token，不在场对象、静态长文本常常没有必要全部注入。
3. 实体搬迁、销毁、引用清理和嵌套实体处理困难。
4. 校验遇到局部问题时整批回滚，导致叙事已经发生却没有有效状态变化。
5. 聊天历史包含 Swipe、编辑、重新生成、分支与交互按钮，状态容易串档。
6. 角色卡作者在「全部手写代码」与「纯自然语言更新规则」之间缺少可扩展的统一开发底座。

### 1.2 不可变的核心设计原则【规范】

**P-01：模型只输出指令。** LLM 可以通过 `<solve_operate>` 写出被 SOLVE 支持的操作 JSON；它不直接编辑真实状态、Schema、Compiled IR、索引或持久化数据库，也不能从指令块执行 JavaScript。

**P-02：一个聊天会话的 Schema 固定。** 会话创建并初始化时确定 `SolveCompiledIR`、初始数据及需要的预制/模板定义；会话运行期间不执行 Schema 热替换和结构迁移。玩家能够切换的模块只是运行时有效字段/指南遮罩，**不是修改 Schema**。

**P-03：`.jsonl` 是可迁移历史的权威来源。** 丢失 IndexedDB 后，仅凭该聊天文件中保留的 Genesis 初始状态与每条历史链的确定性增量，能够重建所有**仍在该文件中保留**的历史节点；完整 Restore 不需要重新执行 LLM 算子，也不需要联网。

**P-04：IndexedDB 是高性能 NoSQL 派生存储。** 保存 Snapshot、正/逆 Patch 缓存、Commit DAG、实体/引用索引、活跃状态及查询数据；**任何 IndexedDB 独有内容都不得成为历史正确性的必要条件**。

**P-05：Restore 与 Replay 严格分开。** Restore 读取「已生效的状态事实」（Patch）并还原；Replay 读取「原始操作意图」（操作指令）并在新的历史基线上再次执行，产出新的 Patch / Feedback / Commit。

**P-06：`@` 只用于实体寻址和 LLM 披露。** 它不是实体真实 JSON Key 的一部分。实体身份由作者的 Schema / 实体注册信息决定，不能靠名字或 Key 文本猜测。

**P-07：作者只需定义数据结构与自愿使用的功能。** 不强制作者把数字分为货币、HP、好感度等语义类别，不强制复杂模块依赖图，不要求编写跨算子事务声明。

**P-08：宽容与一致性并行。** 单条独立指令可以局部失败，其他合法指令尽可能继续执行；但一个高级算子内部的多处状态/索引修改必须原子完成，不能留下半完成的实体和引用。

**P-09：面向 LLM 的状态披露可用 TOON 或紧凑 JSON，作者自由选择；LLM 返回 JSON 算子。** 两种输出使用同一投影、模块遮罩与实体标记规则，仅文本编码不同；TOON 不是持久化格式。

**P-10：宿主适配隔离。** 核心状态引擎不直接依赖 SillyTavern DOM、消息对象或事件 API。宿主相关能力由 Adapter 提供。

## 1.3 V0.3 → V0.4 主要变更矩阵

| 领域 | V0.3 基线 | V0.4 规范 |
|---|---|---|
| 历史事实存储 | IndexedDB 主记录，`.jsonl` 轻指针与指令 | **`.jsonl` 保存 Genesis + 每 Swipe 已执行 Patch + Commit + Feedback + 原始指令** |
| Snapshot | IndexedDB 周期保存，聊天元数据带最新 Active State | **仅 IndexedDB 周期快照**；聊天内只需一次 Genesis，不放每楼或周期 Snapshot |
| 恢复 | IndexedDB 快速恢复，丢失后可依指令重建 | **优先 Patch Restore**；仅用户修改历史时调用 Replay |
| 实体披露 | `@ID` 寻址 | **TOON 视图自动为实体键添加 `@`**，数据真实 Key 不改变 |
| Schema 生命周期 | 可选择多种编译来源 | **每会话初始化后固定**，不加入 Schema Migration 系统 |
| 原子语义 | 高级算子强原子，基本算子局部隔离 | **V0.5 增补**：`$group` 将关联操作组成可选原子组，组失败整体撤回，组外独立操作可继续 |
| Key 点号净化 | 统一 `.` → `_` | 保留自动净化体验，**碰撞或 Schema 不兼容必须拒绝，不得静默覆盖** |
| 数值类型 | Zod 自动 Clamp | **继续只依赖 Schema 约束**；不强加业务语义分类 |
| 模块 | 字段休眠 + 惰性水合 | **沿用轻量模型**，仅补充休眠字段读写与历史记录规则 |
| 索引 | Entity Index | 增加**可重建的反向引用索引**与嵌套实体拥有关系说明 |
| 防护 | 指令解析 + Zod | 仅保留基础解析边界、路径安全与重复提交保护，不引入通用 RBAC |
| 性能承诺 | 固定的毫秒耗时和 TOON 节省百分比 | 改为**需要基准测试验证的目标**，不能视为实现保证 |

## 1.4 范围与非目标【规范】

**V1 目标范围**：SillyTavern **1.19.x 单角色聊天**；十一个算子（含 `$group`）、`$valueOf`、Zod 约束、实体索引与引用、预设/模板、三类视图、TOON/紧凑 JSON、五阶段流水线、双工作模式、双操作指令块、模块热开关、`.jsonl` 权威历史、IndexedDB 高级缓存、Swipe/分支正确性、基础 Inspector 和三种分发。

**明确不做**：群聊适配；运行中 Schema 迁移；跨用户/跨设备实时一致性协作；为作者字段做业务语义推断；复杂 ACL/RBAC；自动理解作者的交易/背包经济规则；强制多算子事务编排；把 TOON 当持久化格式；在引擎里托管远程角色卡代码安全沙箱。

**未来可扩展但不阻碍 V1 的能力**：Blueprint 可视化编译；WYSIWYG 状态栏；自定义索引；计算属性；触发器；独立持久化后端 Adapter。

---

# 第二章：运行环境、分发方式与宿主适配

## 2.0 首版兼容基线【2026-10-21 用户确认】

| 项目 | 首版约定 |
|---|---|
| SillyTavern | 1.19 系列；首个宿主验证版本为本机 1.19.0，不向其他大/次版本自动承诺兼容 |
| 聊天类型 | 仅单角色聊天；群聊不初始化 SOLVE 会话、不执行操作，入口明确提示不支持 |
| 酒馆助手 | 依赖助手的分发方式，以官方当前最新版为依赖基线；2026-10-21 核对官方主分支和本机 manifest，均为 **4.11.3** |

- 「最新版」是持续跟进的兼容目标，不是可复现的版本号。每次 SOLVE 发布必须记录实际通过验证的酒馆版本、助手版本与构建/提交标识；助手更新后重新验证，不把尚未测试的新版本显示为已验证。
- 作者执行定义与 SOLVE 引擎仍遵循会话固定规则；助手的升级不授权替换旧会话定义。原生扩展是否依赖助手，按该 Adapter 实际使用的能力声明，不给独立运行载体增加无用依赖。
- 官方版本核对来源：[酒馆助手 manifest.json](https://github.com/N0VI028/JS-Slash-Runner/blob/main/manifest.json)。本段记录版本核对结果，不代表请求拦截、保存等接口已经通过运行测试。

## 2.1 三种分发方式【沿用 V0.3】

1. **动态 Import JS**：依赖酒馆助手或可执行脚本机制，加载远程 SOLVE 构建物；轻量、便于更新。
2. **角色卡内嵌单文件 JS**：依赖酒馆助手，跟随卡片分发、锁定引擎版本，适合离线运行与版本可复现。
3. **SillyTavern 原生扩展**：独立安装，提供全局设置、缓存查看、调试和未来工作台入口。

三者共用同一 `SOLVE Core`，不复制算子或存储规则。差别仅在初始化、宿主事件、配置来源、消息保存与显示层。

## 2.2 Card-First Handshake【沿用并补充】

- 当前卡明确自带 SOLVE 实例时，原生扩展默认对该聊天会话让位（Yield）。
- 每个聊天会话有独立的运行时状态；不同会话不能共享未绑定上下文的 `activeState` 或操作锁。
- **【V0.4 修订】** 引入轻量 `SessionRuntimeRegistry`，记录会话所有权、当前消息/Swipe 身份、运行中操作和 generation token。
- 如果两个实例都尝试处理同一消息，仍需要 `operationId` / `commitId` 去重；「让位」只能协调遵守协议的 SOLVE 实例。
- 多标签页同开一个聊天时，用宿主可用的通知/锁能力进行协同；最终以宿主文件中实际持久化的 HEAD 和父 Commit 校验为准。

**【注释】** 这里的「所有权」是 SOLVE 自身防止重复执行的工程机制，不是复杂角色权限体系，也不试图限制任意作者 JS 对宿主的访问。

## 2.3 宿主事件与保存适配器【规范】

```ts
interface SolveHostAdapter {
  getChatIdentity(): { chatId: string; characterId?: string };
  getSelectedMessageIdentity(): {
    messageId: string;
    swipeId: string;
    floorIndex: number; // 仅显示与辅助定位，不能当稳定主键
  };
  loadChatArchive(): Promise<SolveChatArchive>;
  saveChatArchive(change: SolveArchiveMutation): Promise<SaveResult>;
  onGenerationFinished(handler: (event: GenerationEvent) => void): Unsubscribe;
  onChatOrSwipeChanged(handler: (event: HostChangeEvent) => void): Unsubscribe;
  installGenerationGate?(gate: SolveRequestGate): Unsubscribe; // 能力及覆盖范围须经验证
  registerMacros?(): void;
  installDisplayFilter?(): void;
  installPromptFilter?(): void;
}
```

- **【示意】** 这是 SOLVE 侧所需抽象，并不声称上述函数是 SillyTavern 现有 API。
- `GENERATION_ENDED` 等信号只表示进入结束处理阶段，不能不经检查就视为新消息成功归档；还要检查消息身份、完整指令块及当前 generation token。
- 提示词过滤只作用于模型发送上下文；渲染过滤只作用于展示文本。原始 `mes` / `swipes[]` 不删除指令块。
- 保存适配器必须能报告保存是否成功。未确认保存的状态变更不能标为「已归档」。

## 2.4 操作模型 API 适配【沿用 V0.3】

支持两种 API 配置：优先复用 SillyTavern Connection Profile 的请求能力；也允许用户配置 SOLVE 专属连接预设/Key。调用时不应临时切换顶部全局 Profile。

**【待宿主验证】** Connection Profile 读取与请求接口、保存权限、宏注册、Swipe 独立 `extra`、Display Hook 和 Prompt Hook 在目标 SillyTavern 版本上的准确行为需要适配测试；兼容策略通过具体 Adapter 实现，而不是在 Core 猜测版本。

---

# 第三章：状态、Schema、Key 与路径系统

## 3.1 数据模型与会话不变量【规范】

- 业务状态：普通 JSON 值构成的层级树，作者可采用 Object、Record、Array、原始值，不强制 ECS。
- Schema：Zod 描述数据类型、默认值与基础约束；所有实体、引用、模块和视图注册最终编译为会话固定的 `SolveCompiledIR`。
- 会话固定：一旦建立 Genesis，此会话的 `schemaHash` / `compiledIrHash` 锁定。角色卡外部更新不自动重写本会话历史定义。
- 运行时状态包括：① 作者数据 `data`；② 当前模块开关 `activeModules`；③ 预制实体生命周期及其他必要、会随历史变化的引擎状态。后两者不必污染作者的 JSON 业务数据，但必须参与 Commit 的确定性状态计算。
- 所有可重建数据都必须可 JSON 表达；`undefined`、函数、循环引用、`NaN`、`Infinity` 等不得进入正式状态。

## 3.2 Key 禁点号与自动净化【沿用并修订】

- DOT `.` 只代表 SOLVE **操作路径**的层级分隔符，状态树里的真实 Key 默认不允许含点号。
- 对用户导入的动态 Key 或模型拟创建的动态 Key，可自动执行 `.` → `_` 并输出 L1 通知。
- **【V0.4 修订】** 自动净化后发生 Key 冲突（`Dr.Brown` 与 `Dr_Brown`）、破坏 Schema 已声明字段、或导致两个路径同一目标时，该条操作拒绝并反馈；不能默默覆盖已有字段。
- 对静态 Schema 所定义的非法 Key，应在作者编译阶段提示作者修正，避免运行时偷偷改写 Schema。
- 路径片段禁止 `__proto__`、`prototype`、`constructor` 等危险属性进入通用对象遍历写入器；这是基础解析器安全，不是面向用户的权限系统。

## 3.3 三种不同的「名字」【V0.4 重点】

| 概念 | 示例 | 定义来源 | 是否含 `@` |
|---|---|---|---|
| 真实 JSON Key | `alice` | 作者 JSON 及实际容器 | **否** |
| 实体 ID | `alice` | Schema 注册的 Entity Index | **否** |
| 实体路径写法 | `@alice.hp` | SOLVE 操作/宏寻址协议 | **是，仅语法标记** |

例子：

```json
{
  "characters": {
    "alice": { "name": "艾莉丝", "hp": 100 }
  }
}
```

Schema 标记 `characters` 为实体字典后，引擎识别 `characters.alice` 是实体；操作 LLM 用 `@alice.hp` 寻址；RFC 6902 Patch 则使用真实 JSON Pointer `/characters/alice/hp`。

**【规范】** 并非任何名为 `alice` 的对象都是实体。一个普通配置对象也可以有相同 Key，只有 Schema 声明的路径实例进入 `EntityIndex`。

## 3.4 路径解析与实体索引

```ts
interface EntityIndexEntry {
  id: string;                // alice，不带 @
  path: string;              // 真实 JSON Pointer，如 /characters/alice
  entityType: string;
  ownerEntityId?: string;    // 生命周期拥有者；非普通引用
}
```

- `@id.field`：先用 Entity Index 定位实体，再解析相对字段路径。
- `world.weather`：普通点路径，不依赖 Entity Index。
- `$self`：仅在绑定实体/字段的 UI 交互上下文中表示相对路径；未经绑定的 LLM 请求不能自行宣称 `$self`。
- JSON Patch 使用 RFC 6901 Pointer 规则（包含 `~0`、`~1` 转义），操作路径使用 SOLVE 语法；二者由路径模块转换，不能简单字符串替换。
- ID 为会话内全局唯一；用户或 LLM 写出的 `@` 只是引用标记，不存成真实 JSON Key。

## 3.5 Zod 校验与全局防呆【沿用 V0.3】

默认：

1. 数值声明 `.min()` / `.max()` / `.nonnegative()` 时自动 Clamp 并反馈 L1。
2. 对注册实体 `$unset`：升级为 `$deleteEntity`，保证级联清理。
3. 在注册实体容器对新实例执行 `$set`：升级为 `$createEntity`，应用默认值并登记索引。
4. 对固定对象子树 `$set` 局部对象：默认深合并，不清空未提及同级字段。
5. 实体引用数组 `$push` 自动去重。
6. `.destroyOnZero()` 修饰的实体字段达到销毁条件时触发完整实体删除。
7. 单条操作失败不拖垮整批其他独立操作；但每个高阶操作内部必须是一个原子单位。

**【注释】** Clamp 并非「所有数字都截断」：只在声明了边界的字段生效，作者不用告诉引擎数字究竟代表金钱、血量或亲密度。

### 3.5.1 Deep Merge 的具体边界

- `z.object()` 的字段按 Schema 层级递归合并。
- 数组、标量和 `null` 按具体目标字段规则整体写入，不做数组按下标合并。
- 对 `Record` 中**已经存在**的键可以按值 Schema 合并；增加新实体必须走创建语义。
- 遇到 Schema 禁止的字段或不可变位置，该**单条操作**失败，不静默删除其他字段。
- 子树局部校验是性能优化，仍需保证被改变实体的索引、引用以及可能关联的约束不变量。

### 3.5.2 原子性边界

- 独立 `$set` 路径、`$inc` 路径、单个 `$push` 目标等是独立 Statement，可分别成功/失败。
- 单个 `$move`、`$swap`、`$transfer` 源账户及其全部目的地、单个 `$deleteEntity` 的完整级联，必须全部成功或全部不生效。
- **不要求**一个 `<solve_operate>` 内所有算子一起成功；也**不强制**作者声明跨算子原子操作组。
- **V0.5 增补**：支持可选 `$group` 原子操作组。组内任一步失败时，撤回整组数据、引擎状态、索引、生命周期与别名消解；组外独立操作不受影响。

---

# 第四章：实体、所有权、引用与预设黄金三角

## 4.1 实体类型与容器【沿用 V0.3】

- **多例实体**：必须保存在 `Record<EntityId, EntityObject>`，不允许实体集合用普通数组承载。实体自身 ID 不必在值对象里重复储存。
- **单例实体**：固定 ID（如 `world`、`combat`），支持必需或可空；其声明的路径由 Schema 决定。
- **嵌套实体**：可在实体内部的已声明多例实体 Record 中出现；每个嵌套实体仍拥有会话级唯一 ID。
- **非实体**：普通 Object/Record/Array 不产生独立 `@ID`，也不能假装可以全局实体寻址。

## 4.2 拥有关系与引用关系【V0.4 修订】

**拥有关系（Ownership）**：一个嵌套实体的物理生命周期由其所属实体子树决定；父实体销毁时按自底向上的次序销毁所有在其拥有子树中的实体。父实体迁移时，所属子实体路径前缀同步更新。

**引用关系（Reference）**：字段记录其他实体 ID，不拥有对方，例如 `friend`、`partner`、某个角色的好感度键。删除引用者不会删除被引用实体。

**【注释】** 不要求作者为所有字段标注「是否拥有」：嵌套实体容器的拥有关系可根据实体结构声明自动推导；只有引用字段才通过 `solve.ref()` 或分离式注册明确标识。

## 4.3 三种引用承载方式与四种删除规则【沿用 V0.3】

1. 单值引用：`partner: "@char_002"`。
2. 数组引用：`friends: ["@char_002"]`。
3. 字典 Key 引用：`relations: {"char_002": 80}`（这里 `char_002` 是目标实体 ID，不是物理对象实体）。

清理策略：`remove`（列表中移除）、`null`（单值设空）、`unset`（删字典键）、`restrict`（存在有效外部引用时拒绝销毁）。

**【规范】** 在执行实体删除前，先收集待销毁拥有子树及所有指向它们的**外部**引用，再判断 `restrict`，最后在候选状态中完成「引用清理 → 自底向上删除 → 索引更新」并整体提交。拥有子树内部互相引用不应凭空阻止整棵子树销毁。

## 4.4 索引设计【V0.4 修订】

```ts
interface ReverseRefEntry {
  sourcePointer: string;          // 真实 JSON Pointer
  sourceEntityId?: string;
  targetEntityId: string;
  kind: 'single' | 'array' | 'record-key';
  onDelete: 'remove' | 'null' | 'unset' | 'restrict';
}
```

- `EntityIndex: entityId → pointer/type/owner`。
- `ReverseReferenceIndex: targetEntityId → incoming reference entries`。
- 两者是**从真实状态 + 固定 Schema 可重建的派生索引**，IndexedDB 可存储它们以加速查询，`.jsonl` 不用逐楼保存索引。
- `$set`、`$push`、`$pull`、`$move`、`$swap`、`$createEntity`、`$deleteEntity` 都应在同一候选状态操作中维护受影响的索引。
- 若索引缓存出现异常，丢弃并从 Restore 后的状态重建，而不是反向修改权威历史。

## 4.5 预设黄金三角【沿用 V0.3】

| 类型 | 语义 | 生命周期 | 触发方式 |
|---|---|---|---|
| `InitialData` | 会话开局初始数据，支持不同开场 Greeting | Genesis 起已生效 | 初始化时注入 |
| `Prefab Pool` | 唯一身份，不能重复克隆 | `dormant → active → destroyed` | 精确 ID 的 `$createEntity` 或 `$move` 唤醒 |
| `Template Catalog` | 不下场的通用模板，可无限克隆 | 定义固定、实例另生成 ID | `$createEntity` 中的 `$from` |

- 原生宏（例如 `{{user}}`、`{{char}}`）在初始化/相应配置编译阶段按宿主上下文解析。
- `_prefabs` / `_templates` 是根据作者配置与当前条件向操作 LLM 披露的目录视图，不必放入全部 Active State。
- 唤醒唯一预制实体必须通过精确 ID；不根据自然语言 `name` 自动猜测唤醒。
- 预制实体的生命周期及新建实体 ID 的实际消解结果需体现在可恢复的确定性状态/元数据中。

## 4.6 ID 冲突与别名映射【沿用并明确】

例如 LLM 请求创建 `@item_sword`，但这个 ID 已存在，则引擎可以自动选择 `item_sword_2`，输出 L1 反馈。

- 实际创建结果与 ID 映射不能只存在 IndexedDB 内存里：要能由**已执行 Patch**重建；用于 Replay 的 `resolvedMeta` 也应随本 Swipe 的可迁移 Commit 元数据保存。
- 同批次后续指令若提到冲突 ID，需要先判定它是「旧实体」还是「本批新建实体的别名」；**【规范】** 解析器仅在明确指向本批创建请求的上下文中替换该新建别名。存在歧义时优先给出 L3 提示，不静默把旧对象改成新对象。
- 可在未来增强 `createAlias` 等内部元数据，但不强制 LLM 使用新算子或自造复杂语法。

---
# 第五章：十个原算子、group、动态取值与五阶段流水线

## 5.1 指令协议总原则【沿用 V0.3】

LLM 仅通过 JSON 操作对象表达状态变更；顶层使用 `$operator`，参数保持扁平化、尽量自然语言友好：

```json
{
  "$set": { "world.weather": "rain" },
  "$inc": { "@alice.hp": -15 }
}
```

- 一个指令块可以包含多个算子；解析器首先验证顶层字段是否为支持的十一个算子（含 `$group`）。
- 基本参数支持 JSON 对象映射或指定的一维列表形式；细节见下表。
- 不允许把 JSON 函数、代码片段、Schema 修改定义或未知 `$xxx` 算子混进可执行指令。
- 读取实时状态、修改状态、产出反馈三者由 Core 执行；模型不能通过提示词把数据校验关闭。
- 原始指令文本需保留在当前 Swipe 的消息正文中；状态结果由实际 Patch 归档。

## 5.2 五个高级算子【沿用 V0.3】

### 5.2.1 `$createEntity`：创建、模板实例化和预制唤醒

```json
{
  "$createEntity": {
    "characters.@char_erin": { "name": "艾琳" },
    "enemies.@mob_slime_1": { "$from": "@tpl_slime", "hp": 20 },
    "characters.@char_veronica": {}
  }
}
```

- 左侧为「父容器真实路径 + `.@新ID`」的创建语法。实际 JSON 新 Key 为 `char_erin`，**不带 `@`**。
- 目标必须是 Schema 声明的实体容器；引擎按子 Schema 补全默认值。
- `$from` 只能从注册模板目录选取；Prefab 可按预定义生命周期进行唤醒。
- ID 冲突允许按稳定算法添加后缀，并产生 L1；实际 Key 与映射进入本 Swipe 的已执行记录。
- 创建、默认填充、实体登记、引用初始化作为该实体创建操作的原子单位。

### 5.2.2 `$deleteEntity`：级联销毁

```json
{ "$deleteEntity": ["@mob_slime_1", "@item_broken_key"] }
```

- 支持一维数组；可对单字符串做容错。
- 每个目标实体的拥有子树、引用清理和索引更新共同构成原子单位。多个独立删除目标默认彼此隔离。
- `restrict` 阻止目标及其拥有子树被删时，该目标删除整条失败。
- 漏写 `@` 可给出智能纠错反馈；不能把可能指向其他普通字段的路径无条件重解释为实体。

### 5.2.3 `$move`：转移字段、移动实体、唤醒预制对象

```json
{
  "$move": {
    "@item_001": "@warehouse_001.items",
    "@item_excalibur": "@player.inventory"
  }
}
```

- 一个源到目标的迁移过程是原子的：源移出、目标写入、子实体路径更新、引用/拥有索引修正全成功才生效。
- 目标容器必须允许放置该实体类型；禁止将实体搬进自己的拥有子树（防止循环拥有关系）。
- **默认禁止覆盖已经占用的实体 Key/不可替换槽位**，发生冲突返回 L3；需要互换时使用 `$swap`。
- 位置不变、目标与源重复等无意义指令可产生 L1 或 L3，具体按解析器已确定的幂等规则处理。

### 5.2.4 `$swap`：双位置交换

```json
{ "$swap": { "@char_001.mainHand": "@char_001.offHand" } }
```

- 两侧读值、写值和索引维护须共同原子执行。
- 如果两个位置存在父子包含或类型不兼容关系，拒绝当前交换；不尝试猜测如何部分交换。
- 如果槽位包含实体，还必须满足实体容器和拥有关系规则；普通对象字段交换仍遵循 Schema。

### 5.2.5 `$transfer`：数值守恒转移

```json
{
  "$transfer": {
    "@char_001.gold": {
      "@char_002.gold": 50,
      "@char_003.gold": 30
    }
  }
}
```

- 每个**源路径**及其全部目的地视为一个原子转移 Statement；多个源路径默认按 Statement 局部隔离。
- 源值和目标值应为可进行数值运算的字段；数量必须是有限、非负数；禁止同一源被列为自己的目的地。
- 先在候选状态计算源扣减与所有目的地入账，再验证各字段声明的约束；只要任一侧不满足转移条件，整笔转移拒绝。
- `$transfer` 不使用 Clamp 掩盖余额不足或接收方上限冲突，避免一笔转移凭空增减总额。其他 `$inc`、`$set` 仍遵循作者 Schema 的自动 Clamp 策略。
- 不要求作者将该数值声明为「货币」，对所有符合数值类型且满足约束的字段一视同仁。

**【注释】** `$transfer` 的守恒是**算子机制**，不是作者业务语义分类。无需知道字段叫 `gold`、`hp` 还是 `energy`。JS `number` 的有限精度依旧存在；作者需要精确整数时可直接采用整数单位及 Zod 约束，SOLVE 不强制所有数值转为整数。

## 5.3 五个基础算子【沿用 V0.3】

| 算子 | 示例 | 主要语义 | 失败隔离 |
|---|---|---|---|
| `$set` | `{"$set":{"world.weather":"rain"}}` | 设置值；固定对象默认深合并 | 每个目标路径 |
| `$unset` | `{"$unset":["@alice.tempBuff"]}` | 删除可选字段 / 字典键；实体自动升级删除 | 每个目标 |
| `$inc` | `{"$inc":{"@alice.hp":-15}}` | 数值加减，受 Zod Clamp 约束 | 每个目标路径 |
| `$push` | `{"$push":{"world.logs":"胜利"}}` | 数组追加；引用数组自动去重 | 每个数组目标 |
| `$pull` | `{"$pull":{"@alice.tags":"中毒"}}` | 从数组按字面值删除匹配项 | 每个数组目标 |

补充边界：

- `$unset` 不能删除 Schema 必需、不可空且无合理删除语义的固定字段。
- `$pull` 默认删除**所有按结构字面值相等匹配的元素**；引用数组在加入时去重。
- `$set` 修改引用字段时，反向引用索引一并更新。
- `$inc` 目标不是数字、传入非有限值、或目标不存在且无默认值时，当前 Statement 失败。
- `$push` 不能向非数组字段自动创建数组；只有 Schema 默认明确支持的缺省字段才可按规则补齐。

## 5.4 `$valueOf` 动态取值【沿用并明确】

```json
{
  "$set": {
    "player.hp": { "$valueOf": "player.maxHp" },
    "@char_001.mp": { "$valueOf": "@char_001.maxMp", "$mul": 0.5 }
  },
  "$inc": {
    "player.gold": { "$valueOf": "shop.iron_sword.price", "$mul": -1 }
  }
}
```

- 在 `$set`、`$inc`、`$transfer` 指定的值位置支持对象形式 `$valueOf`，`$mul` 默认 1。
- `$valueOf` 从**当前 Statement 开始前的工作状态**读取，不能越过休眠模块读取被隐藏字段，也不能绕过实体寻址。
- 同一个原子 Statement 中多次动态取值读同一基准，避免部分字段先写入后改变后续取值结果。
- 不同 Statement 根据确定的执行顺序看到之前已成功 Statement 的效果。
- 路径不存在、类型不匹配或 `$mul` 非有限值时，该 Statement 拒绝并反馈；不猜测数字含义。

## 5.5 五阶段固定流水线【沿用 V0.3】

| 阶段 | 操作 | 目的 |
|---|---|---|
| Phase 1 创生 | `$createEntity` | 新对象及索引先就位 |
| Phase 2 结构迁移 | `$move` → `$swap` | 先处理搬运与换位 |
| Phase 3 数值/状态 | `$set` → `$inc` → `$transfer` | 完成值变更、动态计算 |
| Phase 4 集合 | `$push` → `$pull` | 处理数组增删 |
| Phase 5 销毁 | `$unset` → `$deleteEntity` | 最后清除字段和实体 |

**【V0.4 修订】执行顺序补充规范**：

1. 顶层十种算子按上表阶段及同阶段固定优先级归并，不依赖模型书写的顶层 JSON Key 顺序。
2. 同一算子多个目标按源 JSON 对象中的出现顺序执行；数组参数按元素顺序。解析器必须保留这一顺序并给每个 Statement 一个稳定的 `statementIndex`。
3. 在 Phase 2、3 中，同一目标/祖先子树被多条操作同时读写时，按确定次序解释；若无法保证无歧义（例如同批 `$move` 互相占目标容器、同一 `$set` 同时写父节点与子节点），拒绝冲突 Statement 并给 L3，而不悄悄重排。
4. 对每条 Statement，先在临时视图做寻址、计算、校验与索引调整，整体成功后才更新工作状态；失败直接丢弃其候选结果。
5. 全部 Statement 结束后生成**本楼操作的累计最终状态差异**，再与此前当前 Swipe 已归档的交互动作合成最终楼层 Patch。
6. 独立的成功 Statement 可以留下有效变更；这是 SOLVE 有意选择的「尽可能执行」，不是整批 ACID。

### 5.5.1 同目标操作样例【示意】

```json
{
  "$set": { "@alice.hp": 70 },
  "$inc": { "@alice.hp": -10 }
}
```

按固定顺序先 `$set` 后 `$inc`，最终 HP 为 60（仍需考虑 Schema 边界）。

**【注释】** V0.3 没有完整限定同阶段不同算子顺序，V0.4 将它确定下来，避免不同实现得出不同结果；这个选择属于引擎协议，而不是对 LLM 新增学习负担。

## 5.6 `$group` 有序原子操作组【V0.5 用户确认】

```json
{"$group":[{"$inc":{"@player.gold":-50}},{"$move":{"@sword":"@player.inventory"}}]}
```

- `$group` 是第十一个可选算子，参数为非空有序操作对象数组。数组依次执行，每个成员内部仍沿用五阶段排序。组内操作连续执行，不与组外交错。
- 任一成员失败，整组撤回；嵌套组失败传递到最外层。嵌套最多 8 层。失败组保留一条明确反馈，不保留已经撤回的成功提示。
- 组内数值越界直接拒绝，不使用 Clamp 掩盖余额不足。普通组外 `$inc` / `$set` 保持原有 Clamp；`$transfer` 始终遵守守恒，组外也不 Clamp。
- 组内完成后校验完整候选状态及作者跨字段规则；中间状态不提前持久化。外部网络写入不包含在状态回退保证内。
- 同一顶层对象先完成普通五阶段，再执行 `$group`；若需要明确前后次序，用顶层有序操作数组表达。多个独立组用多个数组成员表达。
- 旧的十算子指令继续可用；无需将无关联操作全部放进 group。

---

# 第六章：模型工作模式、指令块与交互动作

## 6.1 随正文操作模式 In-Band【沿用 V0.3】

剧情 LLM 在正文尾部输出：

```xml
艾莉丝遭遇突袭，受到了伤害。
<solve_operate>
{"$inc":{"@alice.hp":-15}}
</solve_operate>
```

- 原始内容保存在消息文本；渲染层隐藏或折叠块；提示词组装过滤旧操作块。
- 只有消息生成真正完成且对应的是当前有效 Swipe 时才尝试执行，不能仅凭某个结束事件直接落库。
- `jsonrepair` 用于尽量容错解析模型 JSON；**修复后的 AST 仍必须完整检查算子白名单、目标路径、参数与 Schema**。
- 不完整/重复/嵌套错误的 `<solve_operate>` 不应误抓部分正文作为操作；报告可恢复错误。

## 6.2 独立操作模型 Out-of-Band【沿用 V0.3】

- 剧情文本结束后，由 SOLVE 单独调用操作 LLM，生成同样的 `<solve_operate>` 指令。
- 输入默认：最近 2～4 层对话文本 + `{{solve_SOP}}` + `{{solve_guide}}` + `{{solve_toon::operator}}` + 上一有效 Commit 的 `{{solve_feedback}}`。
- 支持独立高速模型配置或宿主已保存的 Connection Profile，不要求切换酒馆当前全局 Profile。
- 状态栏显示「数据同步中」；超时后允许**只重试数据操作，不重生剧情文本**。
- 生成中用户切换聊天/Swipe 时，返回结果必须重新核对其请求绑定的 `chatId/messageId/swipeId/parentCommitId/generationToken`；不符合立即丢弃或提示用户重新执行，绝不写到新会话。

### 6.2.1 独立操作模型忙碌期间的请求开关【用户确认方向与实施约定】

提供玩家可设置的 **「独立操作模型运行时允许继续请求」** 开关，配置名示意为 `allowRequestsDuringOperatorBusy`。作者可以通过公开 API 读取该设置及忙碌状态，最终设置由玩家决定。用户已确认提供该开关；默认关闭、拒绝时不自动重发等细节是本次补充的实施约定。

| 设置 | 请求行为 |
|---|---|
| 关闭（默认） | 当前聊天的数据同步任务忙碌时，阻止玩家和其他插件通过已适配入口发起新的模型生成请求 |
| 开启 | 允许上述请求继续发出；这些请求使用当时已经确认归档的状态，界面保留「数据同步中」提示 |

**忙碌与请求身份**：

- 忙碌范围覆盖独立操作模型任务从取得执行资格、准备输入、发起请求，到解析执行及宿主保存确认；失败、超时、取消进入终态后释放本任务占用，不因异常永久锁住聊天。
- 保存失败仍须保留「未归档/待同步」标记。解除请求限制不等于这次状态变更已保存。
- 限制绑定 `chatId` 与具体任务身份，不锁住其他聊天；结束时只释放本任务的占用，旧任务不能解除新任务的忙碌状态。切换设置只影响之后进入的新请求，不批量终止已经发出的请求。
- 本次 SOLVE 自身的操作模型调用持有协调器分配的任务许可，不会被自己的开关拦截；插件不能仅凭传入一个来源字符串取得该许可。

**拦截范围与可观测结果**：

- 不能只禁用发送按钮。Adapter 应在请求真正发送前统一检查酒馆标准生成入口、已适配的酒馆助手 `generate/generateRaw` 路径，以及经 SOLVE 请求接口发起的调用；插件来源与玩家来源遵循同一设置。
- 这里的「请求」指当前聊天关联的模型生成请求，不包括保存聊天、取消任务、恢复缓存或普通资源加载。状态栏按钮若仅提交变量动作，仍按状态写入队列处理；按钮若触发模型生成，则受本开关控制。
- 阻止时向玩家说明正在同步，并向插件返回明确的忙碌/取消结果（统一码示意 `SOLVE_OPERATOR_BUSY`）；默认不暗中排队重发，避免产生重复剧情或额外调用。
- 酒馆原生生成拦截器不等于所有生成路径的拦截器；监听到事件也不等于可以取消请求。助手入口必须验证取消/拒绝发生在模型请求发送之前。
- 插件自行联网、缓存旧函数引用或走未适配的独立入口时，不能声称 SOLVE 已全面拦住它。提供公开的忙碌查询、请求准入接口与适配能力清单；不能覆盖的入口需明确显示兼容限制，不能把按钮禁用包装成全插件保证。
- 若调用助手自身会自动禁用发送按钮，Adapter 还须验证并协调这一行为，保证「允许继续请求」模式确实可用；不得使用全局停止所有生成来实现单个请求的拒绝。

**允许并发请求时的状态一致性**：

- 每个聊天内 SOLVE 自身的操作模型任务仍串行处理；新剧情产生的待同步任务按已确认的消息/分支顺序排队，在取得执行资格时才读取最新有效父状态并构造输入，不复用排队前过期的提示词。
- 开关允许请求并发，不允许状态结果互相覆盖。交互动作、作者扩展和插件经 SOLVE 提交的状态写入仍走统一队列，并校验父提交及预期版本。
- 用户继续生成后，旧任务仍按其原消息/Swipe/分支身份检查；不能只因出现更新的楼层就作废所有先前任务。原 Swipe 被替换、上游被编辑或预期版本变化时，丢弃过期候选或明确重新计算，不能把旧 Patch 接到新父状态上。
- 跨聊天切换、取消、失败、保存重试和运行时实例退出都要清理任务占用；已被限制的请求、待同步任务和失败原因可在 Inspector 查看。

## 6.3 两个操作指令块【沿用 V0.3】

| 消息块 | 来源 | 归档位置 | 执行顺序 |
|---|---|---|---|
| `<solve_operate>` | LLM（两种工作模式） | 当前消息 / 当前 Swipe 原文末尾 | 先 |
| `<solve_mutual_operate>` | UI 按钮、模块切换、Inspector、API | 当前消息 / 当前 Swipe 原文末尾 | 后 |

`<solve_mutual_operate>` 内保存有序的玩家动作记录（含 actionId、来源、操作内容或模块事件）。V0.5 实施格式见后端规范；LLM 不得伪造此块。新按钮动作追加到当前 Swipe 末尾，并对相应的**累计 Patch**重新计算。

**【示意】**

```xml
<solve_mutual_operate>
[
  {"$inc":{"@player.hp":30}},
  {"$inc":{"@player.gold":-10}}
]
</solve_mutual_operate>
```

- 对同一按钮连点两次是两个合法、具有不同 `actionId` 的动作；网络/保存重试沿用原 `actionId`，不得扣两次。
- 模块切换属于运行时配置变更，可在操作日志中归档为**SOLVE 内部交互事件**，而不是硬塞一个额外的 LLM 算子。两种来源都归纳进该 Swipe 的有效引擎状态增量中。
- 若 Inspector 直接修改 JSON，需先把差异转换为受支持的可回放操作，或以带来源标记的内部修正事件归档；不可生成只有 IndexedDB 知道的隐藏状态修改。

## 6.4 反馈四级漏斗【沿用 V0.3】

- **L0 完全成功**：无额外模型反馈文字；具体变更已在最新状态中体现。原企划提出常规成功占比仅是预期，不是统计保证。
- **L1 自动修正**：Clamp、ID 重命名、Key 净化、算子自动升级、堆叠归零销毁。
- **L2 外部变更**：UI、模块、调试器等非 LLM 来源改变了状态。
- **L3 拒绝与纠错**：不存在的路径/ID、`restrict`、冲突、类型或约束错误，必要时给模糊匹配建议。

**【V0.4 修订】** 反馈绑定到产生它的 `commitId` 和 `swipeId`。读取上一楼反馈必须基于当前选定的有效历史链，而不是简单取 `chat[i-1]` 的某个全局状态。

## 6.5 用户交互的执行与保存确认【规范】

UI 可以先显示乐观更新结果，但在宿主保存确认之前，它只是**未归档候选状态**。若写回操作块或 `extra.solve` 保存失败，应停止把该变更当作历史正式事实，重试保存或撤回乐观更新，并向玩家清晰提示。

**【注释】** `.jsonl` 和 IndexedDB 不存在天然的跨存储原子事务。V0.4 的规矩很简单：**以最终成功持久化到聊天文件中的记录为准**；本地数据库中比聊天多出的未同步数据可以作为恢复中的待处理记录，但不能无提示地冒充已归档历史。

---

# 第七章：可选模块、状态休眠与惰性水合

## 7.1 作者零额外依赖的模块模型【沿用 V0.3】

作者可将根节点、对象、深层字段或多个分支路径分配给指定模块，并支持父子模块嵌套。作者只需声明「这些字段属于这个模块」和可选更新指南，无需写复杂依赖图、冲突图或业务规则引擎。

### 7.2 模块关闭：四重遮罩

1. 所有 LLM 状态披露视图自动跳过休眠字段。
2. 对应模块的更新指南不再注入。
3. LLM 操作命中休眠字段时，忽略该 Statement 并产出简洁反馈。
4. Zod 运行时有效校验跳过休眠字段的**业务激活要求**；基础存储完整性依然必须成立。

业务 JSON 数据**保留在原处**，并不物理删掉。重新开启时原样恢复。

## 7.3 模块开启：惰性水合

如果模块首次开启，或休眠期间新建实体未包含该模块字段，SOLVE 根据固定 Schema 对缺失位置填充 `.default()`；同时生成可恢复的**数据 Patch**。若没有合理默认且 Schema 明确要求字段存在，给出 L3 错误，不擅自制造业务值。

- 关闭期间新创建的实体不要求提前写入所有休眠字段。
- 模块开关本身的变更进入 Commit 的 `enginePatch` / `moduleDelta`，不用修改作者可见的数据结构。
- **会话 Schema 一直不变**：开关只改变有效状态、披露和校验遮罩。

## 7.4 休眠字段的跨模块读取规则【V0.4 明确】

- 通过 `$valueOf` 读取休眠字段默认拒绝该 Statement，并给出 L3（避免一边隐藏、一边通过别的模块暗中使用）。
- UI `solve.getState()` 可获取真实完整 JSON；前端有责任遵循作者选定的模块可见性，必要时使用 `getProjectedState`。
- 自定义视图默认也服从休眠遮罩；不应通过自定义 TOON 视图将已关闭字段重新注入模型。
- 父模块关闭时子模块视为有效休眠；重新开启父模块恢复子模块各自保存的开关偏好。
- **V1 不强制作者定义 `requires`、`conflicts`。** 作者若搭建了不合理的跨模块依赖，其更新指南应做业务规避；引擎只提供统一、可预测的访问行为。

---

# 第八章：TOON 状态披露、实体标记、宏与 UI

## 8.1 数据流方向【V0.4 纠正】

```text
原生状态 JSON
  → full / narrative / operator / 自定义投影
  → 休眠模块字段过滤
  → 按 Compiled IR 标记实体键（仅视图层添加 @）
  → @toon-format/toon 编码
  → 作为 LLM 的「状态输入上下文」
  → LLM 输出 <solve_operate> 中的 JSON 算子
  → SOLVE 解析执行 → 实际状态 JSON + Patch
```

**【规范】** TOON 是面向 LLM 的**输入格式**，不是 LLM 输出，也不是聊天历史 Patch 的格式。SOLVE 的核心真实状态永远保持 JSON。

## 8.2 三个不可变内置视图【沿用 V0.3】

| 视图 | 用途 | 默认处理 |
|---|---|---|
| `full` | 面向 LLM 的完整启用模块状态 | 含所有可披露业务字段 |
| `operator` | 独立数据操作 LLM | 剥离 `.readonly()` 标识的静态长文本 |
| `narrative` | 剧情 LLM | 剥离 `.internal()` 纯内部记账字段 |

作者可通过 `solve.registerCustomView(name, projector)` 注册自定义视图；不能篡改内置视图的定义。`solve.getState()` 与 `subscribe()` 面向 UI 提供真实状态及响应式通知。

**【注释】** `.readonly()` 在这里的主要作用是**上下文披露策略**，并不等同于让模型具备 Schema 编辑能力或引入 RBAC。模型本就只能通过受支持算子修改被 Schema 允许的业务数据。

## 8.3 自动实体 `@` 披露【V0.4 核心新增】

### 原始 JSON

```json
{
  "characters": {
    "alice": { "name": "艾莉丝", "hp": 100 },
    "bob": { "name": "鲍勃", "hp": 80 }
  },
  "settings": { "alice": { "theme": "dark" } }
}
```

假设 Schema 声明 `characters` 是实体字典、`settings` 是普通对象，则 TOON 投影可呈现为：

```toon
characters[2:]{name,hp}:
  "@alice": 艾莉丝,100
  "@bob": 鲍勃,80
settings:
  alice:
    theme: dark
```

- 只给真正的实体 Key 添加 `@`，`settings.alice` 不添加。
- 单例实体在**视图树中**也能以 `"@world"` 等被明确标识的入口名披露，实际 JSON Key 仍是 `world`。
- 嵌套实体按 IR 识别后逐层做视图标记；实体引用字段若本就存储 `"@bob"`，应保持其引用语义，不再无脑重复添加 `@`。
- 实体标记与视图过滤必须同时基于固定 IR；不能对普通 Key 执行「凡像 ID 就加 `@`」的字符串替换。
- 对自定义视图，作者如果把实体集合彻底重排成普通表格，则该视图须显式保留实体身份元数据或交由规范化视图投影器处理，不保证任意投影自动识别新路径。

**【注释】** TOON 官方规范要求不满足简单 Key 语法的 Key 使用引号，所以 `"@alice"` 是合理的文本形态。Keyed Tabular Form 仅在值同构、字段满足对应条件时触发；不能因为使用 Record 就保证一定进入表格压缩。实际 Token 节约百分比需要在真实角色卡样本上测试。

## 8.4 宏体系【沿用 V0.3】

| 酒馆宏 | 目标 API | 描述 |
|---|---|---|
| `{{solve_SOP}}` | `solve.getSOP()` | 十一个算子、`@` 语义、指令标签、由 Schema 提取的主要约束 |
| `{{solve_guide}}` | `solve.getGuide(tag?)` | 当前可用的普通与模块指南；支持 `{{solve_guide::combat}}` |
| `{{solve_feedback}}` | `solve.getFeedback()` | 当前链上一有效楼层 L1/L2/L3，L0 空 |
| `{{solve_toon}}` | `solve.toToon(opts)` | 默认或指定视图的 TOON 状态 |
| `{{solve_toon::narrative}}` | 同上 | 剧情视图 |
| `{{solve_toon::operator}}` | 同上 | 操作模型视图 |
| `{{solve_json}}` | `solve.toJson(opts)` | 同一投影的紧凑 JSON 状态，由作者自由选择 |
| `{{solve_json::narrative}}` | 同上 | 剧情视图的紧凑 JSON |
| `{{solve_json::operator}}` | 同上 | 操作模型视图的紧凑 JSON |
| `{{solve_json::@alice, world.weather}}` | 同上 | 与 TOON 宏相同的局部路径投影 |
| `{{solve_toon::@alice, world.weather}}` | 同上 | 多路径局部投影 |
| `{{solve_toon::characters.*.name}}` | 同上 | 通配符字段投影，保留实体身份 |
| `{{solve_val::@alice.hp}}` | `solve.getValue(path)` | 内联单值 |

- 宏读取的是当前已经与选中 Swipe 对齐的**内存 Active State**；不在同步宏回调中异步访问 IndexedDB。
- 宏执行顺序、世界书触发、提示词组装的宿主细节在 Adapter 中解决。
- 在某些宏路径只返回单一实体子树时，投影器要保留适当的 `@实体ID` 视图根标签，不能把实体身份在裁剪时丢掉。

## 8.5 TOON 性能与兼容性

- 直接使用已锁定兼容版本的 `@toon-format/toon` 库与对应规范；不自行发明 TOON 子集作为「官方编码」。
- 实体数据可使用键值表格形式时自动压缩，否则退回标准嵌套形态。
- 核心优化顺序：**先筛选所需状态，再编码 TOON 或紧凑 JSON**；Token 数量与缓存命中率应可在 Inspector 查看。
- 性能目标以测试数据集为准，不承诺固定 50%～65% 节省率。

---
# 第九章：权威 `.jsonl` 历史、IndexedDB、Restore 与 Replay（V0.4 重点重写）

## 9.1 设计目标【规范】

本章确立以下不可破坏的历史规则：

- **A. `.jsonl` 独立恢复全部「仍保留的」聊天历史**：无需 IndexedDB、无需网络、无需重新调用 LLM。
- **B. `.jsonl` 不放周期 Snapshot**：每个普通楼层/Swipe 存一份执行后的增量；IndexedDB 负责周期 Snapshot。
- **C. 两个操作指令块继续保存在聊天正文**，反馈、实际增量与 Commit 元数据位于酒馆消息变量中。
- **D. Restore 使用已执行 Patch**，绝不把原始指令再执行一遍。
- **E. Replay 使用 Raw Ops**，在变动后的上游状态上产生**新** Patch、新反馈、新 Commit；旧历史分支不被静默覆盖。
- **F. IndexedDB 是强大的派生 NoSQL 存储，但不能藏匿唯一不可再生的业务历史事实**。
- **G. 单楼层支持多 Swipe，且每 Swipe 拥有独立历史记录；跨会话分支可共享不变祖先 Commit 的缓存**。

## 9.2 数据分层【V0.4 修订】

| 层 | 典型内容 | 是否权威 | 删除后如何处理 |
|---|---|---|---|
| `.jsonl` 聊天级元数据 | Genesis、协议版本、会话固定定义指纹 | **是** | 若删除则不保证独立恢复 |
| `.jsonl` 消息正文 | `<solve_operate>` / `<solve_mutual_operate>` | **是：操作意图** | 无法进行完整指令 Replay |
| `.jsonl` Swipe 元数据 | `dataPatch`、`enginePatch`、`feedback`、Commit、执行消解元数据 | **是：实际结果** | 无法直接 Restore 对应提交 |
| IndexedDB `commits` | 全历史 DAG 缓存、正逆 Patch、查询字段 | 否 | 扫描 `.jsonl` 重新建立 |
| IndexedDB `snapshots` | 完整状态快照及实体索引 | 否 | 由 Genesis + Patch 重建 |
| IndexedDB `active_states` | 当前会话热状态 | 否 | 从有效 HEAD Restore |
| IndexedDB 查询索引 | 实体/引用/作者查询索引 | 否 | 从 Restore 的业务状态与固定 IR 派生 |

**【注释】** 「独立恢复」严格指**状态 Restore**。若要在另一台设备继续**重新解释历史指令**，需要能加载该会话对应固定 Schema/IR 的可执行定义。即便没有角色卡，`.jsonl` 自带 Genesis + Patch 仍可以做状态历史还原或只读查看。

## 9.3 Genesis：唯一必须具备的初始完整状态【规范】

没有任何前置状态的 Patch 链无法从零恢复。因此必须有一个初始基准 `S0`。

- 每个会话在 `chat_metadata.solve.genesis` 内记录**已经完成宏展开、Schema 默认值补全与初始校验的实际开局状态**。
- Genesis 同时包含最初的模块状态、预制池生命周期相关初始引擎状态，以及与固定 IR 的指纹。
- 第 0 楼的不同 Greeting Swipe 若有不同初始状态，应为这些 Greeting 分别保存可确认的 Genesis Variant；可以用共享基准 + 变体 Patch 节省体积。
- Genesis 属于**开局锚点**，不是 V0.3 每 10～20 楼生成的周期 Snapshot；普通楼层不重复完整状态。
- 如果用户显式清除所有历史到某个中途节点，又希望这个节点变成新的独立起点，可以进行显式「重新定基（Rebase）」并生成新的 Genesis；不应暗中删除仍需恢复的祖先链。

**【示意】聊天级元数据**

```json
{
  "chat_metadata": {
    "solve": {
      "archiveVersion": "0.4",
      "engineSemanticsVersion": "0.4",
      "sessionId": "session_5b01",
      "schemaHash": "sha256:fixed-schema-fingerprint",
      "compiledIrHash": "sha256:fixed-ir-fingerprint",
      "genesis": {
        "genesisId": "g_opening_A",
        "data": {
          "characters": {
            "alice": { "name": "艾莉丝", "hp": 100 }
          }
        },
        "engineState": {
          "activeModules": { "combat": true },
          "prefabLifecycle": {}
        },
        "stateHash": "sha256:genesis-state"
      },
      "genesisVariants": {
        "greeting_swipe_B": {
          "baseGenesisId": "g_opening_A",
          "dataPatch": [],
          "enginePatch": []
        }
      },
      "headHint": "c_0102"
    }
  }
}
```

**【注释】** `sha256:...` 是示意占位符，正式实现必须计算真实哈希。`headHint` 仅供加速定位，**不替代从选中消息/Swipe 与 `parentId` 校验出的实际历史 HEAD**。Genesis 的结构不必一模一样照抄此示例；这里规定的是必须能够独立恢复的事实集合。

## 9.4 每楼层、每 Swipe 的权威执行档案【规范】

SillyTavern 的概念是一楼消息可有多个 Swipe 版本；SOLVE 每个 Swipe 独立绑定：

- 原始聊天文本（其中有两个指令块）；
- 从其 `parentCommitId` 对应状态到本 Swipe 终态的**累计** `dataPatch`；
- 模块状态等引擎元数据的 `enginePatch`；
- L1/L2/L3 反馈，L0 可空；
- `commitId`、`parentId`、`baseHash`、`stateHash`、`resolvedMeta`、操作指纹与存储格式版本；
- 必要时附 `dirty`、`replayConflict` 等调试标志（不是独立事实来源）。
- 使用作者外部输入时，在随操作绑定的 `resolvedMeta.authorInputs` 或等价归档事件中保存实际 JSON 结果及来源/版本标识；不能仅保存一个已过期的缓存链接。具体规则见 §10.4.1。

**【示意】** 一个 Swipe 的 `extra.solve`：

```json
{
  "archiveVersion": "0.4",
  "commit": {
    "commitId": "c_0102",
    "parentId": "c_0101",
    "genesisId": "g_opening_A",
    "baseHash": "sha256:state-before-this-swipe",
    "stateHash": "sha256:state-after-this-swipe",
    "opsDigest": "sha256:raw-model-plus-mutual-ops",
    "engineSemanticsVersion": "0.4"
  },
  "dataPatch": [
    {
      "op": "replace",
      "path": "/characters/alice/hp",
      "value": 85
    }
  ],
  "enginePatch": [],
  "feedback": [
    { "level": "L1", "code": "CLAMP_APPLIED", "message": "示例反馈" }
  ],
  "resolvedMeta": {
    "createdIdMap": {}
  },
  "actionIds": ["msg_10_swipe_0_model"],
  "dirty": false
}
```

本例 `dataPatch` 是真正对作者 JSON 的 RFC 6902 Patch：`/characters/alice/hp`，**不是** `@alice.hp`。`enginePatch` 只用于需要随历史变化的 SOLVE 内部状态（如启用模块、Prefab 生命周期），不写到作者的业务 JSON 内。

> **必须一致**：`feedback`、`opsDigest`、`commit` 必须与同一次保存中的两个指令块相对应。不能出现「新 Patch 配旧正文指令」却宣称这条楼层可完整 Replay 的情况。

## 9.5 当前 Swipe 与非当前 Swipe 的存储【规范】

### 9.5.1 概念结构

```text
聊天消息 i
├─ Swipe A
│  ├─ swipes[A] / 对应消息文本
│  ├─ swipe_info[A].extra.solve
│  └─ Commit A (parent → commitA)
├─ Swipe B
│  ├─ swipes[B] / 对应消息文本
│  ├─ swipe_info[B].extra.solve
│  └─ Commit B (parent → commitB)
└─ Swipe C
   ├─ swipes[C] / 对应消息文本
   ├─ swipe_info[C].extra.solve
   └─ Commit C (parent → commitC)
```

**【待宿主验证】** 不同 SillyTavern 版本的 `mes`、`extra`、`swipes[]`、`swipe_info[]` 的同步/保存行为可能不同。适配器需验证已选 Swipe 的显示字段与对应 `swipe_info` 是怎样映射的。上述是**SOLVE 必须满足的数据归属语义**，不是承诺某个宿主字段一定原样存在。

### 9.5.2 Swipe 改变后历史怎样处理

- 切到另一个 Swipe，当前 HEAD 应指向对应的 Commit。
- 下游楼层如果仍引用旧 Swipe 的 `parentId`，代表**旧历史分支**。不能直接把旧下游 Patch 强行应用于新父状态。
- 用户希望从新 Swipe 继续：可以重建/重放不相容的后继链并生成新分支，或者从当前历史位置直接继续新剧情。
- 已完成并保留的旧 Swipe 历史仍可 Restore；只有当用户真正删除其聊天记录、或重新定基明确丢弃祖先时，旧历史才不再属于独立恢复承诺。

## 9.6 Commit、Hash 与历史身份

每个有效提交至少绑定：

```ts
interface SolveCommitRecord {
  commitId: string;
  parentId: string | null;
  genesisId: string;
  baseHash: string;
  stateHash: string;
  opsDigest: string;
  archiveVersion: string;
  engineSemanticsVersion: string;
}
```

- `commitId` 是稳定、不可变的历史提交身份；可以采用随机唯一 ID，另用 `stateHash` 保证内容正确，不应仅依赖 `floorIndex`。
- `parentId` 指向该 Swipe 实际执行时的父状态提交。分支可共享祖先 Commit。
- `baseHash` 是应用本 Swipe Patch 前的有效状态哈希，`stateHash` 是之后的哈希。两者都计算完整的**逻辑状态**：作者 JSON `data` + 必要的 `engineState`。
- `opsDigest` 检查两段指令块是否和当前 Patch 同一执行版本；改变了历史指令后，即使现在尚未 Replay，也能发现记录已失配。
- 哈希生成需要对 JSON 使用固定的规范化编码（键排序/数值表现/字符串处理一致）；不要直接信任对象普通序列化的偶然顺序。
- 如果恢复时发现父链断裂、哈希不一致或文件缺少某段 Patch，停止声称该节点可靠，并在 Inspector 明确指出第一处损坏位置。

## 9.7 累计 Patch 如何定义【关键细节】

一个 Swipe 可能经历：

1. LLM 指令产生模型结果；
2. 玩家点击一次喝药水；
3. 玩家点击一次切换模块；
4. 玩家再次点击喝药水。

为了让普通楼层只存**一份状态增量**，V0.4 定义：

`dataPatch` + `enginePatch` = **从此 Swipe 父 Commit 的有效状态 → 当前 Swipe 最终状态** 的合成增量。

这意味着：

- 每次新的玩家交互结束，重新产出并保存当前 Swipe 的**最终累计 Patch**；不必把多次按钮点击造成的中间 Patch 逐一复制到聊天变量。
- `<solve_mutual_operate>` 仍按发生顺序保留**每次操作的原始意图**，供 Replay 使用。
- 状态最终 Patch 不是事件流的替代品；它用于 Restore，事件流用于 Replay。
- 同一楼层多次保存时，Commit 可以视为该 Swipe 的「当前已归档修订版」；旧版 Commit 若仍被其他已保存分支引用则不可随意删除。
- `inversePatch` 不是 `.jsonl` 必需字段；IndexedDB 可以在缓存生成时从执行前后状态推导并保存。

**【注释】** 累计 Patch 可以采用生成的最小化 Diff，也可以组合增量后再正规化，只要从正确 `baseHash` 应用能得到精确 `stateHash` 即可。Patch 不要求「每条操作一个 Patch」。

## 9.8 Restore：确定性状态重建【V0.4 核心】

### 9.8.1 仅有 `.jsonl` 的冷恢复

```text
从 .jsonl 读取 Genesis（S₀）
  ↓
根据选中聊天历史/Swipe 构建 parentId 链
  ↓
逐个验证 baseHash
  ↓
依序应用每个 dataPatch 与 enginePatch
  ↓
逐个验证 stateHash
  ↓
得到目标 Commit 的完整状态
  ↓
重建 Entity Index / ReverseReferenceIndex
  ↓
生成 IndexedDB Commit DAG、周期 Snapshot、活跃状态与查询索引
```

数学表示：

\[
S_n = \operatorname{Apply}(\dots \operatorname{Apply}(\operatorname{Apply}(S_0,P_1),P_2)\dots,P_n)
\]

其中 `S` 表示完整逻辑状态，`P` 表示业务数据 Patch + 引擎状态 Patch 的统一应用。

**Restore 禁止**：重新解释模型操作、重新调用 `$valueOf`、重新 Clamp、重新决定 ID、重新运行实体生命周期算子、重新调用 LLM。它只应用**已经被保存为事实**的 Patch；不运行作者的校验、变换、默认值回调或外部副作用。

### 9.8.2 IndexedDB 热恢复

- 先找**位于目标祖先链上且哈希可验证**的最近 Snapshot；不是找任何楼层号接近的快照。
- 从该 Snapshot 沿 parentId 链向目标逐个应用缓存 Patch。
- 若没有可用 Snapshot，退回 Genesis + `.jsonl` Patch 进行冷恢复。
- 当前末楼切 Swipe 可使用 IndexedDB 缓存 `inversePatch` 优化，但只能在其 `commitId/baseHash` 与当前 Active State 完全对应时使用，否则选择安全的 Snapshot 路线。

### 9.8.3 Restore 产物

返回完整业务 JSON、模块开关与 Prefab 生命周期，以及可以派生的索引；Restore 本身**不创造新的历史 Commit**，也不会改变原始消息。

## 9.9 Replay：重新执行历史指令【V0.4 核心】

### 9.9.1 触发条件

- 用户直接编辑第 N 楼的 `<solve_operate>` 或 `<solve_mutual_operate>` 内容。
- 用户切换历史 Swipe 后要求保留/接续受影响的下游剧情链。
- 用户从 Inspector 点击「从此楼重放」或「此楼重新执行」。
- 上游原始指令/父提交发生改变，导致某条原 Patch 的 `baseHash` 不再与当前历史链匹配。

### 9.9.2 处理流程

```text
恢复变动楼层前的有效父状态（Restore）
  ↓
读取当前楼层两个原始指令块
  ↓
调用五阶段确定性引擎重新执行
  ↓
生成新 dataPatch / enginePatch / feedback / resolvedMeta / stateHash
  ↓
新建/记录新的 Commit（旧分支保持可识别）
  ↓
将新 HEAD 作为下一受影响楼层的父提交继续重放
  ↓
出现无法执行的旧指令：记录 L3 + Dirty Floor，尽可能继续独立操作
  ↓
持久化新的指令结果和历史归属
```

Replay 绝不复用旧 `stateHash` 冒充新结果。原始 ID 冲突映射可作为候选提示，但若上游状态变化让旧映射不再成立，必须重新消解 ID，生成新的 `resolvedMeta` 与反馈。

作者逻辑使用时间、随机数或远程结果等外部输入时，普通 Replay 默认使用本次动作已经归档的外部输入，再在新的父状态上重新计算；不自动重新联网、重新抽签或再次触发外部写入。需要刷新外部输入时，由用户或作者流程明确发起新的执行，产生新的动作记录与 Commit。

### 9.9.3 脏楼层与部分成功

- 重放时某个 Statement 失败，记入本楼反馈与 `dirty` 状态；其他互不依赖的合法 Statement 仍可成功。
- `dirty` 表示某些原意未实现，**不一定代表 Patch 损坏**；一份已提交且哈希正确的脏楼层仍可以被正常 Restore。
- 如果连父提交链或 Patch 本身都无法验证，则标注「归档损坏/不可恢复」，与业务指令 L3 严格区分。
- 对存在冲突的下游楼层，可让用户查看原始意图和新实际结果，而不是悄悄改写聊天正文。

## 9.10 Snapshot 策略：仅 IndexedDB【V0.4 修订】

IndexedDB `snapshots` 周期保存：

```ts
interface SolveSnapshot {
  commitId: string;
  stateHash: string;
  state: SolveLogicalState;
  entityIndex?: EntityIndexEntry[];
  createdAt: number;
}
```

- 默认可按 **10～20 个实际 Commit** 创建快照，后续结合累计 Patch 体积和冷恢复耗时动态调整。这里的数字是初始参数，不是历史正确性要求。
- Snapshot 只能加快 Restore，不能成为权威历史的唯一源。
- LRU 与配额清理只能删除**可重建**的缓存，不能修改 `.jsonl`。
- 保留根部及近期/热点 Snapshot；不因清理某个快照就破坏 DAG 中有效分支的可还原性。

## 9.11 IndexedDB 集合设计【沿用并强化 NoSQL 角色】

| Object Store | 主要字段/索引 | 职责 |
|---|---|---|
| `commits` | `commitId`, `parentId`, `chatId`, `swipeId`, `stateHash`, `patch`, `inversePatch` | DAG 加速查询、历史定位、差异比较 |
| `snapshots` | `commitId`, `state`, `stateHash`, `lastUsed` | 快速 Restore |
| `active_states` | `sessionId`, `headId`, `state`, `updatedAt` | 活跃会话热状态 |
| `entity_indexes`（可选） | `sessionId`, `entityId`, `pointer` | 快速实体定位 |
| `reverse_refs`（可选） | `targetEntityId`, `sourcePointer` | 引用清理与查询 |
| `query_indexes`（可选） | 作者指定的索引键和物化查询结果 | 查询、筛选、Inspector |
| `pending_sync`（可选） | `actionId`, `expectedHeadId`, `archivePayload` | 保存失败时的本地待同步草稿 |

- IndexedDB 的可索引 Record/Object Store、事务及 Structured Clone 为 SOLVE 提供 NoSQL 式高级查询和快速存取基础。
- 这不等同于原生 MongoDB 的多文档事务、聚合管线或任意复杂 SQL 查询；高级查询能力需由 SOLVE 自己提供明确接口。
- `pending_sync` 数据不是 `.jsonl` 权威历史的一部分；若客户端被清理，最后一次**尚未成功保存聊天文件**的操作可能丢失，UI 必须如实反馈。

## 9.12 保存流程与数据权威顺序【规范】

### 模型操作完成后的保存

1. 绑定当前 `chatId/messageId/swipeId/expectedParentCommitId/generationToken`。
2. 在候选工作状态执行，计算本 Swipe 终态 Patch、反馈、Commit。
3. 把指令文本与对应 `extra.solve` 作为**同一归档版本**交给宿主保存适配器。
4. 宿主报告保存成功后，将此 Commit 标记为「归档有效」，更新 IndexedDB 缓存、活跃 HEAD 与 UI。
5. 若保存失败：保留待保存草稿，提供重试或撤回；不能仅依据 IndexedDB 更新宣称已保存。

### 用户按钮追加后的保存

1. 读取当前 Swipe 已归档的父状态和归档操作记录。
2. 为本次按钮交互分配唯一 `actionId`，追加到 `<solve_mutual_operate>` 的有序操作数组。
3. 执行当前动作并计算**从同一父 Commit 到最终状态的累计 Patch**，更新反馈和本 Swipe Commit 修订版。
4. 保存该 Swipe 的新正文与新 `extra.solve`，保存成功后替换活跃 HEAD。
5. 相同 `actionId` 的网络/保存重试只对应同一操作，不再重复执行。

**【注释】** 在宿主不能原子更新正文与 `extra` 的版本上，Adapter 应通过保存结果再读校验、变更版本标识及可重试流程降低不一致风险。无能力时必须提示兼容限制，而不能承诺「跨存储强原子」。

## 9.13 数据损坏、清缓存和分支拷贝

- **清 IndexedDB**：恢复 Genesis + 所有可达 Patch，重建索引与缓存；不依赖模型调用。
- **聊天迁移**：只要 `.jsonl` 包含 Genesis 与完整归档的历史链，在另一设备仍可 Restore。
- **角色卡升级**：旧聊天固定定义不自动替换；只读 Restore 可依赖 Patch，新的指令 Replay 要求原定义可执行。
- **手动编辑原始文本但未重放**：`opsDigest` 不匹配时标记需要 Replay，旧 Patch 仍表示旧事实，不把它误当新指令执行结果。
- **用户删除中间历史**：若下游仍依赖被删除 Commit，提示断链并提供显式重放/定基；不能凭新的楼层下标自动接上旧 Patch。
- **/branch 复制**：新聊天内已经携带的历史归档可独立恢复；IndexedDB 可通过 `commitId` 复用不可变祖先快照。新聊天后续 HEAD 与原聊天相互隔离。

---
# 第十章：作者制作体系、SolveFacet 与统一编译层

## 10.1 一份作者数据结构的六个板块【沿用 V0.3】

| 板块 | 必填 | 用途 |
|---|---|---|
| 1. Schema & Constraints | **是** | JSON 骨架、Zod 类型、默认值及上下限 |
| 2. Entity & Ref Topology | 否 | 多例/单例实体、嵌套拥有关系、引用清理规则 |
| 3. Initial / Prefabs / Templates | 否 | 开局数据、唯一预制实体池、泛用克隆模板 |
| 4. Update Guides | 否 | 给 LLM 的操作指南、模块指南、触发条件 |
| 5. Views & Visibility | 否 | `.readonly()`、`.internal()` 与自定义投影 |
| 6. Module Manifest | 否 | 模块清单、字段归属、父子模块与更新指南 |

作者没有必要理解 Commit DAG、逆向补丁、反向引用索引、`@` 视图变换或数据库存储过程。这些是 SOLVE Core 的工作。

## 10.2 四种开发程度【沿用 V0.3】

**程度 0：全部内联 Zod。** 通过 `solve.singleton()`、`solve.collection()`、`solve.ref()`、`.readonly()`、`.module()`、`.guide()` 在 Schema 定义附近完成注册。

**程度 1：按板块分离 JS。** Zod 保持纯净；通过 `solve.useEntities()`、`solve.useRefs()`、`solve.useModules()` 绑定附加能力。

**程度 2：JS 结构 + 世界书动静分离（主流推荐）。** 支持 `[SOLVE:GUIDE module=combat]`、`[SOLVE:INIT]`、`[SOLVE:PREFABS]` 等条目，作者可以用酒馆界面直接改高频设定，不必重新打包 JS。

**程度 3：多文件工程组合。** 使用 `solve.compose()` 合并大型项目模块，适用于多人协作、版本管理及正式发布。

**【V0.4 明确】** 上述方式可产生相同语义的 Compiled IR，但不承诺任意 JavaScript 闭包都能无损转换为纯 JSON。在会话建立时进行编译和必要的绑定固化；已开始的聊天不会因为作者后来更新世界书中的**结构、模板或开局初始数据**而隐式改变历史。

## 10.3 `SolveFacet` 微内核扩展接口【沿用 V0.3】

```ts
interface SolveFacet {
  id: string;
  extendZod?(schema: unknown): unknown;
  collectInlineMeta?(schema: unknown): unknown;
  registerDetached?(source: unknown): unknown;
  parseWorldInfo?(entry: unknown): unknown;
  runtimeHooks?: Partial<{
    beforeProjection(ctx: unknown): void;
    afterCompile(ctx: unknown): void;
    onStateCommitted(ctx: unknown): void;
  }>;
}
```

**【注释】** 这是接口结构示意，不意味着 V1 所有钩子都能在任意阶段读写状态。真正修改业务状态只能经过确定性执行与 Commit 通道；Facet Hook 不应绕过 Patch 归档，否则 `.jsonl` 独立恢复会被破坏。

## 10.4 `SolveCompiledIR` 统一中间表示【沿用并澄清】

```text
Zod 内联 / JS 分离 / 世界书声明 / 多文件组合 / 未来 Blueprint
                 ↓
          SolveFacet Collectors
                 ↓
           SolveCompiledIR
      ┌──────────┼───────────┬──────────────┐
      ▼          ▼           ▼              ▼
  Structural   Entity/Ref   Projection    Module/Guide
      └──────────┴───────────┴──────────────┘
                 ↓
           SOLVE Runtime
```

推荐 IR 至少有：

```ts
interface SolveCompiledIR {
  irFormatVersion: string;
  schemaHash: string;
  structure: unknown;
  entities: unknown;
  references: unknown;
  modules: unknown;
  views: unknown;
  guides: unknown;
  presets: unknown;
  runtimeBindings?: unknown; // 作者函数的固定身份、版本及依赖配置指纹，不内嵌函数闭包
}
```

- **声明式内容**尽可能形成可序列化 JSON，用于校验、编译、Inspector 和未来 Blueprint。
- Zod 自定义变换、复杂 refine、作者函数等不能天然无损转成纯 JSON；采用**固定版本的可执行定义/运行时注册表绑定函数引用**。不以纯 JSON 编译方便为由默认裁剪作者能力。
- 不要在正式 IR 中保存不可序列化的函数闭包，再宣称「所有内容均纯 JSON」。
- `schemaHash` / `compiledIrHash` 用于会话指纹校验，**不是**要加入会话 Schema Migration 系统。

### 10.4.1 作者优先开放与可恢复执行【用户确认方向与实施约定】

- **开放目标**：尽可能支持作者自定义 Zod 校验、跨字段 refine、transform/preprocess、默认值函数、Facet、视图投影、指南逻辑和 JS 扩展。作者可组合自己的业务规则，不强制仅使用框架预设的少量约束，也不要求按货币/HP 等语义分类。
- **执行定义与 JSON 状态分开**：执行定义允许包含函数及其依赖；进入 Genesis、Patch、归档输入的实际状态结果仍必须满足 JSON 数据边界。函数不能直接冒充可序列化状态。
- **固定身份与绑定**：参与编译、校验或状态计算的作者函数使用固定的定义包/注册身份、版本、构建指纹和必要依赖配置；绑定信息纳入会话定义指纹。编译器尽可能自动登记，避免要求作者逐个手写函数元数据。只保存 `function.toString()` 不等于保存了闭包捕获值或完整依赖。
- **局部校验的退路**：能确定依赖范围时使用局部校验；任意跨字段自定义规则无法可靠分析依赖时，保守校验受影响祖先或完整候选状态，不能为了性能静默跳过规则。作者可提供依赖声明帮助优化，但不作为使用自定义规则的强制负担。
- **异步扩展**：保留异步编译/校验/变换入口；检测到异步定义时必须走对应异步执行通道，不能把 Promise 写入正式状态，也不能将异步规则当作已经完成。同步 API 不支持当前定义时返回明确诊断。
- **确定性计算与外部输入**：固定入参、固定函数版本与固定外部输入下，参与 Core 的状态计算须能得到相同逻辑结果。作者可以使用时间、随机数或联网能力；这类值通过准备阶段取得并记录为动作的实际外部输入，再交给状态计算。普通 Replay 复用记录，显式新执行才刷新。
- **副作用与 Hook**：作者可扩展宿主/UI/外部服务；对 SOLVE 正式状态的修改仍通过操作提交或带来源的内部事件归档。提交后 Hook 要继续改变状态时提交新的动作，不直接改写已提交对象；Restore 不运行这些 Hook。外部通知、联网写入等副作用不因 Replay 自动重发，须使用作者扩展自己的动作身份与确认结果处理重试。
- **权限边界**：上述规则约束 SOLVE 对状态与历史提供的保证，不引入作者代码沙箱、通用 RBAC 或额外逐项授权。作者持有的宿主能力沿用酒馆生态的信任机制；脱离 SOLVE 直接改宿主或自行联网，不会因此自动获得 SOLVE 的恢复、撤销或请求拦截保证。
- 原会话固定执行定义缺失时，继续沿用只读 Patch Restore 的降级规则，不临时换成新版作者函数冒充原定义。

## 10.5 世界书解析与会话固定规则【V0.4】

- **新会话初始化**：收集 Schema、实体声明、初始数据、预制池和模板，宏替换后生成 Genesis。
- **会话进行中**：Schema/预制定义/克隆模板以开局的固定版本为准，不随着世界书外部更改自动替换已建立的会话定义。
- **更新指南**：可根据作者已编译的触发规则动态选择、注入；纯提示词内容的调整可影响后续新生成，但不会使已有已提交 Patch 自动变化。
- **Replay** 仅重新执行保留的原始操作指令，不重新发起一次 LLM 推理，因此后续指南文本调整不应改变 Restore 的事实。
- 当前固定定义无法载入时，可提供 Patch Restore 的只读状态检查，不假装可以完整重算作者自定义逻辑。

---

# 第十一章：Inspector、前端绑定、Blueprint 与 WYSIWYG

## 11.1 V1 内置 Solve Inspector【沿用 V0.3】

建议至少三个面板：

**A. Ops & Patch**

- 当前楼 / 当前 Swipe 的 `<solve_operate>`、`<solve_mutual_operate>`。
- 当前 Commit 的 `dataPatch`、`enginePatch`、`feedback`、`baseHash`、`stateHash`。
- 每条 Statement 的执行状态：成功、修正、失败、跳过及失败原因。
- 「从此楼 Replay」和「只重试本楼操作」；后一操作须提示是否有下游依赖。

**B. Active State Editor**

- 展示当前真实 JSON 状态与实体索引；支持按 Schema 展开、定位实体与查引用。
- 直接编辑状态时自动生成可归档的交互操作/内部修正事件，更新本楼累计 Patch；不能只改内存或 IndexedDB。
- 历史楼编辑必须触发后续失效/Replay 逻辑。

**C. Context Preview**

- 预览 `full` / `narrative` / `operator` / 自定义视图。
- 预览 TOON 实体 `@` 标记、关键宏、指南与反馈。
- 显示大致 Token 计数、视图大小、缓存有效状态及提交状态。

### 11.1.1 V0.4 新增：History & Storage 检查项

- 当前 `sessionId/chatId/messageId/swipeId/commitId/parentId`。
- `.jsonl` 归档是否已保存，IndexedDB 是否同步，是否存在待保存的本地草稿。
- 当前历史是否 dirty，原因是「业务操作失败」还是「Patch/Hash 损坏」。
- 冷 Restore、热 Restore、Replay 的最近耗时和快照来源。
- 提供「清除并重建 IndexedDB 缓存」以验证 `.jsonl` 独立恢复（不会删除聊天文件）。

## 11.2 运行时 UI API【沿用 V0.3】

```ts
interface SolveRuntimeApi {
  getState(): Readonly<unknown>;
  getValue(path: string): unknown;
  getProjectedState(view: string): unknown;
  subscribe(callback: (change: unknown) => void): () => void;
  toToon(opts?: unknown): string;
  getSOP(): string;
  getGuide(tag?: string): string;
  getFeedback(): string;
}
```

- `getState()` 返回当前真实业务状态的只读视图或安全拷贝，不能暴露未经追踪的可写引用，否则前端可绕过 Patch 直接修改。
- 交互按钮调用 SOLVE 操作提交 API，而不是让前端直接修改 `getState()` 的返回对象。
- `subscribe` 在已确认更新或明确标记为乐观候选的状态变更后触发；UI 应能区分是否已经成功归档。

## 11.3 V1.5：可视化蓝图工作台【沿用 V0.3】

- 基于 `SolveBlueprint.json` 可导出 `SolveCompiledIR`。
- 提供 Object / Record / Array / Singleton / Collection 节点画布；实体引用以连线表达。
- 模块图层色标，可切换预览某模块休眠后的投影结构。
- Schema-to-Form 编辑器，方便填写 InitialData、Prefab 和 Template。
- 图形化产出的语义必须与 JS/世界书声明形式一致，不能为可视化单独实现第二套运行引擎。

## 11.4 V2.0：WYSIWYG 状态栏与交互构建器【沿用 V0.3】

- **结构绑定层**：Flex/Grid、条件显示、防剧透遮罩、Entity Repeater、`subscribe` 数据绑定。
- **内置组件库**：动态进度条、实体引用胶囊、背包网格、模块开关、Action Button。
- **主题层**：奇幻羊皮纸、赛博霓虹、简洁玻璃等主题；高级作者可使用 Headless 模式自行写 HTML/CSS。
- **零代码动作**：按钮模板支持 `$self` 与 `$valueOf`，点击后提交给 SOLVE Core；动作原文归档到当前 Swipe `<solve_mutual_operate>`，结果合并到累计 Patch。

---

# 第十二章：系统架构、接口分层与开发阶段

## 12.1 总体逻辑架构【V0.4】

```text
                   SillyTavern 宿主 / 酒馆助手
       ┌───────────────────┬──────────────────────┐
       │ 消息 / Swipe 事件 │ 连接预设、宏、展示层  │
       └────────┬──────────┴───────────┬──────────┘
                ▼                      ▼
         ┌─────────────────────────────────────┐
         │ Host Adapters + Session Runtime     │
         │ • Card-First Handshake              │
         │ • 当前会话/消息/Swipe 身份与去重      │
         │ • Prompt / Display 过滤             │
         └──────────────────┬──────────────────┘
                            ▼
         ┌─────────────────────────────────────┐
         │       Command / Event Intake        │
         │ LLM JSON 算子、UI 动作、模块事件      │
         └──────────────────┬──────────────────┘
                            ▼
         ┌─────────────────────────────────────┐
         │            SOLVE Core               │
         │ Compiled IR + Zod + 五阶段流水线     │
         │ 十个算子 + $valueOf + 局部失败隔离  │
         │ Entity Index + Reverse Ref + Modules│
         └──────────────────┬──────────────────┘
                            ▼
         ┌─────────────────────────────────────┐
         │        Commit / Archive Layer       │
         │ 最终 dataPatch + enginePatch         │
         │ Feedback + Commit Hash / ID         │
         │ 聊天归档保存确认 → 正式 HEAD          │
         └────────────┬───────────┬────────────┘
                      │           │
                      ▼           ▼
         ┌─────────────────┐ ┌──────────────────────┐
         │ .jsonl 权威历史  │ │ IndexedDB 派生数据库  │
         │ Genesis          │ │ Commit DAG / Snapshot│
         │ 两个指令块       │ │ 正逆 Patch / 索引     │
         │ Patch / Feedback │ │ 活跃状态 / 查询缓存   │
         │ Commit           │ │ 可全部删除并重建     │
         └─────────────────┘ └──────────────────────┘
                      │           │
                      └─────┬─────┘
                            ▼
         ┌─────────────────────────────────────┐
         │           Read / Output             │
         │ Restore / Replay / Context Views    │
         │ @ 实体标记 → TOON → LLM 上下文        │
         │ Inspector / Reactive UI / 宏        │
         └─────────────────────────────────────┘
```

## 12.2 核心 API 拆分【建议实现】

```ts
interface SolveCore {
  compile(source: SolveDefinition): SolveCompiledIR;

  // 纯候选执行：不接触外部 I/O、聊天保存和 IndexedDB
  execute(
    operations: SolveOperationBatch,
    state: SolveLogicalState,
    context: SolveExecutionContext
  ): SolveExecutionResult;

  // 异步作者定义通道；外部 I/O 先在准备阶段记录为显式输入
  compileAsync(source: SolveDefinition): Promise<SolveCompiledIR>;
  executeAsync(
    operations: SolveOperationBatch,
    state: SolveLogicalState,
    context: SolveExecutionContext
  ): Promise<SolveExecutionResult>;

  // 在 parentId / baseHash 匹配前提下，组装最终增量档案
  buildCommit(
    parentState: SolveLogicalState,
    resultState: SolveLogicalState,
    metadata: SolveExecutionMetadata
  ): SolveCommitDraft;

  // 状态恢复：仅依赖 Genesis、已执行增量和历史链
  restore(archive: SolveArchive, targetCommitId: string): SolveLogicalState;

  // 指令重放：解析原始模型/用户操作并生成新归档
  replay(archive: SolveArchive, fromCommitId: string): SolveReplayResult;

  // 面向 LLM 的视图：只读投影，再编码 TOON 或紧凑 JSON
  project(state: SolveLogicalState, view: SolveViewConfig): JsonValue;
  toToon(projected: JsonValue): string;
}
```

**【注释】** `execute()` 与 `restore()` 最好保持独立于宿主 I/O；保存动作由 Archive Coordinator 处理，而不是把 `saveChat()` 混进算子实现。这样以后可以直接在测试进程、Node 环境或蓝图预览器里运行 SOLVE Core。

## 12.3 适配器边界

- `HostAdapter`：宿主消息、Swipe、Prompt/Display、宏及保存。
- `SchemaCompiler`：Zod/Facet/世界书配置 → 固定 IR。
- `PathResolver`：普通路径、`@ID`、`$self`、JSON Pointer 转换。
- `OperationPlanner`：五阶段排序、Statement 分解与冲突判断。
- `ExecutionEngine`：候选状态、Schema 校验、原子性和反馈。
- `EntityGraph`：实体拥有关系、双向索引、级联删除。
- `ArchiveCoordinator`：操作块 + Patch + Commit + 反馈的持久化版本协调。
- `HistoryStore`：基于 `.jsonl` 的 Restore 与基于指令的 Replay。
- `IndexedDbCache`：Snapshot、正逆 Patch、DAG、查询索引。
- `ProjectionEngine`：模块过滤、视图规则、`@` 标记和 TOON。
- `InspectorAdapter`：调试、预览和显式重放操作。

**【注释】** 这些是逻辑模块，不代表一定要拆成 11 个 NPM 包或 11 个进程。初版可以是同一 JS 代码仓库的不同文件夹/模块，以低复杂度为先。

## 12.4 开发阶段（Milestones）【V0.4 调整】

### M0：规范冻结与最小测试夹具

- 先在 SillyTavern 1.19.0 单聊 + 当次官方最新版酒馆助手验证保存确认、Swipe 归属、原生/助手生成入口及请求开关的覆盖范围；记录具体版本，群聊不进入执行流程。
- 固定作者函数绑定、异步执行与外部输入归档契约；验证任意跨字段规则的保守校验路线。
- 固定操作/路径/引用/实体 `@` 标记语义。
- 固定 Genesis / 每 Swipe `extra.solve` / `dataPatch` / `enginePatch` 数据契约。
- 固定 Restore 与 Replay 两套算法及测试用例。
- 创建脱离 SillyTavern 的纯 TS/JS 测试运行器。

**完成条件**：两个开发者用相同指令、起始状态、固定作者执行定义及已归档外部输入能生成同一逻辑结果；每条已定义边界都有测试；关键宿主入口已有可验证的能力清单。

### M1：纯 SOLVE Core 与 LLM 视图

- Compiled IR、Zod、基本 5 算子、`$valueOf`、五阶段计划器。
- 五个高级算子、实体容器、拥有关系、引用索引、Prefab/Template。
- 模块有效遮罩与惰性水合。
- `full/operator/narrative`、实体 `@` 投影、TOON、主要宏文本生成。

**完成条件**：无宿主环境即可执行十一个算子（含 `$group`），验证状态一致性与 TOON 的实体标记。

### M2：`.jsonl` 权威历史与 IndexedDB

- Genesis、每 Swipe Patch/反馈/Commit 的序列化。
- IndexedDB Commit DAG、Snapshot、逆向 Patch 与缓存索引。
- Restore 不调用算子；Replay 重跑指令并生成新 Patch。
- ID 映射、Hash 校验、跨分支 HEAD、缓存清理和重建。

**完成条件**：清空 IndexedDB，能仅通过 `.jsonl` 对每个保留 Swipe 恢复相同 `stateHash`。

### M3：SillyTavern 双模式集成

- In-Band 指令提取、jsonrepair 与渲染/提示词隐藏。
- Out-of-Band 模型请求、Profile 接入、超时重试与旧请求作废。
- 忙碌期间请求开关、原生/助手/已接入插件的请求准入、允许并发时的 SOLVE 串行任务及状态写入队列。
- `<solve_mutual_operate>` 交互序列、保存确认、动作幂等。
- Card-First、三种分发构建及多标签页基本防重。

**完成条件**：真实聊天的 Swipe、重生、编辑、删楼、/branch、交互按钮操作不会串档。

### M4：作者体验与 V1.0

- 世界书动静分离 `[SOLVE:...]`、Facet 与所有六板块作者 API。
- Inspector 三基础面板 + 历史保存/恢复状态检查。
- 多角色卡/多引擎版本、性能与兼容回归测试。

**完成条件**：普通作者不理解 DAG/事务/索引也能编写 Schema 和指南使用；关键数据恢复测试通过，发布 V1.0。

### M5：V1.5 ～ V2.0 可视化演进

- `SolveBlueprint.json` → IR 图形化工作台。
- 全类型节点、实体关系连线、模块色标与 Schema-to-Form。
- WYSIWYG 状态栏/交互构建器、Widget Kit、主题与 Headless 模式。
- 复杂查询索引与触发器另行评估；`$group` 已纳入后端实施。

---
# 第十三章：性能指标、异常测试、验收与发布条件

## 13.1 性能优化原则【V0.4】

1. 不为每条普通状态操作做全量 JSON 深拷贝；优先使用按受影响子树的候选变更与结构共享。
2. Zod 采用子树局部校验，并对影响的实体/引用做增量验证；必要时可触发全量验证作为调试/恢复检查。
3. IndexedDB 使用 Snapshot + Patch DAG 加速跨 Swipe Restore；并缓存实体索引与常用投影视图。
4. `.jsonl` 每 Swipe 存一份累计 Patch，不重复写完整 Active State（Genesis 例外）。
5. 提示词采用字段裁剪后的 TOON 或紧凑 JSON，避免向模型重复投喂原始全部 JSON。
6. 异步数据库读写和耗时的历史冷恢复应避免长期阻塞 UI 主线程；必要时使用工作线程（视发布载体兼容性而定）。
7. IndexedDB 维护缓存淘汰策略，不因缓存配额问题阻断有完整 `.jsonl` 权威记录的 Restore。

**【注释】** V0.3 所写的「0.05 毫秒」「小于 2 毫秒」「0.2 秒」等属于未经基准验证的目标示例，V0.4 不把这些数字当产品保证。TOON 50%～65% Token 节约同理。

## 13.2 最低性能测试矩阵

| 数据档位 | 业务 JSON 状态 | 实体数（示例） | 主要测试 |
|---|---:|---:|---|
| S | 10 KB | 50 | 基础角色卡交互、语义正确 |
| M | 100 KB | 500 | 常规中大型角色卡 |
| L | 1 MB | 5,000 | Patch 累积、实体索引、冷 Restore |
| XL | 5 MB | 20,000 | 退化极限、浏览器配额及大分支 |

测量：每次 Statement 的 P50/P95/P99 执行时间；候选执行/保存确认的延迟；IndexedDB 读取与 Snapshot 生成耗时；冷/热 Restore；100、1,000、5,000 楼情况下的 `.jsonl` 大小；TOON 前后 token 量；内存峰值；UI 卡顿；不同浏览器环境的配额行为。

**【边界】** Patch 不总比完整状态小：一次性更换大数组、大对象或大规模级联销毁时，单楼 Patch 可能很大。不能宣称「每楼 Patch 必定只有几十字节」。该优化的目标是避免**每楼重复完整状态**，而不是无条件保证常数空间。

## 13.3 必须通过的正确性测试（核心）

| 测试编号 | 场景 | 预期结果 |
|---|---|---|
| C-01 | Zod `.min(0)` 字段扣为负数 | `$inc` Clamp 至零，L1，Patch 记录最终值 |
| C-02 | `$set` 固定对象部分字段 | 深合并保留未提及字段 |
| C-03 | `$set` 新实体 | 自动升级 `$createEntity`，登记索引、补默认值 |
| C-04 | `$unset` 实体 | 完整升级 `$deleteEntity`，清理引用 |
| C-05 | 父实体含三层嵌套子实体 | 自底向上删除，索引/外部引用正确 |
| C-06 | 拥有子树外部 `restrict` 引用 | 整个被限制的目标删除失败，无部分销毁 |
| C-07 | `$transfer` 源不足 | 不改变源与所有目的地 |
| C-08 | `$transfer` 目的地越界 | 整笔失败，不凭空损失或创造数值 |
| C-09 | `$set` + `$inc` 同一字段 | 按固定阶段顺序得出确定结果 |
| C-10 | `$valueOf` 引用休眠字段 | 拒绝当前 Statement，其他无关操作继续 |
| C-11 | 动态 Key 净化碰撞 | 拒绝冲突，不覆盖已有 Key |
| C-12 | 同批多实体重名 | 稳定改名，后续别名不覆盖旧实体 |
| C-13 | 删除实体后反向索引检查 | 不剩悬空引用（声明允许的策略内） |
| C-14 | 更新引用数组 | 去重正确、反向索引同步 |
| C-15 | 普通 `settings.alice` | TOON 不添加 `@` |
| C-16 | 实体 `characters.alice` | TOON 自动显示 `"@alice"`，内部 Key 不变 |
| C-17 | 多种作者编译形式 | 同一语义产生等价的 IR / 执行结果 |
| C-18 | 作者跨字段自定义校验/变换 | 必要时扩大校验范围，约束不被局部校验绕过 |
| C-19 | 作者异步校验/变换 | 等待执行完成再提交，异常不泄漏半完成状态 |
| C-20 | 原定义与同名新版作者函数不同 | 指纹可区分，不静默替换旧会话绑定 |

## 13.4 必须通过的历史测试（关键）

| 编号 | 场景 | 通过条件 |
|---|---|---|
| H-01 | 清空整个 IndexedDB | 仅凭 `.jsonl` 还原每个保留的历史 Commit，Hash 一致 |
| H-02 | Restore 1000 楼 | 不调用算子，不调用 LLM，仅应用已保存 Patch |
| H-03 | 同一楼层 3 个 Swipe | 每 Swipe 正文、Patch、反馈、Commit 一一对应 |
| H-04 | 切换历史 Swipe | 不把旧下游 Patch 强接到新父状态 |
| H-05 | 当前末楼连续三次点击按钮 | 三个动作按序归档，保存一份累计 Patch，恢复结果正确 |
| H-06 | 保存失败后重试同一个 `actionId` | 实际逻辑动作只执行一次 |
| H-07 | 交互按钮合法连点两次 | 两个不同 `actionId` 各执行一次 |
| H-08 | Out-of-Band 旧请求迟到 | 不写到已经切走的聊天/Swipe |
| H-09 | 修改第 N 楼原始操作后 Replay | 新 Patch 与新 Commit，旧结果可识别，不冒用旧 Hash |
| H-10 | Replay 部分操作失败 | 保留合法结果、L3 与 dirty，最终 Patch 本身仍可 Restore |
| H-11 | 删除父 Commit | 检测断链，不默默当作旧 PATCH 合法 |
| H-12 | `/branch` 创建新聊天 | 新聊天可独立 Restore，IndexedDB 可共享不可变祖先缓存 |
| H-13 | `opsDigest` 与 Patch 不符 | 标记需要 Replay，不静默覆盖历史 |
| H-14 | 随机抽删 IndexedDB Snapshot | 可退回 Genesis + Patch 找到相同状态 |
| H-15 | Greeting Swipe A/B 初始不同 | 每条对应 Genesis 链恢复到各自的起始状态 |
| H-16 | 模块关闭期间创建实体后开启 | Lazy Hydration 生成数据 Patch，并可从 `.jsonl` 恢复 |
| H-17 | 作者使用已归档时间/随机/远程输入 | 清缓存 Restore 不调用作者函数；普通 Replay 复用原外部输入 |
| H-18 | 请求开关关闭，玩家/已适配插件请求 | 模型请求发送前明确拒绝，SOLVE 自身任务可继续，未适配入口如实标示 |
| H-19 | 请求开关开启，连续生成并交互 | 额外请求可发出；SOLVE 同聊天同步任务串行，按有效父链提交不覆盖 |
| H-20 | 忙碌期间超时/失败/切聊天/切设置 | 只释放本任务占用，待保存事实不被误标成功，不串聊天 |
| H-21 | 群聊触发或依赖更新 | 群聊不执行；版本与验证状态明确，不冒充兼容通过 |

## 13.5 故障注入与兼容性测试

- 浏览器在候选执行后、聊天保存前关闭。
- 浏览器在聊天保存后、IndexedDB 写入前关闭。
- IndexedDB 配额不足、读写事务回滚、数据被清理。
- 宿主保存回调返回失败，或旧保存请求晚于新保存完成。
- 两个 SOLVE 实例同时处理 `GENERATION_ENDED`。
- Out-of-Band 模型请求重复返回或多次重试。
- 多标签页同开一个聊天、切聊天瞬间完成请求。
- 忙碌期间来自发送按钮、原生生成 API、助手 generate/generateRaw 和插件独立联网入口的覆盖差异；逐个验证拒绝时机，不以观察事件替代实际拦截验证。
- 开关允许请求但助手仍自动禁用发送按钮；任务失败或热重载后遗留忙碌占用。
- SillyTavern 新旧消息格式、Swipe 存储行为不一致。
- `jsonrepair` 修复后产生看似合法却被 Schema 禁止的路径。
- 大型 JSON Patch、数组 `remove` 的索引变化、RFC 6901 特殊转义。
- ID 前缀 `@`、非法点号 Key、引用字典键、空/可空 Singleton。

## 13.6 正确性不变量（适合自动化测试）

**I-1：保存事实可恢复**

对任意成功归档到 `.jsonl` 的 Commit `C`：

```text
Hash(Restore(JsonlArchive, C)) == C.stateHash
```

**I-2：缓存不是权威**

```text
Restore(withIndexedDB) == Restore(afterDeleteAllIndexedDB)
```

**I-3：已归档历史 Restore 不执行算子**

```text
count(OperationExecutor.execute during Restore) == 0
```

**I-4：索引可重建**

```text
RebuildEntityIndex(Restore(C)) == CachedEntityIndex(C)
RebuildReverseRefs(Restore(C)) == CachedReverseRefs(C)
```

**I-5：Patch 依赖父状态**

```text
Hash(parentState) == child.baseHash
Hash(Apply(parentState, child.dataPatch, child.enginePatch)) == child.stateHash
```

**I-6：单高级算子原子性**

任何高级原子 Statement 失败后，业务 JSON、模块状态及实体/引用索引都与执行前保持一致。

**I-7：有意保留的局部失败**

同批一个独立 Statement 失败，不强制撤销其他已验证并成功的 Statement。

**I-8：LLM 披露与真实数据严格分离**

```text
ProjectEntityKeys(data, IR) 可能含 "@alice"
StoredJSONKey(data) 仍为 "alice"
```

## 13.7 V1.0 发布阻断条件

存在以下任意问题时不建议发布为稳定 V1.0：

1. 清空 IndexedDB 无法 Restore `.jsonl` 中任意被保留的合法历史链。
2. 同一个 Swipe 的操作块与 `extra.solve` 存在已知不一致路径，却仍被标记为成功归档。
3. `$deleteEntity` 可留下不符合注册规则的悬空引用/孤儿索引。
4. `$move`、`$swap`、`$transfer` 的单次原子操作可能部分生效。
5. Swipe 切换、重新生成或旧异步请求会把状态写到错误分支。
6. 模块关闭再开启导致先前合法状态不可恢复。
7. 大小写/Key 净化/`@` 路径处理导致实体身份错误或数据静默覆盖。
8. 无法区分「历史业务指令失败」与「权威 Patch/Hash 数据损坏」。

---

# 第十四章：实现示例、边界问答与升级备忘录

## 14.1 一个完整回合如何执行【示例】

**初始 Genesis S₀**

```json
{
  "characters": {
    "alice": { "name": "艾莉丝", "hp": 100, "maxHp": 100 },
    "bob": { "name": "鲍勃", "hp": 80, "maxHp": 100 }
  }
}
```

**输入给 LLM 的 TOON（实体自动标记）**

```toon
characters[2:]{name,hp,maxHp}:
  "@alice": 艾莉丝,100,100
  "@bob": 鲍勃,80,100
```

**模型输出的操作 JSON**

```xml
<solve_operate>
{"$inc":{"@alice.hp":-15}}
</solve_operate>
```

**执行后的真实 JSON**

```json
{
  "characters": {
    "alice": { "name": "艾莉丝", "hp": 85, "maxHp": 100 },
    "bob": { "name": "鲍勃", "hp": 80, "maxHp": 100 }
  }
}
```

**归档的 `dataPatch`**

```json
[
  {
    "op": "replace",
    "path": "/characters/alice/hp",
    "value": 85
  }
]
```

**Restore**：Genesis + 上述 Patch → HP 85；不会重新执行 `$inc`。**Replay**：若将原始指令改为 `-25`，在相同父状态上执行会得到 HP 75、新 Patch、新 Commit。

## 14.2 玩家在同一 Swipe 喝两次药水【示例】

假设该 Swipe 模型操作后 HP=60，每瓶恢复 20，Zod 最大 100。

```xml
<solve_mutual_operate>
[
  {"$inc":{"@alice.hp":20}},
  {"$inc":{"@alice.hp":20}}
]
</solve_mutual_operate>
```

此 Swipe 的**累计** Patch 应反映从父 Commit 开始，模型操作加两次玩家交互后的**最终状态**，例如 HP 从父值 100 经过模型受伤和两次治疗后回到 100；如果其他字段未变，一份累计 Patch 可能是空数组。**空 Patch 并不意味着本楼没有操作意图**，两段指令块及操作哈希仍然应保存，以便今后 Replay。

**【注释】** 若累计净变化为零，此楼可以生成 `dataPatch: []`，但 Commit 仍可以因操作历史、反馈或内部模块变化而不同；不能简单因为 Patch 为空就删除 Commit。

## 14.3 原子高级算子与局部失败【示例】

```json
{
  "$transfer": {
    "@alice.hp": { "@bob.hp": 20 }
  },
  "$set": {
    "world.weather": "rain"
  }
}
```

如果 Alice HP 不足导致 `$transfer` 不满足 Schema 下限，转移整笔失败；不影响独立的天气 `$set` 成功。这既保持指令级容错，也确保转移操作内部没有「Alice 没扣，Bob 加了」的损坏状态。

## 14.4 旧存档 V0.3 与新设计的关系

V0.3 是企划版本，而非已经保证存在的大量生产存档格式。因此本节首先是**将来若有旧实验存档时的兼容策略**，并不代表需要现在开发完整 Schema Migration 系统。

- 若旧实验 `.jsonl` 只保存 `{commitId,parentId,stateHash}`，而真实 Patch 只在 IndexedDB，**只带 `.jsonl` 无法无损补出那些旧历史事实**。
- 若旧 IndexedDB 仍可用，可以一次性导出旧 Commit Patch、Genesis 和必要消解信息，填入新的聊天归档结构。
- 若旧 DB 已删除且聊天中只有原始操作指令，可以尝试按对应旧版引擎执行 Replay，但**不能保证与旧实际状态逐项相同**；需明确标记为「重算恢复」而非确定性 Restore。
- V0.4 新会话不需要运行中 Schema Migration；将来升级归档字段格式可做独立的**Archive Format Upgrade**，不等价于作者 Schema 迁移。

## 14.5 给作者的简明规则（可用于用户文档）

1. 用 Zod 定义你需要的状态字段、类型、默认值与范围。
2. 想让对象具有稳定身份，就把它注册为 Singleton 或 Collection Entity；多例实体放到字典里。
3. 想让某个字段引用实体，就用 `solve.ref()`；不要期望 SOLVE 猜字符串含义。
4. 可以为游戏增加模块、更新指南、初始数据、预制角色和模板，不必自己管理历史数据库。
5. LLM 会在披露上下文中看到 `@alice`，但你实际存储的 Key 仍然是 `alice`。
6. 无须区分数字是不是金币/HP；Schema 边界与对应算子负责确定性处理。
7. 角色卡开局后 Schema 固定；修改结构适用于新会话。已有聊天通过自己的 Genesis 和 Patch 恢复历史。
8. 点击按钮或调试器修改状态，SOLVE 会将指令和实际增量归档到当前 Swipe。

## 14.6 需要在实现前验证的具体宿主事项

| 项目 | 最小验证内容 | 不通过的应对 |
|---|---|---|
| 首版宿主范围 | 酒馆 1.19.x 单聊，记录实际测试版本与助手官方最新版 | 群聊不执行；其他版本不冒充已验证 |
| 请求开关 | 原生入口、助手 generate/generateRaw、已接入插件能否在发送前拒绝；放行时按钮是否可用 | 公布覆盖清单；未覆盖入口明确限制，不能承诺全插件拦截 |
| Swipe 存储 | `mes/extra/swipes/swipe_info` 是否能够一一保存映射 | 在 HostAdapter 内维护映射，不允许 Core 猜 |
| 消息保存 | 是否可确认聊天文件成功写入 | 无确认则保留 Pending 与重试提示 |
| Prompt Hook | 能否过滤操作块而不改正文 | 适配现有 prompt 组装机制 |
| Display Hook | 目标发行版是否提供稳定消息渲染 Hook | 采用扩展适配或兼容降级，而非依赖未正式接口 |
| Connection Profile | 能否不切全局配置发独立请求 | 根据实际可用宿主服务封装；不可用则独立配置 |
| 原生宏 | 是否支持同步自定义宏注册与参数 | 缓存可同步访问的当前状态，必要时使用兼容 API |
| 新聊天与 `/branch` | Genesis、消息正文、Swipe 元数据是否完整复制 | 检测并提示缺失，不伪造可迁移历史 |

## 14.7 规范来源与参考资料

**直接继承的产品范围与术语**：用户提供的《SOLVE 项目完整企划案 V0.3》（2026-10-16），尤其原第二章至第十二章的三种分发、六板块 Facet、十算子、模块休眠、双工作模式、TOON、Inspector 与 V2 工作台。

**V0.4 决策来源**：后续需求澄清所确定的 `.jsonl` 独立历史、单会话固定 Schema、`@` 自动实体披露、IndexedDB 派生 NoSQL 能力及「Restore 不等于 Replay」。

**外部协议与宿主参考（实施时仍应以目标版本实际行为为准）**：

- [TOON 官方规范 SPEC.md](https://github.com/toon-format/spec/blob/main/SPEC.md)：键值表格编码、对象 Key 引号规则、同构字段条件。
- [RFC 6902：JSON Patch](https://www.rfc-editor.org/rfc/rfc6902)：`add/remove/replace/move/copy/test` 等 Patch 语义。
- [RFC 6901：JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901)：Patch 的路径表示及转义。
- [SillyTavern UI Extensions 官方文档](https://docs.sillytavern.app/for-contributors/writing-extensions/)：原生扩展、聊天元数据、宏与宿主集成的说明。
- [酒馆助手官方 manifest](https://github.com/N0VI028/JS-Slash-Runner/blob/main/manifest.json)：2026-10-21 核对主分支版本为 4.11.3；发布时重新核对。
- [酒馆助手生成实现](https://github.com/N0VI028/JS-Slash-Runner/blob/main/src/function/generate/index.ts)：区分请求事件、任务身份及取消时机；事件出现不自动证明可阻止发包。
- [SillyTavern 1.19.0 扩展实现](https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/extensions.js)：原生生成拦截器的流程；仍须按实际调用路径验证覆盖范围。
- [MongoDB Atomicity & Transactions](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/)：用作「单操作原子性」与「多操作事务」的概念类比，**SOLVE 不依赖 MongoDB**。

---

# 附录 A：关键术语对照

| 术语 | 含义 |
|---|---|
| **Schema** | 会话初始化时确定的作者数据结构及约束 |
| **Compiled IR** | 将作者各种声明汇总的固定运行时中间表示 |
| **Entity** | 通过 Schema 声明、拥有会话级稳定 ID 的对象 |
| **Entity Index** | 实体 ID → 真实 JSON Pointer 的可重建索引 |
| **Reverse Reference Index** | 被引用实体 ID → 各引用位置的可重建索引 |
| **Ownership** | 嵌套实体的生命周期拥有关系，不同于 `solve.ref()` |
| **`@ID`** | 面向 LLM/算子/宏的实体寻址语法；`@` 不进入真实 JSON Key |
| **Genesis** | `.jsonl` 中单次会话/开场版本的初始完整逻辑状态 |
| **Patch** | 已执行后的状态事实增量，标准业务路径采用 RFC 6902 JSON Patch |
| **Raw Ops** | 模型或 UI 最初提出的操作指令/事件，用于 Replay |
| **Commit** | 绑定父提交、操作指纹、实际结果和状态哈希的历史版本 |
| **Snapshot** | 某个 Commit 的完整状态缓存，V0.4 仅在 IndexedDB 周期保存 |
| **Restore** | Genesis/Snapshot + 已保存 Patch → 历史有效状态，不跑算子 |
| **Replay** | 原始操作指令 + 新父状态 → 重新执行并生成新结果 |
| **Dirty Floor** | 重算后某些原始 Statement 失败但合法部分已提交的楼层 |
| **TOON** | 提供给 LLM 阅读的状态上下文编码，不是操作指令格式 |
| **Module Hibernation** | 模块关闭但原始业务数据保留，披露和操作暂时遮罩 |
| **Lazy Hydration** | 模块启用时根据固定 Schema 的默认值补齐缺失数据 |

# 附录 B：V0.4 实施检查清单

- [ ] 记录首版酒馆 1.19.x 单聊及官方当前最新版助手的实际兼容测试版本，群聊不执行。
- [ ] 固定作者开放扩展的函数绑定、异步通道与外部输入归档规则。
- [ ] 明确会话固定 `schemaHash`、`compiledIrHash` 和初始 Genesis。
- [ ] 完成普通路径、`@ID`、`$self`、JSON Pointer 的解析/转换单元测试。
- [ ] 让 TOON 仅对 Schema 实体节点自动标记 `@`，不污染真实 JSON。
- [ ] 保持十个原算子、`$group` 及五阶段管线，确定同阶段顺序与 Statement 原子边界。
- [ ] 确认 `$transfer` 守恒校验、Key 净化碰撞拒绝、引用索引一致性。
- [ ] 给每个 Swipe 归档两段原始操作块及一份累计 `dataPatch`/`enginePatch`。
- [ ] 给每个 Swipe 归档 Commit（父 ID、基础/结果哈希、指令指纹）和反馈。
- [ ] 完成可在 IndexedDB 完全空白状态下运作的 `.jsonl` Restore。
- [ ] Restore 不调用算子；Replay 重跑算子并生成新 Patch/Commit。
- [ ] IndexedDB Snapshot、逆 Patch、Entity Index、Reverse Ref 均可重建。
- [ ] 实现动作 ID 去重、旧 LLM 请求作废、保存确认与 Pending UI。
- [ ] 验证忙碌期间请求开关的开/关行为、真实拦截覆盖及放行后的串行状态提交。
- [ ] 验证 SillyTavern 的 Swipe 数据、聊天保存、宏与渲染 API 兼容。
- [ ] 完成核心正确性/历史恢复/故障注入测试后再标记稳定 V1.0。

---

> **V0.4 最终架构宣言**  
> **LLM 负责提出意图；SOLVE Core 负责执行与纠错；`.jsonl` 负责永久记录仍保留的历史事实；IndexedDB 负责高性能索引、快照与 NoSQL 查询；TOON 负责让 LLM 用尽量少的上下文读懂当前状态。**  
> **从已提交 Patch 恢复历史，从原始指令重新计算历史，二者永不混淆。**
