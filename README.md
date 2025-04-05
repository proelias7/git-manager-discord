# Git Manager Discord

<div align="center">
  
![License](https://img.shields.io/github/license/proelias7/git-manager-discord)
![Node](https://img.shields.io/badge/Node.js-16.x+-339933?logo=node.js&logoColor=white)
![Discord](https://img.shields.io/badge/Discord-Bot-5865F2?logo=discord&logoColor=white)

</div>

Um bot do Discord que permite gerenciar repositórios Git remotamente através de slash commands e interfaces interativas. Gerencie seus repositórios, submódulos e execute operações Git comuns como pull, commit e push diretamente pelo Discord.

<div align="center">
  <img src="https://via.placeholder.com/800x400?text=Git+Manager+Discord+Bot" alt="Git Manager Discord Preview" width="70%">
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

## 🔧 Pré-requisitos

- Node.js 16.x ou superior
- Um aplicativo Discord registrado com um bot
- Permissões de administrador para o bot no servidor Discord
- Acesso aos repositórios Git que deseja gerenciar

## 🚀 Instalação

1. Clone este repositório:
   ```bash
   git clone https://github.com/proelias7/git-manager-discord.git
   cd git-manager-discord
   ```

2. Instale as dependências:
   ```bash
   npm install
   ```

3. Configure o arquivo `.env` com suas credenciais (use o arquivo `.env.example` como referência):
   ```env
   BOT_TOKEN=seu_token_aqui
   CLIENT_ID=seu_client_id_aqui
   GIT_BASE_PATH=caminho/para/seus/repositorios
   GUILD_ID=id_do_servidor_aqui
   ```

4. Registre os comandos slash no Discord:
   ```bash
   npm run deploy-commands
   ```
   > **Observação**: Pode levar até uma hora para que comandos globais apareçam em todos os servidores. Para testes, considere registrar comandos em um servidor específico.

5. Inicie o bot:
   ```bash
   npm start
   ```

## 📝 Uso

1. No Discord, digite `/init` para inicializar o painel de controle Git.
2. Utilize os botões do painel para interagir com os repositórios:
   - **Listar Repositórios**: Mostra todos os repositórios e submódulos disponíveis no caminho base configurado.
   - **Atualizar Todos**: Atualiza todos os repositórios e submódulos com uma única ação.
   - **Status Geral**: Verifica o status de todos os repositórios.

3. Ao selecionar um repositório específico, você terá acesso a ações como:
   - **Pull**: Atualiza o repositório local com as mudanças do remoto.
   - **Commit & Push**: Adiciona todas as alterações, permite inserir uma mensagem de commit e faz push para o repositório remoto.
   - **Inicializar Submódulos**: Inicializa submódulos não configurados.
   - **Atualizar Submódulos**: Atualiza submódulos existentes.
   - **Corrigir Submódulos Destacados**: Corrige submódulos com HEAD destacada.

## ⚙️ Configuração do Bot no Discord

1. Acesse o [Portal de Desenvolvedores do Discord](https://discord.com/developers/applications)
2. Crie uma nova aplicação e configure um bot
3. Ative as seguintes opções na página do bot:
   - PRESENCE INTENT
   - SERVER MEMBERS INTENT
   - MESSAGE CONTENT INTENT
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

Para registro de comandos em um servidor específico (mais rápido para testes), modifique o arquivo `deploy-commands.js`:

```javascript
// Para testes em um servidor específico (substitua GUILD_ID pelo ID do seu servidor)
const data = await rest.put(
  Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
  { body: commands },
);
```

## 📁 Estrutura do Projeto

```
git-manager-discord/
├── src/
│   ├── commands/        # Comandos slash do Discord
│   │   └── init.js      # Comando para inicializar o painel de controle
│   ├── utils/           # Funções utilitárias
│   │   └── gitManager.js # Gerenciador de operações Git
│   ├── services/        # Serviços da aplicação
│   │   └── panelService.js # Gerenciamento de painéis interativos
│   ├── handlers/        # Manipuladores de eventos
│   │   └── buttonHandler.js # Tratamento de interações com botões
│   ├── index.js         # Arquivo principal do bot
│   └── deploy-commands.js # Script para registro de comandos
├── data/
│   └── pathHashMap.json # Mapeamento de caminhos para hashes
├── .env                 # Variáveis de ambiente (não incluído no Git)
├── .env.example         # Exemplo de variáveis de ambiente
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
  Desenvolvido com ❤️ por <a href="https://github.com/proelias7"> proelias7</a>
</div> 