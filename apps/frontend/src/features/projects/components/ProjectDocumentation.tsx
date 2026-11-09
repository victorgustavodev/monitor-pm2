import { useState, type FormEvent, type ReactNode } from "react";
import { t } from "../../../i18n";
import type { Project } from "../types";

// Render a small Markdown subset as React nodes. User HTML is always plain text.
function inline(text: string): ReactNode[] {
  return text.split(/(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, index) => {
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

export function DocumentationPreview({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (line.startsWith("```")) {
      const code: string[] = [];
      const key = index;
      while (++index < lines.length && !lines[index].startsWith("```")) code.push(lines[index]);
      nodes.push(<pre key={key}><code>{code.join("\n")}</code></pre>);
    } else if (/^#{1,6} /.test(line)) {
      nodes.push(<h3 key={index}>{inline(line.replace(/^#{1,6} /, ""))}</h3>);
    } else if (/^[-*] /.test(line)) {
      const items: ReactNode[] = [];
      const key = index;
      while (index < lines.length && /^[-*] /.test(lines[index])) {
        items.push(<li key={index}>{inline(lines[index].slice(2))}</li>);
        index++;
      }
      index--;
      nodes.push(<ul key={key}>{items}</ul>);
    } else nodes.push(<p key={index}>{inline(line)}</p>);
  }
  return <div className="project-documentation-preview">{nodes}</div>;
}

export function ProjectDocumentation({ project, busy, onSave }: {
  project: Project;
  busy: boolean;
  onSave: (data: FormData) => Promise<void>;
}) {
  const [content, setContent] = useState(project.documentation || "");
  const [editing, setEditing] = useState(!project.documentation);
  const locked = busy || project.deploying;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!locked) await onSave(new FormData(event.currentTarget));
  }
  return <section className="project-form-card project-details">
    <div className="project-section-heading">
      <div><h2>{t("Sobre o projeto")}</h2><p>{t("Documente o README, o banco de dados e os procedimentos da aplicação.")}</p></div>
      <button className="project-button secondary" disabled={locked} onClick={() => setEditing(value => !value)}>{editing ? t("Visualizar documentação") : t("Editar documentação")}</button>
    </div>
    <form className="project-form" onSubmit={save}>
      <label hidden={!editing}>
        {t("Documentação em Markdown")}
        <textarea name="documentation" value={content} onChange={event => setContent(event.target.value)} rows={18} maxLength={32768} disabled={locked} className="project-pm2-code" />
        <small>{t("Use títulos, listas, negrito, blocos de código e links para diagramas. Limite: 32 KB.")}</small>
      </label>
      {!editing && (content.trim() ? <DocumentationPreview content={content} /> : <p className="project-empty">{t("Nenhuma documentação cadastrada.")}</p>)}
      <div className="project-form-actions"><button className="project-button" disabled={locked || content === (project.documentation || "")}>{busy ? t("Salvando…") : t("Salvar documentação")}</button></div>
    </form>
  </section>;
}
