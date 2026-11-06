# Projetos e publicação de builds

## Modelo de dados

O relacionamento é **um projeto para muitos builds**, com duas coleções MongoDB:

| Coleção          | Campos principais                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`       | `name`, `description`, `rootPath`, `pm2ConfigPath`, `createdBy`, datas, `nextBuildNumber`, `activeBuildId`                                  |
| `project_builds` | `projectId`, `name`, `number`, `comments`, `createdBy`, `createdAt`, `originalName`, `size`, `sha256`, `status`, `deployedBy`, `deployedAt` |

`rootPath` é a pasta absoluta da aplicação na VM. `pm2ConfigPath` é relativo a ela, por exemplo `ecosystem.config.js` ou `config/ecosystem.config.js`. A API retorna `pathToRunPm2` calculado a partir dos dois campos. O nome do projeto é único; o nome do build é único dentro do projeto, sem distinguir maiúsculas de minúsculas. O número cresce por projeto e pode ter lacunas após falhas.

O histórico é paginado em grupos de 20 e não é incorporado ao documento do projeto. `activeBuildId` aponta para a última publicação concluída, enquanto o status de um build indica o resultado de sua última tentativa. Isso não equivale ao estado atual dos processos PM2. `createdBy` e `deployedBy` vêm da sessão, nunca de campos enviados pelo cliente.

## Edição e exclusão

**Editar projeto** abre a configuração com nome, descrição, pasta principal e caminho relativo do ecosystem. A atualização mantém ID, autoria original e histórico; registra `updatedBy` e `updatedAt`. Nome e pasta passam pelas mesmas verificações do cadastro, desconsiderando o próprio projeto ao procurar duplicatas e sobreposição.

Alterar `rootPath` cria a nova pasta se necessário, sem mover ou apagar arquivos da anterior e sem executar PM2. O `activeBuildId` é removido porque o manifesto anterior descreve arquivos de outro destino. As próximas publicações começam a gerenciar arquivos na nova pasta; versões anteriores continuam no histórico e podem ser republicadas.

**Sobre o projeto → Excluir projeto** primeiro consulta os processos vinculados e exige digitar o nome para confirmar. Remove permanentemente o documento do projeto, seus registros `project_builds` e `VERSIONS_DIR/projects/<projectId>`. A pasta principal da aplicação é preservada. A opção **Encerrar também os processos vinculados** começa desmarcada; se selecionada, executa `pm2 stop` e salva a lista, mantendo os processos registrados no PM2. Se houver falha ao parar, o cadastro não é excluído; confira processos que já possam ter sido parados antes de tentar novamente.

O vínculo é determinado pelo script ou diretório de execução dentro da pasta principal atual do projeto, sem usar apenas o nome do processo. A prévia retorna processos e uma revisão baseada nas identidades e caminhos. Antes de parar cada processo, o backend verifica novamente a revisão; alterações exigem abrir uma nova confirmação. Projetos com builds também exigem uma consulta bem-sucedida às referências atuais e salvas do PM2; se algum processo usa a pasta dos artefatos armazenados, a exclusão é recusada mesmo que ele esteja parado. Links e junctions no caminho de armazenamento também são recusados.

Edição, exclusão e publicação compartilham um bloqueio por projeto. Cadastro e edição também compartilham um bloqueio de configuração para validar nomes e pastas sem sobreposição concorrente. A limpeza automática não executa durante essas alterações. Projetos com recuperação de publicação pendente precisam ser recuperados antes de editar ou excluir.

Antes de apagar artefatos, o registro recebe `deleting=true`. Se a operação falhar ou for interrompida, esse estado impede novas publicações e edições; o projeto permanece na lista para tentar **Excluir projeto** novamente após corrigir o problema. A limpeza automática preserva esse registro até concluir a exclusão. Os registros de auditoria permanecem no histórico de logs.

## Arquivos locais

A navegação consulta a pasta cadastrada no mesmo servidor que executa o monitor. Mostra diretórios, tamanho, data, prévia de texto e download. A prévia tem limite de 256 KB e diretórios exibem até 2.000 entradas; a interface informa truncamento. Binários ficam disponíveis para download. Conteúdo é exibido como texto, sem executar HTML ou scripts.

A pasta deve ser dedicada à aplicação: não pode se sobrepor à de outro projeto, ao monitor, ao armazenamento de builds, ao PM2 ou às pastas protegidas do sistema. Caminhos que escapem da raiz, links simbólicos e junctions são recusados. A conta Windows do monitor precisa de permissão de leitura e gravação. Usuários autenticados podem operar projetos e processos; o gerenciamento de usuários é exclusivo de administradores.

## Publicação

1. O usuário informa um nome de até 80 caracteres (letras, números, ponto, hífen ou sublinhado), comentário obrigatório de até 4.000 caracteres e pacote.
2. O backend preserva o original e seu hash, extrai em armazenamento separado e valida os arquivos antes de alterar a aplicação.
3. O ecosystem pode vir no pacote, ser gerado da configuração salva no projeto ou já existir na pasta principal, nessa ordem de prioridade. Se houver uma pasta externa envolvendo o pacote, ela é removida do caminho de publicação quando o ecosystem encontrado permite identificá-la sem ambiguidade. Prefira empacotar diretamente o conteúdo da raiz do projeto; sem ecosystem no pacote, o sistema mantém sua estrutura.
4. Uma cópia dos arquivos afetados e um registro de recuperação são gravados antes de aplicar os arquivos. Arquivos pertencentes ao build ativo e ausentes no novo pacote são removidos; os demais arquivos locais são preservados. O ecosystem existente é preservado quando não há um arquivo no pacote nem uma configuração salva. O ecosystem gerado da configuração salva faz parte do manifesto e da recuperação do build. Mudanças de estrutura entre arquivo e diretório no mesmo caminho são recusadas antes da aplicação.
5. O backend executa o ecosystem no destino cadastrado e atualiza o histórico e o build ativo. Publicações simultâneas no mesmo projeto são recusadas. Execute uma única instância do backend; o bloqueio de operações é local ao processo.

Estados: `processing` (extração), `ready`, `deploying`, `deployed` ou `failed`. Após uma falha, o histórico mantém o erro e, quando disponíveis, o pacote e a extração. Builds extraídos podem ser republicados; não é necessário reenviar o mesmo pacote. O botão de publicação de uma versão anterior aplica novamente seus arquivos e executa seu ecosystem.

Os pacotes aceitos são ZIP, RAR, 7z e TAR, incluindo TAR com Gzip, Bzip2 ou XZ e os aliases indicados no formulário. Pacotes com senha, volumes divididos ou métodos de compressão não suportados são recusados. Os limites `UPLOAD_MAX_MB`, `EXTRACTED_MAX_MB`, 50 mil entradas e tempo máximo de extração continuam valendo. O pacote deve estar pronto para execução: o monitor não compila código nem instala dependências.

Se a aplicação dos arquivos ou a execução PM2 falhar, o monitor tenta restaurar os arquivos anteriores. Se o serviço for interrompido, faz essa recuperação na próxima inicialização, antes de aceitar requisições. Uma recuperação incompleta bloqueia novas publicações naquele projeto até corrigir o acesso aos arquivos e reiniciar o monitor. A restauração é dos arquivos: operações parciais já executadas no PM2 e efeitos externos da aplicação não são revertidos automaticamente. Confira os processos e a saúde da aplicação após uma falha.

## Armazenamento e compatibilidade

### Configuração PM2 persistente

O campo opcional `pm2ConfigContent` em `projects` guarda o conteúdo CommonJS do ecosystem, editável no cadastro e em **Editar projeto**. Aceita até 16 KB em UTF-8; a API compila apenas a sintaxe, sem executar código ao salvar. A validação de processos e scripts ocorre no worker PM2 durante a publicação. Omitir o campo em um `PUT` preserva seu valor; enviar uma string vazia desativa esse recurso para futuros builds.

Se o build não contém o arquivo configurado, a primeira publicação que utiliza `pm2ConfigContent` grava uma cópia em `source/<pm2ConfigPath>`. Isso permite republicar o build com aquela configuração mesmo após editar o conteúdo salvo no projeto. Não altera o ZIP original nem seu hash. O arquivo gerado é aplicado junto com os outros arquivos e restaurado com eles em caso de falha. Um build que já falhou por falta de ecosystem pode receber essa cópia ao tentar publicar novamente depois de configurar o projeto.

O script precisa corresponder aos arquivos extraídos e é relativo à pasta do ecosystem. Para `ecosystem.config.js` na raiz, use `./dist/main.js` se o pacote contém `dist/main.js`, ou `./main.js` se contém o arquivo na raiz. Se o ecosystem fica em `config/`, ajuste o script para essa localização, como `../dist/main.js`. O monitor não deduz o ponto de entrada nem instala dependências.

```text
versions/projects/<projectId>/<buildId>/
  build.zip                  # Extensão original preservada
  source/                    # Conteúdo extraído, usado para republicação
  manifest.json              # Arquivos gerenciados pela publicação
  deployments/<attemptId>/
    journal.json             # Registro de recuperação
    backup/                  # Arquivos anteriores afetados
```

Pacotes, extrações, históricos e cópias de recuperação são preservados por padrão. A limpeza opcional de **Configurações** remove builds antigos conforme o prazo de retenção, preservando o build ativo, referências do PM2 e projetos com recuperação pendente. Ela também se aplica aos uploads avulsos; nunca remove a pasta principal da aplicação. Dimensione o disco e faça backup do MongoDB, de `VERSIONS_DIR` e das pastas das aplicações. Os uploads antigos continuam em **Builds → Uploads avulsos**, usando seu armazenamento e fluxo anteriores. Não há associação automática desses registros a pastas de projetos.

## API autenticada

- `PUT /api/projects/:id`: substitui nome, descrição, pasta principal e configuração do ecosystem; retorna o projeto atualizado. `name` e `rootPath` são obrigatórios, `description` e `pm2ConfigPath` seguem os padrões do cadastro. `pm2ConfigContent` é opcional no cadastro e na edição; sua omissão na edição preserva o conteúdo anterior.
- `GET /api/projects/:id/deletion-preview`: retorna `{ processes: [{ id, name, status }], revision }` para a confirmação, sem expor caminhos internos.
- `DELETE /api/projects/:id`: exclui cadastro, builds e artefatos; responde `204`. Preserva a pasta publicada. Corpo opcional `{ stopProcesses: true, processRevision: "..." }` para parar os processos da prévia. Sem essa opção, mantém o estado dos processos. Revisão desatualizada, operações concorrentes, recuperação pendente e referências PM2 aos artefatos retornam `409`; falha ao consultar PM2 retorna `502`.

| Método e rota                                   | Contrato                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /api/projects`                             | Lista projetos, contagem de builds e build ativo                                                          |
| `POST /api/projects`                            | JSON: `name`, `description` opcional, `rootPath`, `pm2ConfigPath` opcional (padrão `ecosystem.config.js`) |
| `GET /api/projects/:id`                         | Dados de um projeto                                                                                       |
| `GET /api/projects/:id/files?path=...`          | Diretório ou prévia; caminho vazio representa a raiz                                                      |
| `GET /api/projects/:id/files/download?path=...` | Download de um arquivo                                                                                    |
| `GET /api/projects/:id/builds?page=1`           | Histórico do projeto: `{ items, total, page, pageSize }`                                                  |
| `GET /api/builds?projectId=...&page=1`          | Histórico global; filtro de projeto opcional                                                              |
| `POST /api/projects/:id/builds`                 | Multipart: `name`, `comments`, arquivo `build`; salva e publica antes de responder                        |
| `POST /api/projects/:id/builds/:buildId/deploy` | Republica build existente                                                                                 |
| `GET /api/projects/:id/builds/:buildId/archive` | Baixa pacote original                                                                                     |

Uploads e publicações podem demorar; configure o timeout do proxy de acordo com o tamanho dos pacotes. A conexão SSE existente continua atualizando processos e métricas. Listas de projetos, arquivos e builds são consultadas ao abrir a tela, após ações ou pelo botão de atualização; não fazem polling a cada 10 segundos.
