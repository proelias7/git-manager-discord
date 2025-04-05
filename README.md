# Git Manager Discord

<div align="center">
  
![License](https://img.shields.io/github/license/proelias7/git-manager-discord)
![Node](https://img.shields.io/badge/Node.js-16.x+-339933?logo=node.js&logoColor=white)
![Discord](https://img.shields.io/badge/Discord-Bot-5865F2?logo=discord&logoColor=white)

</div>

Um bot do Discord que permite gerenciar repositórios Git remotamente através de slash commands. Com este bot, você pode listar repositórios, executar pull, commit e push através de uma interface interativa no Discord.

<div align="center">
  <img src="https://via.placeholder.com/800x400?text=Git+Manager+Discord+Bot" alt="Git Manager Discord Preview" width="70%">
</div>

## ✨ Funcionalidades

- 📋 Listar repositórios Git disponíveis
- 👁️ Visualizar status dos repositórios (branch atual, modificações, etc.)
- 🔄 Executar Git Pull para atualizar repositórios
- 📤 Adicionar, commitar alterações e fazer push com uma única ação

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

1. No Discord, digite `/repositorios` para ver a lista de repositórios disponíveis.
2. Selecione um repositório no menu dropdown.
3. Escolha a ação desejada:
   - **Pull**: Atualiza o repositório local com as mudanças do remoto.
   - **Commit & Push**: Adiciona todas as alterações, solicita uma mensagem de commit e faz push para o repositório remoto.

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
6. Use o URL gerado para convidar o bot para seu servidor:
   ```
   https://discord.com/api/oauth2/authorize?client_id=SEU_CLIENT_ID&permissions=2048&scope=bot%20applications.commands
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
  Routes.applicationGuildCommands(process.env.CLIENT_ID, 'GUILD_ID'),
  { body: commands },
);
```

## 📁 Estrutura do Projeto

```
git-manager-discord/
├── src/
│   ├── commands/         # Comandos slash do Discord
│   ├── utils/            # Funções utilitárias
│   ├── services/         # Serviços da aplicação
│   ├── handlers/         # Manipuladores de eventos
│   ├── index.js          # Arquivo principal do bot
│   └── deploy-commands.js # Script para registro de comandos
├── data/                 # Dados da aplicação
├── .env                  # Variáveis de ambiente (não incluído no Git)
├── .env.example          # Exemplo de variáveis de ambiente
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
  Desenvolvido com ❤️ por <a href="https://github.com/proelias7">Guilherme Proel</a>
</div> 