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

**Configuração do projeto → Excluir projeto** primeiro consulta os processos vinculados e exige digitar o nome para confirmar. Remove permanentemente o documento do projeto, seus registros `project_builds` e `VERSIONS_DIR/projects/<projectId>`. A pasta principal da aplicação é preservada. A opção **Encerrar também os processos vinculados** começa desmarcada; se selecionada, executa `pm2 stop` e salva a lista, mantendo os processos registrados no PM2. Se houver falha ao parar, o cadastro não é excluído; confira processos que já possam ter sido parados antes de tentar novamente.

O vínculo explícito salvo em `process_projects` prevalece. Sem escolha explícita, o vínculo é determinado pelo script ou diretório de execução dentro da pasta principal atual do projeto. A prévia usa a mesma associação exibida na Home, incluindo processos vinculados manualmente fora da pasta; escolher Sem projeto impede a associação automática. A prévia retorna processos e uma revisão baseada nas identidades e caminhos. Antes de parar cada processo, o backend verifica novamente a revisão; alterações exigem abrir uma nova confirmação. Projetos com builds também exigem uma consulta bem-sucedida às referências atuais e salvas do PM2; se algum processo usa a pasta dos artefatos armazenados, a exclusão é recusada mesmo que ele esteja parado. Links e junctions no caminho de armazenamento também são recusados.

Edição, exclusão e publicação compartilham um bloqueio por projeto. Cadastro e edição também compartilham um bloqueio de configuração para validar nomes e pastas sem sobreposição concorrente. A limpeza automática não executa durante essas alterações. Projetos com recuperação de publicação pendente precisam ser recuperados antes de editar ou excluir.

Antes de apagar artefatos, o registro recebe `deleting=true`. Se a operação falhar ou for interrompida, esse estado impede novas publicações e edições; o projeto permanece na lista para tentar **Excluir projeto** novamente após corrigir o problema. A limpeza automática preserva esse registro até concluir a exclusão. Os registros de auditoria permanecem no histórico de logs.

## Documentação e variáveis de ambiente

**Sobre o projeto** é um editor de documentação separado das configurações operacionais. O campo opcional `documentation` é salvo no MongoDB, aceita até 32 KB em UTF-8 e não altera README ou outros arquivos na VM. A prévia suporta títulos, listas simples, negrito, código e links HTTP(S) para diagramas; HTML é mostrado como texto. Não há renderização ou editor de diagramas. Omitir `documentation` no cadastro/edição mantém compatibilidade; na edição preserva o valor anterior, e uma string vazia remove o conteúdo.

**Variáveis de ambiente** reúne a configuração PM2 e o editor de arquivos `.env` ou `.env.*` da raiz, incluindo `.env.production`. O editor preserva comentários e formatação, aceita texto UTF-8 de até 32 KB e permite criar arquivos ausentes. Não interpreta, executa ou aplica variáveis ao processo: salvar não reinicia o PM2. Nomes não podem conter diretórios; links e junções são recusados. Uma revisão SHA-256 detecta alterações desde a abertura e retorna 409 sem sobrescrever; o rascunho permanece na tela para cópia e reconciliação. Salvamentos compartilham o bloqueio de publicação, edição e exclusão do projeto, e bloqueiam a navegação durante o envio.

Arquivos `.env` seguem as regras gerais dos pacotes: se nunca fizeram parte de builds, permanecem locais; se incluídos em um pacote, podem ser substituídos ou removidos por publicações posteriores. A proteção especial contra sobrescrita aplica-se ao ecosystem configurado.

## Arquivos locais

A navegação consulta a pasta cadastrada no mesmo servidor que executa o monitor. Mostra diretórios, tamanho, data, prévia de texto e download. A prévia tem limite de 256 KB e diretórios exibem até 2.000 entradas; a interface informa truncamento. Binários ficam disponíveis para download. Conteúdo é exibido como texto, sem executar HTML ou scripts.

A pasta deve ser dedicada à aplicação: não pode se sobrepor à de outro projeto, ao monitor, ao armazenamento de builds, ao PM2 ou às pastas protegidas do sistema. Caminhos que escapem da raiz, links simbólicos e junctions são recusados. A conta Windows do monitor precisa de permissão de leitura e gravação. Usuários autenticados podem operar projetos e processos; o gerenciamento de usuários é exclusivo de administradores.

## Publicação

1. O usuário informa um nome de até 80 caracteres (letras, números, ponto, hífen ou sublinhado), comentário obrigatório de até 4.000 caracteres e pacote.
2. O backend preserva o original e seu hash, extrai em armazenamento separado e valida os arquivos antes de alterar a aplicação.
3. O ecosystem existente no destino configurado (`rootPath` + `pm2ConfigPath`) tem prioridade e nunca é substituído por pacotes ou configurações salvas. Na ausência do arquivo local, usa-se o ecosystem armazenado no build; se também estiver ausente, gera-se uma cópia da configuração salva no projeto. Se houver uma pasta externa envolvendo o pacote, ela é removida do caminho de publicação quando o ecosystem encontrado permite identificá-la sem ambiguidade. Prefira empacotar diretamente o conteúdo da raiz do projeto; sem ecosystem no pacote, o sistema mantém sua estrutura.
4. Uma cópia dos arquivos afetados e um registro de recuperação são gravados antes de aplicar os arquivos. Arquivos pertencentes ao build ativo e ausentes no novo pacote são removidos; os demais arquivos locais são preservados. O ecosystem local fica fora da cópia, remoção, manifesto novo e recuperação da tentativa, mesmo que esteja em manifestos antigos ou no pacote. Seu conteúdo e data de modificação são mantidos. Quando o arquivo ainda não existe, sua instalação participa do manifesto e da recuperação; uma falha remove o arquivo recém-instalado. Mudanças de estrutura entre arquivo e diretório no mesmo caminho são recusadas antes da aplicação.
5. O backend executa o ecosystem no destino cadastrado e atualiza o histórico e o build ativo. Publicações simultâneas no mesmo projeto são recusadas. Execute uma única instância do backend; o bloqueio de operações é local ao processo.

Se o `manifest.json` do build ativo estiver ausente, inclusive quando sua pasta de artefatos tiver sido removida ou o armazenamento tiver mudado, a publicação continua sem remover arquivos antigos ausentes do novo pacote. O backend não reconstrói a lista a partir da pasta instalada ou da extração, pois elas não comprovam quais arquivos foram gerenciados. O log da publicação registra a preservação conservadora; após sucesso, o novo build recebe seu próprio manifesto e passa a definir as remoções nas publicações seguintes. Falhas continuam restaurando os arquivos substituídos pela tentativa. Manifestos inválidos e erros de acesso não são tratados como ausência: bloqueiam a publicação com diagnóstico, antes de modificar os arquivos da aplicação.

Estados: `processing` (extração), `ready`, `deploying`, `deployed` ou `failed`. Após uma falha, o histórico mantém o erro e, quando disponíveis, o pacote e a extração. Builds extraídos podem ser republicados; não é necessário reenviar o mesmo pacote. O botão de publicação de uma versão anterior aplica novamente seus arquivos, preserva o ecosystem local e o executa no destino. A versão antiga inicializa o ecosystem apenas quando não existe no destino.

Os pacotes aceitos são ZIP, RAR, 7z e TAR, incluindo TAR com Gzip, Bzip2 ou XZ e os aliases indicados no formulário. Pacotes com senha, volumes divididos ou métodos de compressão não suportados são recusados. Os limites `UPLOAD_MAX_MB`, `EXTRACTED_MAX_MB`, 50 mil entradas e tempo máximo de extração continuam valendo. O pacote deve estar pronto para execução: o monitor não compila código nem instala dependências.

Se a aplicação dos arquivos ou a execução PM2 falhar, o monitor tenta restaurar os arquivos anteriores. Se o serviço for interrompido, faz essa recuperação na próxima inicialização, antes de aceitar requisições. Uma recuperação incompleta bloqueia novas publicações naquele projeto até corrigir o acesso aos arquivos e reiniciar o monitor. A restauração é dos arquivos: operações parciais já executadas no PM2 e efeitos externos da aplicação não são revertidos automaticamente. Confira os processos e a saúde da aplicação após uma falha.

## Armazenamento e compatibilidade

### Configuração PM2 persistente

O campo opcional `pm2ConfigContent` em `projects` guarda o conteúdo CommonJS do ecosystem. A aba **Variáveis de ambiente** verifica o arquivo local pela API de arquivos: se existir, mostra seu conteúdo somente para leitura; se estiver ausente (404), habilita o editor da configuração salva. Falhas de acesso não são tratadas como ausência. Aceita até 16 KB em UTF-8; a API compila apenas a sintaxe, sem executar código ao salvar. A validação de processos e scripts ocorre no worker PM2 durante a publicação. Omitir o campo em um `PUT` preserva seu valor; enviar uma string vazia desativa esse recurso para futuras inicializações. A publicação sempre verifica novamente a existência do arquivo local.

Se nem a pasta do projeto nem o build contêm o arquivo configurado, a primeira publicação que utiliza `pm2ConfigContent` grava uma cópia em `source/<pm2ConfigPath>`. Essa cópia pode inicializar um destino sem ecosystem em republicações futuras, mas nunca substitui um arquivo local existente. Não altera o ZIP original nem seu hash. Um build que já falhou por falta de ecosystem pode receber essa cópia ao tentar publicar novamente depois de configurar o projeto.

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

Pacotes, extrações, históricos e cópias de recuperação são preservados por padrão. A limpeza opcional de **Configurações** remove builds vencidos conforme o prazo em dias contado de `createdAt` (envio), sem reiniciar a idade na republicação. A opção começa desabilitada e o backend verifica os vencimentos a cada minuto, preservando o build ativo, referências do PM2 e projetos com recuperação pendente. Ela também se aplica aos uploads avulsos; nunca remove a pasta principal da aplicação. Dimensione o disco e faça backup do MongoDB, de `VERSIONS_DIR` e das pastas das aplicações. A interface de uploads avulsos e a tela global de builds foram removidas; novos envios pelo painel exigem abrir um projeto. Os registros e artefatos legados não são apagados nesta mudança, e a API legada permanece por compatibilidade. Não há associação automática desses registros a projetos.

## API autenticada

- `PUT /api/projects/:id`: substitui nome, descrição, pasta principal e configuração do ecosystem; retorna o projeto atualizado. `name` e `rootPath` são obrigatórios, `description` e `pm2ConfigPath` seguem os padrões do cadastro. `pm2ConfigContent` é opcional no cadastro e na edição; sua omissão na edição preserva o conteúdo anterior.
- `documentation` é opcional no POST/PUT do projeto; aceita texto UTF-8 de até 32 KB e sua omissão no PUT preserva o conteúdo anterior.
- `GET /api/projects/:id/environment-files/:name`: lê `.env` ou `.env.*` na raiz. Retorna `{ name, content, revision, names }`, com nomes de arquivos disponíveis e hash SHA-256 como revisão. Arquivo ausente retorna conteúdo vazio e `revision: null`, permitindo criação explícita.
- `PUT /api/projects/:id/environment-files/:name`: recebe `{ content, revision }` e retorna `{ name, content, revision }`. Exige a revisão lida ou `null` para criação; conflito, operação concorrente ou recuperação pendente retornam 409. Grava por arquivo temporário e renomeação, sem executar PM2. Usa a autenticação de projetos; a auditoria não grava o conteúdo.
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

## Associação de processos

Na Home, a coluna Projeto e o campo equivalente dos Cards mostram o projeto associado ou **Sem projeto**. **Vincular projeto / Alterar vínculo** permite selecionar qualquer projeto disponível ou remover a associação. A escolha é compartilhada entre usuários e instâncias cluster com o mesmo nome e namespace no mesmo PM2_HOME, persistindo após troca de ID. Não muda diretório, ecosystem ou estado do processo. Projetos publicados são reconhecidos pela pasta quando não existe uma escolha explícita.

Excluir um projeto limpa suas associações explícitas, preservando registros sem vínculo para impedir reassociação indevida por pasta. A exclusão sem a opção de encerramento conserva os processos no PM2. Edição, exclusão e alteração de vínculo compartilham o bloqueio de configuração para impedir referências a um projeto excluído durante o salvamento.
