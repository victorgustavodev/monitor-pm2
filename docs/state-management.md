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

O idioma usa `monitor-pm2:locale` (`pt-BR`, `en`, `es`) e uma assinatura `useSyncExternalStore`; `App` acompanha essa assinatura sem remontar telas ou a conexão SSE. Datas usam a localidade selecionada. A política de limpeza, em contraste, é estado remoto compartilhado no MongoDB: o formulário mantém uma edição local e só altera o agendamento após salvar pela API. Esse agendamento roda no backend, mesmo sem navegadores conectados.

- Não use o Context para guardar segredos que não deveriam estar disponíveis no navegador.
- Evite logs de tokens, credenciais ou payloads sensíveis.
- Se já houver solução de cache/requisições instalada, siga o padrão atual; não introduza outra por preferência pessoal.
- Coloque a transformação de dados repetida em hooks, services ou utilitários apropriados, sem criar estados derivados redundantes.

Veja `api-integration.md` para erros e contratos HTTP e `components.md` para separar estado/apresentação.
