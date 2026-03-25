const { SlashCommandBuilder } = require('discord.js');
const panelService = require('../services/panelService');
const { canCreateGitPanel } = require('../utils/gitPermissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('init')
    .setDescription('Inicializa o painel de controle para gerenciar repositórios Git'),

  async execute(interaction) {
    try {
      console.log(`Comando /init executado por: ${interaction.user.tag}`);

      const mainPath = process.env.GIT_BASE_PATH;
      if (!mainPath) {
        await interaction.reply({
          content: 'GIT_BASE_PATH não está configurado no .env.',
          ephemeral: true
        });
        return;
      }

      if (!canCreateGitPanel(interaction.member, mainPath)) {
        await interaction.reply({
          content:
            'Sem permissão para criar o painel. É necessário o cargo de administrador Git (`GIT_ADMIN_ROLE_ID`), estar autorizado no repositório principal, ou (se ainda não houver utilizadores configurados) ser Administrador do Discord no servidor.',
          ephemeral: true
        });
        return;
      }

      await interaction.deferReply({ ephemeral: false });
      

      const channelId = interaction.channelId;
      const userId = interaction.user.id;
      const panel = panelService.createGitPanel(channelId, userId);
      
      const reply = await interaction.editReply({
        embeds: [panel.embed],
        components: panel.components
      });
      
      panelService.registerMessageId(panel.id, reply.id);
      
      console.log(`Painel de controle criado com ID: ${panel.id}`);
    } catch (error) {
      console.error('Erro ao inicializar painel de controle:', error);
      
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: `Erro ao inicializar o painel de controle: ${error.message}`,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: `Erro ao inicializar o painel de controle: ${error.message}`,
          ephemeral: true
        });
      }
    }
  }
}; 