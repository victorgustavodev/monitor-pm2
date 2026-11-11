import { useMemo } from "react";
import { terminalParts } from "./ansi";

export function LogTerminal({ content, label }: { content: string; label?: string }) {
  const parts = useMemo(() => terminalParts(content), [content]);
  return <pre className="log-terminal" tabIndex={0} aria-label={label}>
    {parts.map((part, index) => <span key={index}
      className={`${part.color === undefined ? "" : `terminal-color-${part.color}`} ${part.bold ? "font-bold" : ""}`}>{part.text}</span>)}
  </pre>;
}
