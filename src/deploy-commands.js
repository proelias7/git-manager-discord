const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

/**
 * Carrega os comandos do diretório de comandos
 * @returns {Array} Array de comandos em formato JSON
 */
function loadCommands() {
  const commands = [];
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    // Limpar cache para garantir que os comandos sejam recarregados
    delete require.cache[require.resolve(filePath)];
    const command = require(filePath);
    
    if ('data' in command) {
      commands.push(command.data.toJSON());
    }
  }
  
  return commands;
}

/**
 * Faz o deploy dos comandos slash no Discord
 * @param {Object} options - Opções de configuração
 * @param {string} options.token - Token do bot
 * @param {string} options.clientId - ID do cliente/aplicação
 * @param {string} [options.guildId] - ID do servidor (opcional, para deploy específico)
 * @param {boolean} [options.silent] - Se true, reduz a verbosidade dos logs
 * @returns {Promise<Object>} Resultado do deploy
 */
async function deployCommands(options = {}) {
  const { token, clientId, guildId, silent = false } = options;
  
  if (!token || !clientId) {
    throw new Error('Token e clientId são obrigatórios para o deploy dos comandos');
  }

  const commands = loadCommands();
  const rest = new REST({ version: '10' }).setToken(token);
  
  const log = (msg) => !silent && console.log(msg);

  try {
    log(`📝 Iniciando o registro de ${commands.length} comandos...`);

    let data;
    
    if (guildId) {
      log(`🎯 Registrando comandos no servidor: ${guildId}`);
      data = await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands },
      );
      log(`✅ ${data.length} comandos registrados no servidor (disponíveis imediatamente)`);
    } else {
      data = await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands },
      );
      log(`✅ ${data.length} comandos registrados globalmente`);
      log(`⚠️ Comandos globais podem levar até 1 hora para aparecer em todos os servidores`);
    }

    return { success: true, count: data.length, global: !guildId };
  } catch (error) {
    console.error('❌ Erro ao registrar os comandos:', error.message);
    return { success: false, error: error.message };
  }
}

// Se executado diretamente (não importado como módulo)
if (require.main === module) {
  require('dotenv').config();
  
  const { BOT_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
  
  if (!BOT_TOKEN || !CLIENT_ID) {
    console.error('Erro: BOT_TOKEN ou CLIENT_ID não definidos no arquivo .env');
    process.exit(1);
  }

  // Permite passar guildId como argumento de linha de comando
  const args = process.argv.slice(2);
  const commandLineGuildId = args[0];

  deployCommands({
    token: BOT_TOKEN,
    clientId: CLIENT_ID,
    guildId: commandLineGuildId || GUILD_ID
  }).then(result => {
    if (!result.success) {
      process.exit(1);
    }
  });
}

module.exports = { deployCommands, loadCommands }; 