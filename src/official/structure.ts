import type { FieldNode, StructureDescription } from '../structure.js';
import type { ActionSpec } from '../interact.js';

/**
 * SOLVE official data structure (player-facing). Spec: docs/official-structure.md.
 * Keys are English; labels and enum values are Chinese.
 */
const text = (label: string, extra: Partial<FieldNode> = {}): FieldNode => ({ type: 'string', label, ...extra });
/** Player-editable on their own character (the player's mind is theirs to write). */
const mine = { owner: 'user' as const };
const goals = (spoiler?: FieldNode['spoiler']): FieldNode => ({ type: 'object', label: '目标', ...(spoiler ? { spoiler } : {}), fields: { long: text('远期', { edit: mine }), short: text('近期', { edit: mine }) } });
const attribute = (label: string, node: Partial<FieldNode>): FieldNode => ({ type: 'int', label, nullable: true, ...node } as FieldNode);
const ladder = (label: string, values: string[]): FieldNode => ({ type: 'ladder', label, values, nullable: true });
const FATE = ['F', 'F+', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S', 'S+', 'EX'];
const FU = ['弱', '普通', '优秀', '卓越'];
const wod = (label: string): FieldNode => attribute(label, { min: 0, computed: [{ label: '超凡', formula: 'wodTranscend' }] });
const dnd = (label: string): FieldNode => attribute(label, { min: 0, max: 30, computed: [{ label: '调整', formula: 'dndModifier' }] });
const fate = (label: string): FieldNode => ladder(label, FATE);
const fu = (label: string): FieldNode => ladder(label, FU);
/**
 * Media link (image / music): shown by the status bar, kept out of both model views (it is not the model's to write).
 * Pictures come in pairs — `thumb` (avatars; may carry a `#xywh=percent:x,y,w,h` crop) and `image` (立绘 / full view);
 * either one stands in for the other.
 */
const media = (label: string, as: 'image' | 'bgm'): FieldNode => ({ type: 'string', label, optional: true, as, readonly: true, internal: true });
/** A numeric gauge; wherever it is used, a natural-language description is accepted too. */
const gauge = (): FieldNode => ({ type: 'object', fields: { value: { type: 'number', label: '当前' }, max: { type: 'number', label: '上限', min: 0, default: 100 } } });

export const OFFICIAL_LISTS = {
  tags: { max: 10, warn: 8 }, labels: { max: 6, warn: 5 }, promises: { max: 8, warn: 6 }, plan: { max: 8, warn: 6 }, events: { max: 12, warn: 9 },
} as const;

/**
 * What the player can do with an item they hold (status bar). Ordinary SOLVE operations with placeholders;
 * the engine validates them like any write, and `narrate` tells the model on the next turn. Spec: src/interact.ts.
 */
const ITEM_ACTIONS: Record<string, ActionSpec> = {
  equip: { label: ['装备', '卸下'], toggle: 'equipped', owner: 'user', when: { type: '装备', count: { gt: 0 } }, narrate: ['{holder}装备了{name}', '{holder}卸下了{name}'] },
  use: { label: '使用', owner: 'user', when: { type: '消耗', count: { gt: 0 } }, narrate: '{holder}使用了{name}',
    ops: [{ $if: { count: { gt: 1 } }, then: [{ $inc: { '{self}.count': -1 } }], else: [
      { $if: { stored: { empty: true } }, then: [{ $unset: '{self}' }], else: [{ $set: { '{self}.count': 0 } }] }] }] },
  give: { label: '交给…', owner: 'user', when: { count: { gt: 0 } }, narrate: '{holder}把{name}×{n}交给了{to.name}',
    ask: { to: { label: '交给谁', pick: 'characters', within: 'meta.present', not: '{holderId}' },
      n: { label: '数量', number: { min: 1, max: '{count}', default: 1 }, when: { count: { gt: 1 }, unique: { ne: true } } } },
    ops: [
      { $if: { unique: true }, then: [{ $move: { '{self}': 'characters.{to}.items.{id}' } }], else: [
        { $transfer: { '{self}.count': { 'characters.{to}.items.{id}.count': '{n}' } } },
        { $if: { count: { lte: '{n}' }, stored: { empty: true } }, then: [{ $unset: '{self}' }] },
      ] },
    ] },
  // Storage: into a building the holder owns, or one that takes deposits from anyone (a bank, a rented warehouse).
  deposit: { label: '存入…', owner: 'user', module: 'buildings', when: { count: { gt: 0 } }, narrate: '{holder}把{name}×{n}存进了{at.name}',
    ask: { at: { label: '存到哪里', pick: 'buildings', filter: [{ owner: '{holderId}' }, { vault: true }] },
      n: { label: '数量', number: { min: 1, max: '{count}', default: '{count}' }, when: { count: { gt: 1 } } } },
    ops: [
      { $transfer: { '{self}.count': { '{self}.stored.{at}': '{n}' } } },
      { $if: { count: { lte: '{n}' }, equipped: true }, then: [{ $set: { '{self}.equipped': false } }] },
    ] },
  withdraw: { label: '取出…', owner: 'user', module: 'buildings', when: { stored: { empty: false } }, narrate: '{holder}从{from.name}取出了{name}×{n}',
    ask: { from: { label: '从哪里取', pick: '{self}.stored' },
      n: { label: '数量', number: { min: 1, max: '{from.value}', default: '{from.value}' } } },
    ops: [
      { $transfer: { '{self}.stored.{from}': { '{self}.count': '{n}' } } },
      { $if: { '@{self}.stored.{from}': { lte: '{n}' } }, then: [{ $unset: '{self}.stored.{from}' }] },
    ] },
  drop: { label: '丢弃', owner: 'user', tone: 'danger', when: { count: { gt: 0 } }, confirm: '丢弃身上的{name}？', narrate: '{holder}丢弃了{name}',
    ops: [{ $if: { stored: { empty: true } }, then: [{ $unset: '{self}' }], else: [{ $set: { '{self}.count': 0, '{self}.equipped': false } }] }] },
};
/** Abilities: the player declares what their character does; the model narrates the outcome and moves 熟练度 / 等级. */
const ABILITY_ACTIONS: Record<string, ActionSpec> = {
  use: { label: '使用', owner: 'user', when: { kind: '技能' }, ops: [], narrate: '{holder}使用{name}：{how}',
    ask: { how: { label: '怎么用、对谁用', text: { placeholder: '例如：对门口的狂信徒使用', optional: true } } } },
  train: { label: '锻炼', owner: 'user', ops: [], narrate: '{holder}花时间锻炼{name}：{how}',
    ask: { how: { label: '怎么锻炼', text: { placeholder: '例如：在后院对着木桩练习一下午', optional: true } } } },
  develop: { label: '开发', owner: 'user', ops: [], narrate: '{holder}尝试开发{name}的新用法：{idea}',
    ask: { idea: { label: '想开发什么', text: { placeholder: '例如：把盾击和冲锋结合起来' } } } },
};
/** Lore the player wrote can be taken back by the player. */
const LORE_ACTIONS: Record<string, ActionSpec> = {
  retract: { label: '撤回', when: { source: '玩家' }, tone: 'danger', confirm: '撤回设定「{title}」？', narrate: '玩家撤回了设定「{title}」，此后不再成立',
    ops: [{ $deleteEntity: ['@{id}'] }] },
};
/** Player-written lore stays editable by the player; each change is told to the model. */
const playerLore = { when: { source: '玩家' }, narrate: '玩家修改了设定「{title}」的{label}：{value}' };
/** Moving the party: the current location follows the player's choice on the map. */
const PLACE_ACTIONS: Record<string, ActionSpec> = {
  go: { label: '前往这里', when: { '@meta.location': { ne: '{id}' }, discovered: { ne: false } }, narrate: '{user}前往{name}',
    ops: [{ $set: { 'meta.location': '{id}' } }] },
};

const character: FieldNode = {
  type: 'object', label: '角色',
  fields: {
    name: text('姓名', { required: true }),
    alias: text('别称', { optional: true }),
    thumb: media('缩略图', 'image'),
    image: media('立绘', 'image'),
    role: { type: 'enum', label: '定位', values: ['用户角色', '核心角色', '主要配角', '次要配角', '一次性敌人'], default: '次要配角',
      hint: '玩家扮演的角色是「用户角色」；只出场一次的敌人用「一次性敌人」，事件结束后删除；会反复出场的反派按分量归入配角。路人与龙套不建' },
    // Which prefab / template this character was spawned from (by $from); the codex lists them under it.
    origin: text('原型', { optional: true, hint: '用 $from 以预制实体或模板为底新建时，写来源的 ID' }),
    age: text('年龄'),
    intro: text('简介', { as: 'paragraph', edit: mine, hint: '一两句：身份、来历、性格' }),
    tags: { type: 'array', label: '身份', of: { type: 'string' }, list: OFFICIAL_LISTS.tags, as: 'tags', hint: '职业、头衔、种族等短标签' },
    appearance: text('外貌', { as: 'paragraph', edit: mine, hint: '外貌与穿着' }),
    condition: text('当前状态', { hint: '此刻的身体与精神状况，一句话，如「左臂流血，惊魂未定」' }),
    drive: {
      type: 'object', label: '驱动力', module: 'drive', fields: {
        goals: goals('spoiler'),
        thoughts: text('想法', { spoiler: 'spoiler', edit: mine, hint: '此刻在想什么' }),
        plan: { type: 'array', label: '规划', spoiler: 'spoiler', list: OFFICIAL_LISTS.plan, as: 'checklist', edit: mine, hint: '接下来打算做的事；完成后 done 设为 true 或移除',
          of: { type: 'object', fields: { text: text('内容', { required: true }),
            done: { type: 'bool', label: '完成', edit: { owner: 'user', narrate: ['{holder}完成了规划：{text}', '{holder}的规划「{text}」重新标为未完成'] } } } } },
      },
    },
    // Spoilers: what one can see from outside stays public (好感度, equipped gear); the rest is folded until clicked.
    relations: {
      type: 'record', label: '社交', module: 'social', keys: 'character', spoiler: 'spoiler', hint: '本角色对对方的单向看法，键是对方的角色 ID',
      of: {
        type: 'object', fields: {
          affection: { type: 'int', label: '好感度', min: -100, max: 100, maxDelta: 10, as: 'meter-center', spoiler: 'public' },
          labels: { type: 'array', label: '关系', of: { type: 'string' }, list: OFFICIAL_LISTS.labels, as: 'tags', hint: '如 青梅竹马、雇主、宿敌' },
          impression: text('印象', { hint: '对对方的看法，一句话' }),
          promises: { type: 'array', label: '约定', of: { type: 'string' }, list: OFFICIAL_LISTS.promises, hint: '双方之间未了结的约定' },
          keyEvents: { type: 'array', label: '关键事件', stamp: true, list: OFFICIAL_LISTS.events, as: 'timeline' },
        },
      },
    },
    rp: {
      type: 'object', label: '角色扮演', module: 'rp', fields: {
        rank: text('位阶', { hint: '依世界观推断的实力层级，如 见习骑士、筑基期' }),
        attributes: {
          type: 'object', label: '属性', module: 'rp_attributes', fields: {
            dnd: { type: 'object', label: 'DND', module: 'attr_dnd',
              sections: [{ label: '身体', keys: ['str', 'dex', 'con'] }, { label: '心智', keys: ['int', 'wis', 'cha'] }], fields: {
              str: dnd('力量'), dex: dnd('敏捷'), con: dnd('体质'), int: dnd('智力'), wis: dnd('感知'), cha: dnd('魅力') } },
            wod: { type: 'object', label: 'WOD', module: 'attr_wod',
              sections: [{ label: '身体', keys: ['str', 'dex', 'sta'] }, { label: '心智', keys: ['int', 'wits', 'res'] }, { label: '社交', keys: ['pre', 'man', 'com'] }], fields: {
              str: wod('力量'), dex: wod('敏捷'), sta: wod('耐力'),
              int: wod('智力'), wits: wod('感知'), res: wod('决心'),
              pre: wod('风度'), man: wod('操控'), com: wod('沉着') } },
            fate: { type: 'object', label: 'FATE', module: 'attr_fate', fields: {
              physique: fate('体格'), athletics: fate('运动'), melee: fate('近战'), shoot: fate('射击'),
              notice: fate('察觉'), empathy: fate('共情'), rapport: fate('交际'), deceive: fate('欺诈'), provoke: fate('挑衅'), contacts: fate('人脉'),
              investigate: fate('调查'), lore: fate('学识'), crafts: fate('工艺'), burglary: fate('盗窃'), stealth: fate('潜行'), drive: fate('驾驶'),
              resources: fate('财富'), will: fate('意志') } },
            fu: { type: 'object', label: 'FU', module: 'attr_fu', fields: {
              might: fu('力量'), dex: fu('敏捷'), insight: fu('洞察'), will: fu('意志') } },
          },
        },
        special: { type: 'record', label: '特殊属性', module: 'rp_attributes', hint: '世界观特有的属性（如 魔力、灵根），键是属性名', of: { type: 'oneOf', variants: [{ type: 'string' }, { type: 'number' }, gauge()] } },
        // Abilities live once in the root `abilities`; a character only references them (with its own level).
        abilities: { type: 'record', label: '能力', module: 'rp_abilities', keys: 'ability', as: 'abilities', actions: ABILITY_ACTIONS, spoiler: 'spoiler',
          of: { type: 'object', fields: {
            level: { type: 'int', label: '等级', min: 0, optional: true, hint: '按 abilities 里该能力 levels 中不超过此等级的最高一级生效' },
            // Practice toward the next level (0–100); reaching 100 raises the level and starts again.
            progress: { type: 'int', label: '熟练度', min: 0, max: 100, optional: true, module: 'scale_num', hint: '锻炼、实战会增长；满 100 时等级加一并从 0 重新累计' },
            progressText: text('熟练度', { optional: true, module: 'scale_text', hint: '一句描述，如「已经能在实战里稳定用出来」' }),
          } } },
        // Two exclusive ways to keep gauges (and ability 熟练度): numbers, or a sentence that fits the story better.
        gauges: { type: 'record', label: '量表', module: ['rp_status', 'scale_num'], as: 'meters', of: gauge(), hint: '键是量表名，名称与数量依世界观决定（如 生命、体力、理智）' },
        gaugesText: { type: 'record', label: '量表', module: ['rp_status', 'scale_text'], as: 'meters', of: { type: 'string' }, hint: '键是量表名，值是一句描述（如 生命：「伤口在渗血，勉强能走」）' },
        effects: { type: 'record', label: '效果', module: 'rp_status', as: 'chips', hint: '身上的增益、减益、伤病，键是效果名；剧情上结束后移除',
          of: { type: 'object', fields: { desc: text('描述'), source: text('来源', { optional: true }), until: text('持续到', { optional: true, hint: '结束条件，如「下次长休」' }) } } },
      },
    },
    // Items live once in the root `items`; a character only references them (with its own count / equipped).
    // Unique items (unique: true) have one holder: giving one to someone takes it from its previous holder.
    // Money is an item of type 货币 (金币, 银两 …): counted, given and deposited like anything else.
    items: { type: 'record', label: '物品', module: 'assets', keys: 'item', uniqueBy: 'unique', as: 'inventory', actions: ITEM_ACTIONS, hint: '持有的物品，键是根节点 items 里的物品 ID，只写本人的数量与状态',
      spoiler: 'spoiler', reveal: { equipped: true },
      of: { type: 'object', fields: {
        count: { type: 'int', label: '数量', min: 0, default: 1, hint: '随身携带的数量' },
        equipped: { type: 'bool', label: '已装备' },
        // Amounts kept in buildings (keyed by building ID); `count` is what the character carries.
        stored: { type: 'record', label: '存放', module: 'buildings', keys: 'building', optional: true, of: { type: 'int', min: 0 }, hint: '存在建筑里的数量，键是建筑 ID；取空的条目删除' },
        note: text('备注', { optional: true, hint: '说不清数额时写一句描述，如「一小袋碎银」' }),
      } } },
    nsfw: {
      type: 'object', label: 'NSFW', module: 'nsfw', fields: {
        libido: text('性欲'), experience: text('性经验'),
        kinks: { type: 'array', label: '性癖', of: { type: 'string' }, list: OFFICIAL_LISTS.tags, as: 'tags' },
        latentKinks: { type: 'array', label: '潜在性癖', of: { type: 'string' }, list: OFFICIAL_LISTS.tags, spoiler: 'hidden', as: 'tags' },
        arousal: { type: 'int', label: '当前情欲', min: 0, max: 200 },
        parts: { type: 'record', label: '部位', of: { type: 'object', fields: {
          development: { type: 'int', label: '开发度', min: 0, max: 100, as: 'stage' },
          sensitivity: { type: 'enum', label: '敏感度', values: ['迟钝', '普通', '敏感', '弱点'], default: '普通' },
          state: text('状态'),
        } } },
      },
    },
  },
};

export const officialStructure: StructureDescription = {
  id: 'solve-official', version: '1.0.0-draft.1', label: 'SOLVE 官方数据结构',
  round: 'meta.round',
  fields: {
    meta: {
      type: 'object', label: '当前状态', fields: {
        round: { type: 'int', label: '轮次', min: 0 },
        time: { type: 'object', label: '时间', as: 'datetime', hint: '推进时间时用 $set 整体写入；clock 格式 HH:MM', fields: {
          era: text('纪元'), year: { type: 'int', label: '年' }, month: { type: 'int', label: '月', min: 1, default: 1 },
          day: { type: 'int', label: '日', min: 1, default: 1 }, clock: text('时分', { default: '08:00' }) } },
        location: { type: 'ref', label: '地点', to: 'place', nullable: true, hint: '主角所在的地点' },
        weather: { type: 'enum', label: '天气', values: ['晴', '雨', '阴', '雪', '雾', '大风', '雷暴', '暴雨', '沙暴', '瘴气', '异象'] },
        present: { type: 'refs', label: '在场角色', to: 'character', hint: '当前场景里的角色（含用户角色），登场离场时更新' },
        mood: { type: 'enum', label: '场景情绪', values: ['日常', '紧张', '战斗', '悲伤', '浪漫', '神秘', '欢快', '恐怖'], hint: '决定背景音乐' },
      },
    },
    characters: { type: 'record', label: '角色', entity: 'character', of: character, hint: '有名有姓、会再出场的角色，包括用户角色' },
    places: {
      type: 'record', label: '地点', entity: 'place', actions: PLACE_ACTIONS, hint: '去过或听说过的地点与区域',
      of: { type: 'object', fields: {
        name: text('地点名', { required: true }),
        kind: { type: 'enum', label: '类别', values: ['区域', '地点'], default: '地点' },
        parent: { type: 'ref', label: '所属区域', to: 'place', nullable: true, hint: '上一级区域（区域 → 地点）' },
        links: { type: 'refs', label: '相连', to: 'place', module: 'map', hint: '能直接走到的地点' },
        desc: text('描述'),
        truth: text('真实描述', { optional: true, spoiler: 'hidden', hint: '真相，玩家看不到；与表面描述一致时不写' }),
        discovered: { type: 'bool', label: '已发现', default: true, module: 'map' },
        thumb: media('缩略图', 'image'),
        image: media('背景图', 'image'),
        bgm: media('背景音乐', 'bgm'),
      } },
    },
    items: {
      type: 'record', label: '物品', entity: 'item', module: 'assets', hint: '物品本体，每种只建一次；谁持有记在角色的 items 下',
      of: { type: 'object', fields: {
        name: text('物品名', { required: true }),
        type: { type: 'enum', label: '类型', values: ['装备', '道具', '消耗', '货币', '关键', '杂物', '座驾'], default: '杂物', hint: '钱也是物品，类型为「货币」，每个币种一个物品' },
        unique: { type: 'bool', label: '独一无二', hint: '世上只有一件（具名武器、信物、钥匙、座驾）时为 true，同一时间只能在一个角色名下；制式装备、药剂、货币不设' },
        thumb: media('缩略图', 'image'),
        image: media('图片', 'image'),
        desc: text('描述'),
        truth: text('真实描述', { optional: true, spoiler: 'hidden', hint: '真相，玩家看不到；与表面描述一致时不写' }),
        condition: text('状态', { optional: true }),
      } },
    },
    abilities: {
      type: 'record', label: '能力', entity: 'ability', module: 'rp_abilities', hint: '能力本体，每种只建一次；谁会记在角色的 rp.abilities 下，多人共有同一能力时引用同一个 ID',
      of: { type: 'object', fields: {
        name: text('能力名', { required: true }),
        kind: { type: 'enum', label: '类别', values: ['特质', '技能'], default: '技能' },
        desc: text('描述'),
        // Effect per level, keyed by the level number ("1", "2" …; gaps allowed). A holder at level n gets the highest key ≤ n.
        levels: { type: 'record', label: '等级效果', of: { type: 'string' }, as: 'levels', hint: '键是等级数字（"1"、"3"，可以跳级），值是该级效果，每级要有实际差别' },
        truth: text('真实描述', { optional: true, spoiler: 'hidden', hint: '真相，玩家看不到；与表面描述一致时不写' }),
      } },
    },
    // Lore established during play (the card author's fixed setting stays in the world book): rules, history,
    // secrets, foreshadowing, rumours (not the plot's progress itself). The model sees every entry; the player sees what 主角 knows.
    lore: {
      type: 'record', label: '设定', entity: 'lore', module: 'lore', list: { max: 40, warn: 32 },
      hint: '剧情中确立的世界观、历史、规则、秘密、伏笔与传闻（剧情进展本身不算；世界书里已有的不必重复）',
      spoiler: 'spoiler', reveal: { known: true }, actions: LORE_ACTIONS,
      create: { label: '写一条设定', fields: ['title', 'kind', 'content'], set: { source: '玩家', known: true },
        narrate: '玩家确立了设定「{title}」（{kind}）：{content}' },
      of: { type: 'object', fields: {
        title: text('标题', { required: true, edit: playerLore }),
        kind: { type: 'enum', label: '类别', values: ['世界观', '历史', '规则', '秘密', '伏笔', '传闻'], default: '世界观', edit: playerLore },
        content: text('内容', { as: 'paragraph', edit: playerLore, hint: '一两句' }),
        truth: text('真相', { optional: true, spoiler: 'hidden', hint: '玩家看不到' }),
        known: { type: 'bool', label: '主角已知', default: true, hint: '主角还不知道时为 false，揭晓后改为 true' },
        stage: { type: 'enum', label: '伏笔进度', values: ['已埋下', '推进中', '已回收'], nullable: true, default: null, hint: '只用于伏笔，其他类别留 null；埋下的伏笔要记得回收' },
        related: { type: 'refs', label: '相关', to: ['character', 'place', 'faction', 'item', 'building'] },
        source: { type: 'enum', label: '来源', values: ['剧情', '玩家'], default: '剧情', hint: '「玩家」的条目是玩家亲自确立的，必须遵守，不要改写或删除' },
      } },
    },
    // Buildings: homes and shops one owns, and places that keep things for anyone (banks, rented warehouses).
    buildings: {
      type: 'record', label: '建筑', entity: 'building', module: 'buildings', hint: '住宅、商铺、银行、仓库等',
      of: { type: 'object', fields: {
        name: text('名称', { required: true }),
        kind: { type: 'enum', label: '类别', values: ['住宅', '商铺', '银行', '仓库', '据点', '其他'], default: '住宅' },
        owner: { type: 'ref', label: '产权人', to: ['character', 'faction'], nullable: true },
        place: { type: 'ref', label: '位置', to: 'place', nullable: true },
        vault: { type: 'bool', label: '可寄存', optional: true, hint: '任何人都能寄存（银行、出租仓库）时为 true' },
        thumb: media('缩略图', 'image'),
        image: media('图片', 'image'),
        desc: text('描述'), truth: text('真实描述', { optional: true, spoiler: 'hidden', hint: '真相，玩家看不到；与表面描述一致时不写' }),
        developments: { type: 'record', label: '建设', of: { type: 'string' } },
      } },
    },
    factions: {
      type: 'record', label: '势力', entity: 'faction', module: 'factions', hint: '只为有分量的组织建实体',
      of: { type: 'object', fields: {
        name: text('势力名', { required: true }), alias: text('别称', { optional: true }),
        thumb: media('徽记', 'image'), image: media('图片', 'image'),
        tier: { type: 'enum', label: '定位', values: ['霸主统治', '核心大派', '地方霸权', '隐秘结社', '小型流派'], default: '小型流派' },
        leader: { type: 'ref', label: '领袖', to: 'character', nullable: true },
        intro: text('概括', { as: 'paragraph' }),
        base: { type: 'ref', label: '根据地', to: 'place', nullable: true },
        territory: { type: 'refs', label: '势力范围', to: 'place' },
        goals: goals('spoiler'),
        plan: { type: 'array', label: '规划', of: { type: 'string' }, list: OFFICIAL_LISTS.plan, spoiler: 'spoiler' },
        reputation: { type: 'record', label: '声望', keys: 'character', spoiler: 'spoiler', of: { type: 'object', fields: {
          value: { type: 'int', label: '声望值', min: -100, max: 100, maxDelta: 10, as: 'meter-center', spoiler: 'public' },
          title: text('称号', { spoiler: 'public' }),
          keyEvents: { type: 'array', label: '关键事件', stamp: true, list: OFFICIAL_LISTS.events, as: 'timeline' },
        } } },
        diplomacy: { type: 'record', label: '外交', keys: 'faction', spoiler: 'spoiler', of: { type: 'object', fields: {
          stance: { type: 'enum', label: '关系', values: ['盟友', '敌对', '冷淡中立', '臣服依附'], default: '冷淡中立', spoiler: 'public' },
          moves: text('动向', { spoiler: 'spoiler' }),
        } } },
      } },
    },
  },
  // Module guides keep only the rules that span several fields; what each field means is its `hint`.
  modules: {
    drive: { label: '驱动力', guide: '驱动力：剧情推进后及时更新角色的目标、想法与规划。' },
    social: { label: '社交', guide: '社交：两人之间的看法各自记在自己的 relations 下，互不影响。' },
    rp: { label: '角色扮演' },
    rp_attributes: { label: '属性', parent: 'rp', guide: '属性：只填写当前开启的属性体系；该角色没有的属性填 null（例如亡灵没有体质）。' },
    attr_dnd: { label: 'DND', parent: 'rp_attributes', exclusive: 'attributes' },
    attr_wod: { label: 'WOD', parent: 'rp_attributes', exclusive: 'attributes', enabled: false, guide: 'WOD：每超过 5 点获得 1 点超凡（由引擎计算，不要写入）。' },
    attr_fate: { label: 'FATE', parent: 'rp_attributes', exclusive: 'attributes', enabled: false },
    attr_fu: { label: 'FU', parent: 'rp_attributes', exclusive: 'attributes', enabled: false },
    rp_abilities: { label: '能力', parent: 'rp', guide: '能力：新能力先在 abilities 建实体，再加到角色的 rp.abilities 下。玩家说要「开发」能力时，依剧情决定成果：为该能力补充更高等级的效果，或新建一个衍生能力。' },
    rp_status: { label: '状态', parent: 'rp' },
    scale_num: { label: '数值', parent: 'rp', exclusive: 'scales' },
    scale_text: { label: '描述', parent: 'rp', exclusive: 'scales', enabled: false, guide: '量表与熟练度用一句描述，随剧情改写，不写数字。' },
    assets: { label: '资产', guide: '资产：新物品先在 items 建实体，再加到持有者的 items 下。付钱、交易用 $transfer 在双方的 count 之间转移（对方还没有时自动新建），保证总数守恒。独一无二的物品转手时直接加到新持有者名下，引擎自动从原持有者处移除（也可以用 $move）。' },
    nsfw: { label: 'NSFW', enabled: false },
    map: { label: '地图', guide: '地图：新发现的地点建实体并设 discovered: true；移动时更新 meta.location。' },
    lore: { label: '设定', guide: '设定：新剧情与已有设定矛盾时修改原条目，不要另建一条。' },
    buildings: { label: '建筑', enabled: false, guide: '建筑：物品存进建筑时用 $transfer 从持有者的 count 转到 items.<物品ID>.stored.<建筑ID>，取出反过来。' },
    factions: { label: '势力', enabled: false },
  },
  groups: { attributes: { label: '属性体系' }, scales: { label: '量表与熟练度' } },
  guide: [
    '实体 ID 用简短英文或拼音，全局唯一（角色、物品、能力、地点、势力之间也不能重名）。',
    '开局或新场景：先用 $createEntity 建出登场的角色（包括用户角色）和所在地点，再在后面的操作对象里写 meta.location、meta.present 等引用它们的字段。',
    '有预制实体或模板时优先使用：预制实体以它自己的 ID 登场；需要以它为基础另做一个独立角色时用 $from，并把 origin 写成来源的 ID。',
    '清单类条目有上限；收到整理提示时先合并或删除旧条目。',
  ].join('\n'),
  projection: [
    { kind: 'present', collection: 'characters', list: 'meta.present', keep: ['name', 'alias', 'role', 'intro', 'tags', 'condition'], always: { field: 'role', equals: '用户角色' } },
    { kind: 'related', path: 'characters.*.relations', collection: 'characters', list: 'meta.present', always: { field: 'role', equals: '用户角色' } },
    { kind: 'related', path: 'factions.*.reputation', collection: 'characters', list: 'meta.present', always: { field: 'role', equals: '用户角色' } },
    { kind: 'referenced', collection: 'items', from: ['characters.*.items'], keep: ['name', 'type'] },
    { kind: 'referenced', collection: 'abilities', from: ['characters.*.rp.abilities'], keep: ['name', 'kind'] },
    { kind: 'neighborhood', collection: 'places', current: 'meta.location', parent: 'parent', links: 'links', keep: ['name', 'kind', 'parent'] },
  ],
  bgm: { mood: 'meta.mood', location: 'meta.location', places: 'places', field: 'bgm', parent: 'parent', library: [] },
  display: {
    // The player's own character is never hidden behind spoilers.
    spoilerExempt: { collection: 'characters', field: 'role', equals: '用户角色' },
    // Floating overview bar (also the panel title once expanded).
    // Time, place and weather are always shown; gauges are world-specific and stay in the panel.
    bar: ['meta.location', 'meta.time', 'meta.weather', 'meta.mood', 'meta.present'],
    layout: [
      { tab: '角色', items: [{
        sheet: 'characters', id: '$user', subtitle: 'alias', badges: ['rp.rank', 'role'], tags: 'tags',
        vitals: ['rp.gauges', 'rp.gaugesText'], status: 'condition', effects: 'rp.effects', currency: 'items', currencyType: '货币',
        pages: [
          { label: '属性', paths: ['rp.attributes', 'rp.special'] },
          { label: '能力', paths: ['rp.abilities'] },
          { label: '背包', paths: ['items'], as: 'inventory' },
          { label: '任务', paths: ['drive'], as: 'quests' },
          { label: '档案', paths: ['age', 'intro', 'appearance', 'nsfw'] },
        ],
      }] },
      { tab: '社交', items: [
        { graph: 'characters', module: 'social', title: '关系图', edges: 'relations', weight: 'affection', label: 'labels', present: 'meta.present', size: 'role', badges: ['role'],
          legend: { positive: '友好', neutral: '一般', negative: '敌意' } },
        { list: 'characters', title: '人物', exclude: '$user', present: 'meta.present', order: 'role', badges: ['role'], score: 'relations.$user.affection', scoreLabel: '♥', search: true,
          backrefs: [{ collection: 'lore', field: 'related', label: '相关设定' }],
          // An NPC card reads in layers: the overview (under the picture on wide screens; the first page on phones),
          // then motives, ties, abilities, belongings. What is not visible from outside sits behind spoilers.
          aside: { label: '概况', paths: ['relations.$user.affection', 'condition', 'age', 'tags', 'intro', 'appearance'] },
          pages: [
            { label: '动机', paths: ['drive'], as: 'quests' },
            { label: '关系', paths: ['relations'] },
            { label: '能力', paths: ['rp.rank', 'rp.gauges', 'rp.gaugesText', 'rp.effects', 'rp.attributes', 'rp.special', 'rp.abilities'] },
            { label: '物品', paths: ['items'], as: 'inventory' },
            { label: '私密', paths: ['nsfw'] },
          ] },
      ] },
      { tab: '地图', items: [{ map: 'places', current: 'meta.location', backrefs: [{ collection: 'lore', field: 'related', label: '相关设定' }] }] },
      // Codex: every item and ability instance in one place, with who holds it.
      { tab: '图鉴', items: [{ codex: [
        // Prefabs and templates of type character: a bestiary of ready-made NPCs, with who was spawned from each.
        { prefabs: 'character', into: 'characters', label: '角色', origin: 'origin', badges: ['role'],
          pages: [
            { label: '概况', paths: ['condition', 'age', 'tags', 'intro', 'appearance'] },
            { label: '能力', paths: ['rp.rank', 'rp.gauges', 'rp.gaugesText', 'rp.effects', 'rp.attributes', 'rp.special', 'rp.abilities'] },
            { label: '物品', paths: ['items'], as: 'inventory' },
          ] },
        { collection: 'items', label: '物品', group: 'type', holders: ['characters.*.items'] },
        { collection: 'abilities', label: '能力', group: 'kind', holders: ['characters.*.rp.abilities'] },
      ] }] },
      { tab: '势力', module: 'factions', items: [
        { graph: 'factions', title: '势力关系图', edges: 'diplomacy', tone: 'stance', label: 'stance', size: 'tier', badges: ['tier'],
          tones: { 盟友: 'positive', 敌对: 'negative', 冷淡中立: 'neutral', 臣服依附: 'info' }, legend: { positive: '盟友', negative: '敌对', neutral: '中立', info: '依附' } },
        { list: 'factions', title: '势力', order: 'tier', badges: ['tier'], score: 'reputation.$user.value', scoreLabel: '声望', search: true,
          backrefs: [{ collection: 'lore', field: 'related', label: '相关设定' }],
          aside: { label: '概况', paths: ['reputation.$user.value', 'reputation.$user.title', 'leader', 'base', 'territory', 'intro'] },
          pages: [
            { label: '目标', paths: ['goals', 'plan'], as: 'quests' },
            { label: '声望', paths: ['reputation'] },
            { label: '外交', paths: ['diplomacy'] },
          ] },
      ] },
      { tab: '设定', module: 'lore', items: [{ list: 'lore', title: '设定', group: 'kind', badges: ['kind', 'stage', 'source'], hide: ['known'], search: true }] },
      { tab: '建筑', module: 'buildings', items: [{ list: 'buildings', title: '建筑', group: 'kind', badges: ['kind'], stored: { holders: 'characters.*.items', field: 'stored' } }] },
    ],
  },
  initialData: {},
};
