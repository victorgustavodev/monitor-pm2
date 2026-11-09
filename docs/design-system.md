# Cores e tokens de design

## Projetos e builds

As telas de projetos usam `apps/frontend/src/styles/projects.css`, com os mesmos tokens semânticos do painel. Cards apresentam nome, pasta e contagem de builds; o detalhe usa abas Arquivos, Builds e Sobre o projeto. O navegador de arquivos combina breadcrumbs, tabela com rolagem horizontal e prévia de texto. O histórico mostra autor, comentário, data, estado e indicação textual do build ativo. Formulários e ações de publicação mostram estado pendente e bloqueiam interações conflitantes. Os cards e formulários passam para uma coluna em telas pequenas.

As cores da interface ficam em [`tokens.css`](../apps/frontend/src/styles/tokens.css). A paleta KPMG mantém azul `#00338D`, cobalto `#1E49E2` e branco como cores predominantes. As outras cores da marca são referências disponíveis; feedback de sucesso, atenção e erro tem uma paleta funcional própria.

## Organização

1. **Primitivos** (`--palette-*`): os valores hexadecimais da marca, neutros e feedback. São a fonte dos valores, sem indicar onde uma cor será usada.
2. **Semânticos** (`--ds-color-*`): referências aos primitivos conforme a finalidade da cor. Por exemplo, `--ds-color-action` define ações primárias; `--ds-color-focus` define foco de teclado. As duas funções podem usar o mesmo cobalto e ainda ser alteradas separadamente.
3. **Integração com componentes**: CSS consome os semânticos com `var(...)`; o adaptador `@theme inline` disponibiliza os mesmos tokens como utilitários do Tailwind v4. Componentes não devem acessar os primitivos nem declarar novas cores literais.

| Uso                            | Token CSS                                          | Exemplos no Tailwind              |
| ------------------------------ | -------------------------------------------------- | --------------------------------- |
| Fundo da página                | `--ds-color-canvas`                                | `bg-canvas`                       |
| Cards e diálogos               | `--ds-color-surface`                               | `bg-surface`                      |
| Conteúdo e apoio               | `--ds-color-content`, `--ds-color-muted`           | `text-content`, `text-muted`      |
| Títulos e links                | `--ds-color-heading`, `--ds-color-link`            | `text-heading`, `text-link`       |
| Ação primária                  | `--ds-color-action`, `--ds-color-on-action`        | `bg-action text-on-action`        |
| Hover de ação                  | `--ds-color-action-hover`                          | `hover:bg-action-hover`           |
| Borda e foco                   | `--ds-color-line`, `--ds-color-focus`              | `border-line focus:border-focus`  |
| Identidade e contraste da logo | `--ds-color-shell`, `--ds-color-on-brand`          | `bg-shell text-on-brand`          |
| Sucesso                        | `--ds-color-success`, `--ds-color-success-surface` | `text-success bg-success-surface` |
| Atenção                        | `--ds-color-warning`, `--ds-color-warning-surface` | `text-warning bg-warning-surface` |
| Erro ou ação destrutiva        | `--ds-color-danger`, `--ds-color-danger-surface`   | `text-danger bg-danger-surface`   |

Sombras, seleção de texto, sobreposições e efeitos decorativos também ficam nesse arquivo e referenciam a paleta. Nenhuma cor de interface precisa ser repetida em `app/App.tsx`, `features/management/Management.tsx` ou `styles/global.css`.

## Como usar

```tsx
<button className="bg-action text-on-action hover:bg-action-hover">
  Salvar
</button>
<p className="text-muted">Informação complementar</p>
```

```css
.meu-componente {
  color: var(--ds-color-content);
  background: var(--ds-color-surface);
  border: 1px solid var(--ds-color-line);
}
```

Para alterar uma cor de marca, edite o primitivo. Para alterar somente uma função da interface, altere o alias semântico correspondente. Um novo tema deve sobrescrever os tokens semânticos em um seletor de tema, sem mudar os componentes; este projeto publica apenas o tema claro.

Estados devem continuar identificáveis por texto ou ícone, além da cor. Mantenha contraste suficiente entre texto e superfície e preserve o indicador de foco. A logo branca exige o fundo `shell`. O favicon e a metadata `theme-color` são artefatos independentes do CSS e devem acompanhar a cor institucional quando a marca mudar.

## Navegação e layout

O painel autenticado usa uma sidebar azul com a logo branca, o usuário conectado e Home, Projetos e um grupo expansível Configurações. O grupo abre Geral, Logs e Usuários abaixo do botão; Logs e Usuários são destinos independentes, e Usuários é exclusivo de administradores. Builds ficam somente dentro do projeto. `components/layout/Sidebar.tsx` centraliza os destinos; `app/App.tsx` controla a área ativa. As telas ficam em `features/`, os estilos globais em `styles/global.css` e a tela de login em `features/auth/Login.tsx`. O estado ativo, o hover, os ícones e o foco de teclado da navegação usam os tokens `--ds-color-navigation-*` e `--ds-color-shell-*`.

Em desktop, a sidebar permanece visível enquanto o conteúdo rola. Em telas menores que 768 px, ela vira uma barra superior com navegação horizontal. O conteúdo mantém largura flexível e tabelas rolam dentro do próprio card. O atalho “Ir para o conteúdo” permite pular a navegação usando o teclado.

A Home mostra os quatro indicadores em uma linha no desktop, duas colunas até 1200 px e uma até 640 px. Abaixo ficam todos os processos, com portas, busca, ações e seletor Lista/Cards. Cadastros e envios em andamento bloqueiam a troca de área até a conclusão. Em Configurações, a atualização dos processos pode ser pausada durante a sessão.

Na área Processos, o seletor **Lista / Cards** alterna a apresentação das aplicações sem alterar os dados ou a busca. A lista é o formato inicial; a preferência é salva no `localStorage` deste navegador sob a chave `monitor-pm2:applications-layout`. Se o armazenamento estiver indisponível, a troca continua funcionando durante a navegação atual. Os cards usam duas colunas no desktop e uma no celular e incluem o atalho **Novo processo**. Status, portas e ações são componentes compartilhados entre os dois formatos, incluindo o bloqueio de ações durante uma operação.

Referências: [aliases de design tokens](https://www.designtokens.org/tr/2025.10/format/), [variáveis de tema do Tailwind](https://tailwindcss.com/docs/theme).
