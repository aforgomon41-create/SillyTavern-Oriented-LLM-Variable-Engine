/**
 * Example chat state for the official structure: used by tests, the debug demo and
 * the status-bar previews. Scenario: a dark-fantasy capital, round 42, WOD attributes.
 */
import type { Json, LogicalState } from '../../src/types.js';
import type { SolveCore } from '../../src/engine.js';
import type { StructureDescription } from '../../src/structure.js';
import { officialStructure } from '../../src/official/structure.js';
import { art, MUSIC, thumb } from './media.js';

/** Both pictures of an entity: thumbnail for avatars, full picture for the 立绘 / scene view. */
const pics = (k: Parameters<typeof art>[0]) => ({ thumb: thumb(k), image: art(k) });

/** Modules switched on for this example (others keep their defaults). */
export const exampleModules: Record<string, boolean> = { attr_dnd: false, attr_wod: true, factions: true, estates: true };

export const exampleData: Record<string, Json> = {
  meta: {
    round: 42,
    time: { era: '灰烬纪元', year: 1024, month: 3, day: 14, clock: '19:30' },
    location: 'tavern', weather: '雨', present: ['erin', 'mira', 'ash'], mood: '日常',
  },
  characters: {
    erin: {
      name: '艾琳', alias: '银发', ...pics('erin'), role: '用户角色', age: '二十出头',
      intro: '被逐出银枝骑士团的见习骑士，背着一桩不属于自己的罪名，正在王都暗中调查真相。',
      tags: ['见习骑士', '流亡者', '契约者'], appearance: '银色短发，旧皮甲上有被刮掉的骑士团纹章。', condition: '疲惫，左臂擦伤',
      drive: { goals: { long: '洗清罪名，重回骑士团', short: '找到当晚的目击者' }, thoughts: '米拉知道的比她说的多。',
        plan: [{ text: '打听目击者下落', done: true }, { text: '潜入下城区仓库', done: false }] },
      relations: {
        mira: { affection: 35, labels: ['旅伴'], impression: '话多但可靠', promises: ['替她保守身世的秘密'],
          keyEvents: [{ round: 12, text: '在雾沼救下米拉' }, { round: 30, text: '米拉替她挡下追兵' }] },
        cassius: { affection: -20, labels: ['前上司'], impression: '冷酷，但似乎有所隐瞒', promises: [],
          keyEvents: [{ round: 3, text: '被卡修斯亲手剥夺骑士资格' }] },
      },
      rp: {
        rank: '铜阶',
        attributes: { wod: { str: 23, dex: 6, sta: 8, int: 3, wits: 4, res: 5, pre: 2, man: 2, com: 3 } },
        special: { 契约之力: '残响' },
        abilities: { night_vision: {}, indomitable: {}, shield_bash: { level: 2 }, echo_slash: { level: 1 } },
        gauges: { 生命: { value: 72, max: 100 }, 体力: { value: 30, max: 50 }, 理智: { value: 88, max: 100 }, 饥饿: '一天没吃东西，肚子在叫' },
        effects: { 淋湿: { desc: '敏捷检定略受影响', until: '烤干衣物' }, 契约低语: { desc: '偶尔听见契约者的声音', source: '契约' } },
      },
      items: {
        iron_sword: { count: 1, equipped: true }, round_shield: { count: 1, equipped: true },
        healing_draught: { count: 2, equipped: false }, sealed_letter: { count: 1, equipped: false }, grey_mare: { count: 1, equipped: false },
      },
      funds: { 金币: 140, 银币: 37, 铜币: 58, 当票: '一张押着家传戒指的当票' },
    },
    mira: {
      name: '米拉', ...pics('mira'), role: '核心角色', age: '看不出', intro: '游走各地的吟游诗人，对王都的传闻无所不知。',
      tags: ['吟游诗人', '情报贩子'], appearance: '绿色斗篷，背着一把旧鲁特琴。', condition: '微醺',
      drive: { goals: { long: '找回失落的家族乐谱', short: '让艾琳欠她一个人情' }, thoughts: '如果艾琳知道我是灰烬教团的逃亡者……', plan: [] },
      relations: {
        erin: { affection: 48, labels: ['旅伴', '在意的人'], impression: '固执的笨蛋', promises: [], keyEvents: [{ round: 12, text: '被艾琳从雾沼救出' }] },
        cassius: { affection: -35, labels: ['旧怨'], impression: '骑士团的走狗', promises: [], keyEvents: [] },
      },
      rp: {
        rank: '铁阶',
        attributes: { wod: { str: 2, dex: 5, sta: 2, int: 4, wits: 6, res: 3, pre: 7, man: 6, com: 4 } },
        special: { 情报网: 60 }, abilities: { perfect_pitch: {}, lullaby: { level: 3 }, night_vision: {} },
        gauges: { 生命: { value: 45, max: 60 } }, effects: {},
      },
      items: { lute: { count: 1, equipped: true }, healing_draught: { count: 1, equipped: false } },
      funds: { 银币: 12 },
    },
    ash: {
      name: '灰烬', ...pics('ash'), role: '次要配角', age: '死去多年', intro: '徘徊在酒馆地窖的亡灵骑士，只记得自己的誓言。',
      tags: ['亡灵', '旧骑士'], appearance: '锈蚀的板甲里只有一团幽蓝的火。', condition: '沉默地守在门边',
      drive: { goals: { long: '完成生前的誓言', short: '守住地窖的门' }, thoughts: '……', plan: [] },
      relations: { mira: { affection: 20, labels: ['听众'], impression: '她的歌让火焰安静', promises: [], keyEvents: [] } },
      rp: {
        rank: '银阶',
        attributes: { wod: { str: 11, dex: 3, sta: null, int: 2, wits: 3, res: 9, pre: 1, man: null, com: 6 } },
        special: { 幽火: '燃烧中' }, abilities: { undying: {}, night_vision: {} },
        gauges: { 魂火: { value: 64, max: 100 } }, effects: {},
      },
      items: {}, funds: {},
    },
    cassius: {
      name: '卡修斯', ...pics('cassius'), role: '主要配角', age: '四十余岁', intro: '银枝骑士团团长，亲手将艾琳逐出骑士团。',
      tags: ['骑士团长'], appearance: '高大，左眼有一道旧伤。', condition: '在王城值守',
      drive: { goals: { long: '保住骑士团的名誉', short: '找到伪造火漆的人' }, thoughts: '那孩子不会做这种事。', plan: [] },
      relations: { erin: { affection: 10, labels: ['前部下'], impression: '太过天真', promises: [], keyEvents: [] } },
      rp: { rank: '金阶', attributes: { wod: { str: 9, dex: 7, sta: 8, int: 5, wits: 6, res: 8, pre: 6, man: 4, com: 7 } },
        special: {}, abilities: { shield_bash: { level: 4 } }, gauges: { 生命: { value: 140, max: 140 } }, effects: {} },
      items: {}, funds: { 金币: 900 },
    },
  },
  items: {
    iron_sword: { name: '铁剑', ...pics('iron_sword'), type: '装备', desc: '普通的制式铁剑' },
    round_shield: { name: '圆盾', ...pics('round_shield'), type: '装备', desc: '边缘有凹痕的木盾' },
    healing_draught: { name: '治疗药剂', ...pics('healing_draught'), type: '消耗', desc: '散发苦味的红色药水，能止血' },
    sealed_letter: { name: '封蜡信', ...pics('sealed_letter'), type: '关键', unique: true, desc: '盖着骑士团火漆的信', truth: '火漆是伪造的' },
    grey_mare: { name: '灰马', ...pics('grey_mare'), type: '座驾', unique: true, desc: '温顺的老母马', condition: '拴在酒馆马厩' },
    lute: { name: '旧鲁特琴', ...pics('lute'), type: '装备', unique: true, desc: '琴颈刻着看不懂的花纹', truth: '花纹是失落乐谱的一部分' },
  },
  abilities: {
    night_vision: { name: '夜视', kind: '特质', desc: '在黑暗中视物如常' },
    indomitable: { name: '不屈', kind: '特质', desc: '濒死时仍能行动一回合' },
    perfect_pitch: { name: '过耳不忘', kind: '特质', desc: '听过一次的旋律与对话都能复述' },
    undying: { name: '不死', kind: '特质', desc: '不需要进食与睡眠' },
    shield_bash: { name: '盾击', kind: '技能', desc: '以盾牌冲撞，使目标失衡', levels: {
      1: '推开一名近身的敌人一步', 2: '目标失衡，下一次攻击检定 −1', 3: '可以把目标撞倒在地',
      4: '撞倒的同时打断对方正在进行的施法或蓄力', 5: '一次冲撞波及身前两名敌人' } },
    echo_slash: { name: '残响斩', kind: '技能', desc: '借契约之力挥出带回声的斩击', truth: '每次使用都会让契约者离现世更近一步', levels: {
      1: '斩击后一回合，同一位置再响起一次较弱的斩击', 3: '回声与本体同样锋利，并能穿过薄墙', 5: '回声会追着目标走，直到命中或天亮' } },
    lullaby: { name: '安眠曲', kind: '技能', desc: '用歌声让周围的人昏昏欲睡', levels: {
      1: '让一个本就疲惫的人睡着', 2: '让一屋子的普通人犯困，警觉的人不受影响', 3: '让一名有防备的人入睡，歌声停下前不会醒',
      4: '亡灵与野兽也会安静下来' } },
  },
  places: {
    capital: { name: '王都', ...pics('capital'), bgm: 'lord_of_the_land', kind: '区域', parent: null, links: ['fog_marsh'], desc: '灰烬纪元的王国首都，终日笼罩在细雨中。', discovered: true },
    tavern: { name: '醉橡木酒馆', ...pics('tavern'), bgm: 'minstrel_guild', kind: '地点', parent: 'capital', links: ['lower_town', 'palace'], desc: '老旧但热闹，地窖里据说住着亡灵。', discovered: true },
    palace: { name: '王城', ...pics('palace'), kind: '地点', parent: 'capital', links: ['tavern'], desc: '银枝骑士团驻守的王城。', discovered: true },
    lower_town: { name: '下城区', ...pics('lower_town'), bgm: 'sneaky_snitch', kind: '地点', parent: 'capital', links: ['tavern', 'warehouse'], desc: '鱼龙混杂的贫民区。', discovered: true },
    warehouse: { name: '码头仓库', ...pics('warehouse'), bgm: 'crypto', kind: '地点', parent: 'capital', links: ['lower_town'], desc: '据说当晚有人在这里交易。', truth: '灰烬教团的据点', discovered: false },
    fog_marsh: { name: '雾沼', ...pics('fog_marsh'), bgm: 'dark_fog', kind: '区域', parent: null, links: ['capital', 'marsh_hut'], desc: '终年不散的浓雾与沼泽。', discovered: true },
    marsh_hut: { name: '沼泽小屋', ...pics('marsh_hut'), kind: '地点', parent: 'fog_marsh', links: ['fog_marsh'], desc: '艾琳救下米拉的地方。', discovered: true },
  },
  estates: {
    old_manor: { name: '艾琳的旧宅', owner: 'erin', place: 'lower_town', desc: '破旧的两层小楼，被骑士团查封后无人打理。', developments: { 地下室: '藏着父亲留下的铠甲' } },
  },
  factions: {
    silver_branch: {
      name: '银枝骑士团', tier: '核心大派', leader: 'cassius', intro: '守护王都的骑士团，以荣誉自居。', base: 'palace', territory: ['capital'],
      goals: { long: '维持王国秩序', short: '平息伪造火漆的丑闻' }, plan: ['加强王城巡逻'],
      reputation: { erin: { value: -30, title: '被逐者', keyEvents: [{ round: 3, text: '艾琳被逐出骑士团' }] } },
      diplomacy: { ash_cult: { stance: '敌对', moves: '秘密追查教团据点' } },
    },
    ash_cult: {
      name: '灰烬教团', alias: '余烬', tier: '隐秘结社', leader: null, intro: '崇拜灰烬与亡者的地下教团。', base: 'warehouse', territory: ['lower_town'],
      goals: { long: '唤醒沉睡的灰烬之王', short: '找回逃亡的米拉' }, plan: ['在下城区散布谣言'],
      reputation: {}, diplomacy: { silver_branch: { stance: '敌对', moves: '伪造骑士团火漆嫁祸' } },
    },
  },
};

/**
 * Ready-made entities for the example world (in a real chat they come from [SOLVE:PREFABS] / [SOLVE:TEMPLATES]).
 * cassius is already on stage, the rat king came and went, the hound and the bishop have not appeared yet;
 * the zealot template has produced one independent NPC.
 */
export const examplePresets: { prefabs: Record<string, { type: string; data: Record<string, Json> }>; templates: Record<string, { type: string; data: Record<string, Json> }> } = {
  prefabs: {
    cassius: { type: 'character', data: { name: '卡修斯', ...pics('cassius'), role: '主要配角', intro: '银枝骑士团团长，亲手将艾琳逐出骑士团。', tags: ['骑士团长'] } },
    grave_hound: { type: 'character', data: {
      name: '墓园猎犬', ...pics('grave_hound'), role: '一次性敌人', age: '不详', tags: ['亡灵', '野兽'],
      intro: '在王都旧墓园游荡的腐朽猎犬，闻到活人的气味就会扑上来。', appearance: '皮毛脱落，肋骨间燃着暗绿色的火。', condition: '在墓园深处游荡',
      rp: { rank: '铁阶', attributes: { wod: { str: 5, dex: 6, sta: null, int: 1, wits: 4, res: 3, pre: 0, man: 0, com: 2 } },
        abilities: { night_vision: {}, undying: {} }, gauges: { 生命: { value: 30, max: 30 } } } } },
    ember_bishop: { type: 'character', data: {
      name: '余烬主教', ...pics('ember_bishop'), role: '主要配角', age: '看不出年纪', tags: ['灰烬教团', '神职'],
      intro: '灰烬教团的主教，总在别人替他做完脏活之后才出现。', appearance: '灰袍下露出一截烧焦的手指，声音温和得过分。', condition: '藏身于码头仓库',
      drive: { goals: { long: '唤醒沉睡的灰烬之王', short: '找回逃亡的米拉' }, thoughts: '骑士团替我们做了一半的事。' },
      rp: { rank: '金阶', attributes: { wod: { str: 3, dex: 4, sta: 5, int: 9, wits: 7, res: 8, pre: 7, man: 9, com: 6 } },
        special: { 信徒: '下城区约有三十人' }, abilities: { undying: {}, echo_slash: { level: 3 } } } } },
    rat_king: { type: 'character', data: {
      name: '下水道鼠王', ...pics('rat_king'), role: '一次性敌人', tags: ['野兽', '群体'], intro: '几十只尾巴缠在一起的老鼠，像一个会思考的东西。',
      appearance: '一团湿漉漉的、蠕动的灰毛。', rp: { abilities: { night_vision: {} }, gauges: { 群体: '还剩二十来只' } } } },
  },
  templates: {
    cult_zealot: { type: 'character', data: {
      name: '教团狂信徒', ...pics('cult_zealot'), role: '一次性敌人', origin: 'cult_zealot', tags: ['灰烬教团'],
      intro: '被主教的布道点燃的下城区居民，为教团做跑腿和打手。', appearance: '灰色头巾，袖口有烧灼的痕迹。',
      rp: { rank: '铁阶', attributes: { wod: { str: 3, dex: 3, sta: 3, int: 2, wits: 2, res: 4, pre: 2, man: 2, com: 2 } }, gauges: { 生命: { value: 20, max: 20 } } } } },
  },
};

/** Genesis state of the example: the official defaults plus the example's module choices. */
export async function exampleState(core: SolveCore): Promise<LogicalState> {
  const initial = await core.initialize(exampleData);
  Object.assign(initial.engineState.activeModules, exampleModules);
  if (!core.definition.prefabs?.rat_king) return initial;
  // History of the example's presets: the rat king appeared and was killed; one zealot was spawned from the template.
  const steps: unknown[] = [
    { $createEntity: { 'characters.@rat_king': {} } },
    { $deleteEntity: ['@rat_king'] },
    { $createEntity: { 'characters.@one_eye': { $from: '@cult_zealot', name: '独眼狂信徒', condition: '在酒馆外的雨里盯着门口' } } },
  ];
  let state = initial;
  for (const step of steps) {
    const result = await core.execute(step as never, state);
    if (result.feedback.some(f => f.level === 'L3')) throw new Error('示例预制步骤失败：' + JSON.stringify(result.feedback));
    state = result.state;
  }
  return state;
}

/** The official structure with the example world's prefabs and templates attached. */
export const exampleStructure: StructureDescription = { ...officialStructure, ...examplePresets, bgm: { ...officialStructure.bgm, library: MUSIC } };
