# Styling e design system

## Fonte de verdade

As cores, superfícies, sombras, seleção de texto, sobreposições e efeitos decorativos existentes são definidos em **`src/styles/tokens.css`** (referência informada: `apps/frontend/src/styles/tokens.css`). Mantenha esse arquivo como fonte única de tokens. `src/styles/global.css` concentra regras globais; componentes devem aplicar estilos pelo sistema de tokens, não repetir valores em cada tela.

A identidade visual KPMG usa **azul `#00338D`**, **cobalto `#1E49E2`** e branco como referências da marca. Esses valores identificam a paleta; **não são autorização para hardcode** em componentes. Sucesso, atenção e erro possuem paletas funcionais próprias já existentes no arquivo de tokens.

O projeto documentado utiliza **Tailwind CSS v4**, com adaptação `@theme inline`. Preserve a integração atual e confirme os pacotes instalados antes de alterar configuração. Somente o **tema claro** está definido neste momento.

## Três níveis de tokens

1. **Primitivos — `--palette-*`**: valores da marca, neutros e feedback. Uso restrito à definição de tokens.
2. **Semânticos — `--ds-color-*`**: finalidade no produto; componentes devem referenciar este nível.
3. **Adaptador Tailwind — `@theme inline`**: disponibiliza semânticos como utilitários (`bg-surface`, `text-muted` etc.).

Nunca importe diretamente `--palette-*` para estilizar um componente. Para mudar uma cor global de marca, ajuste o primitivo; para mudar uma função específica, ajuste o token semântico apropriado. Não altere ambos sem necessidade.

## Referência dos tokens existentes

| Finalidade                 | Tokens semânticos                                        | Exemplos de utilitários                 |
| -------------------------- | -------------------------------------------------------- | --------------------------------------- |
| Fundo de página            | `--ds-color-canvas`                                      | `bg-canvas`                             |
| Cards/diálogos             | `--ds-color-surface`                                     | `bg-surface`                            |
| Texto principal/secundário | `--ds-color-content`, `--ds-color-muted`                 | `text-content`, `text-muted`            |
| Títulos e links            | `--ds-color-heading`, `--ds-color-link`                  | `text-heading`, `text-link`             |
| Ação primária              | `--ds-color-action`, `--ds-color-on-action`              | `bg-action text-on-action`              |
| Hover da ação              | `--ds-color-action-hover`                                | `hover:bg-action-hover`                 |
| Borda e foco               | `--ds-color-line`, `--ds-color-focus`                    | `border-line`, `focus:border-focus`     |
| Identidade institucional   | `--ds-color-shell`, `--ds-color-on-brand`                | `bg-shell text-on-brand`                |
| Sucesso                    | `--ds-color-success`, `--ds-color-success-surface`       | `text-success bg-success-surface`       |
| Atenção                    | `--ds-color-warning`, `--ds-color-warning-surface`       | `text-warning bg-warning-surface`       |
| Erro/destrutivo            | `--ds-color-danger`, `--ds-color-danger-surface`         | `text-danger bg-danger-surface`         |
| Navegação                  | família `--ds-color-navigation-*` e `--ds-color-shell-*` | Consultar aliases reais em `tokens.css` |

Exemplos:

```tsx
<button className="bg-action text-on-action hover:bg-action-hover focus-visible:outline-focus">
  Salvar
</button>
<p className="text-muted">Informação complementar</p>
```

```css
.meu-componente {
  color: var(--ds-color-content);
  background-color: var(--ds-color-surface);
  border: 1px solid var(--ds-color-line);
}
```

Antes de usar uma classe de token, verifique se o alias correspondente está **realmente registrado** pelo `@theme inline` atual. Não assuma nomes de tokens de espaçamento, tipografia ou sombra sem encontrá-los em `tokens.css`.

## Layout, navegação e responsividade

- Sidebar autenticada: azul institucional, logo branca, identidade de navegação baseada nos tokens `navigation` e `shell`.
- Em **desktop**, sidebar persistente; a **área de conteúdo** deve rolar sem deslocar indevidamente a navegação.
- **Abaixo de 768 px**, a navegação se apresenta como barra superior horizontal.
- Tabelas extensas: usar contêiner com `overflow-x-auto` dentro do card; não esconder colunas críticas sem decisão de produto.
- Cards de processos: **duas colunas no desktop**, **uma no celular**, conforme comportamento já descrito.
- Preservar o link **“Ir para o conteúdo”**, foco visível por teclado, ordem de tabulação e texto/ícones além de cor para estados.
- Evitar margens e alturas fixas que quebrem em telas menores. Respeitar espaçamento e tipografia já usados no design system.

## Estados de UI e comportamento visual

- Processos: o seletor **Lista / Cards** altera somente a composição, não altera dados, busca, filtros ou permissões.
- Componentes de status, portas e ações permanecem consistentes entre as duas visualizações.
- Ações pendentes devem mostrar indicador de processamento e impedir interação repetida/conflitante.
- Loading, vazio, erro e sucesso devem ter tratamento visual consistente e texto que explique o estado.
- A identidade da marca deve preservar contraste e legibilidade, inclusive na sidebar.
- A logo branca deve permanecer sobre a superfície `shell` adequada.

## Restrições para a IA

**Não fazer:**

- Criar cores `#hex`, `rgb()` ou `hsl()` nos componentes para reproduzir cores disponíveis nos tokens.
- Trocar tokens semânticos por cores de primitivos na UI.
- Introduzir tema escuro por conta própria.
- Alterar `src/styles/tokens.css` para resolver um detalhe local sem avaliar o impacto global.
- Repetir valores de cores no `App.tsx`, telas de feature e `global.css`.
- Substituir indicadores de foco por estilos que dependam só do mouse.

Favicon e `theme-color` são artefatos independentes do CSS. Uma mudança de marca deve revisar ambos, sem assumir que alterá-los acontece automaticamente ao editar tokens.

## Referências

- Tokens da aplicação: `src/styles/tokens.css`.
- Estilos gerais: `src/styles/global.css`, se presente.
- [Design Tokens Format Module](https://www.designtokens.org/tr/2025.10/format/).
- [Tailwind CSS — Theme variables](https://tailwindcss.com/docs/theme/).
