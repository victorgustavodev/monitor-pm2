import { t } from "../i18n";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (
    options?.body &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch {
    throw new ApiError(
      t("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente."),
      0,
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const messages: Record<number, string> = {
      401:
        url === "/api/auth/login"
          ? t("Usuário ou senha inválidos.")
          : t("Sua sessão expirou. Entre novamente."),
      403: t("Você não tem permissão para realizar esta ação."),
      413: t("O arquivo excede o limite de envio do servidor."),
      429: t("Muitas tentativas de acesso. Aguarde alguns minutos antes de tentar novamente."),
      502:
        url === "/api/processes"
          ? t("Não foi possível carregar os processos do PM2. Verifique a conexão do monitor com o PM2 na VM.")
          : t("O servidor está indisponível no momento. Verifique o serviço e o encaminhamento do IIS."),
      503: t("O serviço está temporariamente indisponível. Tente novamente em instantes."),
      504: t("O servidor demorou para responder. Tente novamente em instantes."),
    };
    const detail = typeof body?.message === "string" ? body.message : "";
    throw new ApiError(
      `${(detail && t(detail)) || messages[response.status] || t("Não foi possível concluir a operação.")} (HTTP ${response.status})`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
