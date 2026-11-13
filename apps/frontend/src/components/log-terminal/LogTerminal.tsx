import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { terminalParts } from "./ansi";
import { t } from "../../i18n";

export function LogTerminal({ content, label, follow = false }: { content: string; label?: string; follow?: boolean }) {
  const parts = useMemo(() => terminalParts(content), [content]);
  const terminal = useRef<HTMLPreElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  useLayoutEffect(() => {
    if (follow && atBottom && terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight;
  }, [content, follow, atBottom]);
  return <>
    {follow && !atBottom && <button type="button" className="px-4 py-2 text-xs text-link" onClick={() => setAtBottom(true)}>{t("Ir para o fim dos logs")}</button>}
    <pre ref={terminal} className="log-terminal" tabIndex={0} aria-label={label} onScroll={event => {
      const node = event.currentTarget;
      setAtBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 32);
    }}>
    {parts.map((part, index) => <span key={index}
      className={`${part.color === undefined ? "" : `terminal-color-${part.color}`} ${part.bold ? "font-bold" : ""}`}>{part.text}</span>)}
  </pre></>;
}
