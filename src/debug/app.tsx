import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { AlertDialog, Dialog, Switch, Tabs, Tooltip } from "radix-ui";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Code2,
  FileClock,
  FlaskConical,
  Leaf,
  LoaderCircle,
  Moon,
  PanelLeftClose,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  Terminal,
  X,
} from "lucide-react";
import type { Controller, DebugConnection } from "./connection.js";
import { connect } from "./connection.js";
import { VERSION } from "../version.js";
import { isPreviewCurrent, parseEditor, type PreviewTicket } from "./editor.js";
import "./style.css";

const json = (value: unknown) =>
  typeof value === "string"
    ? value
    : (JSON.stringify(value, null, 2) ?? "undefined");
const short = (value?: string | null) => (value ? value.slice(0, 12) : "—");
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
type Notice = { text: string; error?: boolean };
type Run = <T>(
  label: string,
  task: () => Promise<T> | T,
  success?: (result: T) => void,
) => Promise<void>;
const ActionContext = createContext<{ run: Run; working: boolean }>({
  run: async () => {},
  working: false,
});
function useActions() {
  return useContext(ActionContext);
}
function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className="icon-button" aria-label={label} {...props}>
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={6}>
          {label}
          <Tooltip.Arrow />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
function Button({
  children,
  primary,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button className={primary ? "button primary" : "button"} {...props}>
      {children}
    </button>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Leaf size={24} />
      <p>{children}</p>
    </div>
  );
}
function Code({ value, label = "数据" }: { value: unknown; label?: string }) {
  const [copied, setCopied] = useState(false),
    [failure, setFailure] = useState("");
  return (
    <div className="code-wrap">
      <div className="code-label">
        <span>{label}</span>
        <button
          className="copy"
          aria-label={`复制${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(json(value));
              setCopied(true);
              setFailure("");
              setTimeout(() => setCopied(false), 1600);
            } catch {
              setFailure("复制失败，请选中文字复制");
            }
          }}
        >
          {copied ? <Check size={14} /> : <Clipboard size={14} />}{" "}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre tabIndex={0}>{json(value)}</pre>
      {failure && <small role="status">{failure}</small>}
    </div>
  );
}
function Card({
  title,
  eyebrow,
  children,
  action,
  className = "",
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <article className={`card ${className}`}>
      <div className="card-heading">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </article>
  );
}
function Confirm({
  title,
  description,
  children,
  onConfirm,
  disabled,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button disabled={disabled}>{children}</Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="overlay" />
        <AlertDialog.Content className="dialog">
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description>{description}</AlertDialog.Description>
          <div className="dialog-actions">
            <AlertDialog.Cancel asChild>
              <Button>取消</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button primary onClick={onConfirm}>
                确认{title}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Switch.Root
      className="switch"
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      disabled={disabled}
    >
      <Switch.Thumb className="switch-thumb" />
    </Switch.Root>
  );
}
function Tree({
  value,
  name = "state",
  depth = 0,
  query = "",
}: {
  value: unknown;
  name?: string;
  depth?: number;
  query?: string;
}) {
  const [open, setOpen] = useState(depth === 0),
    [limit, setLimit] = useState(100);
  const search = query.toLocaleLowerCase();
  if (search && !`${name} ${json(value)}`.toLocaleLowerCase().includes(search))
    return null;
  const entries =
    value && typeof value === "object" ? Object.entries(value) : null;
  if (!entries?.length)
    return (
      <div className="tree-leaf">
        <span className="tree-key">{name}</span>
        <span className={`tree-value ${typeof value}`}>{json(value)}</span>
      </div>
    );
  const childQuery = name.toLowerCase().includes(search) ? "" : search;
  const visible = childQuery
    ? entries.filter(([key, child]) =>
        `${key} ${json(child)}`.toLowerCase().includes(childQuery),
      )
    : entries;
  return (
    <details
      className="tree-node"
      open={!!search || open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <ChevronRight size={14} />
        <span className="tree-key">{name}</span>
        <span className="tree-type">
          {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </summary>
      {(open || search) && (
        <div className="tree-children">
          {visible.slice(0, limit).map(([key, child]) => (
            <Tree
              key={key}
              name={key}
              value={child}
              depth={depth + 1}
              query={childQuery}
            />
          ))}
          {visible.length > limit && (
            <Button onClick={() => setLimit(limit + 100)}>
              再显示 100 项（剩余 {visible.length - limit}）
            </Button>
          )}
        </div>
      )}
    </details>
  );
}
function DataTree({ value, query }: { value: unknown; query: string }) {
  if (!value || typeof value !== "object") return <Code value={value} />;
  const entries = Object.entries(value).filter(([key, child]) =>
    `${key} ${json(child)}`.toLowerCase().includes(query.toLowerCase()),
  );
  return entries.length ? (
    <div className="tree">
      {entries.map(([key, child]) => (
        <Tree key={key} name={key} value={child} query={query} />
      ))}
    </div>
  ) : (
    <Empty>没有匹配的数据</Empty>
  );
}
function safeRead<T>(reader: () => T): T | undefined {
  try {
    return reader();
  } catch {
    return undefined;
  }
}

function StatePanel({
  c,
  edit,
}: {
  c: Controller;
  edit: (value: string) => void;
}) {
  const { run, working } = useActions(),
    status = c.getStatus();
  const state = useMemo(
    () => safeRead(() => c.getState()),
    [c, status.headId, status.ready],
  );
  const modules = useMemo(
    () => safeRead(() => c.getModules()) ?? [],
    [c, status.headId, status.ready],
  );
  const info = useMemo(() => c.getDefinitionInfo(), [c]);
  const [search, setSearch] = useState(""),
    [format, setFormat] = useState("tree"),
    [path, setPath] = useState(""),
    [value, setValue] = useState<unknown>(),
    [hasValue, setHasValue] = useState(false);
  const [graph, setGraph] =
      useState<Awaited<ReturnType<Controller["inspectCommit"]>>>(),
    [entity, setEntity] = useState("");
  useEffect(() => {
    setHasValue(false);
  }, [status.headId]);
  useEffect(() => {
    let active = true;
    c.inspectCommit()
      .then((result) => {
        if (active) setGraph(result);
      })
      .catch(() => {
        if (active) setGraph(undefined);
      });
    return () => {
      active = false;
    };
  }, [c, status.headId]);
  const locked =
    !status.ready || status.busy || working || status.pendingCount > 0;
  return (
    <>
      <div className="workspace-intro">
        <div>
          <div className="eyebrow">LIVE EXPLORER</div>
          <h1>让每一次变化，清晰可见。</h1>
          <p>探索当前变量、实体与规则，所有修改都留下历史。</p>
        </div>
        <div className="live-tag">
          <span className="dot" />
          {status.ready ? "状态已同步" : "等待恢复"}
        </div>
      </div>
      <div className="metrics">
        <div>
          <span>当前提交</span>
          <strong className="mono">{short(status.headId)}</strong>
        </div>
        <div>
          <span>实体</span>
          <strong>
            {graph?.entities.length ?? "—"}
            <small> 个</small>
          </strong>
        </div>
        <div>
          <span>启用模块</span>
          <strong>
            {modules.filter((m) => m.enabled).length}
            <small> / {modules.length}</small>
          </strong>
        </div>
        <div>
          <span>恢复来源</span>
          <strong>
            {status.cache.source === "snapshot" ? "本地快照" : "聊天归档"}
          </strong>
        </div>
      </div>
      <div className="columns main-columns">
        <div className="stack">
          <Card
            title="当前状态"
            eyebrow="STATE"
            action={
              <div className="segmented">
                <button
                  aria-pressed={format === "tree"}
                  onClick={() => setFormat("tree")}
                >
                  树形
                </button>
                <button
                  aria-pressed={format === "json"}
                  onClick={() => setFormat("json")}
                >
                  JSON
                </button>
              </div>
            }
          >
            <label className="search">
              <Search size={16} />
              <input
                aria-label="搜索状态"
                placeholder="搜索键名或变量值…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>/</kbd>
            </label>
            {state ? (
              format === "tree" ? (
                <DataTree value={state.data} query={search} />
              ) : (
                <Code value={state} label="完整逻辑状态" />
              )
            ) : (
              <Empty>当前状态不可读，请到历史与恢复中检查归档。</Empty>
            )}
            <div className="card-foot">
              <ShieldCheck size={14} />
              读取不会修改聊天。编辑请使用操作实验室。
            </div>
          </Card>
          <Card title="实体索引" eyebrow="ENTITIES">
            <label className="field">
              选择实体
              <select
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
              >
                <option value="">
                  所有实体（{graph?.entities.length ?? 0}）
                </option>
                {graph?.entities.map((item) => (
                  <option key={item.id} value={item.id}>
                    @{item.id} · {item.type}
                  </option>
                ))}
              </select>
            </label>
            <div className="entity-list">
              {graph?.entities
                .filter((item) => !entity || item.id === entity)
                .map((item) => (
                  <div className="entity" key={item.id}>
                    <div className="entity-mark">
                      <Braces size={18} />
                    </div>
                    <div>
                      <strong>@{item.id}</strong>
                      <small>{item.pointer}</small>
                      {item.owner && <small>所属实体：{item.owner}</small>}
                    </div>
                    <span className="tag">{item.type}</span>
                  </div>
                ))}
            </div>
            <details className="disclosure">
              <summary>引用关系（{graph?.references.length ?? 0}）</summary>
              <Code value={graph?.references ?? []} label="实体引用" />
            </details>
          </Card>
        </div>
        <div className="stack">
          <Card title="按路径读取" eyebrow="QUICK INSPECT">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  "路径读取成功",
                  () => c.getValue(path),
                  (result) => {
                    setValue(result);
                    setHasValue(true);
                  },
                );
              }}
            >
              <label className="field">
                变量路径
                <input
                  value={path}
                  onChange={(e) => {
                    setPath(e.target.value);
                    setHasValue(false);
                  }}
                  placeholder="例如 @player.hp"
                />
              </label>
              <Button disabled={!status.ready || !path.trim() || working}>
                <Search size={15} />
                读取变量
              </Button>
            </form>
            {hasValue && (
              <>
                <Code value={value} label={path} />
                <Button
                  disabled={locked}
                  onClick={() => edit(json({ $set: { [path]: value } }))}
                >
                  <Code2 size={15} />
                  在实验室编辑
                </Button>
              </>
            )}
          </Card>
          <Card title="模块开关" eyebrow="MODULES">
            {modules.length ? (
              modules.map((module) => (
                <div className="module" key={module.name}>
                  <div>
                    <strong>{module.name}</strong>
                    <small>{module.guide ?? module.paths.join(", ")}</small>
                    {module.parent && <small>父模块：{module.parent}</small>}
                  </div>
                  <Toggle
                    checked={module.enabled}
                    label={`切换模块 ${module.name}`}
                    disabled={locked}
                    onChange={(enabled) =>
                      void run("模块设置已保存", () =>
                        c.setModule(module.name, enabled),
                      )
                    }
                  />
                </div>
              ))
            ) : (
              <p className="muted">这个定义没有可切换模块。</p>
            )}
            <p className="hint">
              开关会保存到当前聊天；父模块关闭时，子模块保持停用。
            </p>
          </Card>
          <Card title="作者定义" eyebrow="DEFINITION">
            <strong>{info.id}</strong>
            <p className="muted">版本 {info.version}</p>
            <div className="fingerprint mono">{info.fingerprint}</div>
            <details className="disclosure">
              <summary>查看结构与约束</summary>
              <Code value={info} label="定义信息" />
            </details>
          </Card>
        </div>
      </div>
    </>
  );
}

const examples = [
  { name: "修改数值", batch: { $inc: { "@player.hp": -5 } } },
  { name: "设置天气", batch: { $set: { "world.weather": "微风，晴朗" } } },
  {
    name: "原子操作组",
    batch: {
      $group: [
        { $inc: { "@player.gold": -10 } },
        { $inc: { "@player.inventory.herb.count": 1 } },
      ],
    },
  },
];
type Candidate = Awaited<ReturnType<Controller["preview"]>>;
function OperationsPanel({
  c,
  input,
  setInput,
}: {
  c: Controller;
  input: string;
  setInput: (input: string) => void;
}) {
  const { run, working } = useActions(),
    status = c.getStatus();
  const [author, setAuthor] = useState(""),
    [candidate, setCandidate] = useState<Candidate>(),
    [ticket, setTicket] = useState<PreviewTicket>(),
    [resultTab, setResultTab] = useState("patch");
  const syntaxError = useMemo(() => {
    try {
      parseEditor(input, author);
      return "";
    } catch (error) {
      return errorText(error);
    }
  }, [input, author]);
  const current = isPreviewCurrent(ticket, input, author, status.headId);
  const locked =
    working || status.busy || !status.ready || status.pendingCount > 0;
  const inputRef = useRef({ input, author });
  inputRef.current = { input, author };
  useEffect(() => {
    setTicket(undefined);
  }, [input, author]);
  const preview = () => {
    const captured = { input, author };
    void run(
      "预演完成，尚未保存到聊天",
      async () => {
        const parsed = parseEditor(input, author),
          result = await c.preview(parsed.operations, parsed.authorInputs);
        return result;
      },
      (result) => {
        if (
          inputRef.current.input !== captured.input ||
          inputRef.current.author !== captured.author
        )
          throw new Error("预演期间输入已变化，旧结果已作废，请重新预演。");
        setCandidate(result);
        setTicket({
          ...captured,
          head: result.baseHeadId,
          actionId: crypto.randomUUID(),
        });
        setResultTab(result.feedback.length ? "feedback" : "patch");
      },
    );
  };
  const submit = () => {
    if (!current || !ticket) return;
    void run(
      "操作已正式保存到聊天",
      () => {
        const parsed = parseEditor(input, author);
        return c.submit(parsed.operations, {
          authorInputs: parsed.authorInputs,
          expectedHead: ticket.head,
          actionId: ticket.actionId,
        });
      },
      () => {
        setTicket(undefined);
      },
    );
  };
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">OPERATION LAB</div>
          <h1>操作实验室</h1>
          <p>先预演变量变化，检查通过后再正式保存。</p>
        </div>
        <span className="tag">JSON 操作</span>
      </div>
      <div className="columns lab-columns">
        <Card
          title="编写操作"
          eyebrow="01 / EDIT"
          action={
            <Button
              disabled={!!syntaxError || working}
              onClick={() => {
                const parsed = parseEditor(input, author);
                setInput(json(parsed.operations));
                if (author.trim()) setAuthor(json(parsed.authorInputs));
              }}
            >
              格式化
            </Button>
          }
        >
          <label className="field">
            加载示例
            <select
              defaultValue=""
              onChange={(e) => {
                const sample = examples[Number(e.target.value)];
                if (sample) setInput(json(sample.batch));
                e.target.value = "";
              }}
            >
              <option value="" disabled>
                选择示例（需匹配当前定义）
              </option>
              {examples.map((sample, i) => (
                <option key={sample.name} value={i}>
                  {sample.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            操作 JSON
            <textarea
              className="editor"
              spellCheck={false}
              aria-invalid={!!syntaxError}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  (e.ctrlKey || e.metaKey) &&
                  e.key === "Enter" &&
                  !locked &&
                  !syntaxError
                ) {
                  e.preventDefault();
                  preview();
                }
              }}
            />
          </label>
          <details className="disclosure">
            <summary>作者输入（可选 JSON）</summary>
            <label className="field">
              authorInputs
              <textarea
                className="editor small-editor"
                spellCheck={false}
                placeholder="{}"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </label>
          </details>
          {syntaxError && (
            <p className="syntax-error" role="status">
              JSON 格式需要调整：{syntaxError}
            </p>
          )}
          <div className="toolbar">
            <Button
              primary
              disabled={locked || !!syntaxError}
              onClick={preview}
            >
              <Play size={15} />
              预演操作
            </Button>
            <small className="muted">Ctrl / ⌘ + Enter</small>
          </div>
          <p className="hint">预演不保存聊天，但会执行作者定义中的校验函数。</p>
        </Card>
        <Card
          title="检查结果"
          eyebrow="02 / REVIEW & SAVE"
          action={
            <span
              className={`tag ${current && !status.pendingCount ? "good" : ""}`}
            >
              {status.pendingCount
                ? "请先处理草稿"
                : current
                  ? "可提交"
                  : candidate
                    ? "需重新预演"
                    : "等待预演"}
            </span>
          }
        >
          {candidate ? (
            <>
              <div className="result-summary">
                <span>
                  应用语句 <b>{candidate.applied}</b>
                </span>
                <span>
                  反馈 <b>{candidate.feedback.length}</b>
                </span>
                <span>
                  变更{" "}
                  <b>
                    {candidate.dataPatch.length + candidate.enginePatch.length}
                  </b>
                </span>
              </div>
              {!current && (
                <div className="banner warning">
                  输入或正式历史已变化，请重新预演。
                </div>
              )}
              <Tabs.Root value={resultTab} onValueChange={setResultTab}>
                <Tabs.List className="tab-list" aria-label="预演结果">
                  <Tabs.Trigger value="patch">变更</Tabs.Trigger>
                  <Tabs.Trigger value="feedback">反馈</Tabs.Trigger>
                  <Tabs.Trigger value="state">结果状态</Tabs.Trigger>
                  <Tabs.Trigger value="aliases">别名</Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="patch">
                  <Code
                    value={{
                      dataPatch: candidate.dataPatch,
                      enginePatch: candidate.enginePatch,
                    }}
                    label="预演变更"
                  />
                </Tabs.Content>
                <Tabs.Content value="feedback">
                  <Code value={candidate.feedback} label="操作反馈" />
                </Tabs.Content>
                <Tabs.Content value="state">
                  <Code value={candidate.state} label="预演状态" />
                </Tabs.Content>
                <Tabs.Content value="aliases">
                  <Code value={candidate.aliases} label="创建别名" />
                </Tabs.Content>
              </Tabs.Root>
              <div className="save-area">
                <p className="hint">
                  基于提交 <code>{short(ticket?.head)}</code>
                  。正式保存会重新执行校验；失败语句请在反馈中确认。
                </p>
                <Button primary disabled={locked || !current} onClick={submit}>
                  <CheckCircle2 size={16} />
                  正式提交
                </Button>
              </div>
            </>
          ) : (
            <Empty>
              写好操作后点击「预演操作」，这里会显示变更、反馈和结果状态。
            </Empty>
          )}
        </Card>
      </div>
    </>
  );
}

function HistoryPanel({
  c,
  connection,
}: {
  c: Controller;
  connection: DebugConnection;
}) {
  const { run, working } = useActions(),
    status = c.getStatus(),
    history = c.getHistory().toReversed(),
    messages = c.getMessages();
  const [selected, setSelected] = useState(""),
    [inspection, setInspection] = useState<unknown>(),
    [before, setBefore] = useState(""),
    [after, setAfter] = useState(""),
    [comparison, setComparison] = useState<unknown>(),
    [validation, setValidation] = useState<unknown>(),
    [archive, setArchive] = useState<unknown>(),
    [messageIndex, setMessageIndex] = useState(() =>
      String(messages.find((m) => m.role === "assistant")?.index ?? ""),
    ),
    [search, setSearch] = useState(""),
    [onlySelected, setOnlySelected] = useState(false);
  const blocked = working || status.busy || status.pendingCount > 0;
  const target = messages.find(
    (m) => m.role === "assistant" && String(m.index) === messageIndex,
  );
  useEffect(() => {
    if (!target)
      setMessageIndex(
        String(messages.find((m) => m.role === "assistant")?.index ?? ""),
      );
  }, [target?.index, messages.length]);
  const selectedMessages = messages.filter((m) => m.role === "assistant");
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">HISTORY & RECOVERY</div>
          <h1>每次改变，都有来处。</h1>
          <p>查看旧修订、比较变量差异，或从聊天记录恢复。</p>
        </div>
        <Button
          disabled={blocked}
          onClick={() => void run("历史已重新读取", () => c.refresh())}
        >
          <RefreshCw size={15} />
          重新读取
        </Button>
      </div>
      <div className="columns main-columns">
        <div className="stack">
          <Card title="提交历史" eyebrow={`${history.length} COMMITS`}>
            <label className="search">
              <Search size={16} />
              <input
                aria-label="搜索提交"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索提交、动作或变更…"
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={onlySelected}
                onChange={(e) => setOnlySelected(e.target.checked)}
              />
              只看当前选中的修订
            </label>
            <div className="commit-list">
              {history
                .filter(
                  (commit) =>
                    (!onlySelected || commit.selected) &&
                    json(commit).toLowerCase().includes(search.toLowerCase()),
                )
                .map((commit) => (
                  <button
                    key={commit.id}
                    disabled={working}
                    className={`commit ${selected === commit.id ? "selected" : ""}`}
                    onClick={() => {
                      setSelected(commit.id);
                      setInspection(undefined);
                      void run(
                        "正在只读检查的提交已恢复",
                        () => c.inspectCommit(commit.id),
                        setInspection,
                      );
                    }}
                  >
                    <span
                      className={`commit-dot ${commit.current ? "current" : ""}`}
                    />
                    <span>
                      <strong className="mono">{short(commit.id)}</strong>
                      <small>
                        {commit.parentId
                          ? `${commit.actions.length} 个动作 · ${commit.dataPatch.length} 项数据变更`
                          : "初始状态"}
                      </small>
                    </span>
                    <span className="tag">
                      {commit.current
                        ? "当前"
                        : commit.selected
                          ? "已选"
                          : "旧修订"}
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
            </div>
          </Card>
          {inspection !== undefined && (
            <Card title="提交详情" eyebrow="READ ONLY">
              <p className="hint">只读恢复，不改变当前聊天或所选回复。</p>
              <Code value={inspection} label="提交与状态" />
            </Card>
          )}
          <Card title="双版本比较" eyebrow="COMPARE">
            <div className="columns">
              <label className="field">
                起点
                <select
                  value={before}
                  disabled={working}
                  onChange={(e) => {
                    setBefore(e.target.value);
                    setComparison(undefined);
                  }}
                >
                  <option value="">选择提交</option>
                  {history.map((commit) => (
                    <option key={commit.id} value={commit.id}>
                      {short(commit.id)}
                      {commit.current ? " · 当前" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                终点
                <select
                  value={after}
                  disabled={working}
                  onChange={(e) => {
                    setAfter(e.target.value);
                    setComparison(undefined);
                  }}
                >
                  <option value="">选择提交</option>
                  {history.map((commit) => (
                    <option key={commit.id} value={commit.id}>
                      {short(commit.id)}
                      {commit.current ? " · 当前" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Button
              disabled={!before || !after || working}
              onClick={() =>
                void run(
                  "差异比较完成",
                  () => c.compareCommits(before, after),
                  setComparison,
                )
              }
            >
              <ArrowRight size={15} />
              比较差异
            </Button>
            {comparison !== undefined && (
              <Code value={comparison} label="版本差异" />
            )}
          </Card>
        </div>
        <div className="stack">
          <Card title="消息与重放" eyebrow="MESSAGES">
            <label className="field">
              角色消息楼层
              <select
                value={messageIndex}
                onChange={(e) => setMessageIndex(e.target.value)}
              >
                {selectedMessages.map((m) => (
                  <option key={m.index} value={m.index}>
                    楼层 {m.index} · 回复 {m.swipeIndex + 1}/{m.swipeCount}
                  </option>
                ))}
              </select>
            </label>
            {target && (
              <>
                <p className="message-preview">{target.text}</p>
                <div className="hint mono">提交 {short(target.headId)}</div>
              </>
            )}
            <p className="hint">
              楼层从 0
              开始。重放会重新执行原操作与作者规则，保存新修订；编辑过前面楼层时，请重放后续历史。
            </p>
            <div className="button-stack">
              <Confirm
                title="重放本层"
                description={`重新计算楼层 ${messageIndex} 并保存新修订，旧修订会保留。`}
                disabled={blocked || !target}
                onConfirm={() =>
                  void run("本层重放完成", () =>
                    c.replayMessage(Number(messageIndex)),
                  )
                }
              >
                重放本层
              </Confirm>
              <Confirm
                title="重放后续"
                description={`从楼层 ${messageIndex} 开始，逐层重新计算并保存；遇到错误会停止。`}
                disabled={blocked || !target}
                onConfirm={() =>
                  void run("后续历史重放完成", () =>
                    c.replayFrom(Number(messageIndex)),
                  )
                }
              >
                从此层重放后续
              </Confirm>
            </div>
          </Card>
          <Card title="完整性与缓存" eyebrow="INTEGRITY">
            <div className="button-stack">
              <Button
                disabled={working || status.busy}
                onClick={() =>
                  void run(
                    "只读归档已读取",
                    () => connection.sessions.inspectArchive(),
                    setArchive,
                  )
                }
              >
                只读检查归档
              </Button>
              <Button
                disabled={working || status.busy}
                onClick={() =>
                  void run(
                    "归档校验完成，请查看逐项结果",
                    () => c.validateArchive(),
                    setValidation,
                  )
                }
              >
                <ShieldCheck size={15} />
                校验归档
              </Button>
              <Button
                disabled={blocked || !status.cache.enabled}
                onClick={() => void run("缓存已重建", () => c.rebuildCache())}
              >
                <RefreshCw size={15} />
                重建快照缓存
              </Button>
            </div>
            <p className="hint">
              缓存只用于加速恢复；聊天归档才是正式记录。
              {!status.cache.enabled && "当前缓存已关闭。"}
            </p>
            {validation !== undefined && (
              <Code value={validation} label="归档校验结果" />
            )}
            {archive !== undefined && (
              <Code value={archive} label="原始归档（只读）" />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function ContextPanel({ c }: { c: Controller }) {
  const { run, working } = useActions(),
    status = c.getStatus(),
    info = c.getDefinitionInfo();
  const [view, setView] = useState("full"),
    [paths, setPaths] = useState(""),
    [tab, setTab] = useState("json"),
    [preview, setPreview] =
      useState<ReturnType<Controller["getContextPreview"]>>(),
    [signature, setSignature] = useState("");
  const selected = preview?.[tab as keyof typeof preview],
    stale = signature !== `${status.headId}|${view}|${paths}`;
  const text = selected === undefined ? "" : json(selected);
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">CONTEXT INSPECTOR</div>
          <h1>模型会看见什么？</h1>
          <p>检查视图、提示词与输出格式，无需发起模型请求。</p>
        </div>
        <span className="tag">本地预览</span>
      </div>
      <Card title="预览设置">
        <div className="context-controls">
          <label className="field">
            变量视图
            <select value={view} onChange={(e) => setView(e.target.value)}>
              <option value="full">完整 · full</option>
              <option value="narrative">叙事 · narrative</option>
              <option value="operator">操作 · operator</option>
              {info.customViews.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            路径筛选
            <input
              value={paths}
              onChange={(e) => setPaths(e.target.value)}
              placeholder="留空显示全部；多个路径用逗号分隔"
            />
          </label>
          <Button
            primary
            disabled={!status.ready || working}
            onClick={() =>
              void run(
                "上下文预览已更新",
                () =>
                  c.getContextPreview({
                    view,
                    paths: paths
                      .split(/[,，\n]/)
                      .map((p) => p.trim())
                      .filter(Boolean),
                  }),
                (result) => {
                  setPreview(result);
                  setSignature(`${status.headId}|${view}|${paths}`);
                },
              )
            }
          >
            <Play size={15} />
            生成预览
          </Button>
        </div>
        <p className="hint">
          路径和视图只筛选变量输出；指南、指令说明和独立请求提示词展示后端的完整实际内容。
        </p>
      </Card>
      <Card
        title="上下文内容"
        action={
          preview && (
            <span className="muted">
              {text.length.toLocaleString()} 字符 ·{" "}
              {new TextEncoder().encode(text).length.toLocaleString()} 字节
            </span>
          )
        }
      >
        <Tabs.Root value={tab} onValueChange={setTab}>
          <Tabs.List className="tab-list" aria-label="上下文格式">
            {[
              ["json", "JSON"],
              ["toon", "TOON"],
              ["guide", "指南"],
              ["sop", "指令说明"],
              ["feedback", "反馈"],
              ["operatorPrompt", "操作提示词"],
            ].map(([key, label]) => (
              <Tabs.Trigger key={key} value={key!}>
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value={tab}>
            {preview ? (
              <>
                {stale && (
                  <div className="banner warning">
                    设置或历史已变化，以下为上一次预览。请重新生成。
                  </div>
                )}
                <Code value={selected} label={`上下文 · ${tab}`} />
              </>
            ) : (
              <Empty>选择视图后生成预览，查看实际传递给模型的内容。</Empty>
            )}
          </Tabs.Content>
        </Tabs.Root>
      </Card>
    </>
  );
}

function DiagnosticsPanel({
  c,
  connection,
}: {
  c: Controller;
  connection: DebugConnection;
}) {
  const { run, working } = useActions(),
    status = c.getStatus();
  const [search, setSearch] = useState(""),
    [level, setLevel] = useState("all"),
    [failure, setFailure] = useState(false);
  const logs = c.journal
    .read()
    .toReversed()
    .filter(
      (log) =>
        (level === "all" || log.level === level) &&
        `${log.code} ${log.message}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">DIAGNOSTICS</div>
          <h1>把问题留在明处。</h1>
          <p>请求、保存与恢复的现场记录，帮助定位异常。</p>
        </div>
        <Button
          disabled={working}
          onClick={() => void run("日志已清空", () => c.clearDiagnostics())}
        >
          清空日志
        </Button>
      </div>
      {connection.simulation && (
        <Card title="演示工具" eyebrow="SANDBOX">
          <div className="module">
            <div>
              <strong>模拟保存失败</strong>
              <small>开启后提交会保留待保存草稿；关闭后可重试。</small>
            </div>
            <Toggle
              label="模拟保存失败"
              checked={failure}
              onChange={(value) => {
                setFailure(value);
                connection.simulation!.setFailure(value);
              }}
            />
          </div>
          <Button
            disabled={
              working || status.busy || !!status.pendingCount || !status.ready
            }
            onClick={() =>
              void run("已处理一条演示模型回复", () =>
                connection.simulation!.addMessage(),
              )
            }
          >
            添加一条演示回复（体力 +2）
          </Button>
          <p className="hint">
            使用真实变量引擎与保存流程；数据仅在内存中，刷新即重置，不调用模型。
          </p>
        </Card>
      )}
      <div className="columns main-columns">
        <Card title="事件日志" eyebrow={`${logs.length} EVENTS`}>
          <div className="log-controls">
            <label className="search grow">
              <Search size={16} />
              <input
                aria-label="搜索日志"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索错误码、事件或内容…"
              />
            </label>
            <select
              aria-label="日志级别"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option value="all">全部级别</option>
              <option value="info">信息</option>
              <option value="warning">警告</option>
              <option value="error">错误</option>
            </select>
          </div>
          <div className="logs">
            {logs.length ? (
              logs.map((log) => (
                <div key={log.sequence} className={`log ${log.level}`}>
                  <div>
                    <span className="tag">
                      {log.level === "error"
                        ? "错误"
                        : log.level === "warning"
                          ? "警告"
                          : "信息"}
                    </span>
                    <time>{new Date(log.time).toLocaleTimeString()}</time>
                    {log.durationMs !== undefined && (
                      <span>{Math.round(log.durationMs)} ms</span>
                    )}
                  </div>
                  <strong className="mono">{log.code}</strong>
                  <p>{log.message}</p>
                </div>
              ))
            ) : (
              <Empty>暂无匹配日志</Empty>
            )}
          </div>
        </Card>
        <div className="stack">
          <Card title="运行环境" eyebrow="RUNTIME">
            <dl className="facts">
              <dt>操作模式</dt>
              <dd>
                {status.mode === "in-band" ? "同一次回复" : "独立操作模型"}
              </dd>
              <dt>本地缓存</dt>
              <dd>{status.cache.enabled ? "已启用" : "未启用"}</dd>
              <dt>会话</dt>
              <dd className="mono">{status.sessionId}</dd>
            </dl>
            {status.cache.error && (
              <div className="banner warning">{status.cache.error}</div>
            )}
            {status.operatorBusy && (
              <Button
                onClick={() => void run("已请求取消", () => c.cancelOperator())}
              >
                取消操作模型请求
              </Button>
            )}
          </Card>
          <Card title="宿主能力" eyebrow="CAPABILITIES">
            {status.capabilities.map((cap) => (
              <div className="capability" key={cap.id}>
                <div>
                  {cap.available ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <CircleHelp size={16} />
                  )}
                  <strong>{cap.label}</strong>
                  <span className={`tag ${cap.available ? "good" : ""}`}>
                    {cap.available ? "可用" : cap.required ? "缺失" : "可选"}
                  </span>
                </div>
                {!cap.available && <small>{cap.detail}</small>}
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}

function Pending({ c }: { c: Controller }) {
  const { run, working } = useActions(),
    status = c.getStatus();
  if (!status.pendingCount) return null;
  return (
    <div className="pending banner warning">
      <div>
        <strong>有 {status.pendingCount} 项待保存操作</strong>
        <p>
          处理完成前暂停新写入。重试会复用已有结果；放弃会先确认是否已实际保存。
        </p>
        {status.pendingImportError && <p>{status.pendingImportError}</p>}
        <details>
          <summary>查看草稿详情</summary>
          <Code value={c.getPending()} label="本地待保存草稿" />
        </details>
      </div>
      <div className="button-stack">
        <Button
          primary
          disabled={working || status.busy || !c.getPending().length}
          onClick={() => void run("待保存操作已保存", () => c.retryPending())}
        >
          重试保存
        </Button>
        <Confirm
          title="放弃本地草稿"
          description="未保存的候选会被清理；如果操作其实已经落盘，会恢复实际保存的结果。"
          disabled={working || status.busy}
          onConfirm={() => void run("本地草稿已处理", () => c.discardPending())}
        >
          放弃草稿
        </Confirm>
      </div>
    </div>
  );
}
function ReportDialog({ c }: { c?: Controller }) {
  const [state, setState] = useState(false),
    [text, setText] = useState(false),
    { run, working } = useActions();
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <IconButton label="导出调试报告" disabled={!c}>
          <ArrowDownToLine size={18} />
        </IconButton>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>导出调试报告</Dialog.Title>
          <Dialog.Description>
            报告仅下载到本机。历史动作与变更可能包含角色变量值，请检查后再分享。
          </Dialog.Description>
          <label className="check-label">
            <input
              type="checkbox"
              checked={state}
              onChange={(e) => setState(e.target.checked)}
            />
            包含完整变量状态
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={text}
              onChange={(e) => setText(e.target.checked)}
            />
            包含聊天消息正文
          </label>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <Button>关闭</Button>
            </Dialog.Close>
            <Button
              primary
              disabled={!c || working}
              onClick={() =>
                void run("报告已生成并交给浏览器下载", () => {
                  const report = c!.exportDebugReport({
                    includeState: state,
                    includeText: text,
                  });
                  const url = URL.createObjectURL(
                    new Blob([json(report)], { type: "application/json" }),
                  );
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = `SOLVE-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
                  anchor.click();
                  setTimeout(() => URL.revokeObjectURL(url), 10000);
                })
              }
            >
              <ArrowDownToLine size={15} />
              下载 JSON
            </Button>
          </div>
          <Dialog.Close asChild>
            <button className="dialog-x" aria-label="关闭导出窗口">
              <X size={18} />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
const navigation = [
  { id: "state", label: "状态探索", caption: "State explorer", icon: Braces },
  {
    id: "operations",
    label: "操作实验室",
    caption: "Operation lab",
    icon: FlaskConical,
  },
  {
    id: "history",
    label: "历史与恢复",
    caption: "History & recovery",
    icon: FileClock,
  },
  {
    id: "context",
    label: "上下文预览",
    caption: "Context inspector",
    icon: Code2,
  },
  {
    id: "diagnostics",
    label: "诊断日志",
    caption: "Diagnostics",
    icon: Activity,
  },
];

function BoundWorkspace({
  c,
  connection,
  nav,
  setNav,
}: {
  c: Controller;
  connection: DebugConnection;
  nav: string;
  setNav: (nav: string) => void;
}) {
  const [input, setInput] = useState(json(examples[0]!.batch)),
    [working, setWorking] = useState(false),
    [notice, setNotice] = useState<Notice>();
  const alive = useRef(true),
    running = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run: Run = async (label, task, success) => {
    if (running.current) return;
    running.current = true;
    setWorking(true);
    setNotice(undefined);
    try {
      const result = await task();
      if (alive.current) {
        success?.(result);
        setNotice({ text: label });
      }
    } catch (error) {
      if (alive.current) setNotice({ text: errorText(error), error: true });
    } finally {
      running.current = false;
      if (alive.current) setWorking(false);
    }
  };
  const status = c.getStatus();
  return (
    <ActionContext.Provider value={{ run, working }}>
      <div className="workspace-tools">
        <ReportDialog c={c} />
      </div>
      {working && (
        <div className="working" role="status">
          <LoaderCircle className="spin" size={15} />
          正在处理…
        </div>
      )}
      {notice && (
        <div
          className={`notice ${notice.error ? "error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          <span>
            {notice.error ? "操作未完成：" : ""}
            {notice.text}
          </span>
          <IconButton label="关闭提示" onClick={() => setNotice(undefined)}>
            <X size={15} />
          </IconButton>
        </div>
      )}
      {!status.ready && (
        <div className="banner warning">
          <strong>状态需要恢复</strong>
          <p>{status.reason || "请检查当前聊天的历史与绑定状态。"}</p>
          <Button onClick={() => setNav("history")}>
            前往历史与恢复
            <ArrowRight size={15} />
          </Button>
        </div>
      )}
      <Pending c={c} />
      <section hidden={nav !== "state"} aria-label="状态探索">
        <StatePanel
          c={c}
          edit={(value) => {
            setInput(value);
            setNav("operations");
          }}
        />
      </section>
      <section hidden={nav !== "operations"} aria-label="操作实验室">
        <OperationsPanel c={c} input={input} setInput={setInput} />
      </section>
      <section hidden={nav !== "history"} aria-label="历史与恢复">
        <HistoryPanel c={c} connection={connection} />
      </section>
      <section hidden={nav !== "context"} aria-label="上下文预览">
        <ContextPanel c={c} />
      </section>
      <section hidden={nav !== "diagnostics"} aria-label="诊断日志">
        <DiagnosticsPanel c={c} connection={connection} />
      </section>
    </ActionContext.Provider>
  );
}
function Unbound({ connection }: { connection: DebugConnection }) {
  const [result, setResult] = useState<unknown>(),
    [commitId, setCommitId] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    status = connection.sessions.getStatus();
  async function act(task: () => Promise<unknown>) {
    setBusy(true);
    setNotice("");
    try {
      setResult(await task());
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">WAITING FOR CONNECTION</div>
          <h1>等待当前聊天就绪</h1>
          <p>{status.reason || "请打开绑定了 SOLVE 定义的单角色聊天。"}</p>
        </div>
      </div>
      <Card title="连接与只读检查">
        <p className="muted">
          作者脚本需要先通过 SOLVE.register 或 SOLVE.attach
          注册定义。缺少原定义时，仍可尝试只读恢复已保存归档。
        </p>
        <label className="field">
          提交 ID（可选）
          <input
            value={commitId}
            disabled={busy}
            onChange={(e) => {
              setCommitId(e.target.value);
              setResult(undefined);
            }}
            placeholder="留空检查当前归档；也可指定旧提交 ID"
          />
        </label>
        <div className="toolbar">
          <Button
            disabled={busy || status.phase === "loading"}
            onClick={() => void act(() => connection.sessions.reconcile())}
          >
            <RefreshCw size={15} />
            重新连接
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void act(() =>
                connection.sessions.inspectArchive(
                  commitId.trim() || undefined,
                ),
              )
            }
          >
            只读检查归档
          </Button>
        </div>
        {busy && <p role="status">正在读取…</p>}
        {notice && (
          <div role="alert" className="banner warning">
            {notice}
          </div>
        )}
        {result !== undefined && <Code value={result} label="只读归档" />}
        <details className="disclosure">
          <summary>已注册的定义（{status.registered.length}）</summary>
          <Code value={status.registered} />
        </details>
      </Card>
    </>
  );
}

function App({ connection }: { connection: DebugConnection }) {
  const [, update] = useState(0),
    [nav, setNav] = useState("state"),
    [dark, setDark] = useState(
      () =>
        safeRead(() => localStorage.getItem("solve-debug-theme")) === "dark",
    );
  useEffect(
    () => connection.sessions.subscribe(() => update((value) => value + 1)),
    [connection],
  );
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("solve-debug-theme", dark ? "dark" : "light");
    } catch {
      /* optional */
    }
  }, [dark]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !document.querySelector('[role="dialog"], [role="alertdialog"]')
      )
        connection.close();
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [connection]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof HTMLElement &&
          event.target.closest("input, textarea, select, [contenteditable]"))
      )
        return;
      const search = document.querySelector<HTMLInputElement>(
        "main section:not([hidden]) .search input",
      );
      if (search) {
        event.preventDefault();
        search.focus();
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
  const session = connection.sessions.getStatus(),
    c = connection.sessions.controller,
    status = c?.getStatus();
  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="app-shell">
        <aside className="sidebar">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setNav("state");
            }}
          >
            <div className="brand-mark">
              <Leaf size={23} />
            </div>
            <span>
              SOLVE<small>变量调试工作台</small>
            </span>
          </a>
          <div className="nav-label">WORKSPACE</div>
          <nav aria-label="工作区">
            {navigation.map(({ id, label, caption, icon: Icon }) => (
              <button
                key={id}
                className={`nav-item ${nav === id ? "active" : ""}`}
                aria-current={nav === id ? "page" : undefined}
                onClick={() => {
                  setNav(id);
                  document.querySelector("main")?.scrollTo({ top: 0 });
                }}
              >
                <Icon size={19} />
                <span>
                  {label}
                  <small>{caption}</small>
                </span>
                {id === "diagnostics" &&
                  !!c?.journal.read().filter((log) => log.level === "error")
                    .length && <span className="error-count">!</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="quiet-note">
              <ShieldCheck size={18} />
              <p>
                每一笔变量变化
                <br />
                都有可追溯的记录。
              </p>
            </div>
            <span className="version">
              SOLVE {connection.version}
              <span>{connection.demo ? "DEMO" : "LOCAL"}</span>
            </span>
          </div>
        </aside>
        <div className="app-body">
          <header className="topbar">
            <div className="breadcrumb">
              <span className="desktop-only">调试工作台</span>
              <ChevronRight className="desktop-only" size={14} />
              <strong>
                {navigation.find((item) => item.id === nav)?.label}
              </strong>
            </div>
            <div className="top-actions">
              <span
                className={`status-pill ${status?.pendingCount ? "warning" : ""}`}
              >
                <span className={`dot ${!status?.ready ? "off" : ""}`} />
                {status?.busy
                  ? "处理中"
                  : status?.pendingCount
                    ? "待保存"
                    : status?.ready
                      ? "已连接"
                      : "未就绪"}
              </span>
              <IconButton
                label={dark ? "切换浅色主题" : "切换深色主题"}
                onClick={() => setDark(!dark)}
              >
                {dark ? <Sun size={18} /> : <Moon size={18} />}
              </IconButton>
              {!connection.demo && (
                <IconButton label="关闭调试面板" onClick={connection.close}>
                  <PanelLeftClose size={18} />
                </IconButton>
              )}
            </div>
          </header>
          <div className="session-strip">
            <span className="session-icon">
              <Terminal size={15} />
            </span>
            <strong>{status?.chatId || session.chatId || "未绑定聊天"}</strong>
            <span className="session-definition">
              {status?.definition.id || session.phase}
            </span>
            {connection.demo && (
              <span className="demo-label">演示环境 · 刷新重置</span>
            )}
          </div>
          <main id="main-content">
            {c ? (
              <BoundWorkspace
                key={status?.sessionId}
                c={c}
                connection={connection}
                nav={nav}
                setNav={setNav}
              />
            ) : (
              <Unbound
                key={`${session.chatId}:${session.phase}`}
                connection={connection}
              />
            )}
            <footer>
              有序的状态，自由的故事。
              <span className="footer-links">
                <a href={`https://github.com/aforgomon41-create/SillyTavern-Oriented-LLM-Variable-Engine/tree/v${VERSION}`} target="_blank" rel="noopener noreferrer">源码</a>
                <a href={`https://github.com/aforgomon41-create/SillyTavern-Oriented-LLM-Variable-Engine/blob/v${VERSION}/LICENSE`} target="_blank" rel="noopener noreferrer">AGPL-3.0 · 无担保</a>
              </span>
            </footer>
          </main>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

const root = createRoot(document.getElementById("root")!);
let departed = false;
let disposeConnection: (() => void) | undefined;
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  departed = true;
  // Unsubscribe from the parent manager before an iframe is destroyed.
  root.unmount();
  disposeConnection?.();
});
root.render(
  <div className="boot">
    <Leaf size={28} />
    <p>正在连接 SOLVE…</p>
  </div>,
);
connect()
  .then((connection) => {
    if (departed) {
      connection.dispose?.();
      return;
    }
    disposeConnection = () => connection.dispose?.();
    root.render(<App connection={connection} />);
  })
  .catch((error) => {
    if (departed) return;
    root.render(
      <div className="boot">
        <Leaf size={32} />
        <h1>打开 SOLVE 调试面板</h1>
        <p role="alert">{errorText(error)}</p>
        <a className="button primary" href="?demo=1">
          进入独立演示
          <ArrowRight size={16} />
        </a>
      </div>,
    );
  });
