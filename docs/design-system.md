# Cores e tokens de design

As cores da interface ficam em [`tokens.css`](../apps/frontend/src/styles/tokens.css). A paleta KPMG mantém azul `#00338D`, cobalto `#1E49E2` e branco como cores predominantes. As outras cores da marca são referências disponíveis; feedback de sucesso, atenção e erro tem uma paleta funcional própria.

## Organização

1. **Primitivos** (`--palette-*`): os valores hexadecimais da marca, neutros e feedback. São a fonte dos valores, sem indicar onde uma cor será usada.
2. **Semânticos** (`--ds-color-*`): referências aos primitivos conforme a finalidade da cor. Por exemplo, `--ds-color-action` define ações primárias; `--ds-color-focus` define foco de teclado. As duas funções podem usar o mesmo cobalto e ainda ser alteradas separadamente.
3. **Integração com componentes**: CSS consome os semânticos com `var(...)`; o adaptador `@theme inline` disponibiliza os mesmos tokens como utilitários do Tailwind v4. Componentes não devem acessar os primitivos nem declarar novas cores literais.

| Uso | Token CSS | Exemplos no Tailwind |
| --- | --- | --- |
| Fundo da página | `--ds-color-canvas` | `bg-canvas` |
| Cards e diálogos | `--ds-color-surface` | `bg-surface` |
| Conteúdo e apoio | `--ds-color-content`, `--ds-color-muted` | `text-content`, `text-muted` |
| Títulos e links | `--ds-color-heading`, `--ds-color-link` | `text-heading`, `text-link` |
| Ação primária | `--ds-color-action`, `--ds-color-on-action` | `bg-action text-on-action` |
| Hover de ação | `--ds-color-action-hover` | `hover:bg-action-hover` |
| Borda e foco | `--ds-color-line`, `--ds-color-focus` | `border-line focus:border-focus` |
| Identidade e contraste da logo | `--ds-color-shell`, `--ds-color-on-brand` | `bg-shell text-on-brand` |
| Sucesso | `--ds-color-success`, `--ds-color-success-surface` | `text-success bg-success-surface` |
| Atenção | `--ds-color-warning`, `--ds-color-warning-surface` | `text-warning bg-warning-surface` |
| Erro ou ação destrutiva | `--ds-color-danger`, `--ds-color-danger-surface` | `text-danger bg-danger-surface` |

Sombras, seleção de texto, sobreposições e efeitos decorativos também ficam nesse arquivo e referenciam a paleta. Nenhuma cor de interface precisa ser repetida em `App.tsx`, `Management.tsx` ou `styles.css`.

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

Referências: [aliases de design tokens](https://www.designtokens.org/tr/2025.10/format/), [variáveis de tema do Tailwind](https://tailwindcss.com/docs/theme).
