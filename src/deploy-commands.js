require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const GitManager = require('./utils/gitManager');

const gitBasePath = process.env.GIT_BASE_PATH;
if (!gitBasePath) {
  console.error('Erro: GIT_BASE_PATH não definido no arquivo .env');
  process.exit(1);
}

try {
  const gitManager = new GitManager(gitBasePath);
  console.log(`GitManager inicializado com o caminho: ${gitBasePath}`);
} catch (error) {
  console.error(`Erro ao inicializar GitManager: ${error.message}`);
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  
  if ('data' in command) {
    commands.push(command.data.toJSON());
    console.log(`Comando ${command.data.name} carregado para registro`);
  } else {
    console.warn(`O comando em ${filePath} está faltando a propriedade "data" obrigatória`);
  }
}

const { BOT_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!BOT_TOKEN || !CLIENT_ID) {
  console.error('Erro: BOT_TOKEN ou CLIENT_ID não definidos no arquivo .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

const args = process.argv.slice(2);
const commandLineGuildId = args[0];

const guildId = commandLineGuildId || GUILD_ID;

async function deployCommands() {
  try {
    console.log(`Iniciando o registro de ${commands.length} comandos.`);

    let data;
    
    if (guildId) {
      console.log(`Registrando comandos no servidor com ID: ${guildId}`);
      data = await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, guildId),
        { body: commands },
      );
      console.log(`Sucesso! ${data.length} comandos registrados no servidor específico.`);
      console.log('Os comandos estarão disponíveis imediatamente.');
    } else {
      data = await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands },
      );
      console.log(`Sucesso! ${data.length} comandos registrados globalmente.`);
      console.log('ATENÇÃO: Comandos globais podem levar até uma hora para aparecer em todos os servidores.');
      console.log('Para registro rápido em um servidor específico:');
      console.log('1. Adicione GUILD_ID=seu_id_servidor no arquivo .env, ou');
      console.log('2. Use: node src/deploy-commands.js SEU_ID_DO_SERVIDOR');
    }
  } catch (error) {
    console.error('Erro ao registrar os comandos:', error);
  }
}

deployCommands(); 