import { t } from "../../i18n";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import Logo from "../../assets/logo.png";
import { api } from "../../services/api";

export function Login({
  onLogin,
  serverError,
}: {
  onLogin: () => Promise<void>;
  serverError: string;
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const visibleError = error || serverError;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: data.get("username"),
          password: data.get("password"),
        }),
      });
      await onLogin();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Falha no login"));
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="login-background">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <img
            src={Logo}
            alt="KPMG"
            width={214}
            height={113}
            className="brand-logo"
            decoding="async"
          />
        </div>
        <div className="login-content">
          <h2
            id="login-title"
            className="text-2xl font-semibold tracking-tight text-heading"
          >
            {t("Acesse o painel")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            {t("Realizar login para acessar o monitoramento de processos PM2.")}
          </p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <label className="block text-sm font-medium text-content">
              {t("Usuário")}
              <input
                name="username"
                autoComplete="username"
                placeholder={t("Digite seu usuário")}
                required
                className="login-input mt-2"
              />
            </label>
            <div>
              <label
                htmlFor="login-password"
                className="block text-sm font-medium text-content"
              >
                {t("Senha")}
              </label>
              <div className="relative mt-2">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder={t("Digite sua senha")}
                  required
                  className="login-input login-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={
                    showPassword ? t("Ocultar senha") : t("Mostrar senha")
                  }
                  aria-pressed={showPassword}
                  aria-controls="login-password"
                  className="login-password-toggle"
                >
                  {showPassword ? (
                    <EyeOff size={18} aria-hidden="true" />
                  ) : (
                    <Eye size={18} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
            {visibleError && (
              <div
                role="alert"
                aria-atomic="true"
                className="rounded-lg border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger"
              >
                <p className="font-semibold">
                  {t("Não foi possível acessar o painel")}
                </p>
                <p className="mt-1 break-words leading-5">{visibleError}</p>
              </div>
            )}
            <button
              disabled={loading}
              className="h-12 w-full rounded-lg bg-action px-4 text-sm font-semibold text-on-action transition-colors duration-150 hover:bg-action-hover disabled:opacity-50"
            >
              {loading ? t("Entrando…") : t("Entrar")}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
