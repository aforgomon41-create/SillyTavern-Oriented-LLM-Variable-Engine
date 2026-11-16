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
import { UpdateSection, type UpdateHost } from './update.js';
import { StructureSection, type StructureHost } from './gate.js';
import { imageFields } from './imagegen.js';

/** 生图 (this browser): which plugin draws and when; the switches themselves are the 配图 modules (per chat). */
export interface ImageSettingsHost {
  prefs: { plugin: string; mode: 'auto' | 'button' };
  onPrefs(patch: Partial<{ plugin: string; mode: 'auto' | 'button' }>): void;
  plugins: { id: string; label: string; installed: boolean; ready: boolean; note?: string }[];
  /** Label of the plugin that will draw now. */
  active?: string;
  usage: { entities: number; pictures: number };
  /** Delete the pictures of entities that no longer exist; resolves to the number of files removed. */
  prune(): Promise<number>;
}

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
  /** Opens the structure builder (for card authors). */
  openBuilder?: () => void;
  /** Who writes the operations: the story model, or a separate operator model (this browser). */
  update?: UpdateHost;
  /** Which structure new chats use, and what happens with cards that bring MVU / ERA (this browser). */
  structure?: StructureHost;
  /** 设置存档 (the account): this structure's saved sets of per-chat settings. */
  presets?: {
    list: { id: string; name: string; savedAt: number }[];
    /** When 「上次的设置」 was last recorded. */
    last?: number;
    save(name: string): InteractResult; overwrite(id: string): InteractResult; remove(id: string): void;
    apply(id: string): Promise<InteractResult>;
  };
  /** Remove everything SOLVE keeps in this browser; resolves to the number of items removed. */
  clearLocal?: () => Promise<number>;
  /** Quick buttons above the tavern's input (this browser). */
  buttons?: { list: { id: string; label: string; desc: string; on: boolean }[]; onToggle(id: string, on: boolean): void };
  /** 生图: plugin and timing (this browser). */
  images?: ImageSettingsHost;
  /** Section to open first (previews). */
  section?: string;
}

type Section = 'modules' | 'images' | 'lists' | 'delta' | 'presets' | 'structure' | 'update' | 'buttons' | 'display' | 'music';
const SECTIONS: { id: Section; label: string; note: string }[] = [
  { id: 'modules', label: '模块', note: '按聊天保存' },
  { id: 'images', label: '生图', note: '开关按聊天' },
  { id: 'lists', label: '清单上限', note: '按聊天保存' },
  { id: 'delta', label: '变化上限', note: '按聊天保存' },
  { id: 'presets', label: '设置存档', note: '所有聊天' },
  { id: 'structure', label: '数据结构', note: '本机' },
  { id: 'update', label: '变量更新', note: '本机' },
  { id: 'buttons', label: '快捷按钮', note: '本机' },
  { id: 'display', label: '显示', note: '本机' },
  { id: 'music', label: '音乐', note: '本机' },
];

export function SettingsBody({ host, bgm, onBack }: { host: SettingsHost; bgm?: BgmView; onBack: () => void }) {
  const K = useKit(), m = useModel();
  const [box, wide] = useWide(900);
  const sections = SECTIONS.filter(s => s.id !== 'delta' || deltaRows(m).length).filter(s => s.id !== 'music' || bgm || host.tracks).filter(s => s.id !== 'update' || host.update).filter(s => s.id !== 'structure' || host.structure).filter(s => s.id !== 'buttons' || host.buttons).filter(s => s.id !== 'presets' || host.presets)
    .filter(s => s.id !== 'images' || (host.images && imageFields(m).length));
  const [current, setCurrent] = React.useState<Section>(() => sections.some(x => x.id === host.section) ? host.section as Section : 'modules');
  const [status, setStatus] = React.useState<{ text: string; tone?: 'error' } | undefined>();
  const report = (r: InteractResult, done: string) => setStatus(r.ok ? { text: done } : { text: r.error, tone: 'error' });
  const body = (id: Section) => (
    <div {...solve('settings-section', { section: id })}>
      {id === 'modules' ? <Modules host={host} report={report} />
        : id === 'images' ? <Images host={host} report={report} />
        : id === 'lists' ? <Limits host={host} report={report} kind="lists" />
        : id === 'delta' ? <Limits host={host} report={report} kind="delta" />
        : id === 'presets' ? <Presets host={host} report={report} />
        : id === 'structure' ? <StructureSection host={host.structure!} />
        : id === 'update' ? <UpdateSection host={host.update!} />
        : id === 'buttons' ? <Buttons host={host} />
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
  const own = new Set(imageModules(m));
  const mods: ModRow[] = Object.entries(m.def.modules ?? {}).filter(([name]) => !own.has(name)).map(([name, spec]) => ({ name, ...spec }));
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
const IMAGE_ROOT = 'image';
function imageModules(m: ReturnType<typeof useModel>): string[] {
  const fields = imageFields(m);
  return fields.length ? [IMAGE_ROOT, ...fields.map(f => f.module)] : [];
}

// ── 生图 ──

function Images({ host, report }: { host: SettingsHost; report: (r: InteractResult, done: string) => void }) {
  const K = useKit(), m = useModel(), img = host.images!;
  const fields = imageFields(m);
  const on = (name: string) => { const v = m.state.engineState.activeModules[name]; return v === undefined ? m.def.modules?.[name]?.enabled !== false : v; };
  const [busy, setBusy] = React.useState(false);
  const toggle = async (name: string, label: string, v: boolean) => {
    setBusy(true);
    try { report(await host.setModule(name, v), `已${v ? '开启' : '关闭'}「${label}」`); } finally { setBusy(false); }
  };
  const disabled = busy || !!host.locked;
  const all = on(IMAGE_ROOT);
  const [cleaning, setCleaning] = React.useState(false);
  const prune = async () => {
    setCleaning(true);
    try { const n = await img.prune(); report({ ok: true }, n ? `已删除 ${n} 张图片` : '没有需要清理的图片'); }
    catch (e) { report({ ok: false, error: e instanceof Error ? e.message : String(e) }, ''); }
    finally { setCleaning(false); }
  };
  const sameEvent = img.plugins.filter(p => (p.id === 'chatu8' || p.id === 'chami') && p.installed).length > 1;
  return (
    <>
      <p {...part('intro')}>开启后，模型会在新建角色、地点等实体时写一段生图提示词（imagePrompt），状态栏用你装好的生图插件按它出图。关闭的项不再进入提示词。</p>
      <div {...solve('module-tree')}>
        <div {...solve('module')} style={{ '--depth': 0 } as React.CSSProperties}>
          <div {...part('row')}>
            <span {...part('label')}>配图<small>总开关 · 按聊天保存</small></span>
            <K.Switch checked={all} aria-label="配图总开关" onCheckedChange={v => { if (!disabled) void toggle(IMAGE_ROOT, '配图', v); }} />
          </div>
          {fields.map(f => (
            <div key={f.module} {...solve('module', { off: all ? undefined : '' })} style={{ '--depth': 1 } as React.CSSProperties}>
              <div {...part('row')}>
                <span {...part('label')}>{f.label}{!all ? <small>上级已关闭</small> : <small>{f.shape === 'portrait' ? '竖图' : f.shape === 'landscape' ? '横图' : '方图'}</small>}</span>
                <K.Switch checked={on(f.module)} aria-label={`给${f.label}配图`} onCheckedChange={v => { if (!disabled && all) void toggle(f.module, f.label + '配图', v); }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <section {...solve('limit-group')}>
        <h4>生图插件<small>本机</small></h4>
        <div {...solve('image-plugins')} role="radiogroup" aria-label="生图插件">
          {[{ id: 'auto', label: '自动选择', installed: true, ready: !!img.active, note: img.active ? `现在会用「${img.active}」` : '没有检测到可用的生图插件' }, ...img.plugins].map(p => (
            <button key={p.id} type="button" role="radio" aria-checked={img.prefs.plugin === p.id} {...solve('image-plugin', { ready: p.ready ? '' : undefined })}
              disabled={!p.installed && img.prefs.plugin !== p.id} onClick={() => img.onPrefs({ plugin: p.id })}>
              <span {...part('label')}>{p.label}</span>
              <span {...part('state')}>{p.id === 'auto' ? '' : p.ready ? '可用' : p.installed ? '未就绪' : '未安装'}</span>
              {p.note ? <small>{p.note}</small> : null}
            </button>
          ))}
        </div>
        {sameEvent ? <p {...part('hint')}>智绘姬和酒馆场景插件响应同一个调用，两个都装着时会各画一张，SOLVE 用先画完的那张；建议只开其中一个的生图。</p> : null}
      </section>
      <section {...solve('limit-group')}>
        <h4>生图方式<small>本机</small></h4>
        <Choice value={img.prefs.mode} label="生图方式" options={[{ value: 'button', label: '按钮生成' }, { value: 'auto', label: '自动生成' }]} onChange={v => img.onPrefs({ mode: v as 'auto' | 'button' })} />
        <p {...part('hint')}>{img.prefs.mode === 'auto'
          ? '每轮回复后，给新写或改过提示词的实体自动出图（一次画一张，排队进行）。作者预制了图片的实体不自动生成。'
          : '在图片位置显示「生成配图」按钮，点了才画。'}</p>
      </section>
      <section {...solve('limit-group')}>
        <h4>图片<small>本聊天</small></h4>
        <div {...solve('pref', { kind: 'action' })}>
          <span {...part('label')}>已生成 {img.usage.pictures} 张<small>{img.usage.entities} 个实体；存放在酒馆的 user/images/ 下。删除实体后，它的图片可以在这里清理。</small></span>
          <K.Button size="sm" disabled={cleaning || !img.usage.pictures} onClick={() => void prune()}>清理无主图片</K.Button>
        </div>
      </section>
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

// ── 快捷按钮 ──

function Buttons({ host }: { host: SettingsHost }) {
  const K = useKit(), b = host.buttons!;
  return (
    <>
      <p {...part('intro')}>显示在酒馆输入框上方的一排按钮，用来处理变量没算对、卡住或报错的情况。只影响这台设备。</p>
      <div {...solve('pref-list')}>
        {b.list.map(x => (
          <div key={x.id} {...solve('pref', { kind: 'switch' })}>
            <span {...part('label')}>{x.label}<small>{x.desc}</small></span>
            <K.Switch checked={x.on} aria-label={`显示「${x.label}」按钮`} onCheckedChange={v => b.onToggle(x.id, v)} />
          </div>
        ))}
      </div>
    </>
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
      {host.openBuilder ? (
        <div {...solve('pref', { kind: 'action' })}>
          <span {...part('label')}>结构制作<small>给卡作者用：修改这张卡的数据结构（字段、模块、布局），检查后写进角色世界书或导出脚本。</small></span>
          <K.Button size="sm" onClick={host.openBuilder}>打开</K.Button>
        </div>
      ) : null}
      {host.clearLocal ? <ClearLocal clear={host.clearLocal} /> : null}
    </div>
  );
}
/** 清除本机数据: what SOLVE keeps in this browser (preferences, the archive cache). Chats are not touched. */
function ClearLocal({ clear }: { clear: () => Promise<number> }) {
  const K = useKit();
  const [state, setState] = React.useState<'idle' | 'confirm' | 'busy' | number>('idle');
  return (
    <div {...solve('pref', { kind: 'action' })}>
      <span {...part('label')}>清除本机数据
        <small>{typeof state === 'number' ? `已清除 ${state} 项本机设置和缓存。刷新页面后恢复默认。`
          : '删掉 SOLVE 存在这个浏览器里的设置（显示、变量更新、快捷按钮、生图、悬浮球位置…）和存档缓存。聊天记录和里面的变量、跟着酒馆账号的「设置存档」都不受影响。不再用 SOLVE 时可以清掉。'}</small></span>
      {state === 'confirm' ? (
        <span {...part('buttons')}>
          <K.Button size="sm" variant="ghost" onClick={() => setState('idle')}>取消</K.Button>
          <K.Button size="sm" variant="primary" onClick={() => { setState('busy'); void clear().then(n => setState(n), () => setState('idle')); }}>确定清除</K.Button>
        </span>
      ) : <K.Button size="sm" disabled={state === 'busy'} onClick={() => setState('confirm')}>{state === 'busy' ? '清除中…' : '清除'}</K.Button>}
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

/** 设置存档: save this chat's module switches and limits as a named set; new chats can start with one. */
function Presets({ host, report }: { host: SettingsHost; report: (r: InteractResult, done: string) => void }) {
  const K = useKit(), p = host.presets!;
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState<string | undefined>();
  const day = (t: number) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const apply = async (id: string, label: string) => { setBusy(id); try { report(await p.apply(id), `已把「${label}」套用到这个聊天`); } finally { setBusy(undefined); } };
  return (
    <>
      <p {...part('intro')}>「模块」「清单上限」「变化上限」是按聊天保存的，新聊天默认从结构自带的设置开始。把一个聊天调好的设置存成一套，以后开新聊天时在弹窗里选它就行。SOLVE 也会自动记下你最近一次改的设置（「上次的设置」）。存档跟着酒馆账号走，换浏览器也在。</p>
      <section {...solve('limit-group')}>
        <h4>把这个聊天的设置存成一套</h4>
        <div {...solve('pref-list')}>
          <form {...solve('pref')} onSubmit={e => { e.preventDefault(); const r = p.save(name); report(r, `已存为「${name.trim() || '未命名'}」`); if (r.ok) setName(''); }}>
            <input {...solve('text-input')} value={name} onChange={e => setName(e.target.value)} placeholder="起个名字，如 日常 · 关闭战斗" aria-label="这套设置的名字" maxLength={40} />
            <K.Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>保存</K.Button>
          </form>
        </div>
      </section>
      <section {...solve('limit-group')}>
        <h4>存好的设置<small>{p.list.length}</small></h4>
        <div {...solve('pref-list')}>
          {p.last ? (
            <div {...solve('pref', { kind: 'action' })} data-preset="last">
              <span {...part('label')}>上次的设置<small>自动记录 · {day(p.last)}</small></span>
              <K.Button size="sm" variant="ghost" disabled={!!busy || !!host.locked} onClick={() => void apply('last', '上次的设置')}>{busy === 'last' ? '套用中…' : '套用到这个聊天'}</K.Button>
            </div>
          ) : null}
          {p.list.map(x => (
            <div key={x.id} {...solve('pref', { kind: 'action' })} data-preset={x.id}>
              <span {...part('label')}>{x.name}<small>存于 {day(x.savedAt)}</small></span>
              <span {...part('buttons')}>
                <K.Button size="sm" variant="ghost" disabled={!!busy || !!host.locked} onClick={() => void apply(x.id, x.name)}>{busy === x.id ? '套用中…' : '套用'}</K.Button>
                <K.Button size="sm" variant="ghost" onClick={() => report(p.overwrite(x.id), `已用这个聊天的设置覆盖「${x.name}」`)}>覆盖</K.Button>
                <K.Button size="sm" variant="ghost" onClick={() => { p.remove(x.id); report({ ok: true }, `已删除「${x.name}」`); }} aria-label={`删除 ${x.name}`}>删除</K.Button>
              </span>
            </div>
          ))}
          {!p.list.length && !p.last ? <p {...part('empty')}>还没有存好的设置。</p> : null}
        </div>
      </section>
    </>
  );
}
