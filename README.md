# ati-dev-cockpit para Windows

Painel web inspirado no Portainer para visualizar e operar processos do PM2 em uma VM Windows. O frontend React/Tailwind e a API Express são publicados juntos na porta `4170`.

## Funcionalidades

- lista status, PID, CPU, memória, uptime e reinícios;
- inicia, para, reinicia e remove processos;
- exibe as últimas linhas de log;
- autenticação sem banco usando credenciais em variáveis de ambiente;
- sessão JWT em cookie `HttpOnly` com duração de 8 horas;
- bloqueio por allowlist CIDR da VPN na própria API;
- tarefa agendada do Windows com reinício automático;
- regra opcional do Firewall do Windows restrita à rede VPN.

## Instalação

Requisitos: Node.js 22+, npm, PM2 instalado globalmente e PowerShell 5.1+.

```powershell
npm.cmd install
Copy-Item .env.example .env
# Edite .env e troque usuário, senha, JWT_SECRET e VPN_ALLOWED_CIDRS
npm.cmd run build
npm.cmd run start:prod
```

Abra `http://IP-DA-VM:4170`. Para desenvolvimento, use `npm.cmd run dev` (frontend em `5173`, com proxy para a API).

O backend inclui o PM2 como dependência local e usa o mesmo daemon/`PM2_HOME` da conta Windows. Para usar outra instalação, sobrescreva o script:

```dotenv
PM2_SCRIPT=C:\Users\usuario\AppData\Roaming\npm\node_modules\pm2\bin\pm2
```

Gere um segredo com pelo menos 32 bytes, por exemplo:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

## Inicialização automática

O PM2 mantém estado por usuário. Instale a tarefa usando a **mesma conta Windows que executa os quatro aplicativos PM2**, em PowerShell elevado:

```powershell
.\scripts\install-scheduled-task.ps1
Start-ScheduledTask -TaskName 'ati-dev-cockpit'
```

O instalador pede a credencial interativamente; a senha não é gravada em arquivos do projeto. Logs do painel ficam em `runtime/`.

Se os aplicativos PM2 também precisam ressurgir após reinicialização, salve a lista com `pm2 save` e configure a estratégia de startup do daemon para essa mesma conta.

## Restrição à VPN

Defina as redes reais no `.env`, sem usar `*` em produção:

```dotenv
VPN_ALLOWED_CIDRS=10.20.0.0/16,127.0.0.1/32,::1/128
```

Adicione também defesa no Firewall do Windows (PowerShell elevado):

```powershell
.\scripts\configure-firewall.ps1 -VpnRemoteAddress '10.20.0.0/16'
```

Use HTTPS em produção (IIS, Caddy ou outro proxy interno) e então configure `COOKIE_SECURE=true`. Caso haja proxy reverso, mantenha a regra de firewall apontando para a faixa da VPN e não exponha a porta diretamente à internet.

## API

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/processes`
- `POST /api/processes/:id/start|stop|restart|delete`
- `GET /api/processes/:id/logs?lines=150`
- `GET /api/health`

Os comandos usam `execFile` com argumentos separados e validam o ID contra a lista do PM2 antes da operação, evitando interpolação de comandos do shell.
