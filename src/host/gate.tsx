/**
 * 选择数据结构 in the page: while the open chat has no SOLVE running, the dialog (opened by itself once per chat when
 * a structure is still to be chosen) and the floating ◈ button (always, to open it again).
 */
import * as React from 'react';
import { BindDialog, GATE_DEFAULTS, GateBall, detectFrameworks, type CardSnapshot, type Detection, type GatePrefs, type GateView } from '../ui/statusbar/gate.js';
import { applyPreset, defaultPick, lastSettings, listPresets, rememberPick, resolvePreset } from './presets.js';

export const GATE = 'solve.gate.v1';
const BALL = 'solve.ball.v1';
export const OPEN_GATE = 'solve:open-gate';

interface SessionsLike {
  controller?: unknown;
  getStatus?(): { chatId?: string; phase: string; reason: string; candidates?: GateView['candidates'] };
  candidates?(): GateView['candidates'];
  choose?(key: string): Promise<any>;
  turnOff?(): Promise<void>;
  reconcile?(reload?: boolean): Promise<void>;
}

const read = <T,>(scope: any, key: string, fallback: T): T => { try { return JSON.parse(scope.localStorage?.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } };
const write = (scope: any, key: string, value: unknown) => { try { scope.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };
export function gatePrefs(scope: any): GatePrefs {
  const saved = read<Partial<GatePrefs>>(scope, GATE, {});
  // Earlier builds saved the official structure as 'official'.
  return { ...GATE_DEFAULTS, ...saved, ...(saved.defaultStructure === 'official' ? { defaultStructure: 'solve-official' } : {}) };
}

/** What the card brings (its greeting, scripts, world book, the chat's variables): read once per chat. */
export async function cardSnapshot(scope: any): Promise<CardSnapshot | undefined> {
  const ctx = scope.SillyTavern?.getContext?.();
  const ch = ctx?.characters?.[ctx.characterId];
  if (!ch) return undefined;
  const ext = ch.data?.extensions ?? {};
  const rawScripts: unknown = ext.tavern_helper?.scripts ?? ext.TavernHelper_scripts ?? (Array.isArray(ext.tavern_helper) ? Object.fromEntries(ext.tavern_helper).scripts : undefined) ?? [];
  const scripts = (Array.isArray(rawScripts) ? rawScripts : []).flatMap((x: any) => x?.type === 'folder' && Array.isArray(x.value) ? x.value : [x?.value ?? x])
    .filter((x: any) => x && typeof x === 'object').map((x: any) => ({ name: String(x.name ?? ''), content: String(x.content ?? '') }));
  let entries: CardSnapshot['entries'] = [];
  const book = ext.world || ch.data?.character_book?.name;
  if (book && ctx.loadWorldInfo) {
    try { const data = await ctx.loadWorldInfo(book); entries = Object.values(data?.entries ?? {}).map((e: any) => ({ comment: String(e?.comment ?? ''), content: String(e?.content ?? '') })); } catch { entries = []; }
  } else if (Array.isArray(ch.data?.character_book?.entries)) {
    entries = ch.data.character_book.entries.map((e: any) => ({ comment: String(e?.comment ?? e?.name ?? ''), content: String(e?.content ?? '') }));
  }
  return { greeting: String(ch.first_mes ?? ''), scripts, entries, chatVariables: ctx.chatMetadata?.variables ?? {}, messages: (ctx.chat ?? []).map((m: any) => String(m?.mes ?? '')) };
}

export function GateLayer({ scope, sessions, onSessions, openDebug }: { scope: any; sessions: () => SessionsLike | undefined; onSessions(listener: () => void): () => void; openDebug(): void }) {
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => onSessions(tick), [onSessions]);
  const s = sessions();
  let status: ReturnType<NonNullable<SessionsLike['getStatus']>> | undefined;
  try { status = s?.getStatus?.(); } catch { status = undefined; }
  const ctx = (() => { try { return scope.SillyTavern?.getContext?.(); } catch { return undefined; } })();
  const card: string = ctx?.characters?.[ctx?.characterId]?.name ?? '这个角色';
  const chatId = status?.chatId ?? ctx?.chatId;
  const phase = s?.controller ? 'ready' : status?.phase ?? 'idle';
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [detection, setDetection] = React.useState<{ chat: string; value: Detection } | undefined>();
  const asked = React.useRef(new Set<string>());
  const [ball, setBall] = React.useState(() => read<{ x: number; y: number } | undefined>(scope, BALL, undefined));
  const candidates = (status?.candidates ?? []) as GateView['candidates'];
  const prefs = gatePrefs(scope);

  // Read the card once per chat (MVU / ERA / its own SOLVE structure).
  React.useEffect(() => {
    if (!chatId || (phase !== 'choose' && phase !== 'off')) return;
    let live = true;
    void cardSnapshot(scope).then(snap => { if (live && snap) setDetection({ chat: chatId, value: detectFrameworks(snap) }); });
    return () => { live = false; };
  }, [chatId, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const bind = React.useCallback(async (key: string, choice: string) => {
    if (!s?.choose) return;
    setBusy(true); setError(undefined);
    const structure = candidates.find(c => c.key === key)?.id;
    try {
      const controller = await s.choose(key);
      let note = '';
      const values = structure ? resolvePreset(scope, structure, choice) : undefined;
      if (structure) rememberPick(scope, structure, choice);
      if (values) {
        try { const n = await applyPreset(controller, values); note = n ? '，已套用设置' : ''; }
        catch (e) { note = `，但设置没有全部套用：${e instanceof Error ? e.message : String(e)}`; }
      }
      setOpen(false);
      try { scope.toastr?.success(`这个聊天开始用「${candidates.find(c => c.key === key)?.label ?? '数据结构'}」${note}`, 'SOLVE'); } catch { /* no toasts */ }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [s, candidates, scope]);

  // Leaving the chat closes the dialog (declared before the auto-open below: effects run in order).
  React.useEffect(() => { setOpen(false); setError(undefined); }, [chatId]);
  // A chat waiting for a structure: ask once (or follow 设置 › 数据结构 › 直接使用 / 不使用).
  React.useEffect(() => {
    if (phase !== 'choose' || !chatId || asked.current.has(chatId) || !candidates.length) return;
    asked.current.add(chatId);
    if (prefs.whenNone === 'skip') return;
    if (prefs.whenNone === 'use') {
      const pick = candidates.find(c => c.own) ?? candidates.find(c => c.id === prefs.defaultStructure) ?? candidates[0]!;
      void bind(pick.key, defaultPick(scope, pick.id));
      return;
    }
    setError(undefined); setOpen(true);
  }, [phase, chatId, candidates.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // The wand menu's 「SOLVE 设置」 without a status bar, and the debug panel, open the dialog through this event.
  React.useEffect(() => {
    const doc: Document = scope.document;
    const onOpen = () => { setError(undefined); setOpen(true); };
    doc.addEventListener(OPEN_GATE, onOpen);
    return () => doc.removeEventListener(OPEN_GATE, onOpen);
  }, [scope]);

  if (!chatId || ctx?.groupId != null || !['choose', 'off', 'error', 'unbound'].includes(phase)) return null;
  const view: GateView = {
    card, phase, reason: status?.reason ?? '', candidates,
    ...(detection && detection.chat === chatId ? { detection: detection.value } : {}),
    initial: (candidates.find(c => c.own) ?? candidates.find(c => c.id === prefs.defaultStructure) ?? candidates[0])?.key ?? '',
    presets: id => {
      const last = lastSettings(scope, id), saved = listPresets(scope, id);
      const day = (t: number) => new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
      return {
        options: [
          ...(last ? [{ value: 'last', label: '上次的设置', detail: `${day(last.savedAt)} 改的` }] : []),
          ...saved.map(p => ({ value: p.id, label: p.name, detail: `存于 ${day(p.savedAt)}` })),
          { value: 'default', label: '结构默认', detail: '模块和上限都用结构自带的' },
        ],
        initial: defaultPick(scope, id),
      };
    },
  };
  const tone = phase === 'off' ? 'off' : phase === 'choose' ? 'ask' : 'error';
  const label = phase === 'off' ? 'SOLVE 在这个聊天没有开启，点这里开启' : phase === 'choose' ? 'SOLVE：给这个聊天选择数据结构' : `SOLVE 没能打开这个聊天：${status?.reason ?? ''}`;
  return (
    <>
      {open ? null : <GateBall tone={tone} label={label} onOpen={() => { setError(undefined); setOpen(true); }} {...(ball ? { position: ball } : {})}
        onMove={p => { setBall(p); write(scope, BALL, p); }} />}
      {open ? (
        <BindDialog key={chatId} view={view} busy={busy} {...(error ? { error } : {})}
          onBind={(key, preset) => void bind(key, preset)}
          onLater={() => setOpen(false)}
          onOff={() => { setOpen(false); if (phase !== 'off') void s?.turnOff?.().catch(e => { try { scope.toastr?.error(String(e?.message ?? e), 'SOLVE'); } catch { /* */ } }); }}
          onRetry={() => { setOpen(false); void s?.reconcile?.(true); }}
          onDebug={() => { setOpen(false); openDebug(); }} />
      ) : null}
    </>
  );
}
