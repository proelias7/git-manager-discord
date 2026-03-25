# Git Manager Discord

<div align="center">
  
![License](https://img.shields.io/github/license/proelias7/git-manager-discord)
![Node](https://img.shields.io/badge/Node.js-16.x+-339933?logo=node.js&logoColor=white)
![Discord](https://img.shields.io/badge/Discord-Bot-5865F2?logo=discord&logoColor=white)
![Git](https://img.shields.io/badge/Git-F05032?logo=git&logoColor=white)

</div>

Um bot do Discord que permite gerenciar repositórios Git remotamente através de slash commands e interfaces interativas. Gerencie seus repositórios, submódulos e execute operações Git comuns como pull, commit e push diretamente pelo Discord.

<div align="center">
  <img src="https://git-scm.com/images/logos/downloads/Git-Icon-1788C.png" alt="Git Logo" width="200">
</div>

## ✨ Funcionalidades

- 📋 Listar repositórios Git e submódulos disponíveis
- 👁️ Visualizar status detalhado dos repositórios (branch atual, modificações, HEAD destacada, etc.)
- 🔄 Executar Git Pull para atualizar repositórios
- 📦 Inicializar e atualizar submódulos Git
- 🛠️ Corrigir submódulos com HEAD destacada (detached HEAD)
- 📤 Adicionar, commitar alterações e fazer push com uma interface de modal interativa
- 🔁 Atualizar todos os repositórios com uma única ação
- 🚨 Suporte a modos de pull: normal, com stash e force
- 🔐 **Permissões por repositório**: cargo de administrador Git (`GIT_ADMIN_ROLE_ID`) com acesso total; outros utilizadores só nos repositórios em que forem autorizados; gestão pelo painel **Gerir acessos** (lista em `data/repoUserAccess.json`)
- ⏱️ **Pull antes do reinício** (opcional): agendamento com `RESTART_SCHEDULE` e políticas em `data/repoPolicy.json` para filas e caminhos só no horário de reinício
- 🔗 **Webhook GitHub/GitLab**: Pull automático quando commits contêm `@pull` na mensagem
- 📡 **Servidor Webhook**: Endpoint HTTP para receber webhooks do GitHub
- 🔔 **Notificações Discord**: Receba notificações de pulls automáticos em um canal específico

## 🔧 Pré-requisitos

- Node.js 16.x ou superior
- Um aplicativo Discord registrado com um bot
- Permissões mínimas no servidor para o bot (mensagens, comandos slash, embeds, etc. — ver secção abaixo)
- **Quem pode usar o painel:** definido por `GIT_ADMIN_ROLE_ID` e pela lista por repositório; ou, em bootstrap, **Administrador** do Discord quando ainda não há utilizadores no repositório principal (ver `GIT_ADMIN_ROLE_ID` no `.env.example`)
- Acesso de leitura/escrita aos repositórios Git no diretório configurado em `GIT_BASE_PATH`

## 🚀 Instalação

1. Clone este repositório:
   ```bash
   git clone https://github.com/proelias7/git-manager-discord.git
   cd git-manager-discord
   ```

2. **Windows**: Execute `install.bat` (verifica Node.js e cria o arquivo `start.bat`)
   
   **Linux/Mac**: Instale as dependências manualmente:
   ```bash
   npm install
   ```

3. Configure o arquivo `.env` com suas credenciais (use o [`.env.example`](.env.example) como referência completa):
   ```env
   # Configuração básica do bot
   BOT_TOKEN=seu_token_aqui
   CLIENT_ID=seu_client_id_aqui
   GIT_BASE_PATH=caminho/para/seus/repositorios
   GUILD_ID=id_do_servidor_aqui

   # Permissões Discord (painel Git) — ver comentários no .env.example
   GIT_ADMIN_ROLE_ID=id_do_cargo_admin_git

   # Webhook GitHub/GitLab (opcional)
   ENABLE_GITHUB_WEBHOOK=false
   WEBHOOK_PORT=3001
   WEBHOOK_SECRET=
   DISCORD_WEBHOOK_CHANNEL_ID=
   AUTO_REPO_MAPPING=true

   # Pull agendado antes do reinício (opcional)
   RESTART_SCHEDULE_ENABLED=true
   RESTART_SCHEDULE=
   RESTART_PULL_LEAD_MINUTES=2

   # Deploy automático dos comandos slash ao iniciar o bot
   AUTO_DEPLOY_COMMANDS=true
   ```

4. Registre os comandos slash no Discord:
   ```bash
   npm run deploy-commands
   ```
   > **Observação**: Pode levar até uma hora para que comandos globais apareçam em todos os servidores. Para testes, considere registrar comandos em um servidor específico.

5. Inicie o bot:
   
   **Windows**: Execute `start.bat` (criado pelo install.bat)
   
   **Linux/Mac ou manualmente:**
   ```bash
   npm start
   ```
   
   **Ou usando PM2 (recomendado para produção):**
   ```bash
   pm2 start ecosystem.config.js
   # ou
   npm run start:pm2
   ```

6. **(Opcional)** Se habilitou o webhook GitHub, configure o firewall:
   - **Windows**: Configure manualmente o firewall para permitir a porta `WEBHOOK_PORT` (padrão: 3001)
   - **Linux/Mac**: Configure o firewall para permitir a porta configurada em `WEBHOOK_PORT`
   - Veja mais detalhes em [FIREWALL_SETUP.md](FIREWALL_SETUP.md)

## 📝 Uso

1. No Discord, digite `/init` para inicializar o painel de controle Git.
2. Utilize os botões do painel para interagir com os repositórios:
   - **Listar Repositórios**: Mostra todos os repositórios e submódulos disponíveis no caminho base configurado.
   - **Atualizar Todos**: Atualiza todos os repositórios e submódulos com uma única ação.
   - **Status Geral**: Verifica o status de todos os repositórios.
   - **Gerir acessos** (apenas quem tem o cargo `GIT_ADMIN_ROLE_ID`): escolhe um repositório e adiciona ou remove utilizadores autorizados a usar comandos Git nesse caminho.

3. Ao selecionar um repositório específico, você terá acesso a ações como:
   - **Pull**: Atualiza o repositório local com as mudanças do remoto.
   - **Commit & Push**: Adiciona todas as alterações, permite inserir uma mensagem de commit e faz push para o repositório remoto.
   - **Inicializar Submódulos**: Inicializa submódulos não configurados.
   - **Atualizar Submódulos**: Atualiza submódulos existentes.
   - **Corrigir Submódulos Destacados**: Corrige submódulos com HEAD destacada.

Quem pode **criar o painel** (`/init`) e quem pode usar cada ação depende de `GIT_ADMIN_ROLE_ID` e da lista de utilizadores por repositório; detalhes nos comentários do `.env.example`.

## ⚙️ Configuração do Bot no Discord

1. Acesse o [Portal de Desenvolvedores do Discord](https://discord.com/developers/applications)
2. Crie uma nova aplicação e configure um bot
3. **Intents:** o bot usa apenas `Guilds` e `GuildMessages` (ver [`src/index.js`](src/index.js)). Não é necessário ativar Presence, Server Members Intent ou Message Content Intent para o uso normal do painel e dos comandos slash.
4. Na seção "OAuth2" > "URL Generator", selecione os escopos:
   - `bot`
   - `applications.commands`
5. Nas permissões do bot, selecione:
   - Send Messages
   - Use Slash Commands
   - Read Messages/View Channels
   - Attach Files
   - Embed Links
   - Use External Emojis
6. Use o URL gerado para convidar o bot para seu servidor:
   ```
   https://discord.com/api/oauth2/authorize?client_id=SEU_CLIENT_ID&permissions=274877975552&scope=bot%20applications.commands
   ```

## 🔍 Solução de Problemas

Se os comandos slash não aparecerem:
1. Verifique se o bot está online
2. Verifique se o comando foi registrado corretamente (`npm run deploy-commands`)
3. Certifique-se de que convidou o bot com o escopo `applications.commands`
4. Aguarde até uma hora para comandos globais (ou use registro em servidor específico)
5. Tente remover e adicionar o bot ao servidor novamente

Para registro de comandos em um servidor específico (mais rápido para testes), ajuste [`src/deploy-commands.js`](src/deploy-commands.js):

```javascript
// Para testes em um servidor específico (substitua GUILD_ID pelo ID do seu servidor)
const data = await rest.put(
  Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
  { body: commands },
);
```

## 🔗 Webhook GitHub / GitLab (Opcional)

O bot pode receber webhooks do GitHub ou GitLab e executar pull automático quando um commit contém `@pull` na mensagem.

### Configuração Rápida

1. **Habilite o webhook no `.env`:**
   ```env
   ENABLE_GITHUB_WEBHOOK=true
   WEBHOOK_PORT=3001
   ```

2. **Configure o firewall:**
   - Windows: Configure manualmente o firewall para permitir a porta configurada
   - Veja mais detalhes em [FIREWALL_SETUP.md](FIREWALL_SETUP.md)

3. **Mapeie seus repositórios:**
   ```bash
   curl -X POST http://localhost:3001/mappings \
     -H "Content-Type: application/json" \
     -d '{"githubRepo": "usuario/repositorio", "localPath": "C:/caminho/local"}'
   ```

4. **Configure o webhook no GitHub:**
   - Vá em Settings → Webhooks → Add webhook
   - URL: `http://seu-ip:3001/webhook`
   - Content type: `application/json`
   - Events: `Just the push event`
   - Secret: (opcional, mas recomendado)

5. **Faça um commit com `@pull`:**
   ```bash
   git commit -m "Atualização importante @pull"
   git push
   ```

📘 **Guia completo:** Veja [WEBHOOK_SETUP.md](WEBHOOK_SETUP.md) para instruções detalhadas (GitHub e GitLab).

## 📁 Estrutura do Projeto

```
git-manager-discord/
├── src/
│   ├── commands/        # Comandos slash do Discord
│   │   └── init.js      # Comando para inicializar o painel de controle
│   ├── utils/           # Funções utilitárias
│   │   ├── gitManager.js   # Operações Git
│   │   ├── gitPermissions.js # Quem pode usar o painel por cargo/lista
│   │   ├── repoUserAccess.js # Persistência da lista por repositório
│   │   ├── repoPolicy.js      # Políticas (ex.: pull só no reinício)
│   │   └── restartPullQueue.js # Fila para pulls agendados
│   ├── services/        # Serviços da aplicação
│   │   ├── panelService.js      # Painéis interativos
│   │   ├── webhookService.js    # Servidor HTTP de webhooks
│   │   └── restartPullScheduler.js # Pull agendado antes do reinício
│   ├── handlers/        # Manipuladores de eventos
│   │   └── buttonHandler.js # Botões, menus e modais
│   ├── index.js         # Arquivo principal do bot
│   └── deploy-commands.js # Registro de comandos slash
├── data/
│   ├── pathHashMap.json    # Mapeamento hash ↔ caminho (componentes do painel)
│   ├── repoMapping.json    # Mapeamento remoto → caminho local (webhook)
│   ├── repoUserAccess.json # Utilizadores Discord autorizados por repo
│   └── repoPolicy.json     # Ex.: pullOnRestartOnly
├── logs/                # Logs do PM2 (se usado)
├── .env                 # Variáveis de ambiente (não incluído no Git)
├── .env.example         # Exemplo de variáveis de ambiente
├── ecosystem.config.js  # Configuração do PM2
├── install.bat          # Script de instalação (Windows)
├── start.bat            # Script de inicialização (gerado pelo install.bat)
├── package.json
└── README.md
```

## 💻 Desenvolvimento

Para desenvolver e testar o bot localmente:

```bash
npm run dev
```

## 🤝 Contribuindo

Contribuições são bem-vindas! Sinta-se à vontade para abrir issues e pull requests.

1. Faça um fork do projeto
2. Crie sua branch de feature (`git checkout -b feature/MinhaFeature`)
3. Commit suas alterações (`git commit -m 'Adiciona MinhaFeature'`)
4. Push para a branch (`git push origin feature/MinhaFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está licenciado sob a Licença MIT - veja o arquivo [LICENSE](LICENSE) para detalhes.

---

<div align="center">
  Desenvolvido com ❤️ por <a href="https://github.com/proelias7">proelias7</a>
</div> 