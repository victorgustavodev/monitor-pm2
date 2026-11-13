# Integração com API e serviços

## Objetivo

Centralizar detalhes de transporte HTTP, manter o frontend desacoplado de contratos externos e permitir evolução das operações do cockpit sem acoplar Axios, autenticação e tratamento de erros a cada componente.

**Atenção:** não foram fornecidos os arquivos reais de cliente HTTP nem os endpoints do backend. Todos os nomes de funções e estruturas abaixo são **convenções recomendadas**, não alegações sobre rotas existentes. A IA deve inspecionar os serviços e contratos atuais antes de implementar mudanças.

## Responsabilidades por camada

| Local                              | Papel                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/lib/`                         | Instância Axios ou cliente HTTP existente; base URL, interceptors, timeout e integração com libs |
| `src/config/`                      | Variáveis públicas e configurações globais da aplicação, quando usadas                           |
| `src/services/`                    | Serviços de alcance transversal, como Analytics ou integração global                             |
| `src/features/<feature>/services/` | Endpoints, tipos de payload e operações exclusivos da feature                                    |
| `src/features/<feature>/hooks/`    | Estado de request, carregamento, erro, revalidação e ações para a UI                             |
| `src/components/`                  | UI compartilhada, sem conhecimento de Axios e URLs de endpoint                                   |

## Fluxo esperado

```text
ProcessPage/ProcessFeature
  └─ useProcesses (estado e orquestração)
      └─ processesService (contrato de domínio)
          └─ httpClient (configurado em lib/)
              └─ API backend
                  └─ operações e validações PM2
```

## Exemplo conceitual de um serviço de feature

```ts
// Exemplo de responsabilidade, NÃO código ligado às rotas reais.
// Reaproveitar o cliente HTTP, os tipos e os endpoints já existentes.
export interface ProcessesService {
  list(): Promise<ProcessSummary[]>;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
}
```

As funções não devem construir strings de comando shell no browser. A comunicação com PM2 acontece no **backend**, que é responsável por autenticação, autorização, validação dos parâmetros e execução segura.

## Contrato e consistência

1. Inspecione o formato real das respostas, códigos HTTP, paginação, status e erros antes de tipar o consumo.
2. Defina tipos claros de requisição e resposta; evite `any` e inferências frágeis.
3. Normalize somente o necessário para o frontend; não mude payloads de API sem alinhamento com o backend.
4. Mantenha base URL e headers comuns em um cliente centralizado.
5. Não crie uma instância Axios para cada tela ou componente.
6. Use a solução de autenticação já existente; não replique tokens em diversas camadas.
7. Diferencie erro de rede, timeout, permissão, validação e erro inesperado quando o backend permitir.
8. Não exiba mensagens internas, caminhos do servidor nem dados sensíveis como feedback ao usuário.
9. Não assuma endpoints `/api/processes`, `/pm2` ou outros exemplos não confirmados.

## Padrão de estados no consumo

Uma operação remota deve permitir que a UI trate:

- **Loading inicial**: ainda não há dado para mostrar.
- **Atualização**: já há dado, mas uma nova consulta está em andamento.
- **Vazio**: resposta válida sem itens.
- **Erro**: falha com mensagem adequada e opção de tentar novamente.
- **Sucesso**: confirmação da ação executada e revalidação/atualização.

Tratamento visual e acessibilidade ficam nos componentes; tradução de falhas técnicas deve ocorrer no serviço/hook apropriado, sem acoplar uma biblioteca de toast a cada endpoint.

## Regras específicas do cockpit PM2

- Antes de operações como iniciar, parar, reiniciar ou excluir processos, confira as permissões e os contratos de backend atuais.
- Evite duplo clique e ações concorrentes sobre o mesmo processo durante uma operação.
- Após mutações, atualize a fonte única de dados para manter dashboard, Lista e Cards sincronizados.
- O refresh automático não deve sobrescrever mutações recentes com resposta defasada.
- Respeite a pausa de atualizações configurada para a sessão.
- Logs podem ser grandes: preserve limites, paginação, streaming ou mecanismos existentes sem carregar volumes desnecessários no navegador.

## Segurança e configuração

- Não inclua chaves secretas, senhas do servidor, caminhos confidenciais ou credenciais PM2 em variáveis de ambiente expostas ao frontend.
- Não confunda variável `REACT_APP_*` (comum em CRA) com `VITE_*` (Vite). Use exclusivamente o mecanismo confirmado no `package.json`/configuração real.
- Evite configurar permissões CORS fictícias nos headers do cliente: CORS é aplicado pelo servidor.
- Não desative validação TLS/SSL como solução padrão.
- Não faça logs de informações sensíveis em console ou ferramentas de telemetria.
- Uma verificação de permissão no frontend **não substitui** autorização no backend.

## Checklist para novos endpoints

### Contratos implementados de configurações e portas

- `GET /api/processes` e o SSE retornam `namespace`, `label` e `labelUpdatedAt` junto às métricas. `PUT /api/processes/:id/label` recebe `{ name, namespace, label }`, exige sessão e confirma nome/namespace contra o processo atual antes de salvar. Aceita até 80 caracteres sem controles/quebras de linha; string vazia remove o nome de exibição. Retorna `{ name, namespace, label, labelUpdatedAt }`. Não chama `pm2 rename`, restart ou save. IDs reaproveitados com outra identidade retornam 409; um ID inexistente retorna 404.

- `GET /api/auth/me` inclui `role: "admin" | "user"`, consultado do banco. `GET /api/users`, `POST /api/users` e `PUT /api/users/:id/role` exigem `admin` no backend; no frontend, o acesso fica no submenu Configurações → Usuários da sidebar. A criação aceita `role` opcional, com padrão `user`. A edição recebe `{ role: "admin" | "user" }`, retorna o usuário público e impede rebaixar o último administrador (409). Alterações de perfil são serializadas na instância e o administrador solicitante é conferido novamente; o papel do banco vale imediatamente para as sessões existentes.
- `GET /api/projects/:id/deletion-preview` retorna os processos associados ao projeto (escolha explícita ou identificação pela pasta) e uma revisão. A confirmação de exclusão envia `stopProcesses` e `processRevision`; a opção de parar começa desmarcada. Uma revisão desatualizada retorna 409 e exige nova confirmação. Parar conserva a entrada no PM2.

- `GET /api/settings/retention` retorna `enabled`, `retentionDays` e, após execução, `lastRunAt`, `lastDeleted` e eventual `lastError`.
- `PUT /api/settings/retention` recebe `{ enabled: boolean, retentionDays: number }`. Exige sessão; prazo inteiro de 1–3650 dias a partir de `createdAt` de cada versão. A opção começa desabilitada. `intervalHours` legado é ignorado e removido do documento ao salvar; não há `nextRunAt` global na resposta. O backend verifica vencimentos a cada minuto, inclusive imediatamente ao iniciar, mantendo as proteções dos builds ativos e referências PM2. A UI bloqueia navegação enquanto salva e trata 401 pelo fluxo de sessão existente.
- A resposta de processos (consulta e SSE) inclui `ports` e `portSource`, usados por `ProcessPort` para exibir os números das portas e indicar sua origem. Não realiza descoberta de IP/DNS nem expõe variáveis de ambiente PM2.
- O cliente HTTP permanece em `apps/frontend/src/services/api.ts`; os textos comuns usam o catálogo `i18n/messages.ts`. Mensagens técnicas externas desconhecidas mantêm seu conteúdo original.

- [ ] Localizei a rota e o contrato reais do backend.
- [ ] Reutilizei a instância HTTP existente em `lib/`.
- [ ] Coloquei o serviço na feature, salvo se for transversal.
- [ ] Tipos de entrada/saída estão claros e coerentes com o backend.
- [ ] Loading, erro, vazio, sucesso e cancelamento/atualização foram considerados.
- [ ] Não dupliquei chamadas em componentes de apresentação.
- [ ] Revalidação e polling não geram inconsistência.
- [ ] Testes relevantes e documentação foram atualizados.
## Progresso de publicação

O cliente cria uma operação com `POST /api/projects/:id/build-operations`, reservando o projeto imediatamente, e envia `operationId` e `background=true` como query no POST de upload/publicação existente. Após receber o pacote, o servidor responde 202 com o estado da operação e continua a publicação independente da conexão HTTP. Sem `background=true`, os endpoints permanecem síncronos e compatíveis, mas também registram e bloqueiam a operação. Uma segunda publicação no mesmo projeto retorna 409, inclusive para outro usuário; projetos distintos podem publicar em paralelo (até cinco operações em andamento por usuário).

`GET /api/build-operations` retorna snapshots das operações para usuários autenticados. `GET /api/build-operations/stream` envia a lista no evento SSE `publications`, incluindo `projectId`, `projectName`, `username` e `canCancel` além de etapa, percentual, logs e estado. Exibe todas as operações em andamento e os 20 resultados mais recentes dos últimos 30 minutos. O envio respeita backpressure, mantendo somente um snapshot pendente para clientes lentos. A reserva sem upload iniciado expira em cinco minutos; um upload já iniciado mantém a reserva até conclusão/cancelamento. O stream específico `GET /api/projects/:id/build-operations/:operationId/stream` continua disponível somente ao autor. O percentual indica marcos das etapas, não estimativa de tempo ou bytes enviados.

`POST /api/projects/:id/build-operations/:operationId/cancel` solicita cancelamento, somente para o autor. Extração termina o worker, validação/cópia verifica AbortSignal e alterações são restauradas pelo journal antes de liberar a operação. Ao iniciar o PM2, cancelamento é bloqueado (409) para evitar interrupção de uma troca de processos. Falhas em tarefas assíncronas ficam no estado e nos logs; fechar o painel, navegar ou desconectar o SSE não cancela o servidor. Operações ficam em memória; reinício encerra conexões e usa a recuperação persistente já existente para builds interrompidos.

Durante publicações, POSTs de ações de processos/ecosystems e PUTs de nome/vínculo retornam 409. Uma ação de processo já em andamento também impede criar uma publicação. POST `/api/processes/:id/:action` aceita `{ name, namespace }` opcional para conferir a identidade antes de executar; nomes/namespace diferentes do processo atual retornam 409. A leitura de métricas e logs permanece disponível. O SSE de processos envia `live` com `{ collectedAt }` a cada coleta bem-sucedida, mesmo quando o evento `processes` é suprimido por não haver mudanças.

## Vínculos de processos

Entradas reais mantêm `id` numérico. Entradas ausentes de projetos usam `id` string com prefixo `project:`, `status: "not_started"` e `startProjectId`; métricas são zero e a única ação PM2 oferecida é `POST /api/projects/:id/start`. Não envie esse identificador sintético às rotas `/api/processes/:id/*`. `applicationUrl` acompanha o vínculo e sua versão no GET/SSE e na resposta de alteração de projeto.

`GET /api/logs/applications` exige sessão e retorna nomes distintos com logs salvos (`[{ name }]`). A UI combina esses nomes com os processos atuais, inicia sem aplicação selecionada e consulta logs somente após a escolha. `GET /api/logs` aceita `processName` exato, além dos filtros anteriores; isso preserva acesso ao histórico após troca de ID e agrupa processos com o mesmo nome. Mantém limite padrão de 100 e máximo de 500 registros. Auditoria continua disponível. Respostas de seleções antigas não substituem a seleção atual.

`GET /api/processes` e o SSE incluem `projectId`, `projectName`, `projectUpdatedAt` (nulos se ausentes) e `projectObservedAt` (data da consulta dos vínculos). `PUT /api/processes/:id/project` exige sessão e recebe `{ name, namespace, projectId }`, com ID de projeto válido ou `null` para remover o vínculo. Retorna `{ name, namespace, projectId, projectName, projectUpdatedAt }`. Valida a identidade atual contra o PM2; ID inexistente retorna 404, identidade desatualizada retorna 409, projeto inexistente retorna 404 e projeto em exclusão/recuperação retorna 409. Não altera processos no daemon.

As APIs legadas de versões e histórico global continuam disponíveis por compatibilidade; a interface usa somente builds vinculados a projetos.

## Documentação e arquivos de ambiente do projeto

POST/PUT de projetos aceitam `documentation` opcional (texto UTF-8 até 32 KB); omissão no PUT preserva o valor. Formulários de documentação e configuração PM2 enviam os campos gerais exigidos pela API e apenas o conteúdo que editam, sem apagar os demais campos opcionais.

GET/PUT `/api/projects/:id/environment-files/:name` leem e gravam `.env` e variantes na raiz, além do caminho exato de `pm2ConfigPath` (codificado na URL). GET retorna `{ name, content, revision, names }`; PUT recebe `{ content, revision }`. Revisão é SHA-256 do conteúdo lido ou `null` para criação. Conflito retorna 409 e a UI mantém o rascunho. Conteúdo é UTF-8 até 32 KB para `.env`; o ecosystem aceita até 16 KB e tem a sintaxe CommonJS validada sem execução ao salvar. Nomes, caminhos e links são validados pelo backend. Salvar bloqueia ações conflitantes e navegação, sem executar PM2. Erro 401 segue o fluxo de sessão existente. Valores não entram na auditoria nem no armazenamento do navegador.

## Logs em tempo real

`GET /api/logs/stream?processName=...&namespace=...` é autenticado por cookie, envia `snapshot` com o histórico recente e `log` com novos trechos (`{ content }`). `namespace` é opcional; o modal da Home o informa para isolar aplicações homônimas. A tela Logs mantém a seleção por nome, incluindo histórico de processos ausentes. A identidade independe do ID PM2 e acompanha recriações. Os eventos `live`, `logs-error` e `session-expired` sinalizam coleta, falha e expiração. A sessão também é revalidada periodicamente, e clientes lentos são desconectados para limitar memória.

O coletor único persiste os arquivos incrementalmente a cada segundo e publica os trechos nos terminais abertos. O histórico inicial usa até 100 registros e a exibição mantém os últimos 200 mil caracteres. A reconexão substitui o snapshot, sem duplicar histórico; a UI encerra a assinatura ao fechar ou trocar a aplicação. A pausa do terminal congela a exibição, mantendo um buffer limitado para a retomada. Ela é independente da pausa de métricas da Home. Os endpoints de leitura anteriores continuam disponíveis.

## Gerenciar e início automático

`GET /api/processes/:id/settings?name=...&namespace=...` retorna `{ name, namespace, projectId, canAutoStart, autoStart, autoStartUpdatedAt, autoStartError }`. `PUT /api/processes/:id/settings` recebe `{ name, namespace, autoStart: boolean }` e retorna a configuração salva. Ambos exigem sessão e conferem a identidade contra a lista atual; aceitam também IDs sintéticos codificados na URL, exclusivamente para identidades conhecidas do inventário. Não envie IDs sintéticos às rotas antigas de comandos PM2.

Habilitar exige um projeto vinculado, ecosystem local, nome/namespace presentes nesse arquivo e script/cwd válidos dentro da pasta. O PUT compartilha os bloqueios de comandos/publicações e de configuração do projeto. Valida sem iniciar processos. Desabilitar continua permitido para uma preferência anterior cujo projeto tenha sido desvinculado. O GET/SSE de processos inclui `autoStart`, `autoStartUpdatedAt` e `autoStartError`; a UI preserva a gravação mais recente contra snapshots antigos. Não armazena ambiente ou scripts executáveis na coleção de preferências: a inicialização lê o ecosystem local.

A exclusão manual de processos também compartilha o bloqueio de configuração, impedindo que um salvamento concorrente reabilite o início automático de um processo que acabou de ser excluído.
