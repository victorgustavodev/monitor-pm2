export type TerminalPart = { text: string; color?: number; bold: boolean };

export function terminalParts(content: string): TerminalPart[] {
  // Consume terminal commands, including OSC hyperlinks, without interpreting HTML.
  const commands = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)|(?:\x1b\[|\x9b)([0-9;:?]*)([ -/]*)([@-~])|\x1b[ -/]*[@-Z\\-_]|[\x00-\x08\x0b-\x1f\x7f]/g;
  const parts: TerminalPart[] = [];
  let color: number | undefined, bold = false, offset = 0;
  for (const match of content.matchAll(commands)) {
    if (match.index > offset) parts.push({ text: content.slice(offset, match.index), color, bold });
    if (match[3] === "m") {
      const codes = (match[1] || "0").split(";").map(Number);
      for (let index = 0; index < codes.length; index++) {
        const code = codes[index];
        if (code === 0) { color = undefined; bold = false; }
        else if (code === 1) bold = true;
        else if (code === 22) bold = false;
        else if (code === 39) color = undefined;
        else if (code >= 30 && code <= 37) color = code - 30;
        else if (code >= 90 && code <= 97) color = code - 90;
        // Extended colors are consumed as a unit; keep the accessible token palette.
        else if (code === 38 || code === 48 || code === 58)
          index += codes[index + 1] === 2 ? 4 : codes[index + 1] === 5 ? 2 : 0;
      }
    }
    offset = match.index + match[0].length;
  }
  if (offset < content.length) parts.push({ text: content.slice(offset), color, bold });
  return parts;
}
