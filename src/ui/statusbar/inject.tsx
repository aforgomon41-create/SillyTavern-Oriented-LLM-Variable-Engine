/**
 * 设置 · 变量更新 · 提示词注入（预览）。随正文输出时，主模型要知道怎么写操作、现在的变量是什么。
 * 卡片自己写了 {{solve_SOP}} 等宏就不用管；没写（比如卡没有自带变量、用的是默认数据结构）时，由 SOLVE 注入。
 * 每段提示词可以单独开关，选位置（最前面 / 聊天记录之前 / 聊天记录中某个深度）和角色。
 * 对应酒馆的扩展提示词（setExtensionPrompt）；对话补全模式下不依赖预设的 Main Prompt，见 src/host/inject.ts。
 * 酒馆里由 src/host/inject.ts 在每次生成前按这些设置注入（独立操作模型时不注入）。
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { part, solve } from './widgets.js';

export type InjectKey = 'sop' | 'guide' | 'data' | 'feedback';
export type InjectPosition = 'before' | 'after' | 'chat';
export type InjectRole = 'system' | 'user' | 'assistant';
export interface InjectItem { on: boolean; position: InjectPosition; depth: number; role: InjectRole }
export interface InjectPrefs {
  /** auto: inject what the card does not already have as a macro; always: inject everything that is on; off: rely on the card. */
  mode: 'auto' | 'always' | 'off';
  items: Record<InjectKey, InjectItem>;
  /** Format of the variable data. */
  format: 'toon' | 'json';
}
export const INJECT_DEFAULTS: InjectPrefs = {
  mode: 'auto', format: 'toon',
  items: {
    sop: { on: true, position: 'after', depth: 4, role: 'system' },
    guide: { on: true, position: 'after', depth: 4, role: 'system' },
    data: { on: true, position: 'chat', depth: 2, role: 'system' },
    feedback: { on: true, position: 'chat', depth: 0, role: 'system' },
  },
};
export const INJECTS: { key: InjectKey; label: string; macro: string; text: string }[] = [
  { key: 'sop', label: '操作说明', macro: '{{solve_SOP}}', text: '怎么写 <solve_operate>、每个算子的用法' },
  { key: 'guide', label: '指南', macro: '{{solve_guide}}', text: '结构作者写给模型的规则，开启的模块和满足条件的指南' },
  { key: 'data', label: '变量数据', macro: '{{solve_toon}} / {{solve_json}}', text: '当前变量，按「叙事」视图和投影规则输出' },
  { key: 'feedback', label: '上轮反馈', macro: '{{solve_feedback}}', text: '上一轮被修正或失败的操作；没有时不注入' },
];
const POSITIONS: { value: InjectPosition; label: string }[] = [
  { value: 'before', label: '最前面（系统提示之前）' }, { value: 'after', label: '聊天记录之前（角色设定之后）' }, { value: 'chat', label: '聊天记录中（按深度）' },
];
const ROLES: { value: InjectRole; label: string }[] = [{ value: 'system', label: '系统' }, { value: 'user', label: '用户' }, { value: 'assistant', label: 'AI' }];

export interface InjectHost {
  prefs: InjectPrefs; onPrefs(patch: Partial<InjectPrefs>): void;
  /** Macros the card (description, scenario, system prompt, world book) already uses, as INJECTS keys. */
  cardMacros?: InjectKey[];
  /** Current text of each prompt (for counts and preview). */
  texts?(): Partial<Record<InjectKey, string>>;
}

/** Whether a prompt is injected under the current settings. */
export function injected(p: InjectPrefs, key: InjectKey, cardMacros: InjectKey[] = []): { on: boolean; why?: string } {
  if (p.mode === 'off') return { on: false, why: '不注入' };
  if (!p.items[key].on) return { on: false, why: '已关闭' };
  if (p.mode === 'auto' && cardMacros.includes(key)) return { on: false, why: '卡里已经写了，不重复注入' };
  return { on: true };
}

export function InjectSection({ host }: { host: InjectHost }) {
  const K = useKit();
  const p = host.prefs;
  const texts = React.useMemo(() => host.texts?.() ?? {}, [host, p.format]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = React.useState<InjectKey | undefined>();
  const item = (key: InjectKey, patch: Partial<InjectItem>) => host.onPrefs({ items: { ...p.items, [key]: { ...p.items[key], ...patch } } });
  const macros = host.cardMacros ?? [];
  return (
    <section {...solve('limit-group')}>
      <h4>提示词注入<small>给写正文的模型</small></h4>
      <div {...solve('pref-list')}>
        <div {...solve('pref', { kind: 'stack' })}>
          <span {...part('label')}>注入方式<small>{macros.length ? `这张卡已经写了 ${macros.map(k => INJECTS.find(x => x.key === k)!.macro).join('、')}` : '这张卡没有写 SOLVE 的宏'}</small></span>
          <div {...solve('update-modes', { size: 'sm' })} role="radiogroup" aria-label="注入方式">
            {([['auto', '自动', '卡里没写的才注入'], ['always', '总是注入', '不管卡里写没写'], ['off', '不注入', '只靠卡里的宏']] as const).map(([v, l, t]) => (
              <button key={v} type="button" role="radio" aria-checked={p.mode === v} {...part('mode')} onClick={() => host.onPrefs({ mode: v })}><b>{l}</b><small>{t}</small></button>
            ))}
          </div>
        </div>
        {p.mode === 'always' && macros.length ? <p {...part('hint')} data-tone="warn">卡里写了的宏照常输出，再注入一份会重复，模型会看到两遍。</p> : null}
        {p.mode !== 'off' ? INJECTS.map(x => {
          const it = p.items[x.key], st = injected(p, x.key, macros), text = texts[x.key];
          return (
            <div key={x.key} {...solve('inject', { off: st.on ? undefined : '' })}>
              <div {...part('head')}>
                <span {...part('label')}><b>{x.label}</b><small>{x.text}</small>
                  <small {...part('state')}>{st.on ? (text === undefined ? '注入' : text ? `${text.length} 字` : '现在是空的，这轮不注入') : st.why}</small></span>
                <K.Switch checked={it.on} aria-label={`注入${x.label}`} onCheckedChange={v => item(x.key, { on: v })} />
              </div>
              {it.on ? (
                <div {...part('where')}>
                  <select {...solve('select')} aria-label={`${x.label}的位置`} value={it.position} onChange={e => item(x.key, { position: e.target.value as InjectPosition })}>
                    {POSITIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {it.position === 'chat' ? <>
                    <span {...solve('stepper')} title="0 = 最新消息之后，1 = 最新一条消息之前，以此类推">
                      <button type="button" aria-label={`${x.label}的深度 减少`} disabled={it.depth <= 0} onClick={() => item(x.key, { depth: Math.max(0, it.depth - 1) })}>−</button>
                      <input inputMode="numeric" aria-label={`${x.label}的深度`} value={it.depth} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n <= 999) item(x.key, { depth: n }); }} />
                      <span {...part('unit')}>深度</span>
                      <button type="button" aria-label={`${x.label}的深度 增加`} onClick={() => item(x.key, { depth: Math.min(999, it.depth + 1) })}>+</button>
                    </span>
                    <select {...solve('select')} aria-label={`${x.label}的角色`} value={it.role} onChange={e => item(x.key, { role: e.target.value as InjectRole })}>
                      {ROLES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </> : null}
                  {x.key === 'data' ? (
                    <select {...solve('select')} aria-label="变量数据的格式" value={p.format} onChange={e => host.onPrefs({ format: e.target.value as InjectPrefs['format'] })}>
                      <option value="toon">TOON</option><option value="json">JSON</option>
                    </select>
                  ) : null}
                  {text !== undefined ? <K.Button size="sm" variant="ghost" onClick={() => setOpen(o => o === x.key ? undefined : x.key)} aria-expanded={open === x.key}>{open === x.key ? '收起' : '查看'}</K.Button> : null}
                </div>
              ) : null}
              {open === x.key && text !== undefined ? <pre {...part('text')}>{text || '（现在是空的）'}</pre> : null}
            </div>
          );
        }) : null}
      </div>
      {p.mode !== 'off' ? <Stack prefs={p} macros={macros} /> : null}
    </section>
  );
}

/** Where everything lands in the prompt, top to bottom. */
function Stack({ prefs, macros }: { prefs: InjectPrefs; macros: InjectKey[] }) {
  const on = INJECTS.filter(x => injected(prefs, x.key, macros).on);
  const at = (pos: InjectPosition) => on.filter(x => prefs.items[x.key].position === pos);
  const chat = at('chat').sort((a, b) => prefs.items[b.key].depth - prefs.items[a.key].depth);
  const chip = (x: typeof INJECTS[number]) => <span key={x.key} {...part('chip')}>{x.label}{prefs.items[x.key].position === 'chat' ? <small>@{prefs.items[x.key].depth} · {ROLES.find(r => r.value === prefs.items[x.key].role)!.label}</small> : null}</span>;
  const depths = [...new Set(chat.map(x => prefs.items[x.key].depth))];
  return (
    <div {...solve('inject-stack')} aria-label="注入位置示意">
      <small {...part('title')}>发给模型的顺序</small>
      {at('before').length ? <div {...part('slot')}>{at('before').map(chip)}</div> : null}
      <div {...part('fixed')}>系统提示 · 角色设定 · 世界书</div>
      {at('after').length ? <div {...part('slot')}>{at('after').map(chip)}</div> : null}
      <div {...part('fixed')}>聊天记录</div>
      {depths.filter(d => d > 0).map((d, i, list) => {
        const gap = d - (list[i + 1] ?? 0);
        return (
          <React.Fragment key={d}>
            <div {...part('slot')}>{chat.filter(x => prefs.items[x.key].depth === d).map(chip)}</div>
            <div {...part('fixed')} data-kind="msgs">{i === list.length - 1 ? `最新 ${gap} 条消息` : `${gap} 条消息`}</div>
          </React.Fragment>
        );
      })}
      {depths.includes(0) ? <div {...part('slot')}>{chat.filter(x => prefs.items[x.key].depth === 0).map(chip)}</div> : null}
    </div>
  );
}
