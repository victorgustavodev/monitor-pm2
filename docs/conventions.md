# Convenções de desenvolvimento

## Regra geral

Mantenha o padrão existente sempre que ele for consistente e funcional. Estas convenções orientam **novas alterações**; não justificam uma reorganização global não solicitada.

## Linguagem e organização

- O frontend usa **React + TypeScript**, conforme `App.tsx` e arquivos apresentados.
- Componentes: nome e arquivo em `PascalCase.tsx`, respeitando os nomes já existentes.
- Hooks: prefixo `use` (`useProcesses.ts`, `useDebounce.ts`), com escopo local ou global conforme reutilização.
- Serviços e utilitários: nomes descritivos; preserve convenções de sufixo já usadas (`*.service.ts` etc.).
- Tipos: `interface`/`type` claros, próximos ao código que os usa ou em `types/` da feature se compartilhados.
- Constantes: nomes que expressem propósito; configuração global em `config/` quando apropriado.
- Imports: prefira caminhos e aliases **realmente configurados**; não invente `@/` ou novos aliases.
- Exports: use padrão já adotado na área; prefira APIs explícitas em vez de barrels globais sem critério.

## Responsabilidade única

- **Página**: ponto de entrada, composição e roteamento; pouca lógica de negócio.
- **Feature**: experiência funcional e regras próprias, incluindo serviços e hooks quando necessários.
- **Componente compartilhado**: apresentação/comportamento reutilizável entre funcionalidades.
- **Hook**: encapsula lógica React e efeitos, não apenas um wrapper sem necessidade.
- **Serviço**: comunicação ou adaptação de um contrato externo, sem construir UI.
- **Utilitário**: função genérica, preferencialmente pura e testável.
- **Context**: estado compartilhado quando o alcance justificar; não usar como substituto automático de props.

## Código e manutenção

1. Pesquise implementações semelhantes antes de criar arquivos.
2. Evite `any`, casts inseguros e `// @ts-ignore` como atalhos.
3. Não crie abstrações ou pastas apenas para acomodar um caso trivial.
4. Preserve a separação entre estado remoto, estado local, apresentação e persistência.
5. Limpe efeitos, subscriptions, timers e listeners quando aplicável.
6. Evite operações sem tratamento de falha e feedback ao usuário.
7. Não modifique APIs públicas nem permissões silenciosamente.
8. Não faça renomeação ou movimentação massiva no contexto de uma correção pontual.
9. Mantenha documentação e testes alinhados às mudanças relevantes.

## Acessibilidade e UX

- Use semântica HTML apropriada, labels de formulário, estados `disabled` e feedback textual.
- Preserve navegação por teclado, ordem de foco e link “Ir para o conteúdo”.
- Estados (processo online/offline/erro, sucesso/atenção/destrutivo) devem ser identificáveis além da cor.
- Botões destrutivos devem evitar disparos acidentais e feedback ambíguo.
- Em atualizações periódicas, não provoque perda de foco, campos resetados ou re-renderização intrusiva sem necessidade.

## CSS e design

- Consumir `src/styles/tokens.css` por aliases semânticos e classes Tailwind correspondentes.
- Evitar cores literais em JSX/CSS de componentes.
- Não recriar a paleta da marca em CSS local.
- Respeitar os layouts e breakpoint de navegação de 768 px já descritos.
- Antes de modificar sidebar, Processos ou Dashboard, consultar `styling.md` e `architecture.md`.

## Testes e validação

- Testes de funções puras: validar casos normais, bordas e falhas.
- Testes de componentes/fluxos: verificar renderização, acessibilidade, loading, erro, disabled e interação.
- Testes de integração (quando infraestrutura existente permitir): garantir contratos de hooks/serviços e ações.
- Para uma mudança na visualização Lista / Cards: verificar mesma busca/filtro, estado de ações e persistência/fallback.
- Execute scripts **presentes** no `package.json` relevante (por exemplo, lint, test, typecheck, build) e relate limitações; não assuma nomes de scripts.
- O arquivo `setupTests.ts` está presente na árvore enviada, mas confirme o framework e a configuração reais antes de escrever testes.

## Checklist de entrega para a IA

- [ ] Entendi a intenção e identifiquei os arquivos afetados.
- [ ] Li `AGENTS.md` e a documentação da área afetada.
- [ ] Respeitei a localização de componentes e o design system.
- [ ] Reaproveitei serviços/instâncias/configurações existentes.
- [ ] Não introduzi dependências ou migrações desnecessárias.
- [ ] Verifiquei estados, acessibilidade e responsividade.
- [ ] Validei com ferramentas disponíveis e reportei o resultado.
- [ ] Atualizei documentação relevante se introduzi uma nova convenção.

## Mapa de documentos

- `architecture.md`: estrutura e limites entre camadas.
- `components.md`: decidir componente global vs. local.
- `styling.md`: tokens KPMG e padrões de layout.
- `state-management.md`: escopo de estado, polling e persistência.
- `api-integration.md`: cliente HTTP, serviços e PM2.
