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

- `GET /api/auth/me` inclui `role: "admin" | "user"`, consultado do banco. `GET /api/users` e `POST /api/users` exigem `admin` no backend; no frontend, o acesso fica no submenu Configurações → Usuários da sidebar. A criação aceita `role` opcional, com padrão `user`.
- `GET /api/projects/:id/deletion-preview` retorna os processos vinculados à pasta atual e uma revisão. A confirmação de exclusão envia `stopProcesses` e `processRevision`; a opção de parar começa desmarcada. Uma revisão desatualizada retorna 409 e exige nova confirmação. Parar conserva a entrada no PM2.

- `GET /api/settings/retention` retorna `enabled`, `retentionDays`, `intervalHours`, `nextRunAt` e, após execução, `lastRunAt`, `lastDeleted` e eventual `lastError`.
- `PUT /api/settings/retention` recebe `{ enabled: boolean, retentionDays: number, intervalHours: number }`. Exige sessão; retenção de 1–3650 dias, intervalo inteiro de 1–8760 horas. A UI bloqueia navegação enquanto salva e trata 401 pelo fluxo de sessão existente.
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

O cliente cria uma operação com `POST /api/projects/:id/build-operations`, acompanha snapshots via SSE em `GET /api/projects/:id/build-operations/:operationId/stream` e envia `operationId` como query no POST de upload/publicação existente. Os endpoints antigos continuam síncronos e compatíveis. A operação é restrita ao projeto e ao usuário autenticado; snapshots incluem etapa, percentual, logs e disponibilidade de cancelamento. O percentual indica marcos das etapas, não estimativa de tempo ou bytes enviados.

`POST /api/projects/:id/build-operations/:operationId/cancel` solicita cancelamento. Extração termina o worker, validação/cópia verifica AbortSignal e alterações são restauradas pelo journal antes de liberar a operação. Ao iniciar o PM2, cancelamento é bloqueado (409) para evitar interrupção de uma troca de processos. O POST original só termina após publicação ou recuperação; fechar o SSE não cancela o servidor. Operações ficam em memória; reinício encerra conexões e usa a recuperação persistente já existente para builds interrompidos.

## Vínculos de processos

`GET /api/processes` e o SSE incluem `projectId`, `projectName`, `projectUpdatedAt` (nulos se ausentes) e `projectObservedAt` (data da consulta dos vínculos). `PUT /api/processes/:id/project` exige sessão e recebe `{ name, namespace, projectId }`, com ID de projeto válido ou `null` para remover o vínculo. Retorna `{ name, namespace, projectId, projectName, projectUpdatedAt }`. Valida a identidade atual contra o PM2; ID inexistente retorna 404, identidade desatualizada retorna 409, projeto inexistente retorna 404 e projeto em exclusão/recuperação retorna 409. Não altera processos no daemon.

As APIs legadas de versões e histórico global continuam disponíveis por compatibilidade; a interface usa somente builds vinculados a projetos.
