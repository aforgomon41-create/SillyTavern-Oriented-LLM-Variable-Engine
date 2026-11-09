import type { FieldNode, StructureDescription } from '../structure.js';

/**
 * SOLVE official data structure (player-facing). Spec: docs/official-structure.md.
 * Keys are English; labels and enum values are Chinese.
 */
const text = (label: string, extra: Partial<FieldNode> = {}): FieldNode => ({ type: 'string', label, ...extra });
const goals = (spoiler?: FieldNode['spoiler']): FieldNode => ({ type: 'object', label: '目标', ...(spoiler ? { spoiler } : {}), fields: { long: text('远期'), short: text('近期') } });
const attribute = (label: string, node: Partial<FieldNode>): FieldNode => ({ type: 'int', label, nullable: true, ...node } as FieldNode);
const ladder = (label: string, values: string[]): FieldNode => ({ type: 'ladder', label, values, nullable: true });
const FATE = ['F', 'F+', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S', 'S+', 'EX'];
const FU = ['弱', '普通', '优秀', '卓越'];
const wod = (label: string): FieldNode => attribute(label, { min: 0, computed: [{ label: '超凡', formula: 'wodTranscend' }] });
const dnd = (label: string): FieldNode => attribute(label, { min: 0, max: 30, computed: [{ label: '调整', formula: 'dndModifier' }] });
const fate = (label: string): FieldNode => ladder(label, FATE);
const fu = (label: string): FieldNode => ladder(label, FU);
/** A numeric gauge; wherever it is used, a natural-language description is accepted too. */
const gauge = (): FieldNode => ({ type: 'object', fields: { value: { type: 'number', label: '当前' }, max: { type: 'number', label: '上限', min: 0, default: 100 } } });

export const OFFICIAL_LISTS = {
  tags: { max: 10, warn: 8 }, labels: { max: 6, warn: 5 }, promises: { max: 8, warn: 6 }, plan: { max: 8, warn: 6 }, events: { max: 12, warn: 9 },
} as const;

const character: FieldNode = {
  type: 'object', label: '角色',
  fields: {
    name: text('姓名', { required: true }),
    alias: text('别称', { optional: true }),
    role: { type: 'enum', label: '定位', values: ['用户角色', '核心角色', '主要配角', '次要配角'], default: '次要配角' },
    age: text('年龄'),
    intro: text('简介', { as: 'paragraph' }),
    tags: { type: 'array', label: '身份', of: { type: 'string' }, list: OFFICIAL_LISTS.tags, as: 'tags' },
    appearance: text('外貌', { as: 'paragraph' }),
    condition: text('当前状态'),
    drive: {
      type: 'object', label: '驱动力', module: 'drive', fields: {
        goals: goals('spoiler'),
        thoughts: text('想法', { spoiler: 'spoiler' }),
        plan: { type: 'array', label: '规划', spoiler: 'spoiler', list: OFFICIAL_LISTS.plan, as: 'checklist',
          of: { type: 'object', fields: { text: text('内容', { required: true }), done: { type: 'bool', label: '完成' } } } },
      },
    },
    relations: {
      type: 'record', label: '社交', module: 'social', keys: 'character',
      of: {
        type: 'object', fields: {
          affection: { type: 'int', label: '好感度', min: -100, max: 100, maxDelta: 10, as: 'meter-center' },
          labels: { type: 'array', label: '关系', of: { type: 'string' }, list: OFFICIAL_LISTS.labels, as: 'tags' },
          impression: text('印象'),
          promises: { type: 'array', label: '约定', of: { type: 'string' }, list: OFFICIAL_LISTS.promises },
          keyEvents: { type: 'array', label: '关键事件', stamp: true, list: OFFICIAL_LISTS.events, as: 'timeline' },
        },
      },
    },
    rp: {
      type: 'object', label: '角色扮演', module: 'rp', fields: {
        rank: text('位阶'),
        attributes: {
          type: 'object', label: '属性', module: 'rp_attributes', fields: {
            dnd: { type: 'object', label: 'DND', module: 'attr_dnd', fields: {
              str: dnd('力量'), dex: dnd('敏捷'), con: dnd('体质'), int: dnd('智力'), wis: dnd('感知'), cha: dnd('魅力') } },
            wod: { type: 'object', label: 'WOD', module: 'attr_wod', fields: {
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
        special: { type: 'record', label: '特殊属性', module: 'rp_attributes', of: { type: 'oneOf', variants: [{ type: 'string' }, { type: 'number' }, gauge()] } },
        // Abilities live once in the root `abilities`; a character only references them (with its own level).
        abilities: { type: 'record', label: '能力', module: 'rp_abilities', keys: 'ability', as: 'abilities',
          of: { type: 'object', fields: { level: { type: 'int', label: '等级', min: 0, optional: true } } } },
        gauges: { type: 'record', label: '量表', module: 'rp_status', as: 'meters', of: { type: 'oneOf', variants: [gauge(), { type: 'string' }] } },
        effects: { type: 'record', label: '效果', module: 'rp_status', as: 'chips',
          of: { type: 'object', fields: { desc: text('描述'), source: text('来源', { optional: true }), until: text('持续到', { optional: true }) } } },
      },
    },
    // Items live once in the root `items`; a character only references them (with its own count / equipped).
    items: { type: 'record', label: '物品', module: 'assets', keys: 'item', as: 'inventory',
      of: { type: 'object', fields: { count: { type: 'int', label: '数量', min: 0, default: 1 }, equipped: { type: 'bool', label: '已装备' } } } },
    funds: { type: 'record', label: '资金', module: 'assets', as: 'currency', of: { type: 'oneOf', variants: [{ type: 'int', min: 0 }, { type: 'string' }] } },
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
        time: { type: 'object', label: '时间', as: 'datetime', fields: {
          era: text('纪元'), year: { type: 'int', label: '年' }, month: { type: 'int', label: '月', min: 1, default: 1 },
          day: { type: 'int', label: '日', min: 1, default: 1 }, clock: text('时分', { default: '08:00' }) } },
        location: { type: 'ref', label: '地点', to: 'place', nullable: true },
        weather: { type: 'enum', label: '天气', values: ['晴', '雨', '阴', '雪', '雾', '大风', '雷暴', '暴雨', '沙暴', '瘴气', '异象'] },
        present: { type: 'refs', label: '在场角色', to: 'character' },
        mood: { type: 'enum', label: '场景情绪', values: ['日常', '紧张', '战斗', '悲伤', '浪漫', '神秘', '欢快', '恐怖'] },
      },
    },
    characters: { type: 'record', label: '角色', entity: 'character', of: character },
    places: {
      type: 'record', label: '地点', entity: 'place',
      of: { type: 'object', fields: {
        name: text('地点名', { required: true }),
        kind: { type: 'enum', label: '类别', values: ['区域', '地点'], default: '地点' },
        parent: { type: 'ref', label: '上级', to: 'place', nullable: true },
        links: { type: 'refs', label: '相连', to: 'place', module: 'map' },
        desc: text('描述'),
        truth: text('真实描述', { optional: true, spoiler: 'hidden' }),
        discovered: { type: 'bool', label: '已发现', default: true, module: 'map' },
        image: text('背景图', { optional: true }),
        bgm: text('背景音乐', { optional: true }),
      } },
    },
    items: {
      type: 'record', label: '物品', entity: 'item', module: 'assets',
      of: { type: 'object', fields: {
        name: text('物品名', { required: true }),
        type: { type: 'enum', label: '类型', values: ['装备', '道具', '消耗', '关键', '杂物', '座驾'], default: '杂物' },
        desc: text('描述'),
        truth: text('真实描述', { optional: true, spoiler: 'hidden' }),
        condition: text('状态', { optional: true }),
      } },
    },
    abilities: {
      type: 'record', label: '能力', entity: 'ability', module: 'rp_abilities',
      of: { type: 'object', fields: {
        name: text('能力名', { required: true }),
        kind: { type: 'enum', label: '类别', values: ['特质', '技能'], default: '技能' },
        desc: text('描述'),
        truth: text('真实描述', { optional: true, spoiler: 'hidden' }),
      } },
    },
    estates: {
      type: 'record', label: '不动产', entity: 'estate', module: 'estates',
      of: { type: 'object', fields: {
        name: text('名称', { required: true }),
        owner: { type: 'ref', label: '产权人', to: ['character', 'faction'], nullable: true },
        place: { type: 'ref', label: '位置', to: 'place', nullable: true },
        desc: text('描述'), truth: text('真实描述', { optional: true, spoiler: 'hidden' }),
        developments: { type: 'record', label: '建设', of: { type: 'string' } },
      } },
    },
    factions: {
      type: 'record', label: '势力', entity: 'faction', module: 'factions',
      of: { type: 'object', fields: {
        name: text('势力名', { required: true }), alias: text('别称', { optional: true }),
        tier: { type: 'enum', label: '定位', values: ['霸主统治', '核心大派', '地方霸权', '隐秘结社', '小型流派'], default: '小型流派' },
        leader: { type: 'ref', label: '领袖', to: 'character', nullable: true },
        intro: text('概括', { as: 'paragraph' }),
        base: { type: 'ref', label: '根据地', to: 'place', nullable: true },
        territory: { type: 'refs', label: '势力范围', to: 'place' },
        goals: goals('spoiler'),
        plan: { type: 'array', label: '规划', of: { type: 'string' }, list: OFFICIAL_LISTS.plan, spoiler: 'spoiler' },
        reputation: { type: 'record', label: '声望', keys: 'character', of: { type: 'object', fields: {
          value: { type: 'int', label: '声望值', min: -100, max: 100, maxDelta: 10, as: 'meter-center' },
          title: text('称号'),
          keyEvents: { type: 'array', label: '关键事件', stamp: true, list: OFFICIAL_LISTS.events, as: 'timeline' },
        } } },
        diplomacy: { type: 'record', label: '外交', keys: 'faction', of: { type: 'object', fields: {
          stance: { type: 'enum', label: '关系', values: ['盟友', '敌对', '冷淡中立', '臣服依附'], default: '冷淡中立' },
          moves: text('动向', { spoiler: 'spoiler' }),
        } } },
      } },
    },
  },
  modules: {
    drive: { label: '驱动力', guide: '驱动力：目标、想法与规划反映角色当下的动机；剧情推进后及时更新，完成的规划标记 done 或移除。' },
    social: { label: '社交', guide: '社交：relations 以对方角色 ID 为键，记录本角色对对方的单向看法。好感度每次变化不超过 ±10。keyEvents、promises 直接写字符串，引擎自动记录轮次。' },
    rp: { label: '角色扮演' },
    rp_attributes: { label: '属性', parent: 'rp', guide: '属性：只填写当前开启的属性体系；该角色没有的属性填 null（例如亡灵没有体质）。位阶与特殊属性依世界观自行推断；特殊属性的值可以是文字、数字或 {value, max}。' },
    attr_dnd: { label: 'DND', parent: 'rp_attributes', exclusive: 'attributes', guide: 'DND 属性为 0～30 的整数，调整值由引擎计算。' },
    attr_wod: { label: 'WOD', parent: 'rp_attributes', exclusive: 'attributes', enabled: false, guide: 'WOD 属性为不小于 0 的整数，没有上限；每超过 5 点获得 1 点超凡（由引擎计算，不要写入）。' },
    attr_fate: { label: 'FATE', parent: 'rp_attributes', exclusive: 'attributes', enabled: false, guide: 'FATE 技能使用阶梯 F/F+/E/E+/D/D+/C/C+/B/B+/A/A+/S/S+/EX。' },
    attr_fu: { label: 'FU', parent: 'rp_attributes', exclusive: 'attributes', enabled: false, guide: 'FU 属性只用四档：弱/普通/优秀/卓越。' },
    rp_abilities: { label: '能力', parent: 'rp', guide: '能力：能力本体只在根节点 abilities 建一次（{name, kind: 特质|技能, desc}），角色的 rp.abilities 以能力 ID 为键引用它，只写本人的 {level}。多人共有同一能力时引用同一个 ID；新能力先建实体再引用。' },
    rp_status: { label: '状态', parent: 'rp', guide: '状态：gauges 为量表，名称与数量依世界观和剧情决定；需要精确数值时写 {value, max}，叙事化的状态直接写一句话（如「伤口在渗血，勉强能走」）。effects 为效果，剧情上结束后移除，可用 until 写结束条件。' },
    assets: { label: '资产', guide: '资产：物品本体只在根节点 items 建一次（{name, type, desc, condition}），角色的 items 以物品 ID 为键引用它，只写本人的 {count, equipped}。物品转手：从原持有者的 items 删去该键，再在新持有者的 items 下加上同一 ID；同类消耗品多人持有时各自记数量。funds 的币种依世界观决定（如 金币/银币/铜币、文/银两、美元/人民币/日元）；清楚数额时写整数，转账用 $transfer 保证总数守恒；说不清数额时写一句描述（如「一小袋碎银」）。座驾是类型为「座驾」的物品。' },
    nsfw: { label: 'NSFW', enabled: false },
    map: { label: '地图', guide: '地图：地点用 parent 表示层级（区域 → 地点），用 links 记录相通的地点；新发现的地点 discovered 设为 true。' },
    estates: { label: '不动产', enabled: false },
    factions: { label: '势力', enabled: false, guide: '势力：只为有分量的组织建实体；声望每次变化不超过 ±10。' },
  },
  groups: { attributes: { label: '属性体系' } },
  guide: [
    '用 <solve_operate> 输出 JSON 操作来更新变量，只写本回合实际发生的变化。',
    'meta.round（轮次）由引擎维护，不要修改。推进时间时用 $set 整体写入 meta.time（clock 格式 HH:MM）。',
    '只为 用户角色/核心角色/主要配角/次要配角 建立角色实体，路人与龙套不建。实体 ID 用简短英文或拼音，全局唯一（角色、物品、能力、地点、势力之间也不能重名）。',
    '角色登场或离场时更新 meta.present；当前地点写入 meta.location（地点实体 ID）。',
    '清单类条目（身份、关系、约定、关键事件等）有上限；收到整理提示时先合并或删除旧条目。',
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
        vitals: 'rp.gauges', status: 'condition', effects: 'rp.effects', currency: 'funds',
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
        { list: 'characters', title: '人物', exclude: '$user', present: 'meta.present', order: 'role', badges: ['role'], score: 'relations.$user.affection', scoreLabel: '♥',
          // An NPC card reads in layers: how they see you first, then motives, other ties, abilities, belongings.
          pages: [
            { label: '概况', paths: ['relations.$user', 'condition', 'age', 'tags', 'intro', 'appearance'] },
            { label: '动机', paths: ['drive'], as: 'quests' },
            { label: '关系', paths: ['relations'] },
            { label: '能力', paths: ['rp.rank', 'rp.gauges', 'rp.effects', 'rp.attributes', 'rp.special', 'rp.abilities'] },
            { label: '物品', paths: ['items', 'funds'], as: 'inventory' },
            { label: '私密', paths: ['nsfw'] },
          ] },
      ] },
      { tab: '地图', items: [{ map: 'places', current: 'meta.location' }] },
      { tab: '势力', module: 'factions', items: [
        { graph: 'factions', title: '势力关系图', edges: 'diplomacy', tone: 'stance', label: 'stance', size: 'tier', badges: ['tier'],
          tones: { 盟友: 'positive', 敌对: 'negative', 冷淡中立: 'neutral', 臣服依附: 'info' }, legend: { positive: '盟友', negative: '敌对', neutral: '中立', info: '依附' } },
        { list: 'factions', title: '势力', order: 'tier', badges: ['tier'], score: 'reputation.$user.value', scoreLabel: '声望',
          pages: [
            { label: '概况', paths: ['reputation.$user', 'leader', 'base', 'territory', 'intro'] },
            { label: '目标', paths: ['goals', 'plan'], as: 'quests' },
            { label: '声望', paths: ['reputation'] },
            { label: '外交', paths: ['diplomacy'] },
          ] },
      ] },
      { tab: '不动产', module: 'estates', items: [{ list: 'estates', title: '不动产' }] },
    ],
  },
  initialData: {},
};
