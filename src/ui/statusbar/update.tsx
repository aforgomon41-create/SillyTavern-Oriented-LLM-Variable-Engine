/**
 * 设置 · 变量更新（预览）。谁来写 <solve_operate>：写正文的模型顺带写（随正文输出），还是正文写完后另请一个模型来写（独立操作模型）。
 * 参考 MVU 的「变量更新方式」：更新方式、模型来源、请求内容、请求策略、通知；角色卡可以指定默认方式，玩家可以改。
 * 只保存在这台设备上（API 密钥也是）。改动立即生效：控制器每处理一条回复都读一次。
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { part, solve } from './widgets.js';
import { INJECT_DEFAULTS, InjectSection, type InjectKey, type InjectPrefs } from './inject.js';

export type UpdateMode = 'in-band' | 'out-of-band';
export interface UpdatePrefs {
  /** undefined = follow the character card. */
  mode?: UpdateMode;
  source: 'same' | 'profile' | 'custom';
  profileId?: string;
  api: { url: string; key: string; model: string; temperature: number; maxTokens: number };
  format: 'toon' | 'json';
  /** Recent chat messages sent along (the reply itself included). */
  history: number;
  preset: 'builtin' | 'current';
  auto: boolean;
  minLength: number;
  trigger: string;
  retries: number;
  timeout: number;
  notify: { working: boolean; failed: boolean };
  /** 随正文输出: what SOLVE injects into the story model's prompt. */
  inject: InjectPrefs;
  /** Saved sets of connection + request settings (自定义 API 方案). */
  saved?: ApiSet[];
  /** Settings version (operator.ts PREFS_REV). */
  rev?: number;
}
/** A saved set: where to send the request and how. */
export type ApiSet = { id: string; name: string } & Pick<UpdatePrefs, 'source' | 'profileId' | 'api' | 'format' | 'history' | 'preset' | 'retries' | 'timeout'>;
const SET_KEYS = ['source', 'profileId', 'api', 'format', 'history', 'preset', 'retries', 'timeout'] as const;
const pickSet = (p: UpdatePrefs) => Object.fromEntries(SET_KEYS.map(k => [k, p[k]])) as Omit<ApiSet, 'id' | 'name'>;
const sameSet = (a: Omit<ApiSet, 'id' | 'name'>, b: Omit<ApiSet, 'id' | 'name'>) => SET_KEYS.every(k => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
export const UPDATE_DEFAULTS: UpdatePrefs = {
  source: 'same', api: { url: '', key: '', model: '', temperature: 1, maxTokens: 65536 },
  format: 'toon', history: 4, preset: 'builtin', auto: true, minLength: 0, trigger: '', retries: 1, timeout: 60,
  notify: { working: true, failed: true },
  inject: INJECT_DEFAULTS,
};
export interface UpdateRun { ok: boolean; at: number; ms?: number; chars?: number; error?: string }
export interface UpdateHost {
  prefs: UpdatePrefs; onPrefs(patch: Partial<UpdatePrefs>): void;
  /** What the character card asks for (the author's registration). */
  cardMode: UpdateMode;
  /** The tavern's saved connection profiles (连接配置). */
  profiles?: { id: string; name: string; detail?: string }[];
  /** Name of the connection currently in use (for 「与当前连接相同」). */
  current?: string;
  test?(): Promise<UpdateRun>;
  models?(): Promise<string[]>;
  /** The prompt the operator model would get for the latest reply. */
  prompt?(): string;
  last?: UpdateRun;
  /** Re-run the operator model on the latest reply. */
  rerun?(): Promise<UpdateRun>;
  /** Macros the card already uses (随正文输出 injection skips those in auto mode). */
  cardMacros?: InjectKey[];
  /** Current text of each injected prompt. */
  injectTexts?(): Partial<Record<InjectKey, string>>;
}

const MODES: { value: UpdateMode; label: string; text: string }[] = [
  { value: 'in-band', label: '随正文输出', text: '正文模型在回复末尾顺带写操作，只请求一次' },
  { value: 'out-of-band', label: '独立操作模型', text: '回复完后另请一个模型写操作，正文更专注，每轮多一次请求' },
];
const SOURCES: { value: UpdatePrefs['source']; label: string; text: string }[] = [
  { value: 'same', label: '当前连接', text: '和正文同一个模型' },
  { value: 'profile', label: '酒馆连接配置', text: '选已保存的连接' },
  { value: 'custom', label: '自定义 API', text: '填地址、密钥、模型' },
];
const label = (m: UpdateMode) => MODES.find(x => x.value === m)!.label;

export function UpdateSection({ host }: { host: UpdateHost }) {
  const K = useKit();
  const p = host.prefs, mode = p.mode ?? host.cardMode;
  const set = (patch: Partial<UpdatePrefs>) => host.onPrefs(patch);
  const api = (patch: Partial<UpdatePrefs['api']>) => set({ api: { ...p.api, ...patch } });
  const [test, setTest] = React.useState<{ busy?: boolean; run?: UpdateRun }>({});
  const [models, setModels] = React.useState<string[] | undefined>();
  const [showPrompt, setShowPrompt] = React.useState(false);
  const [rerun, setRerun] = React.useState<{ busy?: boolean; run?: UpdateRun }>({});
  const last = rerun.run ?? host.last;
  return (
    <>
      <p {...part('intro')}>谁来写变量操作。卡片不用改：独立操作模型时，正文里的 <code>{'{{solve_SOP}}'}</code> 等宏自动留空。</p>
      <section {...solve('limit-group')}>
        <h4>更新方式{p.mode ? null : <small>跟随角色卡</small>}</h4>
        <div {...solve('update-modes')} role="radiogroup" aria-label="更新方式">
          {MODES.map(m => (
            <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} {...part('mode')} onClick={() => set({ mode: m.value === host.cardMode ? undefined : m.value })}>
              <b>{m.label}{host.cardMode === m.value ? <K.Badge>角色卡默认</K.Badge> : null}</b>
              <small>{m.text}</small>
            </button>
          ))}
        </div>
        {p.mode && p.mode !== host.cardMode ? (
          <p {...part('hint')}>角色卡默认「{label(host.cardMode)}」。<button type="button" {...part('link')} onClick={() => set({ mode: undefined })}>恢复跟随角色卡</button></p>
        ) : null}
      </section>
      {mode === 'in-band' ? <InjectSection host={{ prefs: p.inject ?? INJECT_DEFAULTS, onPrefs: patch => set({ inject: { ...(p.inject ?? INJECT_DEFAULTS), ...patch } }),
        ...(host.cardMacros ? { cardMacros: host.cardMacros } : {}), ...(host.injectTexts ? { texts: host.injectTexts } : {}) }} /> : null}
      {mode === 'out-of-band' ? <>
        <section {...solve('limit-group')}>
          <h4>操作模型</h4>
          <div {...solve('pref-list')}>
            <ApiSets host={host} />
            <div {...solve('pref', { kind: 'stack' })}>
              <span {...part('label')}>模型来源</span>
              <div {...solve('update-modes', { size: 'sm' })} role="radiogroup" aria-label="模型来源">
                {SOURCES.map(o => (
                  <button key={o.value} type="button" role="radio" aria-checked={p.source === o.value} {...part('mode')} onClick={() => set({ source: o.value })}>
                    <b>{o.label}</b><small>{o.text}</small>
                  </button>
                ))}
              </div>
            </div>
            {p.source === 'same' ? <p {...part('hint')}>用酒馆现在的连接{host.current ? `（${host.current}）` : ''}。</p> : null}
            {p.source === 'profile' ? (
              host.profiles?.length ? (
                <div {...solve('pref')}>
                  <span {...part('label')}>连接配置</span>
                  <select {...solve('select')} aria-label="连接配置" value={p.profileId ?? ''} onChange={e => set({ profileId: e.target.value || undefined })}>
                    <option value="" disabled>选择…</option>
                    {host.profiles.map(x => <option key={x.id} value={x.id}>{x.name}{x.detail ? ` · ${x.detail}` : ''}</option>)}
                  </select>
                </div>
              ) : <p {...part('hint')} data-tone="warn">还没有连接配置：先在酒馆「API 连接 › 连接配置」里存一个。</p>
            ) : null}
            {p.source === 'custom' ? <>
              <Text label="API 地址" hint="OpenAI 兼容" value={p.api.url} placeholder="https://…/v1" onCommit={v => api({ url: v.trim() })} />
              <Text label="API 密钥" hint="只存在这台设备" value={p.api.key} secret placeholder="留空表示无需密钥" onCommit={v => api({ key: v.trim() })} />
              <div {...solve('pref')}>
                <span {...part('label')}>模型名称</span>
                <span {...solve('update-model')}>
                  {models?.length ? (
                    <select {...solve('select')} aria-label="模型名称" value={p.api.model} onChange={e => api({ model: e.target.value })}>
                      {models.includes(p.api.model) ? null : <option value={p.api.model}>{p.api.model || '选择…'}</option>}
                      {models.map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                  ) : <Input label="模型名称" value={p.api.model} placeholder="如 gemini-2.5-flash" onCommit={v => api({ model: v.trim() })} />}
                  {host.models ? <K.Button size="sm" variant="ghost" disabled={!p.api.url} onClick={() => void host.models!().then(setModels, () => setModels([]))}>获取列表</K.Button> : null}
                </span>
              </div>
              <div {...solve('pref')}>
                <span {...part('label')}>温度</span>
                <K.Slider value={Math.round(p.api.temperature * 10)} min={0} max={20} onValueChange={v => api({ temperature: v / 10 })} format={v => (v / 10).toFixed(1)} aria-label="温度" />
              </div>
              <Num label="最大回复长度" hint="含思考，单位 token" value={p.api.maxTokens} min={256} step={256} onChange={n => api({ maxTokens: n })} />
            </> : null}
            {host.test ? (
              <div {...solve('pref', { kind: 'action' })}>
                <span {...part('label')}>测试连接{test.run ? <small data-tone={test.run.ok ? 'ok' : 'error'}>{test.run.ok ? `连接正常 · ${((test.run.ms ?? 0) / 1000).toFixed(1)} 秒` : test.run.error}</small> : <small>发一条很短的请求</small>}</span>
                <K.Button size="sm" disabled={test.busy || (p.source === 'profile' && !p.profileId) || (p.source === 'custom' && (!p.api.url || !p.api.model))}
                  onClick={() => { setTest({ busy: true }); void host.test!().then(run => setTest({ run })); }}>{test.busy ? '测试中…' : '测试'}</K.Button>
              </div>
            ) : null}
          </div>
        </section>
        <section {...solve('limit-group')}>
          <h4>请求内容</h4>
          <div {...solve('pref-list')}>
            <div {...solve('pref')}>
              <span {...part('label')}>变量格式<small>TOON 省字</small></span>
              <Seg label="变量格式" value={p.format} onChange={v => set({ format: v as UpdatePrefs['format'] })} options={[{ value: 'toon', label: 'TOON' }, { value: 'json', label: 'JSON' }]} />
            </div>
            <Num label="带上最近几楼正文" hint="含刚写完的这楼" value={p.history} min={1} max={20} onChange={n => set({ history: n })} />
            <div {...solve('pref')}>
              <span {...part('label')}>预设<small>被拒答时再带上</small></span>
              <Seg label="预设" value={p.preset} onChange={v => set({ preset: v as UpdatePrefs['preset'] })} options={[{ value: 'builtin', label: '不带' }, { value: 'current', label: '当前预设' }]} />
            </div>
            {host.prompt ? (
              <div {...solve('pref', { kind: 'action' })}>
                <span {...part('label')}>发送内容<small>最近一楼会发的内容</small></span>
                <K.Button size="sm" variant="ghost" onClick={() => setShowPrompt(v => !v)} aria-expanded={showPrompt}>{showPrompt ? '收起' : '查看'}</K.Button>
              </div>
            ) : null}
            {showPrompt && host.prompt ? <PromptBox text={host.prompt()} /> : null}
          </div>
        </section>
        <section {...solve('limit-group')}>
          <h4>请求策略</h4>
          <div {...solve('pref-list')}>
            <div {...solve('pref', { kind: 'switch' })}>
              <span {...part('label')}>自动请求<small>关掉后点「单独生成变量」</small></span>
              <K.Switch checked={p.auto} aria-label="自动请求" onCheckedChange={v => set({ auto: v })} />
            </div>
            {p.auto ? <>
              <Num label="最少字数" hint="0 不限" value={p.minLength} min={0} step={50} onChange={n => set({ minLength: n })} />
              <Text label="触发标签" hint="出现才请求，可写 /正则/" value={p.trigger} placeholder="不限" onCommit={v => set({ trigger: v.trim() })} />
            </> : null}
            <Num label="失败后重试" unit="次" value={p.retries} min={0} max={5} onChange={n => set({ retries: n })} />
            <Num label="超时" unit="秒" value={p.timeout} min={10} max={600} step={10} onChange={n => set({ timeout: n })} />
            <p {...part('hint')}>失败时正文保留、变量不变；停止生成、切换聊天或改写这楼会取消请求。</p>
          </div>
        </section>
        <section {...solve('limit-group')}>
          <h4>通知</h4>
          <div {...solve('pref-list')}>
            <div {...solve('pref', { kind: 'switch' })}>
              <span {...part('label')}>请求中显示提示</span>
              <K.Switch checked={p.notify.working} aria-label="请求中显示提示" onCheckedChange={v => set({ notify: { ...p.notify, working: v } })} />
            </div>
            <div {...solve('pref', { kind: 'switch' })}>
              <span {...part('label')}>失败时提示</span>
              <K.Switch checked={p.notify.failed} aria-label="失败时提示" onCheckedChange={v => set({ notify: { ...p.notify, failed: v } })} />
            </div>
          </div>
        </section>
        {last || host.rerun ? (
          <section {...solve('limit-group')}>
            <h4>最近一次</h4>
            <div {...solve('pref-list')}>
              <div {...solve('pref', { kind: 'action' })}>
                <span {...part('label')}>{last ? (last.ok ? '成功' : '失败') : '还没有请求过'}
                  {last ? <small data-tone={last.ok ? 'ok' : 'error'}>{last.ok ? `${((last.ms ?? 0) / 1000).toFixed(1)} 秒 · 返回 ${last.chars ?? 0} 字` : last.error}</small> : null}</span>
                {host.rerun ? <K.Button size="sm" disabled={rerun.busy} onClick={() => { setRerun({ busy: true }); void host.rerun!().then(run => setRerun({ run })); }}>{rerun.busy ? '请求中…' : '重新请求'}</K.Button> : null}
              </div>
            </div>
          </section>
        ) : null}
      </> : null}
    </>
  );
}

/** 已存方案: save the connection and request settings under a name, switch between them. */
function ApiSets({ host }: { host: UpdateHost }) {
  const K = useKit();
  const p = host.prefs, sets = p.saved ?? [], now = pickSet(p);
  const current = sets.find(x => sameSet(x, now));
  const [naming, setNaming] = React.useState<string | undefined>();
  const save = (name: string) => {
    const clean = name.trim(); if (!clean) return;
    const old = sets.find(x => x.name === clean);
    const next: ApiSet = { id: old?.id ?? 'set_' + Date.now().toString(36), name: clean, ...now };
    host.onPrefs({ saved: old ? sets.map(x => x.id === old.id ? next : x) : [...sets, next] });
    setNaming(undefined);
  };
  return <>
    <div {...solve('pref', { kind: 'sets' })}>
      <span {...part('label')}>方案{current ? null : sets.length ? <small>当前设置没存</small> : <small>把下面的设置存成一套</small>}</span>
      <span {...part('buttons')}>
        {sets.length ? (
          <select {...solve('select')} aria-label="已存的方案" value={current?.id ?? ''} onChange={e => { const s = sets.find(x => x.id === e.target.value); if (s) { const { id: _i, name: _n, ...rest } = s; host.onPrefs({ ...rest, ...(rest.profileId ? {} : { profileId: undefined }) }); } }}>
            {current ? null : <option value="">（未保存）</option>}
            {sets.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        ) : null}
        <K.Button size="sm" variant="ghost" onClick={() => setNaming(n => n === undefined ? (current?.name ?? '') : undefined)} aria-expanded={naming !== undefined}>{current ? '另存' : '保存'}</K.Button>
        {current ? <K.Button size="sm" variant="ghost" onClick={() => { if ((globalThis as any).confirm?.(`删除方案「${current.name}」？`) ?? true) host.onPrefs({ saved: sets.filter(x => x.id !== current.id) }); }}>删除</K.Button> : null}
      </span>
    </div>
    {naming !== undefined ? (
      <form {...solve('pref', { kind: 'name' })} onSubmit={e => { e.preventDefault(); save(naming); }}>
        <input aria-label="方案名称" value={naming} placeholder="如 DeepSeek 便宜档" autoFocus onChange={e => setNaming(e.target.value)} />
        <K.Button size="sm" type="submit" disabled={!naming.trim()}>{sets.some(x => x.name === naming.trim()) ? '覆盖' : '保存'}</K.Button>
      </form>
    ) : null}
  </>;
}
function Seg({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const K = useKit();
  if (K.Segmented) return <K.Segmented size="sm" label={label} value={value} onValueChange={onChange} options={options} />;
  return <div {...solve('choice')} role="radiogroup" aria-label={label}>{options.map(o => <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>;
}
function Input({ label, value, onCommit, placeholder, secret }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string; secret?: boolean }) {
  const K = useKit();
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  const props = { value: v, placeholder, 'aria-label': label, type: secret ? 'password' : 'text', autoComplete: 'off', spellCheck: false,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV(e.target.value), onBlur: () => { if (v !== value) onCommit(v); },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); } };
  return K.TextField ? <K.TextField size="sm" {...props} /> : <input {...props} />;
}
function Text({ label, hint, ...rest }: { label: string; hint?: string; value: string; onCommit: (v: string) => void; placeholder?: string; secret?: boolean }) {
  return (
    <div {...solve('pref', { kind: 'text' })}>
      <span {...part('label')}>{label}{hint ? <small>{hint}</small> : null}</span>
      <Input label={label} {...rest} />
    </div>
  );
}
function Num({ label, hint, unit, value, min, max = Infinity, step = 1, onChange }: { label: string; hint?: string; unit?: string; value: number; min: number; max?: number; step?: number; onChange: (n: number) => void }) {
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => setText(String(value)), [value]);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const commit = () => { const n = Number(text); if (text.trim() !== '' && Number.isFinite(n)) onChange(clamp(n)); else setText(String(value)); };
  return (
    <div {...solve('pref')}>
      <span {...part('label')}>{label}{hint ? <small>{hint}</small> : null}</span>
      <span {...solve('stepper')}>
        <button type="button" aria-label={label + ' 减少'} disabled={value <= min} onClick={() => onChange(clamp(value - step))}>−</button>
        <input inputMode="numeric" aria-label={label} value={text} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
        {unit ? <span {...part('unit')}>{unit}</span> : null}
        <button type="button" aria-label={label + ' 增加'} disabled={value >= max} onClick={() => onChange(clamp(value + step))}>+</button>
      </span>
    </div>
  );
}
function PromptBox({ text }: { text: string }) {
  return (
    <div {...solve('update-prompt')}>
      <small>{text.length} 字</small>
      <pre>{text}</pre>
    </div>
  );
}
