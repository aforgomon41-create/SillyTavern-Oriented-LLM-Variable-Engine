/**
 * 配图: the picture spot of an entity when the 配图 module is on. Above the picture: 生成 / 重新生成 with its status,
 * and 提示词 to read or rewrite the `imagePrompt` the model wrote. The picture itself comes in through the entity's
 * `image` (the host shows the generated picture there), so every view keeps its own layout.
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { useModel } from './fields.js';
import { useInteract } from './interact.js';
import { artOf, type Path, type StatusModel } from './model.js';
import { Art, part, solve } from './widgets.js';

export type ImageShape = 'portrait' | 'landscape' | 'square';
export interface ImageFieldSpec { path: string; owner: string; module: string; label: string; shape: ImageShape }
export interface ImageVersionView { url: string; prompt: string; plugin: string; at: number }
export interface ImageJobView { status: 'queued' | 'running' | 'error'; prompt: string; error?: string; progress?: string; plugin?: string }
/** What the host offers (the tavern page; absent in previews without a plugin). */
export interface ImageGenView {
  mode: 'auto' | 'button';
  /** Label of the plugin that will draw, or why none can. */
  plugin: { label?: string; missing?: string };
  record(key: string): { versions: ImageVersionView[]; current: number } | undefined;
  job(key: string): ImageJobView | undefined;
  generate(key: string, prompt: string, shape: ImageShape): void;
  cancel(key: string): void;
  dismiss(key: string): void;
  select(key: string, index: number): void;
}
export const ImageGenContext = React.createContext<ImageGenView | undefined>(undefined);
export const useImageGen = () => React.useContext(ImageGenContext);

export const imageFields = (m: StatusModel): ImageFieldSpec[] => ((m.def.display as { images?: ImageFieldSpec[] } | undefined)?.images ?? []);
/** The prompt field of the entity at `path`, when its module (and the overall 配图 switch) is on. */
export function imageSpec(m: StatusModel, path: Path): ImageFieldSpec | undefined {
  const pattern = m.pattern(path);
  const spec = imageFields(m).find(f => f.owner === pattern);
  if (!spec) return undefined;
  const at = [...path, spec.path.split('.').at(-1)!];
  return m.dormant(at) || m.spoiler(at) === 'hidden' ? undefined : spec;
}

/** Drop-in for `artOf(v) ? <Art …/> : null` at an entity's picture spot. */
export function ArtSlot({ path, v, name, variant, artKey }: { path: Path; v: any; name: string; variant: 'hero' | 'side' | 'banner' | 'item'; artKey?: string }) {
  const m = useModel(), gen = useImageGen();
  const spec = gen ? imageSpec(m, path) : undefined;
  const art = artOf(v);
  const picture = art ? <Art key={artKey ?? art} src={art} alt={name} variant={variant} /> : null;
  if (!spec || !gen) return picture;
  return <Slot path={path} v={v} name={name} spec={spec} gen={gen} variant={variant}>{picture}</Slot>;
}

function Slot({ path, v, name, spec, gen, variant, children }: { path: Path; v: any; name: string; spec: ImageFieldSpec; gen: ImageGenView; variant: string; children: React.ReactNode }) {
  const K = useKit(), live = useInteract();
  const key = path.join('.'), field = spec.path.split('.').at(-1)!;
  const prompt = typeof v?.[field] === 'string' ? (v[field] as string).trim() : '';
  const record = gen.record(key), current = record?.versions[record.current], job = gen.job(key);
  const [editing, setEditing] = React.useState(false);
  const busy = !!job && job.status !== 'error';
  const stale = !!current && !!prompt && current.prompt !== prompt;
  const label = busy ? (job!.status === 'queued' ? '排队中…' : '生成中…') : !current ? '生成配图' : stale ? '按新提示词生成' : '重新生成';
  const go = () => gen.generate(key, prompt, spec.shape);
  const status = job?.status === 'error' ? { tone: 'error', text: job.error ?? '生图失败' }
    : busy ? { tone: 'busy', text: job!.status === 'queued' ? '等待前面的图片生成完' : (job!.progress || `正在用${job!.plugin ? labelOf(job!.plugin) : '生图插件'}生成`) }
    : !prompt ? { tone: 'muted', text: '模型还没写提示词，可以点「提示词」自己写' }
    : gen.plugin.missing ? { tone: 'muted', text: gen.plugin.missing }
    : stale ? { tone: 'muted', text: '提示词改过了，这张是按旧提示词画的' } : undefined;
  return (
    <div {...solve('art-slot', { variant, state: job?.status ?? (current ? 'done' : 'empty') })}>
      <div {...part('tools')}>
        <K.Button size="sm" variant={current && !stale ? 'default' : 'primary'} disabled={busy || !prompt || !!gen.plugin.missing} onClick={go}
          aria-label={`${label}：${name}`}>{busy ? <span {...part('spin')} aria-hidden="true" /> : null}{label}</K.Button>
        {busy ? <K.Button size="sm" variant="ghost" onClick={() => gen.cancel(key)}>取消</K.Button> : null}
        <K.Button size="sm" variant="ghost" aria-expanded={editing} onClick={() => setEditing(e => !e)} aria-label={`查看或修改${name}的生图提示词`}>提示词</K.Button>
        {record && record.versions.length > 1 ? (
          <span {...part('versions')} role="group" aria-label="切换版本">
            <button type="button" aria-label="上一张" disabled={record.current <= 0} onClick={() => gen.select(key, record.current - 1)}>‹</button>
            <span>{record.current + 1} / {record.versions.length}</span>
            <button type="button" aria-label="下一张" disabled={record.current >= record.versions.length - 1} onClick={() => gen.select(key, record.current + 1)}>›</button>
          </span>
        ) : null}
      </div>
      {status ? (
        <p {...part('status')} data-tone={status.tone} role={status.tone === 'error' ? 'alert' : 'status'}>
          {status.text}{job?.status === 'error' ? <button type="button" aria-label="关闭提示" onClick={() => gen.dismiss(key)}>×</button> : null}
        </p>
      ) : null}
      {editing ? <PromptEditor path={[...path, field]} prompt={prompt} used={current?.prompt} locked={!live ? '这里不能修改' : live.locked} onDone={() => setEditing(false)} /> : null}
      {children}
    </div>
  );
}
const labelOf = (id: string) => ({ st: '酒馆自带图像生成', xiaobaix: '小白X', chatu8: '智绘姬', rbq: 'RBQ 绘图', chami: '酒馆场景插件' } as Record<string, string>)[id] ?? id;

function PromptEditor({ path, prompt, used, locked, onDone }: { path: Path; prompt: string; used?: string; locked?: string; onDone: () => void }) {
  const K = useKit(), live = useInteract();
  const [text, setText] = React.useState(prompt);
  const [state, setState] = React.useState<{ busy?: boolean; error?: string }>({});
  React.useEffect(() => setText(prompt), [prompt]);
  const save = async () => {
    if (!live) return;
    setState({ busy: true });
    const result = await live.perform({ ops: [{ $set: { [path.join('.')]: text.trim() } }], title: '修改生图提示词' });
    if (result.ok) { setState({}); onDone(); } else setState({ error: result.error });
  };
  return (
    <div {...part('prompt')}>
      <textarea value={text} onChange={e => setText(e.target.value)} readOnly={!!locked} rows={4} spellCheck={false} aria-label="生图提示词"
        placeholder="英文 tags，逗号分隔，如 1girl, silver hair, black cloak" />
      {used && used !== prompt ? <small>当前图片用的提示词：{used}</small> : null}
      {state.error ? <small data-tone="error" role="alert">{state.error}</small> : locked ? <small>{locked}</small> : null}
      <div {...part('prompt-actions')}>
        <K.Button size="sm" variant="ghost" onClick={onDone}>{locked ? '收起' : '取消'}</K.Button>
        {locked ? null : <K.Button size="sm" variant="primary" disabled={state.busy || text.trim() === prompt} onClick={() => void save()}>保存</K.Button>}
      </div>
    </div>
  );
}
