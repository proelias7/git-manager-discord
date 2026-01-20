require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Events } = require('discord.js');

const GitManager = require('./utils/gitManager');
const ButtonHandler = require('./handlers/buttonHandler');
const WebhookService = require('./services/webhookService');
const { deployCommands } = require('./deploy-commands');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

client.commands = new Collection();

const gitManager = new GitManager(process.env.GIT_BASE_PATH);
const buttonHandler = new ButtonHandler();
let webhookService = null;

buttonHandler.setClient(client);

/**
 * Carrega os comandos do diretório de comandos
 */
function loadLocalCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      console.log(`📦 Comando ${command.data.name} carregado`);
    } else {
      console.warn(`⚠️ O comando em ${filePath} está faltando a propriedade "data" ou "execute" obrigatória`);
    }
  }
}

// Carregar comandos localmente
loadLocalCommands();

client.once(Events.ClientReady, async () => {
  console.log(`\n🤖 Bot online! Logado como ${client.user.tag}\n`);
  
  // Deploy automático dos comandos slash
  const shouldAutoDeploy = process.env.AUTO_DEPLOY_COMMANDS !== 'false';
  
  if (shouldAutoDeploy) {
    console.log('🚀 Iniciando deploy automático dos comandos...');
    const result = await deployCommands({
      token: process.env.BOT_TOKEN,
      clientId: process.env.CLIENT_ID,
      guildId: process.env.GUILD_ID,
      silent: false
    });
    
    if (result.success) {
      console.log(`✅ Deploy concluído: ${result.count} comandos ${result.global ? '(global)' : '(servidor específico)'}\n`);
    } else {
      console.error(`❌ Falha no deploy: ${result.error}\n`);
    }
  } else {
    console.log('ℹ️ Deploy automático desabilitado (AUTO_DEPLOY_COMMANDS=false)\n');
  }
  
  // Iniciar servidor de webhook do GitHub/GitLab
  if (process.env.ENABLE_GITHUB_WEBHOOK === 'true') {
    webhookService = new WebhookService(gitManager, client);
    webhookService.start();
    console.log('✅ Serviço de webhook Git habilitado');
  } else {
    console.log('ℹ️ Serviço de webhook Git desabilitado (ENABLE_GITHUB_WEBHOOK não está definido como true)');
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        console.error(`Nenhum comando correspondente a ${interaction.commandName} foi encontrado.`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`Erro ao executar comando ${interaction.commandName}:`, error);
        reportError(interaction, 'Ocorreu um erro ao executar este comando!');
      }
    }
    else if (interaction.isButton()) {
      await buttonHandler.handleButtonInteraction(interaction);
    }
    else if (interaction.isStringSelectMenu()) {
      await buttonHandler.handleSelectMenuInteraction(interaction);
    }
    else if (interaction.isModalSubmit()) {
      await buttonHandler.handleModalSubmit(interaction);
    }
  } catch (error) {
    console.error('Erro ao processar interação:', error);
    reportError(interaction, 'Ocorreu um erro ao processar esta interação!');
  }
});

const reportError = async (interaction, message) => {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ 
        content: message, 
        ephemeral: true 
      });
    } else {
      await interaction.reply({ 
        content: message, 
        ephemeral: true 
      });
    }
  } catch (e) {
    console.error('Erro ao enviar mensagem de erro:', e);
  }
};

client.login(process.env.BOT_TOKEN);