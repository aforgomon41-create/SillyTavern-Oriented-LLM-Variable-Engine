/**
 * 进入聊天时的变量框架检测（预览）。
 *
 * 进入一个还没有 SOLVE 存档的聊天时，先看这张卡自带什么变量：
 *   · 自带 SOLVE 结构（世界书 [SOLVE:…] 条目、角色脚本注册）→ 用卡自己的，不加载玩家设置的默认结构，轻提示一下；
 *   · 自带 MVU / ERA → 弹窗说明，SOLVE 在这个聊天关闭（玩家可以重新打开）；
 *   · 什么都没有 → 弹窗询问是否用默认数据结构（玩家在设置里选，默认官方数据结构）。
 * 已经有 SOLVE 存档的聊天照旧，不检测、不弹窗。SOLVE 关闭时，启动按钮变成灰色的「SOLVE 已关闭」，点开可以重新开启。
 *
 * 这一版只有界面和检测规则（detectFrameworks 是纯函数），还没有接到进入聊天的流程上。
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { part, solve } from './widgets.js';

export type Framework = 'solve' | 'mvu' | 'era';
export const FRAMEWORK_NAME: Record<Framework, string> = { solve: 'SOLVE', mvu: 'MVU', era: 'ERA' };
export interface Detection {
  /** The card's own variable framework; undefined = none found. */
  framework?: Framework;
  /** Why we think so, one line each (shown to the player). */
  evidence: string[];
  /** The card's own SOLVE structure. */
  structure?: { label: string; version?: string };
}

// ── detection (pure) ──

/** What the detector reads: the card, its main world book, the chat's variables and messages. */
export interface CardSnapshot {
  greeting: string;
  /** Tavern Helper character scripts (data.extensions.tavern_helper.scripts, or the older TavernHelper_scripts). */
  scripts: { name: string; content: string }[];
  /** Entries of the card's world book (comment + content). */
  entries: { comment: string; content: string }[];
  /** Chat variables (Tavern Helper's chat scope). */
  chatVariables: Record<string, unknown>;
  /** Text of the chat's messages, in order. */
  messages: string[];
}
const RULES: { framework: Framework; test: (s: CardSnapshot) => string[] }[] = [
  { framework: 'solve', test: s => [
    ...s.entries.filter(e => /^\[SOLVE:/iu.test(e.comment.trim())).slice(0, 3).map(e => `角色世界书条目「${e.comment.trim()}」`),
    ...s.scripts.filter(x => /\bSOLVE\s*\.\s*(?:register|registerWorldInfo|use)\s*\(/u.test(x.content)).map(x => `角色脚本「${x.name}」注册了 SOLVE 结构`),
  ] },
  { framework: 'mvu', test: s => [
    ...s.entries.filter(e => /\[initvar\]/iu.test(e.comment)).slice(0, 2).map(e => `角色世界书条目「${e.comment.trim()}」（MVU 变量初始化）`),
    ...(/<initvar>/iu.test(s.greeting) ? ['开场白里有 <initvar> 初始化块'] : []),
    ...s.entries.filter(e => /\[mvu_(?:update|plot)\]/iu.test(e.comment)).slice(0, 1).map(e => `角色世界书条目「${e.comment.trim()}」`),
    ...s.scripts.filter(x => /MagVarUpdate|\bmvu\b/iu.test(x.name + '\n' + x.content)).map(x => `角色脚本「${x.name}」加载了 MVU`),
  ] },
  { framework: 'era', test: s => [
    ...(/<VariableInsert>/u.test(s.greeting) ? ['开场白里有 <VariableInsert> 初始化块'] : []),
    ...s.scripts.filter(x => /ERA变量框架|EfficientRollback|\bERA\b/u.test(x.name + '\n' + x.content)).map(x => `角色脚本「${x.name}」加载了 ERA`),
    ...('ERAMetaData' in s.chatVariables || 'SelectedMks' in s.chatVariables ? ['聊天变量里有 ERA 的记录（ERAMetaData）'] : []),
    ...(s.messages.some(m => /<era_data>/u.test(m)) ? ['消息里有 ERA 的消息密钥（<era_data>）'] : []),
  ] },
];
/**
 * The card's own framework. A card's own SOLVE structure wins (the author meant SOLVE to run);
 * otherwise MVU before ERA. Only the card's own things count, not global scripts or books the player turned on.
 */
export function detectFrameworks(s: CardSnapshot): Detection {
  for (const rule of RULES) {
    const evidence = rule.test(s);
    if (evidence.length) return { framework: rule.framework, evidence };
  }
  return { evidence: [] };
}

// ── settings ──

export interface StructureChoice { id: string; label: string; detail?: string }
export interface GatePrefs {
  /** Structure used for cards without variables of their own. */
  defaultStructure: string;
  /** Cards without variables: ask every time / use the default / leave SOLVE off. */
  whenNone: 'ask' | 'use' | 'skip';
  /** Cards with MVU / ERA: turn SOLVE off and tell, or turn it off quietly. */
  whenOther: 'notify' | 'silent';
  /** Per-card answers (「记住这张卡的选择」), keyed by the card's avatar file. */
  remembered: Record<string, { name: string; choice: 'use' | 'skip' | 'on' }>;
}
export const GATE_DEFAULTS: GatePrefs = { defaultStructure: 'official', whenNone: 'ask', whenOther: 'notify', remembered: {} };
export interface ChatGateState {
  /** SOLVE in the current chat. */
  on: boolean;
  /** One line: why it is on / off. */
  reason: string;
  framework?: Framework;
}
export interface StructureHost {
  prefs: GatePrefs; onPrefs(patch: Partial<GatePrefs>): void;
  choices: StructureChoice[];
  chat?: ChatGateState;
  /** Turn SOLVE on / off for the current chat. */
  setChat?(on: boolean): void;
}

export function StructureSection({ host }: { host: StructureHost }) {
  const K = useKit();
  const p = host.prefs, set = host.onPrefs;
  const remembered = Object.entries(p.remembered);
  return (
    <>
      <p {...part('intro')}>进入一个新聊天时，SOLVE 先看这张卡自带什么变量：自带 SOLVE 结构就用卡自己的；自带 MVU 或 ERA 就在这个聊天关闭自己，避免两套变量同时更新；什么都没有时按下面的设置使用默认数据结构。已经在用 SOLVE 的聊天不受影响。</p>
      {host.chat ? (
        <section {...solve('limit-group')}>
          <h4>当前聊天</h4>
          <div {...solve('pref-list')}>
            <div {...solve('pref', { kind: 'action' })}>
              <span {...part('label')}>{host.chat.on ? 'SOLVE 已开启' : 'SOLVE 已关闭'}<small>{host.chat.reason}</small></span>
              {host.setChat ? <K.Button size="sm" variant={host.chat.on ? 'ghost' : 'primary'} onClick={() => host.setChat!(!host.chat!.on)}>{host.chat.on ? '在这个聊天关闭' : '在这个聊天开启'}</K.Button> : null}
            </div>
            {!host.chat.on && host.chat.framework && host.chat.framework !== 'solve' ? <p {...part('hint')} data-tone="warn">这张卡用 {FRAMEWORK_NAME[host.chat.framework]} 管理变量。开启 SOLVE 后两套变量会各自更新，提示词里也会有两份说明，确定需要再开。</p> : null}
          </div>
        </section>
      ) : null}
      <section {...solve('limit-group')}>
        <h4>没有自带变量的卡</h4>
        <div {...solve('pref-list')}>
          <div {...solve('pref')}>
            <span {...part('label')}>默认数据结构<small>卡没有自带变量时用它；卡自带 SOLVE 结构时不加载</small></span>
            <select {...solve('select')} aria-label="默认数据结构" value={p.defaultStructure} onChange={e => set({ defaultStructure: e.target.value })}>
              {host.choices.map(c => <option key={c.id} value={c.id}>{c.label}{c.detail ? ` · ${c.detail}` : ''}</option>)}
            </select>
          </div>
          <div {...solve('pref', { kind: 'stack' })}>
            <span {...part('label')}>进入聊天时</span>
            <div {...solve('update-modes', { size: 'sm' })} role="radiogroup" aria-label="没有自带变量时">
              {([['ask', '每次询问', '弹窗问一次，可以记住这张卡的选择'], ['use', '直接使用', '不问，直接用默认数据结构'], ['skip', '不使用', '不问，SOLVE 保持关闭']] as const).map(([v, l, t]) => (
                <button key={v} type="button" role="radio" aria-checked={p.whenNone === v} {...part('mode')} onClick={() => set({ whenNone: v })}><b>{l}</b><small>{t}</small></button>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section {...solve('limit-group')}>
        <h4>自带 MVU / ERA 的卡</h4>
        <div {...solve('pref-list')}>
          <div {...solve('pref', { kind: 'switch' })}>
            <span {...part('label')}>关闭时提示<small>关掉后 SOLVE 安静地关闭，只在启动按钮上显示「已关闭」</small></span>
            <K.Switch checked={p.whenOther === 'notify'} aria-label="关闭时提示" onCheckedChange={v => set({ whenOther: v ? 'notify' : 'silent' })} />
          </div>
          <p {...part('hint')}>识别依据：MVU 看角色世界书里的 [initvar] / [mvu_update] 条目、开场白里的 &lt;initvar&gt;、加载 MVU 的角色脚本；ERA 看开场白里的 &lt;VariableInsert&gt;、加载 ERA 的角色脚本和聊天里 ERA 的记录。只看这张卡自己的东西，你全局开着的脚本和世界书不算。</p>
        </div>
      </section>
      <section {...solve('limit-group')}>
        <h4>记住的选择<small>{remembered.length}</small></h4>
        {remembered.length ? (
          <ul {...solve('tracks')}>
            {remembered.map(([avatar, r]) => (
              <li key={avatar} {...solve('track')}>
                <span {...part('title')}>{r.name}</span>
                <span {...part('moods')}><K.Badge>{r.choice === 'use' ? '使用默认结构' : r.choice === 'skip' ? '不使用' : '保持开启'}</K.Badge></span>
                <K.Button size="sm" variant="ghost" onClick={() => { const { [avatar]: _, ...rest } = p.remembered; set({ remembered: rest }); }} aria-label={'忘记 ' + r.name}>忘记</K.Button>
              </li>
            ))}
          </ul>
        ) : <p {...part('empty')}>还没有记住的卡。弹窗里勾选「记住这张卡的选择」后会出现在这里。</p>}
      </section>
    </>
  );
}

// ── dialogs ──

/** A modal card in the status-bar layer; Esc and the backdrop take the safe choice. */
function Modal({ title, children, footer, onEscape, label }: { title: React.ReactNode; children: React.ReactNode; footer: React.ReactNode; onEscape: () => void; label: string }) {
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onEscape(); } };
    const el = box.current; el?.addEventListener('keydown', key);
    return () => el?.removeEventListener('keydown', key);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div {...solve('gate')} onClick={e => { if (e.target === e.currentTarget) onEscape(); }}>
      <div ref={box} {...part('card')} role="dialog" aria-modal="true" aria-label={label}>
        <div {...part('mark')} aria-hidden="true">◈ SOLVE</div>
        <h3 {...part('title')}>{title}</h3>
        <div {...part('body')}>{children}</div>
        <div {...part('foot')}>{footer}</div>
      </div>
    </div>
  );
}
function Remember({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <label {...part('remember')}><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />记住这张卡的选择</label>;
}
function Evidence({ items }: { items: string[] }) {
  return <ul {...part('evidence')} aria-label="识别依据">{items.map(x => <li key={x}>{x}</li>)}</ul>;
}

/** The card has MVU / ERA: SOLVE turned itself off in this chat. */
export function OtherFrameworkDialog({ card, detection, onClose, onEnable }: { card: string; detection: Detection; onClose: (remember: boolean) => void; onEnable: (remember: boolean) => void }) {
  const K = useKit();
  const [remember, setRemember] = React.useState(false);
  const name = FRAMEWORK_NAME[detection.framework!];
  return (
    <Modal label={`${card} 自带 ${name} 变量`} onEscape={() => onClose(false)} title={<>「{card}」自带 {name} 变量</>}
      footer={<>
        <Remember value={remember} onChange={setRemember} />
        <span {...part('buttons')}>
          <K.Button size="sm" variant="ghost" onClick={() => onEnable(remember)}>仍然开启 SOLVE</K.Button>
          <K.Button size="sm" variant="primary" data-autofocus="" onClick={() => onClose(remember)}>知道了</K.Button>
        </span>
      </>}>
      <p>为了不和 {name} 同时更新变量，SOLVE 在这个聊天里已经关闭，不会往提示词里加内容，也不显示状态栏。</p>
      <Evidence items={detection.evidence} />
      <p {...part('hint')}>之后想用 SOLVE，点右下角灰色的「SOLVE 已关闭」重新开启。</p>
    </Modal>
  );
}

/** The card has no variables: use the default structure? */
export function AskDefaultDialog({ card, structure, onUse, onSkip, onChange }: { card: string; structure: StructureChoice; onUse: (remember: boolean) => void; onSkip: (remember: boolean) => void; onChange?: () => void }) {
  const K = useKit();
  const [remember, setRemember] = React.useState(false);
  return (
    <Modal label="使用 SOLVE 数据结构" onEscape={() => onSkip(false)} title={<>要用 SOLVE 记录「{card}」的变量吗？</>}
      footer={<>
        <Remember value={remember} onChange={setRemember} />
        <span {...part('buttons')}>
          <K.Button size="sm" variant="ghost" onClick={() => onSkip(remember)}>这次不用</K.Button>
          <K.Button size="sm" variant="primary" data-autofocus="" onClick={() => onUse(remember)}>使用</K.Button>
        </span>
      </>}>
      <p>这张卡没有自带变量。SOLVE 可以用默认数据结构记录角色、物品、地点、关系等，并在状态栏里显示。</p>
      <div {...part('structure')}>
        <span><b>{structure.label}</b>{structure.detail ? <small>{structure.detail}</small> : null}</span>
        {onChange ? <button type="button" {...part('link')} onClick={onChange}>换一个</button> : null}
      </div>
      <p {...part('hint')}>选「这次不用」后，之后也可以点右下角的「SOLVE 已关闭」开启。</p>
    </Modal>
  );
}

/** The card has its own SOLVE structure: a short notice, no question. */
export function OwnStructureNotice({ card, detection, onClose }: { card: string; detection: Detection; onClose: () => void }) {
  React.useEffect(() => { const t = setTimeout(onClose, 8000); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div {...solve('gate-notice')} role="status">
      <span {...part('text')}><b>「{card}」自带 SOLVE 数据结构{detection.structure ? `「${detection.structure.label}${detection.structure.version ? ' ' + detection.structure.version : ''}」` : ''}</b>
        <small>已使用卡自己的结构，你设置的默认结构这次不加载。</small></span>
      <button type="button" {...part('close')} onClick={onClose} aria-label="关闭提示">×</button>
    </div>
  );
}

/** Where the launcher sits while SOLVE is off in this chat: a dim pill that opens the way back. */
export function OffLauncher({ chat, onEnable, onSettings }: { chat: ChatGateState; onEnable: () => void; onSettings?: () => void }) {
  const K = useKit();
  const [open, setOpen] = React.useState(false);
  const other = chat.framework && chat.framework !== 'solve' ? FRAMEWORK_NAME[chat.framework] : undefined;
  return (
    <div {...solve('gate-off')}>
      {open ? (
        <div {...part('pop')} role="dialog" aria-label="SOLVE 已关闭">
          <b>SOLVE 在这个聊天已关闭</b>
          <small>{chat.reason}</small>
          {other ? <small data-tone="warn">开启后会和 {other} 同时更新变量。</small> : null}
          <span {...part('buttons')}>
            {onSettings ? <K.Button size="sm" variant="ghost" onClick={onSettings}>设置</K.Button> : null}
            <K.Button size="sm" variant="primary" onClick={() => { setOpen(false); onEnable(); }}>开启 SOLVE</K.Button>
          </span>
        </div>
      ) : null}
      <button type="button" {...part('pill')} aria-expanded={open} onClick={() => setOpen(v => !v)}>◈ SOLVE 已关闭</button>
    </div>
  );
}
