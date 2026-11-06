# Instruções para agentes de IA — Frontend

> Escopo: a aplicação frontend na qual este arquivo está localizado. Este arquivo orienta agentes de programação; a documentação detalhada e a fonte de verdade arquitetural estão em `docs/`.

## Antes de modificar qualquer código

1. Inspecione a estrutura real de `src/`, o `package.json` e os arquivos relacionados à tarefa.
2. Leia `docs/architecture.md` e `docs/conventions.md`.
3. Consulte a documentação específica:
   - Componentes, extração e reutilização: `docs/components.md`.
   - CSS, Tailwind, tokens e responsividade: `docs/styling.md`.
   - Contextos, hooks, estado remoto e persistência: `docs/state-management.md`.
   - Axios, serviços, requisições e erros: `docs/api-integration.md`.
4. Preserve interfaces, rotas, contratos e padrões já utilizados. Na dúvida, verifique a implementação atual antes de propor mudanças.
5. Faça alterações pequenas e focadas. Não refatore ou mova outras áreas apenas para encaixá-las em um exemplo da documentação.

## Onde colocar arquivos

- `src/assets/`: imagens, fontes, ícones estáticos, mocks e outros recursos.
- `src/components/`: componentes **genuinamente compartilhados por diferentes funcionalidades**.
- `src/config/`: configuração de aplicação reutilizada globalmente.
- `src/context/`: contextos cujo alcance é global ou atravessa funcionalidades.
- `src/features/<feature>/`: componentes, hooks, serviços, tipos e lógica próprios de um domínio ou funcionalidade.
- `src/hooks/`: hooks genéricos compartilhados.
- `src/layouts/`: composição estrutural de páginas (shell, containers de layout etc.).
- `src/lib/`: configuração e adaptadores de bibliotecas externas, como o cliente Axios.
- `src/pages/`: pontos de entrada de páginas/rotas, preferencialmente leves.
- `src/routes/`: definição, proteção e organização de rotas.
- `src/services/`: integrações/serviços transversais, como Analytics.
- `src/styles/`: estilos e tokens globais.
- `src/utils/`: funções utilitárias genéricas, preferencialmente puras.

### Decisão obrigatória sobre componentes

1. Usado exclusivamente em uma feature? Coloque em `src/features/<feature>/components/`.
2. Usado em várias telas **da mesma feature**? Continue dentro dessa feature.
3. Usado em features independentes, com contrato estável e propósito realmente comum? Coloque em `src/components/`.
4. Se for apenas a montagem de uma rota, use `src/pages/`; se for estrutura visual de várias rotas, avalie `src/layouts/`.
5. Não promova componentes a `src/components/` por especulação sobre reutilização futura. Não duplique componentes já compartilhados.

## Regras do design system

- `src/styles/tokens.css` é a fonte de verdade de cores, semântica, sombras e efeitos definidos no projeto.
- Componentes usam **tokens semânticos** `--ds-color-*` ou utilitários correspondentes do Tailwind v4 (`bg-surface`, `text-content`, `bg-action` etc.).
- Não adicione valores hexadecimais, RGB ou cores literais nos componentes para substituir tokens já existentes.
- Não use diretamente `--palette-*` em componentes.
- Não altere a identidade KPMG, o tema claro, os estados acessíveis nem os tokens existentes sem uma solicitação explícita.
- Consulte `docs/styling.md` antes de alterar layout, sidebar, cards, tabelas ou comportamento responsivo.

## Regras de dados e ações do cockpit PM2

- O browser nunca executa comandos PM2 diretamente; operações passam pelos serviços e endpoints já implementados no backend.
- Desabilite ações conflitantes durante operações pendentes; proteja o usuário contra cliques repetidos.
- Respeite o bloqueio atual de troca de área enquanto cadastros ou envios estiverem em andamento.
- Preserve a opção de pausa da atualização de processos durante a sessão.
- Preserve a preferência Lista / Cards na chave `monitor-pm2:applications-layout` com fallback quando `localStorage` não estiver acessível.
- Estados de loading, vazio, erro, sucesso e sem conexão devem ser compreensíveis e acessíveis.
- Não invente endpoints, payloads, variáveis de ambiente ou permissões: descubra os contratos existentes.

## Dependências e validação

- A estrutura mostra `src/App.tsx`, `src/index.tsx` e `react-app-env.d.ts`. **Não presuma Vite nem migre bundler/roteador sem solicitação.**
- Use TypeScript e os padrões já configurados no projeto; não instale dependências para resolver algo possível com as ferramentas atuais.
- Antes de finalizar, execute os scripts disponíveis e pertinentes em `package.json` (por exemplo: lint, typecheck, test, build), informando claramente qualquer verificação não executada.
- Ao alterar uma regra de arquitetura ou design, atualize o respectivo arquivo em `docs/` na mesma mudança.

## Hierarquia de orientação

Requisitos explícitos da tarefa e contratos reais do código prevalecem sobre exemplos ilustrativos. Se um documento não refletir mais a implementação, corrija-o, em vez de forçar uma migração silenciosa. **Estes documentos são normas para novas alterações, não uma ordem para reorganizar arquivos existentes imediatamente.**
