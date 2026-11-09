# ati-dev-cockpit para Windows

Painel web para visualizar e operar processos do PM2 em uma VM Windows. O frontend React/Tailwind e a API Express são publicados juntos na porta `4170`.

## Funcionalidades

- Navegação lateral com Home, Projetos e Configurações expansível (Geral, Logs e Usuários); em celular, a navegação fica no topo. A Home reúne quatro indicadores e a lista completa de processos, com busca e modos Lista/Cards.
- Projetos com navegação pelos arquivos da VM, visualização de texto, download e histórico de builds com autor e comentário obrigatório.
- Publicação de builds na pasta cadastrada do projeto, execução do ecosystem PM2 e possibilidade de republicar versões anteriores.
- Limpeza automática opcional, com prazo de retenção e intervalo configuráveis, preservando builds ativos e arquivos referenciados pelo PM2.
- Interface em português do Brasil, inglês e espanhol, selecionável em Configurações.
- Lista status, PID, portas TCP, CPU, memória, uptime e reinícios dos processos.
- Permite vincular um nome de exibição ao processo, como `processText3920 → workTabs`, com edição na lista e nos cards e busca pelo nome técnico ou de exibição.
- Atualiza métricas e processos por SSE, sem consultas periódicas do navegador.
- Permite alternar as aplicações entre lista e cards, mantendo a busca e as ações nos dois formatos e salvando a preferência no navegador.
- Inicia, para, reinicia e remove processos; também permite iniciar um ecosystem já existente na VM.
- Aceita builds prontos em `.zip`, `.rar`, `.7z`, `.tar`, `.tar.gz`, `.tar.bz2` e `.tar.xz` (incluindo os aliases `.tgz`, `.tbz`, `.tbz2` e `.txz`), identifica projeto e versão, preserva o arquivo original e extrai os arquivos em `versions/`.
- Permite baixar o arquivo compactado original e iniciar qualquer versão salva no PM2, inclusive uma versão anterior.
- Cria usuários no MongoDB, com senha protegida por scrypt e salt individual.
- Mantém sessão de 8 horas em cookie `HttpOnly` e registra ações do painel no MongoDB.
- Coleta a saída dos processos PM2 a cada 5 segundos e mantém o histórico no MongoDB.
- Aceita requisições de qualquer IP, sem allowlist ou configuração de VPN no projeto. O controle de rede fica com a infraestrutura; as operações do painel continuam exigindo login.

## Instalação

Requisitos: Node.js 22+, npm, MongoDB acessível e PowerShell 5.1+. O PM2 já está incluído como dependência local.

```powershell
npm.cmd install
Copy-Item .env.example .env
# Edite .env: MONGODB_URI, MONGODB_DATABASE, ADMIN_USERNAME, ADMIN_PASSWORD e JWT_SECRET
npm.cmd run build
npm.cmd run start:prod
```

Exemplo das configurações de banco e arquivos:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DATABASE=monitor_pm2
VERSIONS_DIR=versions
UPLOAD_MAX_MB=100
EXTRACTED_MAX_MB=1024
```

`VERSIONS_DIR` aceita um caminho absoluto ou relativo à raiz do projeto. A conta Windows do monitor precisa ter permissão de leitura e gravação nessa pasta. O MongoDB deve estar disponível antes de iniciar o painel; a API só começa a escutar após conectar ao banco e preparar os índices.

Abra `http://IP-DA-VM:4170`. Para desenvolvimento, use `npm.cmd run dev` (frontend em `5173`, com proxy para a API).

O código e os arquivos gerados ficam separados:

```text
apps/
  frontend/
    src/
      app/         # Componente principal e integração do painel
      assets/      # Imagens e favicon
      components/  # Componentes compartilhados de layout
      features/    # Telas e componentes agrupados por funcionalidade
        auth/
        management/
        home/
        processes/
        projects/
        settings/
      services/    # Cliente HTTP da API
      styles/      # CSS global e tokens do design system
      types/       # Declarações TypeScript de bibliotecas e do Vite
      main.tsx     # Entrada do React
    dist/     # Build gerado pelo Vite
  backend/
    src/
      auth/      # Sessões, senhas e cadastro de usuários
      common/    # Configuração, acesso ao banco e erros HTTP
      logs/      # Coleta e persistência de logs
      pm2/       # Operações, métricas, SSE, portas e worker de deploy
      projects/  # Projetos, arquivos locais, histórico e publicação de builds
      versions/  # Builds compactados, versões e worker de extração
      main.ts    # Rotas Express e inicialização da API
    dist/     # Build gerado pelo TypeScript
```

`npm.cmd run build` gera primeiro o frontend e depois o backend. Em produção, o Express serve `apps/frontend/dist/` junto da API na porta `4170`. As pastas `dist/` estão ignoradas pelo Git; gere o build no ambiente de deploy ou inclua ambas no artefato de publicação, preservando essa estrutura de diretórios. A antiga pasta `apps/backend/frontend/` não é mais utilizada.

O backend usa o mesmo daemon/`PM2_HOME` da conta Windows. Para consultar uma instalação de CLI diferente, configure:

```dotenv
PM2_SCRIPT=C:\Users\usuario\AppData\Roaming\npm\node_modules\pm2\bin\pm2
# PM2_HOME=C:\Users\usuario\.pm2
```

O deploy das versões usa a API do PM2 local para atualizar os caminhos dos scripts quando a pasta do build muda. Os processos existentes são identificados por nome e namespace e mantêm seus IDs; processos novos são iniciados. A lista é salva com `pm2 save --force` após o deploy.

Use um `JWT_SECRET` com pelo menos 32 caracteres. Para gerar um segredo:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

Configure `COOKIE_SECURE=true` quando o painel for acessado por HTTPS.

## Atualização ao vivo

Após o login, o navegador abre uma conexão SSE autenticada em `GET /api/processes/stream`. O backend consulta o PM2 a cada 5 segundos enquanto houver clientes conectados e compartilha a coleta entre eles. Envia a lista completa apenas quando os dados mudam; cada conexão recebe também o estado inicial disponível. CPU e memória continuam dependendo da amostragem do PM2.

O stream envia sinais de manutenção a cada 15 segundos, verifica se o usuário ainda existe, informa falhas de coleta e encerra quando a sessão expira ou o usuário é removido. O navegador tenta reconectar em caso de interrupção e recebe o estado atual ao reconectar. É possível pausar a atualização ao vivo em **Configurações**; o botão **Atualizar** continua disponível para uma consulta manual.

Se houver IIS ou outro proxy reverso, desabilite o buffering e a compressão para essa rota e permita respostas de longa duração, para que os eventos cheguem sem atraso. O Express já desabilita a compressão nessa rota e envia `X-Accel-Buffering: no` para proxies que reconhecem esse cabeçalho.

## Nomes de exibição dos processos

Na Home, use **Adicionar nome** na coluna **Nome de exibição** (ou no card), informe por exemplo `workTabs` e clique em **Salvar**. O nome técnico do PM2 permanece visível. Para alterar, use **Editar nome**; para remover, salve o campo vazio. O limite é de 80 caracteres e a busca considera ambos os nomes.

Os nomes são compartilhados entre usuários e persistidos na coleção MongoDB `process_labels`, vinculados ao nome técnico, namespace e `PM2_HOME`. Sobrevivem a reinícios e à recriação da mesma aplicação com outro ID; processos de namespaces diferentes ficam separados. Instâncias de um mesmo nome/namespace compartilham o nome de exibição. Salvar esse campo não renomeia nem reinicia o processo no PM2. A sincronização entre navegadores acompanha o SSE existente.

## Portas dos processos

A coluna **Porta** prioriza as portas TCP em escuta no Windows, associadas ao PID do processo PM2 e aos seus subprocessos. Portas repetidas em IPv4/IPv6 aparecem uma única vez; aplicações com vários listeners exibem todas as portas. A inspeção é compartilhada por 5 segundos para evitar consultas repetidas ao sistema.

A Home, nos modos lista e cards, exibe somente os números das portas, sem links de acesso ou descoberta de IP/DNS.

Quando não há uma porta confirmada em escuta ou a inspeção não está disponível, o painel pode mostrar a porta declarada em `PORT`, `port`, `env.PORT` ou nos argumentos `--port`/`-p`, com a indicação **Configurada**. Processos sem informação suficiente exibem `—`. A coluna mostra portas locais da aplicação; o endereço e a porta de publicação de um proxy reverso continuam definidos na infraestrutura.

## Idiomas e limpeza automática

Em **Configurações → Geral → Idioma**, escolha português do Brasil, inglês ou espanhol. A preferência fica neste navegador e não encerra a sessão. O catálogo de traduções fica em `apps/frontend/src/i18n/messages.ts`; frases em português são as chaves, com traduções `en` e `es`. Datas acompanham o idioma. Conteúdo dos projetos, comentários, nomes, logs e diagnósticos técnicos externos permanecem no idioma original. Consulte [internacionalização](docs/i18n.md) para ampliar o catálogo.

Em **Limpeza automática de versões**, habilite a função, informe **Manter versões por (dias)** e **Executar limpeza a cada (horas)** e salve. Ela começa desabilitada; os valores iniciais são 30 dias e 24 horas. A configuração é compartilhada e persistida no MongoDB. A primeira execução fica agendada a partir do salvamento; o backend verifica o agendamento a cada minuto e retoma execuções vencidas após reiniciar.

A limpeza remove permanentemente registros antigos e seus pacotes, extrações e backups em `VERSIONS_DIR`. Preserva o build ativo de cada projeto, operações em andamento, projetos com recuperação pendente e arquivos referenciados pelos processos PM2 (inclusive parados) ou pelas listas salvas `dump.pm2` e `dump.pm2.bak`. Se o PM2 estiver indisponível ou seus caminhos não puderem ser verificados, a limpeza é adiada e o erro aparece nas configurações. A pasta principal das aplicações não é removida. Publicações e limpeza são mutuamente exclusivas; execute uma única instância do backend.

Os campos de última e próxima execução permitem acompanhar o agendamento. O resultado também é registrado como auditoria `RETENTION`. Desabilitar e salvar cancela futuras execuções. Não é usado TTL do MongoDB, pois remover somente o documento deixaria arquivos no disco.

## Design system

A paleta e os tokens semânticos de cores ficam em `apps/frontend/src/styles/tokens.css`. Os componentes usam esses tokens por finalidade (ação, texto, superfície, foco, feedback), sem valores de cor espalhados no JSX. Consulte [a documentação do design system](docs/design-system.md) para manter ou ampliar a identidade visual.

## Usuários do painel

Na primeira inicialização, se a coleção `users` estiver vazia, o monitor cria o primeiro usuário com `ADMIN_USERNAME` e `ADMIN_PASSWORD` do `.env`. A senha deve ter entre 12 e 256 caracteres. Depois disso, os logins consultam o MongoDB; alterar essas variáveis não altera a senha de um usuário já cadastrado.

Em **Configurações → Usuários**, administradores podem listar e criar usuários, escolhendo os perfis **Usuário comum** (`user`, padrão) ou **Administrador** (`admin`). A opção e a tela só aparecem para administradores; a API também recusa listagem e criação por usuários comuns com HTTP 403. Usuários comuns continuam operando processos, projetos, builds, logs e as demais configurações. Não há cadastro público. Nomes de usuário são salvos em minúsculas e não podem se repetir.

O primeiro usuário criado pelo `.env` é administrador. Na atualização de um banco antigo sem perfis, o sistema atribui `admin` à conta legada correspondente a `ADMIN_USERNAME`; se ela não existir, escolhe a conta legada mais antiga. As demais contas sem perfil recebem `user`. Perfis já definidos são preservados. A autorização consulta o perfil do MongoDB a cada requisição e não confia no antigo campo `role=admin` dos tokens.

## Projetos e builds

Para editar, abra o projeto e clique em **Editar projeto**. Altere nome, descrição, pasta principal ou caminho do ecosystem e clique em **Salvar alterações**. O histórico é preservado. Alterar a pasta não move arquivos nem reinicia processos; o indicador de build ativo é limpo e a próxima publicação usa o novo destino.

Se o build gerado não contém o ecosystem, preencha **Configuração PM2 salva no projeto (opcional)** com o conteúdo `module.exports = { apps: [...] }` e salve. Isso também está disponível no cadastro. Você poderá enviar apenas os arquivos da aplicação no ZIP: o monitor cria o arquivo no caminho configurado durante a publicação. O arquivo incluído no ZIP tem prioridade; quando ele falta, usa a configuração salva; sem configuração salva, aceita o arquivo já existente na VM. O caminho `script` é relativo à pasta do ecosystem e precisa corresponder à estrutura do ZIP (`./dist/main.js` ou `./main.js`, por exemplo).

A configuração salva é copiada para o armazenamento do build na primeira publicação que a utiliza, preservando essa cópia para republicações; o ZIP original permanece intacto. Salvar uma configuração nova só afeta novos builds que não tragam ecosystem. Se um build falhou apenas por falta do arquivo, salve a configuração e clique em **Publicar** nesse build para tentar novamente.

Para excluir, abra **Sobre o projeto → Excluir projeto**. A confirmação mostra os processos vinculados pelos caminhos da aplicação e pergunta se deseja encerrá-los. A opção começa desmarcada: assim os processos continuam como estão. Se marcar, eles são parados com `pm2 stop`, mantendo seus registros e salvando o estado no PM2. Digite o nome do projeto para confirmar. A exclusão remove o cadastro, o histórico e os pacotes armazenados; preserva a pasta da aplicação na VM. Edição e exclusão são bloqueadas durante publicações ou recuperação pendente. Arquivos armazenados ainda referenciados pelo PM2 precisam deixar de ser usados antes da exclusão.

1. Abra **Projetos → Novo projeto** e informe nome, pasta principal absoluta na VM (por exemplo, `C:\servicos\project-name`) e caminho relativo do `ecosystem.config.js` dentro dela.
2. Abra o projeto para navegar em **Arquivos**, consultar **Builds** ou conferir os caminhos em **Sobre o projeto**. O acesso é direto ao sistema de arquivos da mesma VM, sem FTP.
3. Clique em **Fazer novo build**, informe um nome único, descreva as alterações no comentário obrigatório e selecione o pacote compactado.
4. **Enviar e publicar** guarda o original, extrai uma cópia para o histórico, aplica os arquivos na pasta principal e executa o ecosystem configurado no PM2. O autor é obtido da sessão autenticada.
5. Para voltar a uma versão anterior, use **Publicar** no histórico. O histórico de builds fica na aba **Builds** de cada projeto.

O MongoDB mantém `projects` e `project_builds` separados, relacionados por `projectId` (um projeto possui muitos builds). O projeto guarda `activeBuildId`, sem incorporar uma lista crescente de builds. Consulte [Projetos: dados, publicação e API](docs/projects.md) para contratos, limites e recuperação de falhas.

Arquivos gerenciados pelo build anterior e ausentes no novo pacote são removidos; arquivos locais que nunca fizeram parte desses builds são preservados. Antes da publicação, o monitor salva uma cópia dos arquivos afetados. Em caso de falha, tenta restaurá-los; uma operação interrompida é recuperada na inicialização seguinte. Isso não desfaz operações já executadas pelo PM2 nem substitui uma verificação de saúde: confira os processos após uma falha.

## Processos vinculados a projetos

A Home mostra o projeto na Lista e nos Cards. Clique no nome para abrir o projeto, ou em **Vincular projeto / Alterar vínculo** para selecionar um projeto ou deixar **Sem projeto**. A busca também considera o nome do projeto. Processos executados na pasta de um projeto são reconhecidos automaticamente até o usuário escolher um vínculo explícito. A escolha é salva no MongoDB por PM2_HOME, nome e namespace; não reinicia nem move o processo.

Publicações e históricos ficam dentro de Projetos. A tela global de builds e os uploads avulsos foram removidos da interface. Artefatos existentes e APIs legadas são preservados por compatibilidade, sem migração ou exclusão automática.

## Logs

A coleção `logs` contém:

- `kind=audit`: usuário, IP recebido pelo servidor, método, rota, status HTTP e data das operações, incluindo login, criação de usuários e operações de versão. Senhas e corpos das requisições não são gravados na auditoria.
- `kind=process`: trechos de stdout/stderr dos processos PM2, com nome, ID, arquivo de origem e data da coleta.

A coleta lê os arquivos de log informados pelo PM2. Na primeira leitura de cada arquivo, importa os últimos 64 KB; depois segue a partir do ponto salvo na coleção `log_cursors`. Cada ciclo lê até 256 KB por arquivo, deixando o restante para os ciclos seguintes. Os pontos de leitura são preservados entre reinícios do monitor, e a coleta reconhece arquivos truncados ou substituídos. Como a coleta ocorre a cada 5 segundos, mantenha o monitor em execução para salvar a saída dos processos; trechos removidos por rotação antes da leitura podem não ser coletados.

A área **Histórico de logs** mostra os últimos 100 registros do tipo escolhido e permite filtrar a saída pelo ID do processo. Os logs já salvos permanecem disponíveis mesmo após remover o processo do PM2. O botão de logs na tabela de processos continua consultando a saída recente diretamente no PM2.

Logs e usuários não têm expiração automática. Versões e builds podem ser removidos pela política opcional de limpeza configurada no painel. Faça backup do banco e de `versions/` para preservar o histórico e os builds antes do prazo de retenção.

## Atualização de uma instalação existente

Configure o MongoDB no `.env`, instale as novas dependências, gere o build e reinicie o monitor. O usuário antigo do `.env` será criado no banco somente se ainda não houver usuários. A variável antiga `VPN_ALLOWED_CIDRS` é ignorada e pode ser removida.

O projeto não cria regras de firewall. Se a instalação antiga usou `scripts/configure-firewall.ps1`, a regra já instalada no Windows continua existindo e deve ser ajustada pela infraestrutura. O script de configuração de VPN foi removido do repositório.

## Inicialização automática

Instale a tarefa usando a **mesma conta Windows que executa os aplicativos PM2**, em PowerShell elevado:

```powershell
.\scripts\install-scheduled-task.ps1
Start-ScheduledTask -TaskName 'ati-dev-cockpit'
```

O instalador pede a credencial interativamente; a senha não é gravada em arquivos do projeto. Logs do próprio serviço do painel ficam em `runtime/`.

Se os aplicativos PM2 também precisam ressurgir após reinicialização, salve a lista com `pm2 save` e configure a inicialização do daemon para essa mesma conta.

## API

As rotas abaixo exigem sessão, exceto login e health:

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/users`, `POST /api/users` com JSON `{ "username": "operador", "password": "senha-com-12-ou-mais", "role": "user" }`; exclusivos de administradores, `role` opcional (`user` ou `admin`)
- `GET /api/settings/retention`, `PUT /api/settings/retention` com JSON `{ "enabled": true, "retentionDays": 30, "intervalHours": 24 }`; limites: 1–3650 dias e 1–8760 horas
- `GET /api/processes`
- `PUT /api/processes/:id/label` com JSON `{ "name": "processText3920", "namespace": "default", "label": "workTabs" }`; `label` vazio remove o nome de exibição
- `GET /api/processes/stream` (SSE: eventos `processes`, `metrics-error` e `session-expired`)
- `POST /api/processes/:id/start|stop|restart|delete`
- `GET /api/processes/:id/logs?lines=150`
- `POST /api/ecosystems` com JSON `{ "path": "C:\\servicos\\minha-app\\ecosystem.config.js" }`
- `POST /api/ecosystems/pick` para abrir o seletor na sessão Windows da VM
- `GET /api/projects`, `POST /api/projects`, `GET /api/projects/:id`
- `PUT /api/processes/:id/project` com JSON `name`, `namespace` e `projectId` (ID ou `null` para desvincular)
- `PUT /api/projects/:id` com JSON `name`, `description`, `rootPath`, `pm2ConfigPath`; `DELETE /api/projects/:id` remove cadastro, builds e arquivos armazenados, preservando a pasta publicada
- `GET /api/projects/:id/deletion-preview` lista processos vinculados e retorna uma revisão; `DELETE /api/projects/:id` aceita `{ "stopProcesses": true, "processRevision": "revisão recebida" }` para pará-los antes de excluir
- `GET /api/projects/:id/files?path=...`, `GET /api/projects/:id/files/download?path=...`
- `GET /api/projects/:id/builds?page=1`, `GET /api/builds?projectId=...&page=1`
- `POST /api/projects/:id/builds` com multipart: `name`, `comments` e arquivo `build`; publica automaticamente
- `POST /api/projects/:id/builds/:buildId/deploy`, `GET /api/projects/:id/builds/:buildId/archive`
- `GET /api/versions`
- `POST /api/versions` com multipart: campos `project`, `version` e arquivo `build` (`.zip`, `.rar`, `.7z`, `.tar`, `.tar.gz`, `.tar.bz2`, `.tar.xz`, `.tgz`, `.tbz`, `.tbz2` ou `.txz`)
- `GET /api/versions/:id/archive`
- `POST /api/versions/:id/start`
- `GET /api/logs?kind=audit|process&processId=3&limit=100` (`processId` opcional, limite de 1 a 500)
- `GET /api/health`

## Verificação

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Os testes do backend usam um MongoDB temporário (o binário é baixado na primeira execução) e um daemon PM2 com pasta e endpoints exclusivos, incluindo pipes exclusivos no Windows. Cobrem autenticação, criação de usuários, upload, extração e download de ZIP, RAR, 7z e TAR com Gzip, Bzip2 e XZ, validação dos arquivos, persistência dos logs, troca de builds e retorno a uma versão anterior. Os pequenos arquivos em `apps/backend/test/fixtures/` permitem testar 7z, Bzip2 e XZ sem ferramentas externas durante os testes.

Os testes de projetos também cobrem isolamento de pastas, navegação, publicação, comentário obrigatório, autoria, concorrência, retorno a builds anteriores e recuperação de arquivos após falhas ou reinício.

Os testes do frontend usam um DOM simulado e respostas de API de teste para verificar a navegação e expansão do submenu da sidebar, a Home com métricas e processos, o acesso de administradores ao destino Usuários, a atualização automática, os bloqueios durante operações e a confirmação opcional de parada ao excluir projetos. Eles não iniciam processos PM2 nem alteram o banco real.
