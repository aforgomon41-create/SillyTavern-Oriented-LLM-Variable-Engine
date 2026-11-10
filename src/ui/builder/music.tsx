/**
 * 结构制作 · 音乐（预览三）。选曲规则（地点自带 → 上级区域 → 按场景情绪从曲库里选）、作者曲库（可试听、拖动排序），
 * 以及「试选」：挑一个情绪和地点，看会放哪一首。音乐只影响显示，不进结构指纹。
 */
import * as React from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { useKit } from '../kit.js';
import { selectBgm } from '../../features.js';
import type { BgmSpec, BgmTrack, LogicalState } from '../../types.js';
import type { StructureDescription } from '../../structure.js';
import { nodeAt, KEY_RE } from './draft.js';
import { Field, Select, TextInput, part, solve, useB } from './builder.js';
import { JsonBox, PathInput, SortList, collections, itemBase, pathOptions, useDraftModel } from './common.js';

const PLAY = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" /></svg>;
const STOP = <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1" /></svg>;
/** One shared player, so starting a track stops the previous one. */
function usePlayer() {
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState<string | undefined>();
  React.useEffect(() => () => { audio.current?.pause(); }, []);
  const toggle = (id: string, url: string) => {
    if (playing === id) { audio.current?.pause(); setPlaying(undefined); return; }
    audio.current?.pause();
    const a = new Audio(url); a.volume = 0.6; audio.current = a;
    a.onended = () => setPlaying(undefined); a.onerror = () => setPlaying(undefined);
    void a.play().then(() => setPlaying(id), () => setPlaying(undefined));
  };
  return { playing, toggle };
}

export function MusicPage() {
  const K = useKit(), { d, set, note } = useB();
  const bgm: BgmSpec = d.bgm ?? {};
  const setBgm = (p: Partial<BgmSpec>) => { const next = Object.fromEntries(Object.entries({ ...bgm, ...p }).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))); set({ ...d, bgm: Object.keys(next).length ? next : undefined } as StructureDescription); };
  const lib = bgm.library ?? [];
  const player = usePlayer();
  const moodNode = bgm.mood ? nodeAt(d, bgm.mood.split('.')) : undefined;
  const moods = [...new Set([...(moodNode?.values ?? []), ...lib.flatMap(t => t.moods)])];
  const abs = pathOptions(d, []);
  const placeBase = itemBase(bgm.places);
  const setTrack = (i: number, p: Partial<BgmTrack>) => setBgm({ library: lib.map((t, j) => j === i ? { ...t, ...p } : t) });
  return (
    <div {...solve('builder-music')}>
      <p {...part('intro')}>选曲顺序：当前地点自带的音乐 → 上级区域的 → 按场景情绪从曲库里选。玩家还能在状态栏 ⚙ 里加自己的曲目。音乐不进结构指纹，发布后立即生效。</p>
      <K.Card title="选曲规则">
        <Field label="场景情绪" hint="一个选项字段，曲目按它的值分类"><PathInput label="场景情绪" value={bgm.mood} options={abs.filter(o => o.type === 'enum')} d={d} base={[]} onChange={v => setBgm({ mood: v })} /></Field>
        <Field label="当前地点"><PathInput label="当前地点" value={bgm.location} options={abs.filter(o => o.type === 'ref')} d={d} base={[]} onChange={v => setBgm({ location: v })} /></Field>
        <Field label="地点集合"><Select label="地点集合" value={bgm.places ?? ''} options={[['', '（不按地点）'], ...collections(d).map(c => [c.key, c.label] as [string, string])]} onChange={v => setBgm({ places: v || undefined })} /></Field>
        {bgm.places ? <>
          <Field label="地点的音乐字段" hint="写曲目 ID 或链接；默认 bgm"><PathInput label="音乐字段" value={bgm.field} options={pathOptions(d, placeBase).filter(o => o.type === 'string')} d={d} base={placeBase} onChange={v => setBgm({ field: v })} /></Field>
          <Field label="上级地点字段" hint="地点没有音乐时往上找"><PathInput label="上级地点字段" value={bgm.parent} options={pathOptions(d, placeBase).filter(o => o.type === 'ref')} d={d} base={placeBase} onChange={v => setBgm({ parent: v })} /></Field>
        </> : null}
      </K.Card>
      <K.Card title="曲库" meta={<small>{lib.length} 首</small>}>
        {moods.length ? (
          <p {...solve('builder-moods')}>
            {moods.map(m => { const n = lib.filter(t => t.moods.includes(m)).length; return <span key={m} data-empty={n ? undefined : ''}>{m} <b>{n}</b></span>; })}
          </p>
        ) : null}
        <SortList ids={lib} label="曲库" keyOf={t => t.id} onMove={(a, b) => setBgm({ library: arrayMove(lib, a, b) })}
          render={(t, i, handle) => (
            <div {...solve('builder-track')} data-playing={player.playing === t.id ? '' : undefined}>
              <div {...part('head')}>
                {handle}
                <button type="button" {...part('play')} onClick={() => player.toggle(t.id, t.url)} aria-label={player.playing === t.id ? `停止 ${t.title ?? t.id}` : `试听 ${t.title ?? t.id}`}>{player.playing === t.id ? STOP : PLAY}</button>
                <TextInput label="曲名" value={t.title ?? ''} placeholder={t.id} onCommit={v => setTrack(i, { title: v.trim() || undefined })} />
                <button type="button" {...part('remove')} onClick={() => { setBgm({ library: lib.filter((_, j) => j !== i) }); note(`已删除「${t.title ?? t.id}」（可撤销）`); }} aria-label={`删除 ${t.title ?? t.id}`}>×</button>
              </div>
              <div {...part('grid')}>
                <Field label="ID"><TextInput label="ID" mono value={t.id} validate={v => !KEY_RE.test(v) ? '英文字母、数字、下划线' : lib.some((x, j) => j !== i && x.id === v) ? '重复' : undefined} onCommit={v => setTrack(i, { id: v })} /></Field>
                <Field label="链接"><TextInput label="链接" mono value={t.url} validate={v => /^(?:https?:|\/)/u.test(v.trim()) ? undefined : '需要 http(s) 链接'} onCommit={v => setTrack(i, { url: v.trim() })} /></Field>
              </div>
              <div {...solve('builder-chips')} role="group" aria-label={`「${t.title ?? t.id}」的情绪`}>
                {moods.map(m => <button type="button" key={m} aria-pressed={t.moods.includes(m)} onClick={() => setTrack(i, { moods: t.moods.includes(m) ? t.moods.filter(x => x !== m) : [...t.moods, m] })}>{m}</button>)}
                {!moods.length ? <small>先在上面选「场景情绪」字段</small> : null}
              </div>
            </div>
          )} />
        <div {...part('actions')}>
          <K.Button size="sm" variant="ghost" onClick={() => { let id = 'track', n = 2; while (lib.some(t => t.id === id)) id = 'track' + n++; setBgm({ library: [...lib, { id, url: '', moods: [] }] }); }}>+ 曲目</K.Button>
        </div>
        <K.CollapseCard title="批量编辑（JSON）" meta={<small>粘贴整个曲库</small>}>
          <JsonBox label="曲库 JSON" rows={10} value={lib} onChange={v => setBgm({ library: v as BgmTrack[] })}
            validate={v => Array.isArray(v) && v.every((t: any) => t && typeof t.id === 'string' && typeof t.url === 'string' && Array.isArray(t.moods)) ? undefined : '每首需要 id、url 和 moods 数组'} />
        </K.CollapseCard>
      </K.Card>
      <TryPick moods={moods} player={player} />
    </div>
  );
}

function TryPick({ moods, player }: { moods: string[]; player: ReturnType<typeof usePlayer> }) {
  const K = useKit(), { d } = useB();
  const { def, state } = useDraftModel();
  const bgm = d.bgm ?? {};
  const get = (s: LogicalState | undefined, p?: string) => p ? p.split('.').reduce<any>((o, k) => o?.[k], s?.data) : undefined;
  const places = (get(state, bgm.places) ?? {}) as Record<string, any>;
  const [mood, setMood] = React.useState<string>(() => String(get(state, bgm.mood) ?? moods[0] ?? ''));
  const [place, setPlace] = React.useState<string>(() => String(get(state, bgm.location) ?? ''));
  const result = React.useMemo(() => {
    if (!def || !state) return undefined;
    const data = JSON.parse(JSON.stringify(state.data));
    const put = (p: string | undefined, v: unknown) => { if (!p) return; const parts = p.split('.'); let o = data; for (const k of parts.slice(0, -1)) o = (o[k] ??= {}); o[parts.at(-1)!] = v; };
    put(bgm.mood, mood || undefined); put(bgm.location, place || undefined);
    try { return selectBgm({ ...def, bgm: d.bgm } as never, { ...state, data }); } catch { return undefined; }
  }, [def, state, mood, place, d.bgm]); // eslint-disable-line react-hooks/exhaustive-deps
  const SOURCE = { place: '这个地点自带的', region: '上级区域的', mood: '按情绪从曲库选的', none: '没有合适的曲目' } as const;
  return (
    <K.Card title="试选" meta={<small>用当前聊天的数据，换个情绪和地点看看</small>}>
      <div {...part('grid')}>
        <Field label="场景情绪"><Select label="场景情绪" value={mood} options={[['', '（无）'], ...moods.map(m => [m, m] as [string, string])]} onChange={setMood} /></Field>
        <Field label="当前地点"><Select label="当前地点" value={place} options={[['', '（无）'], ...Object.entries(places).map(([id, p]) => [id, `${p?.name ?? id}`] as [string, string])]} onChange={setPlace} /></Field>
      </div>
      {result ? (
        <div {...solve('builder-pick')} data-source={result.source}>
          <b>{result.track?.title ?? result.track?.id ?? (result.url ? '地点里写的链接' : '不放音乐')}</b>
          <small>{SOURCE[result.source]}{result.place ? ` · ${places[result.place]?.name ?? result.place}` : ''}</small>
          {result.url ? <K.Button size="sm" onClick={() => player.toggle('try:' + (result.track?.id ?? result.url), result.url!)}>{player.playing === 'try:' + (result.track?.id ?? result.url) ? '停止' : '试听'}</K.Button> : null}
        </div>
      ) : <p {...part('hint')}>{!def ? '草稿有编译错误' : '没有可用的聊天数据'}</p>}
    </K.Card>
  );
}
