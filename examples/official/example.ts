/**
 * Example chat state for the official structure: used by tests, the debug demo and
 * the status-bar previews. Scenario: a dark-fantasy capital, round 42, WOD attributes.
 */
import type { Json, LogicalState } from '../../src/types.js';
import type { SolveCore } from '../../src/engine.js';

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
      name: '艾琳', alias: '银发', role: '用户角色', age: '二十出头',
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
        traits: { 夜视: '在黑暗中视物如常', 不屈: '濒死时仍能行动一回合' },
        skills: { 盾击: { desc: '以盾牌冲撞，使目标失衡', level: 2 }, 残响斩: { desc: '借契约之力挥出带回声的斩击', level: 1 } },
        gauges: { 生命: { value: 72, max: 100 }, 体力: { value: 30, max: 50 }, 理智: { value: 88, max: 100 } },
        effects: { 淋湿: { desc: '敏捷检定略受影响', until: '烤干衣物' }, 契约低语: { desc: '偶尔听见契约者的声音', source: '契约' } },
      },
      items: {
        iron_sword: { name: '铁剑', count: 1, type: '装备', desc: '普通的制式铁剑', equipped: true },
        round_shield: { name: '圆盾', count: 1, type: '装备', desc: '边缘有凹痕的木盾', equipped: true },
        healing_draught: { name: '治疗药剂', count: 2, type: '消耗', desc: '散发苦味的红色药水', equipped: false },
        sealed_letter: { name: '封蜡信', count: 1, type: '关键', desc: '盖着骑士团火漆的信', truth: '火漆是伪造的', equipped: false },
        grey_mare: { name: '灰马', count: 1, type: '座驾', desc: '温顺的老母马', equipped: false, condition: '拴在酒馆马厩' },
      },
      funds: { 金币: 140, 银币: 37 },
    },
    mira: {
      name: '米拉', role: '核心角色', age: '看不出', intro: '游走各地的吟游诗人，对王都的传闻无所不知。',
      tags: ['吟游诗人', '情报贩子'], appearance: '绿色斗篷，背着一把旧鲁特琴。', condition: '微醺',
      drive: { goals: { long: '找回失落的家族乐谱', short: '让艾琳欠她一个人情' }, thoughts: '如果艾琳知道我是灰烬教团的逃亡者……', plan: [] },
      relations: { erin: { affection: 48, labels: ['旅伴', '在意的人'], impression: '固执的笨蛋', promises: [], keyEvents: [{ round: 12, text: '被艾琳从雾沼救出' }] } },
      rp: {
        rank: '铁阶',
        attributes: { wod: { str: 2, dex: 5, sta: 2, int: 4, wits: 6, res: 3, pre: 7, man: 6, com: 4 } },
        special: {}, traits: { 过耳不忘: '听过一次的旋律与对话都能复述' },
        skills: { 安眠曲: { desc: '用歌声让周围的人昏昏欲睡', level: 3 } },
        gauges: { 生命: { value: 45, max: 60 } }, effects: {},
      },
      items: { lute: { name: '旧鲁特琴', count: 1, type: '装备', desc: '琴颈刻着看不懂的花纹', truth: '花纹是失落乐谱的一部分', equipped: true } },
      funds: { 银币: 12 },
    },
    ash: {
      name: '灰烬', role: '次要配角', age: '死去多年', intro: '徘徊在酒馆地窖的亡灵骑士，只记得自己的誓言。',
      tags: ['亡灵', '旧骑士'], appearance: '锈蚀的板甲里只有一团幽蓝的火。', condition: '沉默地守在门边',
      drive: { goals: { long: '完成生前的誓言', short: '守住地窖的门' }, thoughts: '……', plan: [] },
      relations: {},
      rp: {
        rank: '银阶',
        attributes: { wod: { str: 11, dex: 3, sta: null, int: 2, wits: 3, res: 9, pre: 1, man: null, com: 6 } },
        special: { 幽火: '燃烧中' }, traits: { 不死: '不需要进食与睡眠' }, skills: {},
        gauges: { 魂火: { value: 64, max: 100 } }, effects: {},
      },
      items: {}, funds: {},
    },
    cassius: {
      name: '卡修斯', role: '主要配角', age: '四十余岁', intro: '银枝骑士团团长，亲手将艾琳逐出骑士团。',
      tags: ['骑士团长'], appearance: '高大，左眼有一道旧伤。', condition: '在王城值守',
      drive: { goals: { long: '保住骑士团的名誉', short: '找到伪造火漆的人' }, thoughts: '那孩子不会做这种事。', plan: [] },
      relations: { erin: { affection: 10, labels: ['前部下'], impression: '太过天真', promises: [], keyEvents: [] } },
      rp: { rank: '金阶', attributes: { wod: { str: 9, dex: 7, sta: 8, int: 5, wits: 6, res: 8, pre: 6, man: 4, com: 7 } },
        special: {}, traits: {}, skills: {}, gauges: { 生命: { value: 140, max: 140 } }, effects: {} },
      items: {}, funds: { 金币: 900 },
    },
  },
  places: {
    capital: { name: '王都', kind: '区域', parent: null, links: ['fog_marsh'], desc: '灰烬纪元的王国首都，终日笼罩在细雨中。', discovered: true },
    tavern: { name: '醉橡木酒馆', kind: '地点', parent: 'capital', links: ['lower_town', 'palace'], desc: '老旧但热闹，地窖里据说住着亡灵。', discovered: true },
    palace: { name: '王城', kind: '地点', parent: 'capital', links: ['tavern'], desc: '银枝骑士团驻守的王城。', discovered: true },
    lower_town: { name: '下城区', kind: '地点', parent: 'capital', links: ['tavern', 'warehouse'], desc: '鱼龙混杂的贫民区。', discovered: true },
    warehouse: { name: '码头仓库', kind: '地点', parent: 'capital', links: ['lower_town'], desc: '据说当晚有人在这里交易。', truth: '灰烬教团的据点', discovered: false },
    fog_marsh: { name: '雾沼', kind: '区域', parent: null, links: ['capital', 'marsh_hut'], desc: '终年不散的浓雾与沼泽。', discovered: true },
    marsh_hut: { name: '沼泽小屋', kind: '地点', parent: 'fog_marsh', links: ['fog_marsh'], desc: '艾琳救下米拉的地方。', discovered: true },
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

/** Genesis state of the example: the official defaults plus the example's module choices. */
export async function exampleState(core: SolveCore): Promise<LogicalState> {
  const state = await core.initialize(exampleData);
  Object.assign(state.engineState.activeModules, exampleModules);
  return state;
}
