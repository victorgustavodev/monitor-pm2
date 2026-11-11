# Gerenciamento de estado

## Princípio

Escolha o **menor escopo capaz de atender aos consumidores reais**. Nem todo valor precisa de Context, nem todo dado da API deve ser copiado para estado global. O objetivo é minimizar duplicação, efeitos colaterais e inconsistência entre telas.

## Onde manter cada tipo de estado

| Tipo de estado            | Preferência                                                               | Exemplo do cockpit                                         |
| ------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Local de UI               | `useState`/`useReducer` no componente/feature                             | Modal aberto, campo de busca, modo Lista / Cards           |
| Compartilhado na feature  | Hook de feature, Context local à feature ou composição de props           | Seleções e filtros usados por componentes de Processos     |
| Compartilhado globalmente | `src/context/` quando várias áreas realmente precisam dele                | Sessão/autenticação ou estado transversal, se já existirem |
| Remoto                    | Hook/serviço que gerencia fetch, erro, loading e atualização              | Lista de processos, status do PM2, métricas                |
| Persistido                | `localStorage` ou `sessionStorage` apenas para preferências não sensíveis | Modo Lista / Cards                                         |
| Configuração estática     | `src/config/`                                                             | Chaves e configurações públicas do frontend                |

Hooks reutilizáveis por **features distintas** ficam em `src/hooks/`. Hooks específicos ficam em `src/features/<feature>/hooks/`. Contextos específicos podem residir na própria feature; evite criar contextos globais sem necessidade.

## Fonte única de verdade

O carregamento inicial e o botão Atualizar da Home mostram um indicador na área de processos. Eventos SSE recebidos durante essa consulta não encerram seu loading; apenas a requisição atual pode encerrá-lo. Métricas periódicas não remontam a lista. Projetos usa a mesma coleção de processos da Home para informar aplicações não iniciadas e mantém bloqueio de navegação durante o início local. Após essa ação, revalida os processos inclusive em falha parcial.

Nomes de exibição dos processos chegam junto aos dados de consulta e SSE. Após salvar, a resposta atualiza a mesma coleção de processos usada por lista e cards; a busca considera nome técnico e de exibição. `mergeProcessLabels` preserva um nome com `labelUpdatedAt` mais recente quando chega uma coleta antiga, sem reaplicar o nome a outro processo que reutilizou o ID. A remoção mantém um registro com nome vazio e data para também impedir que um evento antigo restaure o valor removido. O rascunho do editor é local e não é sobrescrito durante a digitação por atualizações de métricas.

- Derive contadores, filtros e visões da mesma coleção de dados quando possível.
- Lista e Cards devem receber os mesmos dados filtrados; alternar apresentação não deve refazer regras de busca por caminhos divergentes.
- Evite armazenar o mesmo processo independentemente em múltiplos contextos.
- Não salve objetos completos no `localStorage` quando só uma preferência visual precisa ser persistida.
- Prefira derivar `filteredProcesses` dos dados e filtros a sincronizar estados duplicados com `useEffect`.

## Preferência Lista / Cards

Contrato conhecido:

- Chave: **`monitor-pm2:applications-layout`**.
- Valor inicial: **Lista**.
- A escolha permanece neste navegador quando armazenamento está disponível.
- Se `localStorage` não funcionar, a preferência **continua operacional em memória** durante a sessão atual.
- Não é uma preferência de usuário armazenada no backend.

Se for necessário implementar ou refatorar a lógica, trate falhas de leitura e gravação com `try/catch`. **Antes de mudar os valores serializados**, inspecione como a aplicação grava o modo atualmente; os valores literais (`list`, `cards` etc.) não foram fornecidos e não devem ser presumidos.

## Atualização periódica de processos (polling)

- Utilize o mecanismo já existente de refresh; não adicione bibliotecas ou intervalos concorrentes sem necessidade.
- Respeite a opção de **pausar atualização de processos durante a sessão**, disponível em Configurações.
- Limpe timers e interrompa/cancele requisições ao desmontar os consumidores, quando suportado.
- Evite que uma resposta antiga sobrescreva o resultado mais novo de uma ação start/stop/restart/delete.
- Não faça polling desnecessário de uma tela inativa se a implementação puder economizar chamadas sem perder comportamento.
- Aplique loading inicial e atualização em segundo plano de maneira distinta, evitando piscar toda a tela a cada refresh.
- Não acrescente persistência entre sessões à opção de pausa sem requisito explícito.

## Ações em andamento e navegação

- Marque a ação específica como pendente para bloquear repetições.
- Onde já existir restrição, preserve o **bloqueio de navegação durante cadastros e envios em andamento**.
- A sinalização de indisponibilidade precisa estar visível e acessível (não somente cor).
- Ao concluir uma ação, revalide os dados ou aplique atualização consistente com o contrato existente.
- Em falhas, preserve o estado válido anterior, comunique o erro e permita tentar novamente.

## Segurança e manutenção

### Preferências adicionadas

O idioma usa `monitor-pm2:locale` (`pt-BR`, `en`, `es`) e uma assinatura `useSyncExternalStore`; `App` acompanha essa assinatura sem remontar telas ou a conexão SSE. Datas usam a localidade selecionada. A política de limpeza, em contraste, é estado remoto compartilhado no MongoDB: o formulário mantém uma edição local e só altera o agendamento após salvar pela API. Essa verificação roda no backend, mesmo sem navegadores conectados.

- Não use o Context para guardar segredos que não deveriam estar disponíveis no navegador.
- Evite logs de tokens, credenciais ou payloads sensíveis.
- Se já houver solução de cache/requisições instalada, siga o padrão atual; não introduza outra por preferência pessoal.
- Coloque a transformação de dados repetida em hooks, services ou utilitários apropriados, sem criar estados derivados redundantes.

Veja `api-integration.md` para erros e contratos HTTP e `components.md` para separar estado/apresentação.

## Estado do vínculo de projeto

A associação chega na mesma lista e no mesmo SSE que as métricas, sem polling adicional. O editor mantém seleção local e consulta o catálogo ao abrir. Após salvar, a resposta atualiza todas as instâncias da mesma identidade, inclusive com atualização ao vivo pausada. `mergeProcessLabels` também preserva vínculos contra snapshots anteriores à gravação; compara `projectUpdatedAt` e `projectObservedAt`. Uma coleta mais recente pode remover associações após exclusão de projeto ou mudança de pasta, mesmo sem um metadado explícito para aquele processo. A identificação inclui nome e namespace para não reaproveitar dados de outro processo com o mesmo ID.

## Publicações globais

O hook `useBuildPublication` vive em `App` e mantém tarefas separadas por ID, não um único progresso por tela. A lista vem do SSE global de publicações e permanece ativa mesmo com métricas pausadas. Jobs aceitos em segundo plano liberam navegação; apenas cadastros, salvamentos e o envio inicial continuam bloqueando a tela. O projeto em publicação fica indisponível para um novo build e alterações, inclusive se iniciado por outro usuário. A conexão de publicações ainda desconhecida/interrompida bloqueia ações conflitantes até sincronizar novamente. A conclusão atualiza projetos/histórico; métricas seguem respeitando a pausa da sessão.

IDs de resultados dispensados são locais à sessão em memória. Tarefas em andamento não podem ser dispensadas. Não persista pacotes, logs, variáveis ou conteúdo de tarefas em `localStorage`.

## Prazo das versões

A retenção começa desabilitada e é uma política global (`enabled`, `retentionDays`). O formulário só grava alterações ao salvar; uma escolha já salva permanece ao reabrir a tela. O vencimento usa a data de envio de cada versão, sem reiniciar a contagem ao alterar configurações ou republicar. Ativar ou reduzir o prazo também se aplica às versões existentes. A verificação interna ocorre a cada minuto e não é uma segunda preferência do usuário.
