# ati-dev-cockpit para Windows

Painel web para visualizar e operar processos do PM2 em uma VM Windows. O frontend React/Tailwind e a API Express são publicados juntos na porta `4170`.

## Funcionalidades

- Navegação lateral com visão geral, processos, logs, usuários, builds e configurações; em celular, a navegação fica no topo.
- Lista status, PID, portas TCP, CPU, memória, uptime e reinícios dos processos.
- Atualiza métricas e processos por SSE, sem consultas periódicas do navegador.
- Permite alternar as aplicações entre lista e cards, mantendo a busca e as ações nos dois formatos e salvando a preferência no navegador.
- Inicia, para, reinicia e remove processos; também permite iniciar um ecosystem já existente na VM.
- Aceita builds prontos em `.rar`, identifica projeto e versão, preserva o arquivo original e extrai os arquivos em `versions/`.
- Permite baixar o RAR original e iniciar qualquer versão salva no PM2, inclusive uma versão anterior.
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
        overview/
        processes/
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
      versions/  # Builds RAR, versões e worker de extração
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

## Portas dos processos

A coluna **Porta** prioriza as portas TCP em escuta no Windows, associadas ao PID do processo PM2 e aos seus subprocessos. Portas repetidas em IPv4/IPv6 aparecem uma única vez; aplicações com vários listeners exibem todas as portas. A inspeção é compartilhada por 5 segundos para evitar consultas repetidas ao sistema.

Quando não há uma porta confirmada em escuta ou a inspeção não está disponível, o painel pode mostrar a porta declarada em `PORT`, `port`, `env.PORT` ou nos argumentos `--port`/`-p`, com a indicação **Configurada**. Processos sem informação suficiente exibem `—`. A coluna mostra portas locais da aplicação; o endereço e a porta de publicação de um proxy reverso continuam definidos na infraestrutura.

## Design system

A paleta e os tokens semânticos de cores ficam em `apps/frontend/src/styles/tokens.css`. Os componentes usam esses tokens por finalidade (ação, texto, superfície, foco, feedback), sem valores de cor espalhados no JSX. Consulte [a documentação do design system](docs/design-system.md) para manter ou ampliar a identidade visual.

## Usuários do painel

Na primeira inicialização, se a coleção `users` estiver vazia, o monitor cria o primeiro usuário com `ADMIN_USERNAME` e `ADMIN_PASSWORD` do `.env`. A senha deve ter entre 12 e 256 caracteres. Depois disso, os logins consultam o MongoDB; alterar essas variáveis não altera a senha de um usuário já cadastrado.

Na área **Usuários** do painel é possível listar e criar usuários. Todos os usuários têm acesso à administração dos processos, versões, logs e ao cadastro de outros usuários. Não há cadastro público. Nomes de usuário são salvos em minúsculas e não podem se repetir.

## Builds e versões

1. Gere o build do projeto e empacote os arquivos prontos para execução em um único `.rar`, sem senha e sem divisão em volumes.
2. Abra **Versões e builds**, informe o projeto e a versão (por exemplo, `minha-app` e `1.2.0`) e selecione o arquivo.
3. Clique em **Salvar versão**. O upload apenas salva e extrai o build.
4. Para executar no PM2, clique em **Iniciar** na versão desejada. Ela deve conter exatamente um `ecosystem.config.js`, na raiz ou dentro de uma pasta do RAR.

O build precisa incluir as dependências necessárias para sua execução. O monitor não executa instalação de dependências nem compila o projeto enviado.

Exemplo de conteúdo do RAR:

```text
ecosystem.config.js
dist/
  main.js
node_modules/
  ...dependências de execução, quando necessárias
```

Exemplo do ecosystem:

```javascript
module.exports = {
  apps: [{
    name: 'minha-app',
    script: './dist/main.js',
    exec_mode: 'fork',
    env: { NODE_ENV: 'production' },
  }],
};
```

Os caminhos relativos são resolvidos a partir da pasta do ecosystem; `cwd`, quando informado, também é resolvido a partir dela. Mantenha o mesmo nome e namespace dos processos para que uma nova versão atualize os processos existentes. Iniciar uma versão anterior troca os scripts de volta para aquele build. O estado **Iniciada** indica que o envio ao PM2 foi concluído; o estado atual do processo aparece na tabela **Aplicações**. O deploy não executa uma verificação de saúde da aplicação nem desfaz automaticamente operações parciais de um ecosystem com vários processos.

Os arquivos ficam em:

```text
versions/
  <id-da-versao>/
    build.rar
    build/
      ...arquivos extraídos
```

O MongoDB guarda projeto, versão, nome original, tamanho, hash SHA-256, usuário responsável, datas e estado. Projeto e versão não diferenciam maiúsculas de minúsculas; a mesma combinação não pode ser sobrescrita. A listagem mostra as 200 versões mais recentes. Builds sem ecosystem também podem ser armazenados e baixados, mas não iniciados pelo painel. Arquivos inválidos, caminhos fora da pasta do build e uploads acima dos limites são recusados. A extração tem limite de 2 minutos e 50 mil entradas.

## Logs

A coleção `logs` contém:

- `kind=audit`: usuário, IP recebido pelo servidor, método, rota, status HTTP e data das operações, incluindo login, criação de usuários e operações de versão. Senhas e corpos das requisições não são gravados na auditoria.
- `kind=process`: trechos de stdout/stderr dos processos PM2, com nome, ID, arquivo de origem e data da coleta.

A coleta lê os arquivos de log informados pelo PM2. Na primeira leitura de cada arquivo, importa os últimos 64 KB; depois segue a partir do ponto salvo na coleção `log_cursors`. Cada ciclo lê até 256 KB por arquivo, deixando o restante para os ciclos seguintes. Os pontos de leitura são preservados entre reinícios do monitor, e a coleta reconhece arquivos truncados ou substituídos. Como a coleta ocorre a cada 5 segundos, mantenha o monitor em execução para salvar a saída dos processos; trechos removidos por rotação antes da leitura podem não ser coletados.

A área **Histórico de logs** mostra os últimos 100 registros do tipo escolhido e permite filtrar a saída pelo ID do processo. Os logs já salvos permanecem disponíveis mesmo após remover o processo do PM2. O botão de logs na tabela de processos continua consultando a saída recente diretamente no PM2.

As coleções não têm expiração automática. Faça backup do banco e de `versions/` para preservar o histórico e os builds.

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
- `GET /api/users`, `POST /api/users` com JSON `{ "username": "operador", "password": "senha-com-12-ou-mais" }`
- `GET /api/processes`
- `GET /api/processes/stream` (SSE: eventos `processes`, `metrics-error` e `session-expired`)
- `POST /api/processes/:id/start|stop|restart|delete`
- `GET /api/processes/:id/logs?lines=150`
- `POST /api/ecosystems` com JSON `{ "path": "C:\\servicos\\minha-app\\ecosystem.config.js" }`
- `POST /api/ecosystems/pick` para abrir o seletor na sessão Windows da VM
- `GET /api/versions`
- `POST /api/versions` com multipart: campos `project`, `version` e arquivo `build` (`.rar`)
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

Os testes do backend usam um MongoDB temporário (o binário é baixado na primeira execução) e um daemon PM2 com pasta e endpoints exclusivos, incluindo pipes exclusivos no Windows. Cobrem autenticação, criação de usuários, upload e extração de RAR, validação dos arquivos, persistência dos logs, troca de builds e retorno a uma versão anterior.

Os testes do frontend usam um DOM simulado e respostas de API de teste para verificar a navegação entre as seis áreas, a atualização automática, o bloqueio durante cadastros e o comportamento quando o PM2 está indisponível. Eles não iniciam processos PM2 nem alteram o banco real.
