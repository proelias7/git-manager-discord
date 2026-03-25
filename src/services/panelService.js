const { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');
const crypto = require('crypto');


class PanelService {
  constructor() {
    this.activePanels = new Map();
    
    this.expirationTime = 100 * 365 * 24 * 60 * 60 * 1000;
  }

  createGitPanel(channelId, userId) {
    try {
      this.panelId = this.generatePanelId();

      const embed = this.createPanelEmbed();
      
      const components = this.createPanelButtons();
      
      this.activePanels.set(this.panelId, {
        messageId: null,
        channelId: channelId,
        userId: userId,
        createdAt: Date.now(),
        expiresAt: Date.now() + this.expirationTime
      });
      
      return {
        id: this.panelId,
        embed,
        components
      };
    } catch (error) {
      console.error('Erro ao criar painel Git:', error);
      throw new Error(`Não foi possível criar o painel: ${error.message}`);
    }
  }


  generatePanelId() {
    return crypto.randomBytes(8).toString('hex');
  }


  createPanelEmbed() {
    return new EmbedBuilder()
      .setTitle('🛠️ Painel de Controle Git')
      .setDescription(
        '### Bem-vindo ao Painel de Controle Git!\n\n' +
        'Este painel permite gerenciar seus repositórios Git diretamente pelo Discord.\n\n' +
        'Utilize os botões abaixo para interagir com os repositórios.'
      )
      .setColor(0x4c6ef5)
      .setThumbnail('https://git-scm.com/images/logos/downloads/Git-Icon-1788C.png')
      .setFooter({
        text: `Painel ID: ${this.panelId} | GitBot v${require('../../package.json').version}`,
        iconURL: 'https://git-scm.com/images/logos/downloads/Git-Icon-1788C.png'
      })
      .setTimestamp();
  }


  createExpiredEmbed() {
    return new EmbedBuilder()
      .setTitle('⏰ Painel Expirado')
      .setDescription(
        'Este painel de controle não está mais disponível.\n\n' +
        'Por favor, crie um novo painel utilizando o comando `/init`.'
      )
      .setColor(0xfa5252)
      .setFooter({
        text: `Painel ID inválido | GitBot v${require('../../package.json').version}`,
        iconURL: 'https://git-scm.com/images/logos/downloads/Git-Icon-1788C.png'
      });
  }


  createPanelButtons() {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`list-repos:${this.panelId}`)
        .setLabel('Listar Repositórios')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📚'),
      new ButtonBuilder()
        .setCustomId(`sync-all:${this.panelId}`)
        .setLabel('Atualizar Todos')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🔄'),
      new ButtonBuilder()
        .setCustomId(`status-all:${this.panelId}`)
        .setLabel('Status Geral')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📊'),
      new ButtonBuilder()
        .setCustomId(`manage-access:${this.panelId}`)
        .setLabel('Gerir acessos')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔐')
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`scheduled-pulls:${this.panelId}`)
        .setLabel('Pulls agendados')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏳')
    );
    return [row1, row2];
  }


  registerMessageId(panelId, messageId) {
    const panel = this.activePanels.get(panelId);
    if (panel) {
      panel.messageId = messageId;
      this.activePanels.set(panelId, panel);
    }
  }


  setupExpirationTimer(panelId) {
    const panel = this.activePanels.get(panelId);
    if (!panel) return;
    
    const timeLeft = panel.expiresAt - Date.now();
    
    setTimeout(() => {
      this.expirePanel(panelId);
    }, timeLeft);
  }


  expirePanel(panelId) {
    const panel = this.activePanels.get(panelId);
    if (!panel) return;
    
    this.activePanels.delete(panelId);
    
    console.log(`Painel ${panelId} expirado automaticamente`);
  }


  isPanelActive(panelId) {
    const panel = this.activePanels.get(panelId);
    if (!panel) return false;
    
    return true;
  }


  getPanel(panelId) {
    return this.activePanels.get(panelId) || null;
  }


  removePanel(panelId) {
    this.activePanels.delete(panelId);
  }


  createDisabledButtons(panelId) {
    return new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`notfound:${panelId}`)
          .setLabel('Painel Não Encontrado')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
  }
}

module.exports = new PanelService(); 