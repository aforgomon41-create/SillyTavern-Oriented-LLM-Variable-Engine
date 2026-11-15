# 配图生成：调研与方案草案

状态：调研完成，方案待确认，未实现。日期 2026-11-15。

## 一、需求

- 配图大多不是作者预制，而是游玩中调用生图功能得到的。
- 操作 LLM 在建实体、或外观 / 场景变化时，写一段生图用的 tags；SOLVE 拿它去生图，并支持更换图片。
- SOLVE 管理这些图片的全生命周期：生成、存放、引用、更换、回退、清理。
- 不自带生图后端，而是调用玩家已经装好的生图插件。

## 二、常见生图插件与可调用的接口

| 插件 | 后端 | 能否被其他插件调用 | 调用方式 | 返回 |
| --- | --- | --- | --- | --- |
| 酒馆自带「图像生成」（Image Generation） | A1111/Forge、ComfyUI、NovelAI、OpenAI、Pollinations、Horde 等十多种 | **能**（官方斜杠命令） | `SillyTavern.getContext().executeSlashCommandsWithOptions('/imagine quiet=true gallery=false <prompt>')`；`negative=` 追加负面提示 | `pipe` 是服务器上的图片路径（`/user/images/…png`）；未配置时返回空字符串 |
| 小白X（LittleWhiteBox）画图模块 | NovelAI、SD WebUI、ComfyUI | **能**（作者公开的接口，有文档 `docs/media-api.html`） | `window.xiaobaixDraw.generate({ prompt, signal, onProgress, params })`；`getStatus()` 返回 `{ provider, enabled, ready }` | `{ images: Blob[] }` |
| 智绘姬（st-chatu8，damoshen123 及众多分支） | SD、NovelAI、ComfyUI、Banana/OpenAI 兼容 | **能，但属内部事件**（未写进文档） | 在酒馆的 `eventSource` 上 `emit('generate-image-request', { id, prompt, width?, height?, negative_prompt? })`，监听 `'generate-image-response'` | `{ id, success, imageData, error }`，`imageData` 多为 `data:image/png;base64,…` |
| st-image-hub | OpenAI 兼容图片接口 | 能（`window.ST_IMAGE_HUB_API`，v1） | `generate({ prompt })`，同一时间只接一个任务 | 新生成的图片记录 |
| Auto Illustrator、st-image-auto-generation、云绘、喵喵文生图等 | 多数复用酒馆自带的 `/sd`，或自带单一后端 | 没有公开接口 | 只认回复正文里的标签（`<pic prompt="…">`、`image###…###`、`<yunhui>…</yunhui>` 等） | 图片插进聊天楼层 |

结论：

1. **酒馆自带的 `/imagine` 是首选**。所有装了酒馆的人都有；绝大多数「自动生图」插件本身也是靠它出图；玩家在里面配好的后端、画风前缀、负面提示都会自动带上。
2. **小白X** 有正式公开的接口，返回 Blob，可以作为第二个适配器。
3. **智绘姬** 用户多，但接口是内部事件，作者随时可能改，标为「实验」。
4. 只认正文标签的插件不适合给状态栏配图（图会插进聊天楼层，而不是交给 SOLVE），不接。

## 三、实机验证（本机测试酒馆 1.19，电脑 1440 / 手机 390）

脚本：`scripts/live-imagegen-probe.mjs`，生图后端用 `scripts/fake-a1111.mjs` 模拟（A1111 接口，返回按提示词着色的小图）。两种宽度都是 9/9：

- 酒馆上下文提供 `executeSlashCommandsWithOptions`，`/imagine` 已注册。
- `/imagine quiet=true gallery=false` 返回图片路径，提示词原样送到后端（酒馆还会自动加上玩家配置的画风前缀和负面提示）。
- `quiet=true` 不往聊天里插消息。
- 图片存在服务器上，可直接作为 `<img src>`。
- `/api/images/delete` 可删除。
- 其他插件返回的 base64 图片可以经 `/api/images/upload` 存到 `user/images/solve-assets/`，能列出、能删除。
- 生图未配置时返回空字符串，SOLVE 可据此提示玩家去配置。

注意到的问题：

- 酒馆的「图像生成」扩展加载较慢（测试环境约 15 秒后 `/imagine` 才注册），调用前要检查命令是否已就绪，未就绪时排队等待，不能在启动时一次性判断。
- `gallery=false` 时图片放在 `user/images/` 根目录，无法按目录列出；SOLVE 应在拿到图片后再复制到自己的子目录（或改用 `gallery=true` 存到角色目录后再整理）。

## 四、方案草案

### 4.1 数据结构

- **给模型写的**：有图的实体（角色、地点、物品、势力、建筑）加一个可写字段 `imagePrompt`（文字，提示「画面 tags，英文逗号分隔」）。模型在新建实体、或外观 / 服装 / 场景发生明显变化时写它；`imagePrompt` 变了即视为「需要新图」。
  - 角色另有固定外貌 tags 时，可在设置里让 SOLVE 把角色的外貌 tags 拼在场景 tags 前面，保持同一角色前后一致。
  - 提示词风格（Danbooru tags / 自然语言）随玩家选择的后端在「数据结构」里切换说明。
- **引擎写的**：`thumb` / `image` 维持现状（模型不可写、不进提示词），由生图结果写入，作为一次系统操作记入历史。因此 Swipe、重新生成、回退时，图片随历史一起切换，不会错位。

### 4.2 资产库

每个聊天一份资产清单（存在 SOLVE 的聊天元数据里）：

```
assetId → { path, entity, field, prompt, promptHash, backend, createdRound, status: pending|ready|failed, bytes }
```

- 图片文件统一放在 `user/images/solve-assets/<聊天ID>/`。
- 同一实体同一 `promptHash` 只生成一次：Swipe 回到旧版本、重放历史时直接复用，不重复花钱。
- 每张图记下由哪条提示词、哪个后端生成，状态栏里可以查看。

### 4.3 生命周期

1. **触发**：一轮提交完成后，扫描本轮新建实体、或 `imagePrompt` 变化的实体，进入生图队列（不阻塞回复；同时最多 N 个，可在设置里调）。可选「先确认再生成」。
2. **生成**：按设置里选的适配器调用（自动检测：酒馆自带 → 小白X → 智绘姬），带上超时与取消。
3. **存放**：拿到路径或 base64，存进 `solve-assets/<聊天ID>/`，登记资产。
4. **引用**：以系统操作写入实体的 `thumb` / `image`，记入历史。
5. **更换**：状态栏里实体图片旁边加「重新生成」「改提示词后生成」「从历史版本里选」「上传本地图片」；每次更换都是一条可撤销的玩家操作。
6. **清理**：实体被删除、或某张图已不被任何分支 / Swipe 引用时，标为孤儿；在设置里显示占用空间，一键清理孤儿图片；删除聊天时提示是否一并删除它的图片。

### 4.4 需要你决定的事

1. 首批接哪些适配器：建议「酒馆自带」+「小白X」，智绘姬作为实验选项。
2. 生图触发方式：自动、先确认，还是只在玩家点按钮时生成。
3. 提示词由操作 LLM 在操作块里写（省一次请求，但占操作块篇幅），还是生图前单独请求一次（像 Auto Illustrator 那样，质量更好但多一次调用）。
4. 一轮最多生成几张，以及默认给哪些实体配图（建议：角色头像 / 立绘、地点背景；物品默认关）。

## 五、参考

- 酒馆自带图像生成：`public/scripts/extensions/stable-diffusion/index.js`（`/imagine` 命令，`quiet`、`gallery`、`negative` 参数）；`/api/images/upload|list|delete`（`src/endpoints/images.js`）。
- 小白X：https://github.com/RT15548/LittleWhiteBox （`plugin-entry.js` 中的 `window.xiaobaixDraw`；文档 `docs/media-api.html`）。
- 智绘姬：https://github.com/damoshen123/st-chatu8 （`EventType.GENERATE_IMAGE_REQUEST/RESPONSE`）。
- st-image-hub：https://github.com/Etsuya233/st-image-hub
- st-image-auto-generation：https://github.com/wickedcode01/st-image-auto-generation
- Auto Illustrator：https://github.com/gamer-mitsuha/sillytavern-auto-illustrator
