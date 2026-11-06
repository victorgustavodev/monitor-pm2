# Componentes: compartilhados vs. específicos de feature

## Princípio

**Reutilização é uma característica comprovada, não uma previsão.** Um componente usado em duas telas da **mesma** feature continua pertencendo à feature. Um componente usado em funcionalidades independentes pode ser candidato a `src/components/`, desde que sua responsabilidade e API façam sentido fora do domínio de origem.

## Árvore de decisão para a IA

1. O componente pertence apenas a um fluxo/feature? → `src/features/<feature>/components/`.
2. Ele aparece em várias páginas da mesma feature? → **continua** em `src/features/<feature>/components/`.
3. Ele representa um elemento genérico de interface (Button, Dialog, EmptyState) utilizado em features distintas? → `src/components/ui/` (ou equivalente já existente).
4. Ele representa algo de domínio, mas aparece em features diferentes (ex.: badge de status de processo usado em dashboard e processos)? → considere `src/components/<dominio>/`, **ou** exponha-o pela API pública da feature proprietária quando esse acoplamento for intencional.
5. O componente apenas define a estrutura da aplicação (shell, cabeçalho persistente, sidebar)? → avalie `src/layouts/` ou mantenha o caminho histórico existente.
6. A única finalidade do arquivo é ser a página acessada por uma rota? → `src/pages/`, delegando a implementação para a feature quando ela for complexa.
7. Não está claro se existe reutilização real? → mantenha-o local e extraia depois.

## Exemplos contextualizados para o cockpit

| Elemento                                       | Local recomendado                                                               | Justificativa                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------- |
| `Button`, `ConfirmDialog`, `EmptyState`        | `src/components/ui/`                                                            | São padrões transversais da interface       |
| `ProcessStatusBadge`                           | `src/components/processes/` **se usado por diferentes features**                | Representação de domínio compartilhada      |
| `ProcessList`, `ProcessCard`, `ProcessFilters` | `src/features/processes/components/`                                            | Fazem parte da experiência de Processos     |
| `DashboardStats`, `DashboardProcessSummary`    | `src/features/dashboard/components/`                                            | Específicos da visão geral                  |
| `LoginForm`                                    | `src/features/auth/components/`                                                 | Específico de autenticação                  |
| `UserTable`                                    | `src/features/users/components/`                                                | Específico da área Usuários                 |
| `Sidebar` / shell autenticado                  | Caminho atual em `components/layout/` ou `src/layouts/`, conforme implementação | Estrutura global; não mover silenciosamente |
| Componente da página de rota                   | `src/pages/`                                                                    | Liga navegação, layout e feature            |

**Caso importante:** Lista e Cards são duas visualizações da mesma feature. Isso, por si só, não obriga que seus componentes compartilhados subam para `src/components/`. Se `ProcessActions`, `ProcessPort` e `ProcessStatusBadge` também forem usados pela visão geral, avalie uma API compartilhada estável para não duplicar comportamento.

## Responsabilidades

### Componentes de apresentação

- Recebem dados, estados e callbacks por props.
- Não executam chamadas HTTP diretamente, salvo exceção existente explicitamente justificada.
- Não conhecem detalhes de autenticação, token ou configuração Axios.
- Contêm semântica HTML, acessibilidade, foco e layout.
- Consomem **tokens semânticos**, conforme `styling.md`.

### Componentes de feature

- Podem conhecer termos e tipos do domínio.
- Podem compor componentes compartilhados.
- Devem manter efeitos e buscas em hooks/serviços quando a complexidade justificar.
- Não exportam detalhes internos para outras features sem decisão arquitetural.

## Exemplo de um componente reutilizável

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  loading?: boolean;
};

export function ActionButton({
  children,
  loading = false,
  disabled,
  ...props
}: ActionButtonProps) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`bg-action text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}
```

Este é **um exemplo didático, não um arquivo obrigatório**. Antes de criá-lo, procure um botão existente. Para produção, preserve seu indicador de loading, estilos e comportamento atual; não introduza uma segunda biblioteca de componentes para resolver o mesmo problema.

## Regras de organização e nomenclatura

- Componentes React e arquivos correspondentes: `PascalCase.tsx`, seguindo a convenção predominante já existente.
- Props tipadas em TypeScript; evite `any` e propriedades excessivas que misturem cenários incompatíveis.
- Nomeie por função (`ProcessCard`, `StatusBadge`), não por posição ou aparência temporária (`BlueBoxLeft`).
- Prefira composição (`children`, slots, subcomponentes) a condicionais extensas por dezenas de flags.
- Não crie componentes para um único `div` sem semântica ou comportamento reutilizável.
- Preserve estados de loading, vazio, erro, disabled e foco acessível.
- Utilize componentes de status/ação consistentes entre Lista e Cards para evitar divergências funcionais.
- Evite criar um `index.ts` com exportações automáticas se causar dependência circular.

## Checklist da IA antes de criar um componente

- [ ] Verifiquei se há componente equivalente no repositório.
- [ ] Identifiquei a **feature proprietária** e os locais reais de uso.
- [ ] Escolhi componente local ou global pela reutilização efetiva.
- [ ] Separei efeitos de rede e regras complexas da apresentação, quando pertinente.
- [ ] Usei tokens semânticos e comportamentos acessíveis.
- [ ] Não dupliquei status, portas e ações entre Lista e Cards.
- [ ] Mantive a API pequena e adicionei/atualizei testes quando cabível.
