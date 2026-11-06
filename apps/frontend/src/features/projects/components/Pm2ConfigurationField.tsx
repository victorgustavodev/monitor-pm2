import { t } from "../../../i18n";

export function Pm2ConfigurationField({
  content = "",
  disabled,
}: {
  content?: string;
  disabled: boolean;
}) {
  return (
    <label>
      {t("Configuração PM2 salva no projeto (opcional)")}
      <textarea
        name="pm2ConfigContent"
        defaultValue={content}
        rows={10}
        maxLength={16384}
        disabled={disabled}
        spellCheck={false}
        className="project-pm2-code"
        placeholder={
          'module.exports = {\n  apps: [{\n    name: "minha-app",\n    script: "./dist/main.js",\n    exec_mode: "fork",\n  }],\n};'
        }
      />
      <small>
        {t(
          "Cole o conteúdo do ecosystem uma vez. Se o ZIP não incluir esse arquivo, o monitor usará esta configuração. O caminho do script deve corresponder aos arquivos do ZIP. Limite: 16 KB.",
        )}
      </small>
      <small>
        {t(
          "Exemplo: use ./dist/main.js se o ZIP contiver dist/main.js, ou ./main.js se o arquivo estiver na raiz. Salvar a configuração não reinicia a aplicação.",
        )}
      </small>
      <small>
        {t("Os caminhos do script são relativos à pasta do ecosystem.")}
      </small>
    </label>
  );
}
