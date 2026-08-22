import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/router";
import {
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  Info,
  MessageCircle,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import {
  assistantReducer,
  initialAssistantState,
  safeAssistantHref,
  SCENARIOS,
  sourceForCitation,
} from "@/lib/assistant/contract.mjs";
import { mockEnabled, mockTransport } from "@/lib/assistant/mock.mjs";
import {
  assistantSessionId,
  boundedHistory,
  realTransport,
} from "@/lib/assistant/transport.mjs";
import {
  clearThread,
  loadPreference,
  loadThread,
  savePreference,
  saveThread,
} from "@/lib/assistant/storage.mjs";

const STARTERS = [
  "برای شروع راهنمایی‌ام کن.",
  "چطور دامنه را به برنامه متصل کنم؟",
  "چطور برنامه را در لیارا مستقر کنم؟",
];

const MODES = [
  { id: "normal", label: "معمولی", description: "پاسخ کوتاه همراه منبع دقیق", Icon: MessageCircle },
  { id: "tutorial", label: "آموزش مرحله‌ای", description: "راهنما و نمایش بخش مرتبط صفحه", Icon: BookOpen },
  { id: "command", label: "فقط دستور", description: "فقط command؛ بدون توضیح اضافه", Icon: Terminal },
];

const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function sourceTarget(source) {
  const anchor = source.anchor ? document.getElementById(source.anchor) : document.querySelector("main h1");
  const heading = anchor?.previousElementSibling;
  return heading?.matches?.("h1, h2, h3, h4") ? heading : anchor;
}

function Inline({ text, sources, onSource }) {
  const parts = text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\)|\[S\d+\]|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const citation = part.match(/^\[(S\d+)\]$/)?.[1];
    if (citation) {
      const source = sourceForCitation(citation, sources);
      return source ? <button key={index} className="assistant-citation" onClick={() => onSource(source)} aria-label={`باز کردن منبع ${citation}`}>[{citation}]</button> : part;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = safeAssistantHref(link[2]);
      return href ? (
        <a key={index} href={href} target={href.startsWith("https://") ? "_blank" : undefined} rel="noopener noreferrer">
          {link[1]} {href.startsWith("https://") && <ExternalLink size={12} />}
        </a>
      ) : <span key={index}>{link[1]}</span>;
    }
    return part;
  });
}

function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="assistant-code" dir="ltr">
      <div><span>{language || "text"}</span><button onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }} aria-label="کپی کد">{copied ? <Check size={14} /> : <Copy size={14} />}</button></div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function Markdown({ children, sources = [], onSource }) {
  const lines = children.split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code = [];
      for (i += 1; i < lines.length && !lines[i].startsWith("```"); i += 1) code.push(lines[i]);
      blocks.push(<CodeBlock key={blocks.length} code={code.join("\n")} language={language} />);
      i += 1;
      continue;
    }
    if (/^#{1,3} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      const Tag = `h${level + 2}`;
      blocks.push(<Tag key={blocks.length}><Inline text={line.slice(level + 1)} sources={sources} onSource={onSource} /></Tag>);
      i += 1;
      continue;
    }
    if (/^(\d+\. |[-*] )/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items = [];
      while (i < lines.length && (ordered ? /^\d+\. /.test(lines[i]) : /^[-*] /.test(lines[i]))) {
        items.push(<li key={i}><Inline text={lines[i].replace(/^(\d+\. |[-*] )/, "")} sources={sources} onSource={onSource} /></li>);
        i += 1;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(<Tag key={blocks.length}>{items}</Tag>);
      continue;
    }
    if (line.startsWith("|") && lines[i + 1]?.match(/^\|?[ |:-]+\|/)) {
      const rows = [];
      const cells = (row) => row.split("|").slice(1, -1).map((cell) => cell.trim());
      const headers = cells(line);
      i += 2;
      while (i < lines.length && lines[i].startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push(<div className="assistant-table" key={blocks.length}><table><thead><tr>{headers.map((cell) => <th key={cell}><Inline text={cell} sources={sources} onSource={onSource} /></th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><Inline text={cell} sources={sources} onSource={onSource} /></td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (line.trim()) blocks.push(<p key={blocks.length}><Inline text={line} sources={sources} onSource={onSource} /></p>);
    i += 1;
  }
  return <div className="assistant-markdown">{blocks}</div>;
}

export default function Assistant() {
  const router = useRouter();
  const [state, dispatch] = useReducer(assistantReducer, initialAssistantState);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [mode, setMode] = useState("normal");
  const [tutorial, setTutorial] = useState(null);
  const [tutorialPosition, setTutorialPosition] = useState(null);
  const [value, setValue] = useState("");
  const launcherRef = useRef(null);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const threadRef = useRef(null);
  const abortRef = useRef(null);
  const closeTimerRef = useRef(null);
  const scenario = SCENARIOS.includes(router.query.scenario) ? router.query.scenario : "success";
  const useMockTransport = mockEnabled(router.pathname);
  const busy = ["submitting", "streaming"].includes(state.phase);
  const activeSources = state.messages.at(-1)?.sources?.length ?? 0;
  const statusText = state.phase === "submitting"
    ? activeSources ? `${activeSources} منبع پیدا شد.` : "در حال بررسی مستندات."
    : state.phase === "streaming" ? "پاسخ در حال دریافت است."
      : state.phase === "error" ? state.error?.message
        : state.phase === "stopped" ? "تولید پاسخ متوقف شد."
          : state.phase === "done" ? "پاسخ کامل شد." : "";

  useEffect(() => {
    dispatch({ type: "hydrate", messages: loadThread() });
    setMode(loadPreference());
  }, []);

  useEffect(() => {
    if (state.hydrated && !busy) saveThread(state.messages);
  }, [busy, state.hydrated, state.messages]);

  useEffect(() => {
    if (router.pathname === "/assistant-demo" && scenario === "long-thread") {
      dispatch({
        type: "hydrate",
        messages: Array.from({ length: 10 }, (_, index) => ({
          id: `demo-${index}`,
          role: index % 2 ? "assistant" : "user",
          content: index % 2 ? "پاسخ نمونه برای بررسی گفتگوهای طولانی و رفتار اسکرول." : `سؤال نمونه شماره ${index / 2 + 1}`,
          status: "done",
          sources: [],
          createdAt: "2026-08-21T00:00:00.000Z",
        })),
      });
    }
  }, [router.pathname, scenario]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: busy ? "auto" : "smooth" });
  }, [busy, state.messages]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const resize = () => {
      const maxHeight = Math.min(260, window.innerHeight * 0.32);
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
      input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [value, open]);

  useEffect(() => {
    const target = tutorial?.target;
    if (!target) return;

    const update = () => {
      if (!target.isConnected) return setTutorial(null);
      const rect = target.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 24);
      const center = rect.left + rect.width / 2;
      const left = Math.max(12, Math.min(center - width / 2, window.innerWidth - width - 12));
      const below = window.innerHeight - rect.bottom > 210 || rect.top < 210;
      setTutorialPosition({
        top: below ? rect.bottom + 14 : rect.top - 14,
        left,
        width,
        placement: below ? "bottom" : "top",
        arrow: Math.max(24, Math.min(center - left, width - 24)),
      });
    };

    target.classList.add("assistant-guide-target");
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      target.classList.remove("assistant-guide-target");
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      setTutorialPosition(null);
    };
  }, [tutorial]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setTimeout(() => inputRef.current?.focus(), 0);
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (router.pathname === "/assistant-demo") setOpen(true);
  }, [router.pathname]);

  useEffect(() => {
    const shortcut = (event) => {
      if (event.key === "Escape" && (open || tutorial)) {
        event.preventDefault();
        event.stopPropagation();
        if (open) closePanel();
        else setTutorial(null);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") {
        event.preventDefault();
        if (open) closePanel();
        else openPanel();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [open, closing, tutorial]);

  useEffect(() => () => {
    abortRef.current?.abort();
    clearTimeout(closeTimerRef.current);
  }, []);

  async function ask(question, retry = false) {
    const text = question.trim();
    if (!text || busy || abortRef.current) return;
    setValue("");
    const assistant = { id: id(), role: "assistant", createdAt: new Date().toISOString() };
    if (retry) dispatch({ type: "retry", assistant });
    else dispatch({ type: "submit", user: { id: id(), role: "user", content: text, status: "done", sources: [], createdAt: new Date().toISOString() }, assistant });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const historyMessages = retry ? state.messages.slice(0, -2) : state.messages;
      const path = router.asPath.split(/[?#]/u, 1)[0];
      const request = {
        sessionId: assistantSessionId(),
        mode,
        message: text,
        history: boundedHistory(historyMessages),
        page: {
          path: /^\/[a-z0-9/_-]*$/iu.test(path) ? path : "/",
          title: document.title.trim().slice(0, 200),
        },
      };
      const transport = useMockTransport ? mockTransport : realTransport;
      const options = useMockTransport
        ? { signal: controller.signal, scenario, mode }
        : { signal: controller.signal };
      for await (const event of transport(request, options)) {
        dispatch({ type: "event", event });
        if (event.type === "error") break;
      }
    } catch (error) {
      if (error.name !== "AbortError") dispatch({ type: "error", error: { message: "خطای پیش‌بینی‌نشده رخ داد.", retryable: true } });
    } finally {
      abortRef.current = null;
    }
  }

  function openPanel() {
    clearTimeout(closeTimerRef.current);
    setClosing(false);
    setOpen(true);
  }

  function closePanel() {
    if (!open || closing) return;
    setSettingsOpen(false);
    setInfoOpen(false);
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      dialogRef.current?.close();
      setOpen(false);
      setClosing(false);
      launcherRef.current?.focus();
    }, 220);
  }

  function chooseMode(nextMode) {
    setMode(nextMode);
    savePreference(nextMode);
    setSettingsOpen(false);
  }

  function stop() {
    abortRef.current?.abort();
    dispatch({ type: "stop" });
  }

  function retry() {
    const question = [...state.messages].reverse().find((message) => message.role === "user")?.content;
    if (question) ask(question, true);
  }

  function reset() {
    abortRef.current?.abort();
    clearThread();
    dispatch({ type: "clear" });
  }

  async function openSource(source) {
    await router.push(`${source.url}${source.anchor ? `#${source.anchor}` : ""}`);
    const target = sourceTarget(source);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    closePanel();
    if (mode === "tutorial" && target) {
      setTutorial({ source, target });
      return;
    }
    target?.classList.add("assistant-source-highlight");
    setTimeout(() => target?.classList.remove("assistant-source-highlight"), 2200);
  }

  if (router.pathname.startsWith("/admin")) return null;

  return (
    <>
      <button ref={launcherRef} className="assistant-launcher" onClick={openPanel} aria-label="باز کردن دستیار مستندات">
        <Sparkles size={18} /><span>از مستندات بپرس</span><kbd>⌘ I</kbd>
      </button>
      <dialog
        ref={dialogRef}
        className={`assistant-dialog assistant-mode-${mode}`}
        data-closing={closing}
        onClick={(event) => event.target === event.currentTarget && closePanel()}
        onClose={() => { setOpen(false); launcherRef.current?.focus(); }}
        onCancel={(event) => { event.preventDefault(); closePanel(); }}
        aria-label="دستیار مستندات لیارا"
      >
        <section className="assistant-panel">
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{statusText}</div>
          <header>
            <div className="assistant-brand"><span><Sparkles size={17} /></span><div><strong>دستیار مستندات</strong><small>{MODES.find((item) => item.id === mode)?.label}{useMockTransport ? ` · ${scenario}` : ""}</small></div></div>
            <div className="assistant-actions"><button onClick={() => { setInfoOpen((current) => !current); setSettingsOpen(false); }} aria-label="درباره دستیار" aria-expanded={infoOpen}><Info size={17} /></button><button onClick={() => { setSettingsOpen((current) => !current); setInfoOpen(false); }} aria-label="تنظیمات پاسخ" aria-expanded={settingsOpen}><Settings2 size={17} /></button><button onClick={reset} aria-label="پاک کردن گفتگو"><Trash2 size={17} /></button><button onClick={closePanel} aria-label="بستن"><X size={19} /></button></div>
          </header>

          {settingsOpen && <div className="assistant-settings" role="radiogroup" aria-label="سبک پاسخ">
            <div><strong>پاسخ را شخصی‌سازی کنید</strong><small>هر زمان خواستید قابل تغییر است.</small></div>
            {MODES.map(({ id: modeId, label, description, Icon }) => <button key={modeId} role="radio" aria-checked={mode === modeId} onClick={() => chooseMode(modeId)}><span><Icon size={17} /></span><div><strong>{label}</strong><small>{description}</small></div>{mode === modeId && <Check size={16} />}</button>)}
          </div>}

          {infoOpen && <div className="assistant-info" role="dialog" aria-label="درباره دستیار هوش مصنوعی">
            <div className="assistant-info-title"><span><Sparkles size={18} /></span><div><strong>دستیار هوش مصنوعی لیارا</strong><small>راهنمای سریع مستندات</small></div></div>
            <p>پاسخ‌ها باید فقط از مستندات لیارا ساخته شوند و هر نکته فنی به منبع قابل بازکردن وصل باشد.</p>
            <ul><li><ShieldCheck size={15} /><span><strong>حریم خصوصی</strong>گفتگو در همین tab مرورگر نگهداری می‌شود.</span></li><li><BookOpen size={15} /><span><strong>منبع‌محور</strong>برای اطمینان، citation پاسخ را بررسی کنید.</span></li>{useMockTransport && <li><Info size={15} /><span><strong>نسخه نمایشی</strong>پاسخ‌ها mock هستند و ممکن است کامل نباشند.</span></li>}</ul>
            <button onClick={() => setInfoOpen(false)}>متوجه شدم</button>
          </div>}

          <div ref={threadRef} className="assistant-thread" aria-live={busy ? "off" : "polite"} aria-busy={busy}>
            {!state.messages.length && <div className="assistant-empty"><div className="assistant-orbit"><MessageCircle size={28} /></div><h2>از دل مستندات، جواب دقیق بگیر.</h2><p>یک سؤال فنی بپرس؛ پاسخ همراه منبع معتبر می‌آید.</p><div>{STARTERS.map((starter) => <button key={starter} onClick={() => ask(starter)}>{starter}<span>←</span></button>)}</div></div>}
            {state.messages.map((message) => <article key={message.id} className={`assistant-message ${message.role}`}>
              <div className="assistant-message-label">{message.role === "user" ? "شما" : "دستیار"}</div>
              {message.role === "assistant" ? <Markdown sources={message.sources} onSource={openSource}>{message.content || (busy ? "در حال بررسی مستندات…" : "")}</Markdown> : <p>{message.content}</p>}
              {!!message.sources?.length && <div className="assistant-sources">{message.sources.map((source, index) => <button key={source.id} onClick={() => openSource(source)} title={source.snippet}><span>{index + 1}</span>{source.title}<ExternalLink size={12} /></button>)}</div>}
              {message.status === "stopped" && <small className="assistant-note">تولید پاسخ متوقف شد. <button onClick={retry}>تلاش دوباره</button></small>}
              {message.status === "done" && <small className="assistant-note">پاسخ کامل شد.</small>}
            </article>)}
            {state.error && <div className="assistant-error" role="alert"><strong>پاسخ کامل نشد.</strong><span>{state.error.message}</span>{state.error.retryable && <button onClick={retry}><RotateCcw size={14} /> تلاش دوباره</button>}</div>}
            {!busy && state.suggestions.length > 0 && <div className="assistant-followups"><span>{state.suggestionPrompt}</span>{state.suggestions.map((suggestion) => <button key={suggestion} onClick={() => ask(suggestion)}>{suggestion}</button>)}</div>}
          </div>

          <form className="assistant-composer" data-near-limit={value.length > 1800} onSubmit={(event) => { event.preventDefault(); ask(value); }}>
            <textarea ref={inputRef} value={value} dir={value ? "auto" : "rtl"} onChange={(event) => setValue(event.target.value.slice(0, 2000))} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(value); } }} placeholder="سؤال یا متن خود را بنویسید…" rows={1} aria-label="سؤال از مستندات" />
            <footer className="assistant-composer-footer">
              <div><span>{value.length}/2000</span><span>Shift+Enter برای خط جدید</span></div>
              {busy ? <button type="button" className="assistant-stop" onClick={stop} aria-label="توقف پاسخ"><Square size={15} /></button> : <button type="submit" disabled={!value.trim()} aria-label="ارسال سؤال"><Send size={17} /></button>}
            </footer>
          </form>
        </section>
      </dialog>
      {tutorial && tutorialPosition && <aside
        className="assistant-tutorial"
        data-placement={tutorialPosition.placement}
        style={{ top: tutorialPosition.top, left: tutorialPosition.left, width: tutorialPosition.width, "--guide-arrow": `${tutorialPosition.arrow}px` }}
        role="dialog"
        aria-label="راهنمای بخش مستندات"
      >
        <i aria-hidden="true" />
        <div><span>راهنمای همین بخش</span><button onClick={() => { setTutorial(null); openPanel(); setTimeout(() => inputRef.current?.focus(), 0); }} aria-label="پرسش دوباره"><MessageCircle size={16} /></button></div>
        <strong>{tutorial.source.title}</strong>
        <p>{tutorial.source.snippet}</p>
        <button onClick={() => { tutorial.target.scrollIntoView({ behavior: "smooth", block: "center" }); tutorial.target.classList.remove("assistant-guide-pulse"); requestAnimationFrame(() => { tutorial.target.classList.add("assistant-guide-pulse"); setTimeout(() => tutorial.target.classList.remove("assistant-guide-pulse"), 1400); }); }}>نمایش دوباره بخش</button>
      </aside>}
    </>
  );
}
