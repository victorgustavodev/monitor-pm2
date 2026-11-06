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

O painel autenticado possui sidebar azul com logo branca e sete áreas: **visão geral, processos, projetos, logs, usuários, builds e configurações**. `components/layout/Sidebar.tsx` centraliza destinos e `app/App.tsx` controla a área ativa e o projeto selecionado.

**Antes de editar**, localize os arquivos reais e respeite os caminhos efetivos. Não mova a Sidebar ou o App apenas para fazer o código coincidir com este texto. Se existir um componente de navegação específico em `components/layout/`, ele pode permanecer ali até uma refatoração solicitada e planejada.

- Desktop: sidebar persistente e área principal rolável.
- Abaixo de 768 px: barra superior com navegação horizontal.
- Tabelas largas: rolagem horizontal dentro do card, sem provocar overflow da página.
- A navegação oferece o atalho acessível **“Ir para o conteúdo”**.
- Cadastros/envios em andamento podem impedir a troca de área; essa regra funcional não deve ser perdida em refatorações.

## Dashboard e Processos

- A **visão geral** exibe quatro indicadores em duas colunas e resumo de até seis processos.
- A área **Processos** contém tabela completa, portas e ações.
- O seletor **Lista / Cards** muda somente a apresentação; não duplica fontes de dados nem altera busca ou filtros.
- A lista é o modo inicial. O modo escolhido é persistido em `localStorage` usando `monitor-pm2:applications-layout`.
- Os cards formam duas colunas no desktop, uma em telas pequenas e incluem o atalho **Novo processo**.
- Componentes de status, portas e ações devem ser reaproveitados entre apresentações, respeitando `docs/components.md`.

## Projetos e builds

`features/projects/Projects.tsx` compõe cadastro e detalhe do projeto; `Builds.tsx` reúne o histórico global e o acesso aos uploads avulsos existentes. Componentes exclusivos (`BuildForm`, `BuildHistory`, `ProjectFiles`) ficam em `features/projects/components/`; os tipos ficam em `features/projects/types.ts`. As chamadas reutilizam o cliente autenticado existente em `services/api.ts`. O histórico é compartilhado pelas duas telas, sem promovê-lo a componente global.

Arquivos são lidos pela API a partir da pasta do projeto na VM. Publicação, validação de caminhos e execução PM2 pertencem ao backend. Cadastros, uploads e republicações bloqueiam ações conflitantes e a navegação até concluir. Consulte [Projetos](projects.md) para modelo de dados e contratos.

## Evolução incremental

### Configurações, idiomas e portas

`features/settings/components/RetentionSettings.tsx` edita a política global de retenção pela API autenticada. O backend em `src/settings/` agenda a remoção de artefatos, compartilha um bloqueio com operações de publicação e preserva referências atuais e salvas do PM2. A configuração fica na coleção MongoDB `settings`, documento `retention`.

`src/i18n/` contém o catálogo e a preferência local de idioma; consulte [i18n.md](i18n.md). `ProcessPort` é reutilizado na visão geral, lista e cards e exibe os números das portas em texto, mantendo a distinção entre portas em escuta e configuradas. A visão geral usa botões para navegar até os processos.

1. Identifique o fluxo funcional que será alterado.
2. Preserve o contrato público e os comportamentos atuais.
3. Separe lógica, estado e apresentação **somente quando houver ganho real**.
4. Migre para `features` quando a responsabilidade ficar clara; evite reorganização massiva em paralelo com uma correção simples.
5. Atualize testes e documentação da regra modificada.

Consulte também `components.md`, `state-management.md` e `api-integration.md`.
