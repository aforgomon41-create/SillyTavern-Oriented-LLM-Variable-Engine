/**
 * Player settings, opened from the panel's ⚙ button. Everything is read from the structure — the author
 * declares nothing extra:
 *   · 模块: every declared module, as a tree (parent → children); an exclusive group is one choice.
 *   · 清单上限 / 变化上限: the declared list caps and per-change limits.
 *   These three are saved with the chat as player actions (replay gives the same result).
 *   · 显示 / 音乐: preferences of this browser (spoilers, music, the player's own tracks).
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { dormant } from '../../schema.js';
import type { BgmTrack, ListLimit, ModuleSpec, SettingsPatch } from '../../types.js';
import { useModel } from './fields.js';
import { part, solve, useWide } from './widgets.js';
import type { InteractResult } from './interact.js';
import type { BgmView } from './views.js';

export interface LocalPrefs {
  /** Show spoiler content directly instead of the 「剧透 · 点击查看」 veil. */
  revealSpoilers: boolean;
  /** Skin of the status bar when the Kami preset is present: follow it (default) or keep SOLVE's own. */
  skin?: 'auto' | 'solve';
}
export interface SettingsHost {
  /** Turn a module on or off (a player action saved with the chat). */
  setModule(name: string, enabled: boolean): Promise<InteractResult>;
  /** List caps and per-change limits (a player action saved with the chat); `null` restores a default. */
  setSettings(patch: SettingsPatch): Promise<InteractResult>;
  /** Preferences kept in this browser. */
  prefs: LocalPrefs; onPrefs(patch: Partial<LocalPrefs>): void;
  /** The player's own music (this browser); the author's library comes from the structure. */
  tracks?: { list: BgmTrack[]; add(track: Omit<BgmTrack, 'id'>): void; remove(id: string): void };
  /** Why chat settings are paused right now (e.g. the model is writing). */
  locked?: string;
  /** The Kami preset is on the page (offers 「跟随卡密预设皮肤」). */
  kami?: boolean;
  /** Opens the debug panel (for card authors). */
  openDebug?: () => void;
}

type Section = 'modules' | 'lists' | 'delta' | 'display' | 'music';
const SECTIONS: { id: Section; label: string; note: string }[] = [
  { id: 'modules', label: '模块', note: '按聊天保存' },
  { id: 'lists', label: '清单上限', note: '按聊天保存' },
  { id: 'delta', label: '变化上限', note: '按聊天保存' },
  { id: 'display', label: '显示', note: '本机' },
  { id: 'music', label: '音乐', note: '本机' },
];

export function SettingsBody({ host, bgm, onBack }: { host: SettingsHost; bgm?: BgmView; onBack: () => void }) {
  const K = useKit(), m = useModel();
  const [box, wide] = useWide(900);
  const sections = SECTIONS.filter(s => s.id !== 'delta' || deltaRows(m).length).filter(s => s.id !== 'music' || bgm || host.tracks);
  const [current, setCurrent] = React.useState<Section>('modules');
  const [status, setStatus] = React.useState<{ text: string; tone?: 'error' } | undefined>();
  const report = (r: InteractResult, done: string) => setStatus(r.ok ? { text: done } : { text: r.error, tone: 'error' });
  const body = (id: Section) => (
    <div {...solve('settings-section', { section: id })}>
      {id === 'modules' ? <Modules host={host} report={report} />
        : id === 'lists' ? <Limits host={host} report={report} kind="lists" />
        : id === 'delta' ? <Limits host={host} report={report} kind="delta" />
        : id === 'display' ? <Display host={host} />
        : <Music host={host} {...(bgm ? { bgm } : {})} />}
    </div>
  );
  return (
    <div ref={box} {...solve('settings', { layout: wide ? 'sidebar' : 'tabs' })}>
      <div {...part('head')}>
        <K.Button size="sm" variant="ghost" onClick={onBack}>‹ 返回状态栏</K.Button>
        <strong>设置</strong>
        {host.locked ? <span {...part('locked')}>{host.locked}</span> : null}
        {status ? <span {...part('status')} data-tone={status.tone} role="status">{status.text}</span> : null}
      </div>
      {wide ? (
        <div {...part('split')}>
          <div {...part('nav')}><K.NavList layout="sidebar" label="设置" current={current} onSelect={id => setCurrent(id as Section)}
            items={sections.map(s => ({ id: s.id, label: s.label, meta: s.note }))} /></div>
          <div {...part('main')} role="region" aria-label={sections.find(s => s.id === current)?.label}>{body(current)}</div>
        </div>
      ) : (
        <K.Tabs label="设置" mode="scroll" value={current} onValueChange={v => setCurrent(v as Section)}
          items={sections.map(s => ({ value: s.id, label: s.label, content: body(s.id) }))} />
      )}
    </div>
  );
}

// ── 模块 ──

type ModRow = ModuleSpec & { name: string };
function Modules({ host, report }: { host: SettingsHost; report: (r: InteractResult, done: string) => void }) {
  const K = useKit(), m = useModel();
  const mods: ModRow[] = Object.entries(m.def.modules ?? {}).map(([name, spec]) => ({ name, ...spec }));
  const groups = (m.def as { groups?: Record<string, { label?: string; migrate?: boolean }> }).groups ?? {};
  const pref = (name: string) => { const v = m.state.engineState.activeModules[name]; return v === undefined ? mods.find(x => x.name === name)?.enabled !== false : v; };
  const [busy, setBusy] = React.useState(false);
  const toggle = async (row: ModRow, on: boolean) => {
    setBusy(true);
    try { report(await host.setModule(row.name, on), `已${on ? '开启' : '关闭'}「${row.label ?? row.name}」`); }
    finally { setBusy(false); }
  };
  const disabled = busy || !!host.locked;
  const level = (parent: string | undefined, live: boolean, depth: number): React.ReactNode => {
    const kids = mods.filter(x => x.parent === parent);
    const seen = new Set<string>();
    return kids.map(row => {
      if (row.exclusive) {
        if (seen.has(row.exclusive)) return null;
        seen.add(row.exclusive);
        const members = kids.filter(x => x.exclusive === row.exclusive), on = members.find(x => pref(x.name));
        const g = groups[row.exclusive];
        return (
          <div key={'g:' + row.exclusive} {...solve('module', { kind: 'group', off: live ? undefined : '' })} style={{ '--depth': depth } as React.CSSProperties}>
            <div {...part('row')}>
              <span {...part('label')}>{g?.label ?? row.exclusive}<small>{members.length} 选 1</small></span>
              <Choice value={on?.name ?? ''} label={g?.label ?? row.exclusive} disabled={disabled || !live}
                options={members.map(x => ({ value: x.name, label: x.label ?? x.name }))} onChange={v => { const x = members.find(y => y.name === v); if (x) void toggle(x, true); }} />
            </div>
            {g?.migrate !== false ? <p {...part('hint')}>切换后，下一轮会让模型按新规则换算现有数据；旧数据保留，切回来还在。</p> : null}
            {members.map(x => mods.some(y => y.parent === x.name) ? <React.Fragment key={x.name}>{level(x.name, live && pref(x.name), depth + 1)}</React.Fragment> : null)}
          </div>
        );
      }
      const on = pref(row.name);
      return (
        <div key={row.name} {...solve('module', { off: live ? undefined : '' })} style={{ '--depth': depth } as React.CSSProperties}>
          <div {...part('row')}>
            <span {...part('label')}>{row.label ?? row.name}{!live ? <small>上级已关闭</small> : null}</span>
            <K.Switch checked={on} aria-label={row.label ?? row.name} onCheckedChange={v => { if (!disabled && live) void toggle(row, v); }} />
          </div>
          {level(row.name, live && on, depth + 1)}
        </div>
      );
    });
  };
  return (
    <>
      <p {...part('intro')}>关闭的模块不再进入提示词，状态栏里对应的页签和字段也会隐藏；数据保留，重新开启后还在。元信息与角色核心始终开启。</p>
      <div {...solve('module-tree')}>{level(undefined, true, 0)}</div>
    </>
  );
}
function Choice({ value, options, onChange, label, disabled }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; label: string; disabled?: boolean }) {
  const K = useKit();
  if (K.Segmented && !disabled) return <K.Segmented size="sm" label={label} value={value} onValueChange={onChange} options={options} />;
  return (
    <div {...solve('choice')} role="radiogroup" aria-label={label}>
      {options.map(o => <button key={o.value} type="button" role="radio" aria-checked={o.value === value} disabled={disabled} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

// ── 清单上限 / 变化上限 ──

interface LimitRow { pattern: string; group: string; label: string; value: ListLimit | number; base: ListLimit | number }
const parts = (p: string) => p.split('.');
/** Group by the root collection; name by the declared label, prefixed with the record it sits in (关系 · 约定). */
function naming(m: ReturnType<typeof useModel>, pattern: string, own?: string): { group: string; label: string } {
  const ps = parts(pattern);
  const group = m.label([ps[0]!]);
  const inner: string[] = [];
  for (let i = 1; i < ps.length - 1; i++) if (ps[i + 1] === '*' && ps[i] !== '*') inner.push(m.label(ps.slice(0, i + 1)));
  const label = own ?? m.label(ps);
  return { group, label: [...inner, label].join(' · ') };
}
function listRows(m: ReturnType<typeof useModel>): LimitRow[] {
  return Object.entries(m.def.lists ?? {}).filter(([p]) => !dormant(m.def, m.state, parts(p))).map(([pattern, rule]) => ({
    pattern, ...naming(m, pattern, (rule as { label?: string }).label),
    value: m.state.engineState.settings?.lists?.[pattern] ?? { max: rule.max, warn: rule.warn }, base: { max: rule.max, warn: rule.warn },
  }));
}
function deltaRows(m: ReturnType<typeof useModel>): LimitRow[] {
  return Object.entries(m.def.numeric ?? {}).filter(([p, r]) => r.maxDelta !== undefined && !dormant(m.def, m.state, parts(p))).map(([pattern, rule]) => ({
    pattern, ...naming(m, pattern), value: m.state.engineState.settings?.maxDelta?.[pattern] ?? rule.maxDelta!, base: rule.maxDelta!,
  }));
}
const same = (a: ListLimit | number, b: ListLimit | number) => JSON.stringify(a) === JSON.stringify(b);

function Limits({ host, report, kind }: { host: SettingsHost; report: (r: InteractResult, done: string) => void; kind: 'lists' | 'delta' }) {
  const K = useKit(), m = useModel();
  const rows = kind === 'lists' ? listRows(m) : deltaRows(m);
  const [draft, setDraft] = React.useState<Record<string, ListLimit | number>>({});
  const [busy, setBusy] = React.useState(false);
  const value = (r: LimitRow) => draft[r.pattern] ?? r.value;
  const changed = rows.filter(r => !same(value(r), r.value));
  const invalid = (v: ListLimit | number) => typeof v === 'number' ? !(v >= 0) : !(Number.isInteger(v.max) && Number.isInteger(v.warn) && v.max >= 1 && v.warn >= 0 && v.warn <= v.max);
  const bad = changed.some(r => invalid(value(r)));
  const save = async () => {
    const patch: Record<string, ListLimit | number | null> = Object.fromEntries(changed.map(r => [r.pattern, same(value(r), r.base) ? null : value(r)]));
    setBusy(true);
    try {
      const result = await host.setSettings(kind === 'lists' ? { lists: patch as Record<string, ListLimit | null> } : { maxDelta: patch as Record<string, number | null> });
      report(result, `已保存 ${changed.length} 项`);
      if (result.ok) setDraft({});
    } finally { setBusy(false); }
  };
  const groups = [...new Set(rows.map(r => r.group))];
  return (
    <>
      <p {...part('intro')}>{kind === 'lists'
        ? '清单到「预警线」时，会提醒模型合并相近条目、删掉过时内容；到「上限」后不再接受新增。调低上限不会删除已有条目。'
        : '模型一次能改动的最大幅度，超出部分会被截断并告诉模型。0 表示不限制。'}</p>
      {rows.length ? groups.map(g => (
        <section key={g} {...solve('limit-group')}>
          <h4>{g}</h4>
          <div {...solve('limits', { kind })}>
            {kind === 'lists' ? <div {...part('cols')} aria-hidden="true"><span /><span>预警线</span><span>上限</span><span /></div> : null}
            {rows.filter(r => r.group === g).map(r => {
              const v = value(r), dirty = !same(v, r.value), custom = !same(v, r.base);
              return (
                <div key={r.pattern} {...solve('limit', { dirty: dirty ? '' : undefined, invalid: invalid(v) ? '' : undefined })}>
                  <span {...part('label')} title={r.pattern}>{r.label}</span>
                  {typeof v === 'number'
                    ? <Stepper value={v} min={0} label={`${r.label}：单次变化上限`} onChange={n => setDraft(d => ({ ...d, [r.pattern]: n }))} unit={v === 0 ? '不限' : '±'} />
                    : <>
                      <Stepper value={v.warn} min={0} label={`${r.label}：预警线`} onChange={n => setDraft(d => ({ ...d, [r.pattern]: { ...(value(r) as ListLimit), warn: n } }))} />
                      <Stepper value={v.max} min={1} label={`${r.label}：上限`} onChange={n => setDraft(d => ({ ...d, [r.pattern]: { ...(value(r) as ListLimit), max: n } }))} />
                    </>}
                  <span {...part('reset')}>{custom
                    ? <K.Button size="sm" variant="ghost" onClick={() => setDraft(d => ({ ...d, [r.pattern]: r.base }))} title={'默认 ' + fmt(r.base)}>恢复默认</K.Button>
                    : <small>默认</small>}</span>
                </div>
              );
            })}
          </div>
        </section>
      )) : <K.Empty title="没有可调整的项目" description="当前开启的模块里没有声明这类上限。" />}
      {changed.length ? (
        <div {...solve('settings-save')}>
          <span>{bad ? (kind === 'lists' ? '预警线不能高于上限' : '请输入不小于 0 的数') : `${changed.length} 项未保存`}</span>
          <K.Button size="sm" variant="ghost" onClick={() => setDraft({})}>放弃</K.Button>
          <K.Button size="sm" variant="primary" disabled={bad || busy || !!host.locked} onClick={() => void save()}>保存</K.Button>
        </div>
      ) : null}
    </>
  );
}
const fmt = (v: ListLimit | number) => typeof v === 'number' ? (v === 0 ? '不限' : '±' + v) : `${v.warn} / ${v.max}`;
function Stepper({ value, min, label, onChange, unit }: { value: number; min: number; label: string; onChange: (n: number) => void; unit?: string }) {
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => setText(String(value)), [value]);
  const commit = (s: string) => { const n = Number(s); if (s.trim() !== '' && Number.isFinite(n)) onChange(Math.max(min, Math.round(n))); else setText(String(value)); };
  return (
    <span {...solve('stepper')}>
      <button type="button" aria-label={label + ' 减 1'} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      {unit === '±' ? <span {...part('unit')}>±</span> : null}
      <input inputMode="numeric" aria-label={label} value={text} onChange={e => setText(e.target.value)} onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }} />
      {unit === '不限' ? <span {...part('unit')}>不限</span> : null}
      <button type="button" aria-label={label + ' 加 1'} onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}

// ── 显示 ──

function Display({ host }: { host: SettingsHost }) {
  const K = useKit();
  return (
    <div {...solve('pref-list')}>
      <div {...solve('pref', { kind: 'switch' })}>
        <span {...part('label')}>直接显示剧透<small>关系、能力、物品、真相等默认遮住的内容直接展开。隐藏字段仍然不显示。</small></span>
        <K.Switch checked={host.prefs.revealSpoilers} aria-label="直接显示剧透" onCheckedChange={v => host.onPrefs({ revealSpoilers: v })} />
      </div>
      {host.kami ? (
        <div {...solve('pref', { kind: 'switch' })}>
          <span {...part('label')}>跟随卡密预设的皮肤<small>关闭后状态栏使用 SOLVE 自带的默认皮肤（松绿与暖石灰）。</small></span>
          <K.Switch checked={host.prefs.skin !== 'solve'} aria-label="跟随卡密预设的皮肤" onCheckedChange={v => host.onPrefs({ skin: v ? 'auto' : 'solve' })} />
        </div>
      ) : null}
      {host.openDebug ? (
        <div {...solve('pref', { kind: 'action' })}>
          <span {...part('label')}>调试面板<small>给卡作者用：看完整状态、历史与反馈，预演或提交操作，查看发给模型的内容。</small></span>
          <K.Button size="sm" onClick={host.openDebug}>打开</K.Button>
        </div>
      ) : null}
    </div>
  );
}

// ── 音乐 ──

function Music({ host, bgm }: { host: SettingsHost; bgm?: BgmView }) {
  const K = useKit(), m = useModel();
  const author = (m.def.bgm?.library ?? []) as BgmTrack[];
  const mine = host.tracks?.list ?? [];
  const moods = [...new Set([...author, ...mine].flatMap(t => t.moods))];
  const [title, setTitle] = React.useState(''), [url, setUrl] = React.useState(''), [picked, setPicked] = React.useState<string[]>([]);
  const okUrl = /^(?:https?:|blob:|data:audio\/|\/)/u.test(url.trim());
  const Text = K.TextField;
  const field = (props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">) => Text ? <Text size="sm" {...props} /> : <input {...props} />;
  const add = () => { if (!okUrl || !host.tracks) return; host.tracks.add({ url: url.trim(), ...(title.trim() ? { title: title.trim() } : {}), moods: picked }); setTitle(''); setUrl(''); setPicked([]); };
  const row = (t: BgmTrack, own: boolean) => (
    <li key={(own ? 'mine:' : '') + t.id} {...solve('track')}>
      <span {...part('title')}>{t.title ?? decodeURIComponent(t.url.split('/').pop() ?? t.url)}</span>
      <span {...part('moods')}>{t.moods.length ? t.moods.map(x => <K.Badge key={x}>{x}</K.Badge>) : <small>只按地点</small>}</span>
      {own ? <K.Button size="sm" variant="ghost" onClick={() => host.tracks?.remove(t.id)} aria-label={'删除 ' + (t.title ?? t.url)}>删除</K.Button> : <span />}
    </li>
  );
  return (
    <>
      {bgm ? (
        <div {...solve('pref-list')}>
          <div {...solve('pref', { kind: 'switch' })}><span {...part('label')}>播放背景音乐<small>{bgm.enabled && bgm.title ? '正在播放：' + bgm.title : '已停止'}{bgm.source ? ' · ' + bgm.source : ''}</small></span>
            <K.Switch checked={bgm.enabled} onCheckedChange={bgm.onToggle} aria-label="播放背景音乐" /></div>
          <div {...solve('pref')}><span {...part('label')}>音量</span>
            <K.Slider value={Math.round(bgm.volume * 100)} min={0} max={100} onValueChange={v => bgm.onVolume(v / 100)} format={v => v + '%'} aria-label="音量" /></div>
        </div>
      ) : null}
      <p {...part('intro')}>选曲顺序：当前地点指定的曲目 → 所在区域的曲目 → 按场景情绪从曲库里挑。你添加的曲目和作者的曲库一起参与按情绪选曲，只保存在这台设备上。</p>
      <section {...solve('limit-group')}>
        <h4>我的曲目<small>{mine.length}</small></h4>
        {mine.length ? <ul {...solve('tracks')}>{mine.map(t => row(t, true))}</ul> : <p {...part('empty')}>还没有添加曲目。</p>}
        {host.tracks ? (
          <form {...solve('track-add')} onSubmit={e => { e.preventDefault(); add(); }}>
            {field({ placeholder: '名称（可选）', value: title, onChange: e => setTitle(e.target.value), 'aria-label': '曲目名称' })}
            {field({ placeholder: '音频链接 https://…', value: url, onChange: e => setUrl(e.target.value), 'aria-label': '音频链接', inputMode: 'url' })}
            <div {...part('moods')} role="group" aria-label="情绪">
              {moods.map(x => <button key={x} type="button" aria-pressed={picked.includes(x)} onClick={() => setPicked(p => p.includes(x) ? p.filter(y => y !== x) : [...p, x])}>{x}</button>)}
            </div>
            <K.Button type="submit" size="sm" variant="primary" disabled={!okUrl}>添加</K.Button>
          </form>
        ) : null}
      </section>
      {author.length ? (
        <section {...solve('limit-group')}>
          <h4>作者曲库<small>{author.length}</small></h4>
          <ul {...solve('tracks')}>{author.map(t => row(t, false))}</ul>
        </section>
      ) : null}
    </>
  );
}
