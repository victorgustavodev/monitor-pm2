import { Script } from "node:vm";
import { HttpError } from "../common/http-error";

export function pm2Configuration(raw: unknown, previous = "") {
  if (raw === undefined) return previous;
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 16 * 1024) {
    throw new HttpError(
      400,
      "A configuração PM2 deve ser um texto de até 16 KB.",
    );
  }
  const content = raw.trim();
  if (content) {
    try {
      // Compile as CommonJS without running user code in the API process.
      new Script(
        `(function(exports, require, module, __filename, __dirname) {\n${content}\n})`,
      );
    } catch {
      throw new HttpError(
        400,
        "A configuração PM2 contém JavaScript inválido. Revise o conteúdo do ecosystem.",
      );
    }
  }
  return content;
}
