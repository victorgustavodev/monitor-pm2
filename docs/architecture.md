# Arquitetura do frontend

## Objetivo e abordagem

A aplicação utiliza React + TypeScript e organiza o código por responsabilidade, adotando **features** para funcionalidades maiores ou com potencial de crescimento. Esta documentação descreve o padrão desejado sem exigir uma migração imediata do código existente.

A implementação atual fica em `apps/frontend/`, usa Vite e entra por `src/main.tsx`, que renderiza `src/app/App.tsx`. Verifique sempre o `package.json` e os arquivos reais antes de alterar bundler, scripts ou aliases. A estrutura abaixo é uma referência de responsabilidades; não exige criar pastas vazias nem mover áreas existentes.

## Estrutura base

```text
src/
├── assets/       # Imagens, fontes, mocks, recursos estáticos
├── components/   # Componentes compartilhados entre features
├── config/       # Configurações globais da aplicação
├── context/      # Contextos de alcance global/transversal
├── features/     # Funcionalidades autocontidas
├── hooks/        # Hooks genéricos reutilizáveis
├── layouts/      # Estruturas visuais de páginas e áreas
├── lib/          # Integração/configuração de bibliotecas
├── pages/        # Entradas de páginas e composição de rotas
├── routes/       # Rotas, guards e regras de navegação
├── services/     # Serviços transversais
├── styles/       # CSS global, temas e tokens
├── utils/        # Funções genéricas e puras
├── App.tsx
└── index.tsx
```

## Responsabilidade e limites

| Pasta        | Responsabilidade                                        | Não deve conter                                                |
| ------------ | ------------------------------------------------------- | -------------------------------------------------------------- |
| `assets`     | Recursos estáticos e mocks de desenvolvimento           | Regras de negócio ou segredos                                  |
| `components` | UI e padrões de composição usados em features distintas | Componentes exclusivos de uma única feature                    |
| `config`     | Configurações e constantes globais de aplicação         | Chamadas HTTP ou estado mutável de tela                        |
| `context`    | Estado compartilhado em amplas partes da aplicação      | Todo estado local por conveniência                             |
| `features`   | Organização vertical por domínio funcional              | Dependência arbitrária de detalhes internos de outras features |
| `hooks`      | Lógica React genérica e reutilizável                    | Hooks exclusivos de um domínio                                 |
| `layouts`    | Shell autenticado, composição visual, sidebar/topbar    | Regras de acesso a dados do backend                            |
| `lib`        | Instâncias/configuração de libs externas e adaptadores  | Regras de negócio de processos                                 |
| `pages`      | Páginas e conexão entre rota e feature                  | Implementações extensas de serviço                             |
| `routes`     | Definição de rotas, permissões e redirecionamentos      | UI de domínio complexa                                         |
| `services`   | Integrações transversais e serviços globais             | Serviços exclusivos de `features/processes`, por exemplo       |
| `styles`     | Estilo global, tokens e temas                           | CSS específico espalhado sem necessidade                       |
| `utils`      | Formatação e cálculos independentes de React            | Hooks ou chamadas HTTP                                         |

## Organização interna de uma feature

O exemplo abaixo **ilustra uma estrutura-alvo**, não afirma que os arquivos já existem:

```text
features/
└── processes/
    ├── components/
    │   ├── ProcessList.tsx
    │   ├── ProcessCard.tsx
    │   └── ProcessFilters.tsx
    ├── hooks/
    │   └── useProcesses.ts
    ├── services/
    │   └── processes.service.ts
    ├── types/
    │   └── process.types.ts
    ├── utils/
    │   └── process-formatters.ts
    └── index.ts              # API pública, se fizer sentido
```

A pasta `features` é especialmente indicada para áreas como autenticação, dashboard, processos, logs, usuários, builds e configurações, **na medida em que estas áreas já existirem e crescerem**. Não crie diretórios vazios por antecipação. Uma feature pequena pode começar com um único arquivo.

### Regras de dependência

- `pages` e `routes` **compõem** features, layouts e componentes compartilhados.
- `features/<nome>` pode usar `components`, `hooks`, `lib`, `config`, `utils` e estilos globais.
- Features não devem importar arquivos internos de outra feature (`../outra-feature/components/...`) indiscriminadamente. Se houver necessidade real, exponha um contrato público em `index.ts` ou promova um elemento de uso transversal para `components/`.
- `lib` não depende de componentes, páginas ou features.
- Funções de `utils` devem, de preferência, ser independentes de React e do ambiente de browser.
- `components` genéricos não importam serviços de negócio nem conhecem estruturas específicas de rota.
- Evite imports circulares e barrels (`index.ts`) que causem ciclos.

## Fluxo típico de uma operação

```text
Usuário → Página/Feature → Hook/estado da feature → Serviço da feature
        → Cliente HTTP em lib/ → Backend → PM2
```

O backend é responsável por validar e executar operações PM2. O frontend mostra dados, apresenta estados e envia intenções autorizadas; não executa comandos PM2 no navegador.

## Navegação do cockpit

O painel autenticado possui sidebar azul com logo branca e **Home**, **Projetos** e o grupo expansível **Configurações**, com destinos **Geral**, **Logs** e **Usuários**. `components/layout/Sidebar.tsx` centraliza destinos e `app/App.tsx` controla a área ativa, o projeto selecionado e o perfil recebido da sessão. Logs e Usuários são telas independentes acessadas pelo submenu da sidebar; Usuários fica disponível apenas a administradores. O botão Configurações somente expande ou recolhe o submenu, sem trocar a tela ativa.

**Antes de editar**, localize os arquivos reais e respeite os caminhos efetivos. Não mova a Sidebar ou o App apenas para fazer o código coincidir com este texto. Se existir um componente de navegação específico em `components/layout/`, ele pode permanecer ali até uma refatoração solicitada e planejada.

- Desktop: sidebar persistente e área principal rolável.
- Abaixo de 768 px: barra superior com navegação horizontal.
- Tabelas largas: rolagem horizontal dentro do card, sem provocar overflow da página.
- A navegação oferece o atalho acessível **“Ir para o conteúdo”**.
- Cadastros/envios em andamento podem impedir a troca de área; essa regra funcional não deve ser perdida em refatorações.

## Home

O título da Home cumprimenta o usuário conectado com “Olá, nome”, respeitando o idioma da interface.

`features/processes/components/ProcessLabel.tsx` contém o editor de nome de exibição, reutilizado por lista e cards. A aplicação coordena o salvamento e bloqueia navegação enquanto a operação está pendente. O campo é metadado compartilhado no MongoDB (`process_labels`), identificado por `PM2_HOME`, nome PM2 e namespace; o ID é usado apenas para localizar e conferir a identidade atual. Não executa operações de alteração no daemon PM2.

- `features/home/Home.tsx` exibe quatro indicadores em uma linha no desktop, duas colunas até 1200 px e uma até 640 px.
- A Home também compõe `Applications`, com a tabela completa, portas, busca, logs e ações de processos.
- O seletor **Lista / Cards** muda somente a apresentação; não duplica fontes de dados nem altera busca ou filtros.
- A lista é o modo inicial. O modo escolhido é persistido em `localStorage` usando `monitor-pm2:applications-layout`.
- Os cards formam duas colunas no desktop, uma em telas pequenas e incluem o atalho **Novo processo**.
- Componentes de status, portas e ações devem ser reaproveitados entre apresentações, respeitando `docs/components.md`.

## Projetos e builds

`features/projects/Projects.tsx` compõe cadastro e detalhe do projeto. Upload, publicação e histórico de builds ficam exclusivamente dentro do projeto; não há tela global de builds nem interface de uploads avulsos. Componentes exclusivos (`BuildForm`, `BuildHistory`, `ProjectFiles`, `ProjectSettings`) ficam em `features/projects/components/`; os tipos ficam em `features/projects/types.ts`. `ProjectSettings` contém edição e confirmação de exclusão pelo nome; a tela coordena chamadas e bloqueio de navegação. As chamadas reutilizam o cliente autenticado existente em `services/api.ts`. `BuildHistory` exige `projectId` e consulta somente o histórico desse projeto.

Arquivos são lidos pela API a partir da pasta do projeto na VM. Publicação, validação de caminhos e execução PM2 pertencem ao backend. Cadastros, uploads e republicações bloqueiam ações conflitantes e a navegação até concluir. Consulte [Projetos](projects.md) para modelo de dados e contratos.

`Pm2ConfigurationField` compartilha entre cadastro e edição o conteúdo opcional do ecosystem (`pm2ConfigContent`). O backend valida sintaxe sem executá-lo no salvamento e materializa uma cópia no armazenamento do build quando falta o arquivo no pacote, usando o mesmo fluxo de publicação e recuperação dos demais arquivos.

## Evolução incremental

### Configurações, idiomas e portas

`features/settings/components/RetentionSettings.tsx` edita a política global de retenção pela API autenticada. O backend em `src/settings/` agenda a remoção de artefatos, compartilha um bloqueio com operações de publicação e preserva referências atuais e salvas do PM2. A configuração fica na coleção MongoDB `settings`, documento `retention`.

`src/i18n/` contém o catálogo e a preferência local de idioma; consulte [i18n.md](i18n.md). `ProcessPort` é reutilizado na lista e nos cards da Home e exibe os números das portas em texto, mantendo a distinção entre portas em escuta e configuradas.

`App` renderiza `Management panel="users"` como destino independente quando o perfil é administrador; `Settings` mantém somente preferências gerais. O backend valida o papel armazenado no MongoDB em todas as requisições e protege GET/POST `/api/users` com `requireAdmin`. A visibilidade do frontend não substitui essa autorização.

1. Identifique o fluxo funcional que será alterado.
2. Preserve o contrato público e os comportamentos atuais.
3. Separe lógica, estado e apresentação **somente quando houver ganho real**.
4. Migre para `features` quando a responsabilidade ficar clara; evite reorganização massiva em paralelo com uma correção simples.
5. Atualize testes e documentação da regra modificada.

Consulte também `components.md`, `state-management.md` e `api-integration.md`.
## Modal de publicação

`features/projects/useBuildPublication.ts` coordena a operação autenticada, SSE e cancelamento para uploads e republicações. `components/BuildProgressModal.tsx` apresenta o progresso centralizado, etapas, resultado e diagnóstico. O modal permanece aberto no resultado até Fechar. A navegação permanece bloqueada enquanto o POST aguarda a conclusão ou recuperação no servidor; Escape não oculta uma publicação em andamento. O componente utiliza tokens semânticos, progress nativo e dialog modal com contenção de foco.

## Vínculo de processos a projetos

A Home mostra projeto e edição do vínculo na Lista e nos Cards através de `features/processes/components/ProcessProject.tsx`. `ProcessProjectDialog` carrega os projetos pela API existente; `App` salva o vínculo, atualiza a coleção de processos e bloqueia ações conflitantes e navegação durante o envio. O nome do projeto abre seu detalhe e participa da busca.

O backend resolve associações pela pasta atual do projeto quando não há escolha explícita. A coleção `process_projects` guarda escolhas por PM2_HOME, nome PM2 e namespace, incluindo `null` para manter um processo sem projeto. Não executa comandos de alteração no PM2 ao vincular. A confirmação de exclusão usa os mesmos vínculos, inclusive manuais, e valida novamente sua revisão antes de parar processos.
