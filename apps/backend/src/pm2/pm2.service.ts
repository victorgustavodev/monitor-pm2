import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProcessAction, ProcessView } from "./pm2.types";

const execFileAsync = promisify(execFile);

@Injectable()
export class Pm2Service {
  constructor(private readonly config: ConfigService) {}

  async list(): Promise<ProcessView[]> {
    const { stdout } = await this.run(["jlist"]);
    try {
      const rows = JSON.parse(stdout) as Array<Record<string, any>>;
      return rows.map((item) => ({
        id: Number(item.pm_id),
        name: String(item.name),
        status: String(item.pm2_env?.status ?? "unknown"),
        pid: Number(item.pid ?? 0),
        cpu: Number(item.monit?.cpu ?? 0),
        memory: Number(item.monit?.memory ?? 0),
        uptime: item.pm2_env?.pm_uptime ? Number(item.pm2_env.pm_uptime) : null,
        restarts: Number(item.pm2_env?.restart_time ?? 0),
        mode: String(item.pm2_env?.exec_mode ?? "unknown").replace("_mode", ""),
        version: item.pm2_env?.version ? String(item.pm2_env.version) : null,
      }));
    } catch {
      console.log("Failed to parse PM2 output:", stdout);
      throw new BadGatewayException("O PM2 retornou uma resposta inválida.");
      
    }
  }

  async action(id: number, action: ProcessAction): Promise<void> {
    await this.assertExists(id);
    await this.run([action, String(id)]);
    if (action !== "delete") await this.run(["save", "--force"]);
  }

  async logs(id: number, lines = 100): Promise<string> {
    await this.assertExists(id);
    const safeLines = Math.min(Math.max(lines, 10), 500);
    const { stdout, stderr } = await this.run([
      "logs",
      String(id),
      "--nostream",
      "--raw",
      "--lines",
      String(safeLines),
    ]);
    return `${stdout}${stderr}`.trim();
  }

  private async assertExists(id: number) {
    const processes = await this.list();
    if (!processes.some((process) => process.id === id))
      throw new NotFoundException("Processo PM2 não encontrado.");
  }

  private async run(args: string[]) {
    const pm2Script =
      this.config.get<string>("PM2_SCRIPT") ?? require.resolve("pm2/bin/pm2");
    const command = process.execPath;
    const commandArgs = [pm2Script, ...args];
    try {
      return await execFileAsync(command, commandArgs, {
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 5 * 1024 * 1024,
        env: {
          ...process.env,
          PM2_HOME: this.config.get<string>("PM2_HOME") ?? process.env.PM2_HOME,
        },
      });
    } catch (error: any) {
      const detail = String(
        error?.stderr || error?.message || "Falha desconhecida",
      ).trim();
      throw new BadGatewayException(`Falha ao executar PM2: ${detail}`);
    }
  }
}
