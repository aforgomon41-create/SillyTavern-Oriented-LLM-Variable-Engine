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
  /** Music library of this browser: default library, the player's tracks, collections. */
  music?: MusicHost;
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
  const sections = SECTIONS.filter(s => s.id !== 'delta' || deltaRows(m).length).filter(s => s.id !== 'music' || bgm || host.music).filter(s => s.id !== 'update' || host.update).filter(s => s.id !== 'structure' || host.structure).filter(s => s.id !== 'buttons' || host.buttons).filter(s => s.id !== 'presets' || host.presets)
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

/** One track of the library as the settings page shows it. */
export interface MusicTrack { id: string; title: string; url: string; tags: string[]; kind: 'default' | 'mine' | 'author'; detail?: string; seconds?: number }
export interface MusicHost {
  tracks: MusicTrack[];
  collections: { id: string; name: string; tracks: string[] }[];
  /** What mood music is chosen from: 'default' (默认曲库) / 'all' / a collection id. */
  active: string;
  useDefaults: boolean;
  defaultsState: { state: 'off' | 'loading' | 'ready' | 'failed'; error?: string; credit?: string };
  /** Scene moods of this structure (tags that drive the automatic choice). */
  moods: string[];
  /** Tracks the current source picks from. */
  pool: number;
  playingId?: string;
  failed?: boolean;
  setActive(id: string): void;
  setUseDefaults(on: boolean): void;
  add(track: { title?: string; url: string; tags: string[] }, into: string[]): void;
  update(id: string, patch: { title?: string; tags?: string[] }): void;
  remove(id: string): void;
  createCollection(name: string, tracks?: string[]): string;
  renameCollection(id: string, name: string): void;
  deleteCollection(id: string): void;
  setInCollection(id: string, tracks: string[], remove?: boolean): void;
  preview(id: string): void;
  next(): void;
}
const splitTags = (text: string) => [...new Set(text.split(/[\s,，、#]+/u).map(t => t.trim()).filter(Boolean))];
const minutes = (s?: number) => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';

function Music({ host, bgm }: { host: SettingsHost; bgm?: BgmView }) {
  const K = useKit();
  const mu = host.music;
  const [query, setQuery] = React.useState('');
  const [picked, setPicked] = React.useState<string[]>([]);
  const [chosen, setChosen] = React.useState<string[]>([]);
  const [editing, setEditing] = React.useState<string | undefined>();
  const [naming, setNaming] = React.useState<{ mode: 'new' | 'rename'; name: string } | undefined>();
  const [adding, setAdding] = React.useState(false);
  const [moreTags, setMoreTags] = React.useState(false);
  const Text = K.TextField;
  const field = (props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>) => Text ? <Text size="sm" {...props} /> : <input {...props} />;
  const playback = bgm ? (
    <div {...solve('pref-list')}>
      <div {...solve('pref', { kind: 'switch' })}><span {...part('label')}>播放背景音乐<small>{bgm.enabled && bgm.title ? '正在播放：' + bgm.title : '已停止'}{bgm.source ? ' · ' + bgm.source : ''}</small></span>
        <K.Switch checked={bgm.enabled} onCheckedChange={bgm.onToggle} aria-label="播放背景音乐" /></div>
      <div {...solve('pref')}><span {...part('label')}>音量</span>
        <K.Slider value={Math.round(bgm.volume * 100)} min={0} max={100} onValueChange={v => bgm.onVolume(v / 100)} format={v => v + '%'} aria-label="音量" /></div>
      {mu && bgm.enabled ? <div {...solve('pref', { kind: 'action' })}><span {...part('label')}>换一首<small>同一情绪的下一首</small></span><K.Button size="sm" variant="ghost" onClick={() => mu.next()}>换一首</K.Button></div> : null}
    </div>
  ) : null;
  if (!mu) return <>{playback}</>;
  const coll = mu.collections.find(c => c.id === mu.active);
  const allTags = [...new Set([...mu.moods, ...mu.tracks.flatMap(t => t.tags)])];
  const words = splitTags(query.replace(/#/gu, ' ')).map(w => w.toLowerCase());
  const shown = mu.tracks.filter(t => (!picked.length || picked.every(p => t.tags.includes(p)))
    && words.every(w => t.title.toLowerCase().includes(w) || (t.detail ?? '').toLowerCase().includes(w) || t.tags.some(x => x.toLowerCase().includes(w))));
  const inColl = (id: string) => !!coll?.tracks.includes(id);
  const sourceLabel = (id: string) => id === 'default' ? '默认曲库' : id === 'all' ? '全部曲目' : mu.collections.find(c => c.id === id)?.name ?? id;
  const count = (id: string) => id === 'default' ? mu.tracks.filter(t => t.kind === 'default').length : id === 'all' ? mu.tracks.filter(t => t.kind !== 'author').length : mu.collections.find(c => c.id === id)?.tracks.length ?? 0;
  const sources = [...(mu.useDefaults ? ['default'] : []), 'all', ...mu.collections.map(c => c.id)];
  const toggle = (id: string) => setChosen(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]);
  return (
    <>
      {playback}
      <section {...solve('limit-group')}>
        <h4>播放来源<small>按场景情绪从这里选曲 · {mu.pool} 首</small></h4>
        <div {...solve('pref-list')}>
          <div {...solve('pref', { kind: 'sets' })}>
            <span {...part('label')}>来源{coll ? <small>合集 · {coll.tracks.length} 首</small> : null}</span>
            <span {...part('buttons')}>
              <select {...solve('select')} aria-label="播放来源" value={sources.includes(mu.active) ? mu.active : 'all'} onChange={e => mu.setActive(e.target.value)}>
                {sources.map(id => <option key={id} value={id}>{sourceLabel(id)}（{count(id)}）</option>)}
              </select>
              <K.Button size="sm" variant="ghost" onClick={() => setNaming({ mode: 'new', name: '' })}>新建合集</K.Button>
              {coll ? <K.Button size="sm" variant="ghost" onClick={() => setNaming({ mode: 'rename', name: coll.name })}>重命名</K.Button> : null}
              {coll ? <K.Button size="sm" variant="ghost" onClick={() => { if ((globalThis as any).confirm?.(`删除合集「${coll.name}」？曲目本身不删。`) ?? true) mu.deleteCollection(coll.id); }}>删除</K.Button> : null}
            </span>
          </div>
          {naming ? (
            <form {...solve('pref', { kind: 'name' })} onSubmit={e => { e.preventDefault(); if (!naming.name.trim()) return;
              if (naming.mode === 'rename' && coll) mu.renameCollection(coll.id, naming.name);
              else { const id = mu.createCollection(naming.name, chosen); mu.setActive(id); setChosen([]); }
              setNaming(undefined); }}>
              <input aria-label="合集名称" value={naming.name} placeholder={naming.mode === 'new' ? (chosen.length ? `新合集（含选中的 ${chosen.length} 首）` : '新合集名称，如「战斗曲」') : '合集名称'} autoFocus onChange={e => setNaming({ ...naming, name: e.target.value })} />
              <K.Button size="sm" type="submit" disabled={!naming.name.trim()}>{naming.mode === 'new' ? '建立' : '改名'}</K.Button>
            </form>
          ) : null}
          <div {...solve('pref', { kind: 'switch' })}>
            <span {...part('label')}>使用默认曲库<small>{mu.defaultsState.state === 'loading' ? '正在读取曲目清单…' : mu.defaultsState.state === 'failed' ? `读取失败：${mu.defaultsState.error}` : mu.defaultsState.credit ?? '公有领域古典录音，不用代理也能播放'}</small></span>
            <K.Switch checked={mu.useDefaults} aria-label="使用默认曲库" onCheckedChange={v => mu.setUseDefaults(v)} />
          </div>
          {mu.pool === 0 ? <p {...part('hint')} data-tone="warn">「{sourceLabel(mu.active)}」里还没有曲目，现在不会按情绪放音乐。</p> : null}
        </div>
      </section>
      <section {...solve('limit-group')}>
        <h4>曲目<small>{mu.tracks.length}</small></h4>
        <div {...solve('music-find')}>
          {field({ placeholder: '搜索名称或 #标签', value: query, onChange: e => setQuery(e.target.value), 'aria-label': '搜索曲目', type: 'search' })}
          <div {...part('tags')} role="group" aria-label="按标签筛选">
            {allTags.filter(t => moreTags || mu.moods.includes(t) || picked.includes(t)).map(t => <button key={t} type="button" aria-pressed={picked.includes(t)} data-mood={mu.moods.includes(t) ? '' : undefined} onClick={() => setPicked(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])}>{t}</button>)}
            {allTags.length > mu.moods.length ? <button type="button" data-kind="more" aria-expanded={moreTags} onClick={() => setMoreTags(v => !v)}>{moreTags ? '收起' : `更多标签 ${allTags.filter(t => !mu.moods.includes(t)).length}`}</button> : null}
          </div>
        </div>
        {chosen.length ? (
          <div {...solve('music-bulk')}>
            <span>选中 {chosen.length} 首</span>
            <select {...solve('select')} aria-label="加入合集" value="" onChange={e => { const v = e.target.value; if (v === '$new') setNaming({ mode: 'new', name: '' }); else if (v) { mu.setInCollection(v, chosen); setChosen([]); } }}>
              <option value="">加入合集…</option>
              {mu.collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="$new">新合集…</option>
            </select>
            {coll && chosen.some(inColl) ? <K.Button size="sm" variant="ghost" onClick={() => { mu.setInCollection(coll.id, chosen, true); setChosen([]); }}>移出「{coll.name}」</K.Button> : null}
            <K.Button size="sm" variant="ghost" onClick={() => setChosen([])}>取消选择</K.Button>
          </div>
        ) : null}
        <ul {...solve('music-list')}>
          {shown.map(t => (
            <li key={t.kind + ':' + t.id} {...solve('music-track', { playing: mu.playingId === t.id ? '' : undefined, in: inColl(t.id) ? '' : undefined })}>
              {t.kind === 'author' ? <span /> : <input type="checkbox" aria-label={'选中 ' + t.title} checked={chosen.includes(t.id)} onChange={() => toggle(t.id)} />}
              <span {...part('main')}>
                <b>{t.title}</b>
                <small>{[t.kind === 'default' ? '默认' : t.kind === 'author' ? '卡片作者' : '我的', t.detail, minutes(t.seconds), coll && inColl(t.id) ? `在「${coll.name}」` : ''].filter(Boolean).join(' · ')}</small>
                <span {...part('tags')}>{t.tags.length ? t.tags.map(x => <K.Badge key={x}>{x}</K.Badge>) : <small>没有标签：只在地点指定时播放</small>}</span>
                {editing === t.id ? <TrackEdit track={t} onSave={patch => { mu.update(t.id, patch); setEditing(undefined); }} onCancel={() => setEditing(undefined)} /> : null}
              </span>
              <span {...part('actions')}>
                <K.Button size="sm" variant="ghost" aria-label={'试听 ' + t.title} onClick={() => mu.preview(t.id)}>{mu.playingId === t.id ? '♪' : '▶'}</K.Button>
                {t.kind === 'mine' ? <K.Button size="sm" variant="ghost" onClick={() => setEditing(e => e === t.id ? undefined : t.id)}>编辑</K.Button> : null}
                {t.kind === 'mine' ? <K.Button size="sm" variant="ghost" aria-label={'删除 ' + t.title} onClick={() => { if ((globalThis as any).confirm?.(`删除「${t.title}」？也会从各个合集里移出。`) ?? true) mu.remove(t.id); }}>删除</K.Button> : null}
              </span>
            </li>
          ))}
          {!shown.length ? <li {...part('empty')}>{mu.tracks.length ? '没有符合条件的曲目。' : '还没有曲目。'}</li> : null}
        </ul>
        {adding ? <TrackAdd mu={mu} onDone={() => setAdding(false)} /> : <K.Button size="sm" variant="primary" onClick={() => setAdding(true)}>添加曲目</K.Button>}
      </section>
      <p {...part('intro')}>选曲顺序：当前地点指定的曲目 → 所在区域的曲目 → 按场景情绪从「播放来源」里挑，一首放完换同情绪的下一首。标签里和场景情绪同名的（{mu.moods.join('、')}）用来自动选曲，其余标签方便搜索。曲库和合集只保存在这台设备上。</p>
    </>
  );
}
function TrackEdit({ track, onSave, onCancel }: { track: MusicTrack; onSave: (patch: { title: string; tags: string[] }) => void; onCancel: () => void }) {
  const K = useKit();
  const [title, setTitle] = React.useState(track.title), [tags, setTags] = React.useState(track.tags.join(' '));
  return (
    <form {...solve('music-edit')} onSubmit={e => { e.preventDefault(); onSave({ title: title.trim(), tags: splitTags(tags) }); }}>
      <input aria-label="曲目名称" value={title} onChange={e => setTitle(e.target.value)} />
      <input aria-label="标签" value={tags} placeholder="标签，用空格分隔" onChange={e => setTags(e.target.value)} />
      <span><K.Button size="sm" type="submit" variant="primary">保存</K.Button><K.Button size="sm" variant="ghost" onClick={onCancel}>取消</K.Button></span>
    </form>
  );
}
function TrackAdd({ mu, onDone }: { mu: MusicHost; onDone: () => void }) {
  const K = useKit();
  const [title, setTitle] = React.useState(''), [url, setUrl] = React.useState(''), [moods, setMoods] = React.useState<string[]>([]), [extra, setExtra] = React.useState('');
  const [into, setInto] = React.useState<string[]>(() => mu.collections.some(c => c.id === mu.active) ? [mu.active] : []);
  const [fresh, setFresh] = React.useState('');
  const okUrl = /^(?:https?:|blob:|data:audio\/|\/)/u.test(url.trim());
  const submit = () => {
    if (!okUrl) return;
    const target = [...into]; if (fresh.trim()) target.push(mu.createCollection(fresh.trim()));
    mu.add({ url: url.trim(), ...(title.trim() ? { title: title.trim() } : {}), tags: [...new Set([...moods, ...splitTags(extra)])] }, target);
    onDone();
  };
  return (
    <form {...solve('track-add')} onSubmit={e => { e.preventDefault(); submit(); }}>
      <input placeholder="名称（可选）" value={title} onChange={e => setTitle(e.target.value)} aria-label="曲目名称" />
      <input placeholder="音频链接 https://…" value={url} onChange={e => setUrl(e.target.value)} aria-label="音频链接" inputMode="url" />
      <div {...part('moods')} role="group" aria-label="场景情绪">
        {mu.moods.map(x => <button key={x} type="button" aria-pressed={moods.includes(x)} onClick={() => setMoods(p => p.includes(x) ? p.filter(y => y !== x) : [...p, x])}>{x}</button>)}
      </div>
      <input placeholder="其他标签，用空格分隔，如：钢琴 夜晚" value={extra} onChange={e => setExtra(e.target.value)} aria-label="其他标签" />
      <div {...part('moods')} role="group" aria-label="同时加入合集">
        <small>加入合集：</small>
        {mu.collections.map(c => <button key={c.id} type="button" aria-pressed={into.includes(c.id)} onClick={() => setInto(p => p.includes(c.id) ? p.filter(y => y !== c.id) : [...p, c.id])}>{c.name}</button>)}
        <input placeholder="新合集名称（可选）" value={fresh} onChange={e => setFresh(e.target.value)} aria-label="新合集名称" />
      </div>
      <span {...part('buttons')}><K.Button type="submit" size="sm" variant="primary" disabled={!okUrl}>添加</K.Button><K.Button size="sm" variant="ghost" onClick={onDone}>取消</K.Button></span>
    </form>
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
