const { 
  EmbedBuilder, 
  ActionRowBuilder, 
  StringSelectMenuBuilder, 
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const path = require('path');
const fs = require('fs');
const GitManager = require('../utils/gitManager');

const HASH_MAP_FILE = path.join(process.cwd(), 'data', 'pathHashMap.json');

const gitManager = new GitManager(process.env.GIT_BASE_PATH);


class ButtonHandler {
  constructor() {
    this.client = null;
    
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    this.initPathHashMap();
  }
  

  initPathHashMap() {
    if (!global.pathHashMap) {
      global.pathHashMap = {};
      
      try {
        if (fs.existsSync(HASH_MAP_FILE)) {
          const fileContent = fs.readFileSync(HASH_MAP_FILE, 'utf8');
          const savedMap = JSON.parse(fileContent);
          global.pathHashMap = savedMap;
          console.log(`Mapa de hashes carregado com ${Object.keys(savedMap).length} entradas`);
        }
      } catch (error) {
        console.error('Erro ao carregar mapa de hashes:', error);
      }
    }
  }
  

  savePathHashMap() {
    try {
      fs.writeFileSync(HASH_MAP_FILE, JSON.stringify(global.pathHashMap, null, 2), 'utf8');
      console.log(`Mapa de hashes salvo com ${Object.keys(global.pathHashMap).length} entradas`);
    } catch (error) {
      console.error('Erro ao salvar mapa de hashes:', error);
    }
  }
  

  mapRepoPath(repoPath) {
    const pathHash = require('crypto').createHash('md5').update(repoPath).digest('hex').substring(0, 16);
    global.pathHashMap[pathHash] = repoPath;
    console.log(`Mapeado repositório: ${repoPath} -> hash: ${pathHash}`);
    
    this.savePathHashMap();
    
    return pathHash;
  }
  

  getRepoPath(pathHash) {
    const repoPath = global.pathHashMap[pathHash];
    if (!repoPath) {
      console.error(`Hash de repositório não encontrado: ${pathHash}`);
    }
    return repoPath;
  }


  setClient(client) {
    this.client = client;
  }


  async handleButtonInteraction(interaction) {
    try {
      const customId = interaction.customId;
      
      const lastColonIndex = customId.lastIndexOf(':');
      if (lastColonIndex === -1) {
        await interaction.reply({
          content: 'Formato de botão inválido. Por favor, use o comando `/init` para criar um novo painel.',
          ephemeral: true
        });
        return;
      }
      
      const panelId = customId.substring(lastColonIndex + 1);
      const actionPart = customId.substring(0, lastColonIndex);
      
      console.log(`Processando ação de botão: ${actionPart} para painel: ${panelId}`);

      if (actionPart.startsWith('fix-all-detached-')) {
        const pathHash = actionPart.substring('fix-all-detached-'.length);
        const repoPath = this.getRepoPath(pathHash);
        
        if (!repoPath) {
          await interaction.reply({
            content: 'Informações do repositório não encontradas. Por favor, selecione o repositório novamente.',
            ephemeral: true
          });
          return;
        }
        
        await this.handleFixAllDetachedForRepo(interaction, repoPath, panelId);
        return;
      }
      
      if (/^(pull-|update-sub-|fix-detached-|init-sub-|commit-)[a-f0-9]{16}$/.test(actionPart)) {
        const prefixEnd = actionPart.indexOf('-') + 1;
        const prefix = actionPart.substring(0, prefixEnd);
        const pathHash = actionPart.substring(prefixEnd);
        
        const repoPath = this.getRepoPath(pathHash);
        
        if (!repoPath) {
          await interaction.reply({
            content: 'Informações do repositório não encontradas. Por favor, selecione o repositório novamente.',
            ephemeral: true
          });
          return;
        }
        
        if (prefix === 'pull-') {
          await this.handlePullRepository(interaction, repoPath, panelId);
        } else if (prefix === 'update-sub-') {
          await this.handleUpdateSubmodules(interaction, repoPath, panelId);
        } else if (prefix === 'fix-detached-') {
          await this.handleFixDetached(interaction, repoPath, panelId);
        } else if (prefix === 'init-sub-') {
          await this.handleInitSubmodules(interaction, repoPath, panelId);
        } else if (prefix === 'commit-') {
          await this.handleShowCommitModal(interaction, repoPath, panelId);
        }
        return;
      }
      
      if (actionPart === 'list-repos') {
        await this.handleListRepositories(interaction, panelId);
      } else if (actionPart === 'update-all') {
        await this.handleUpdateAll(interaction, panelId);
      } else if (actionPart === 'fix-all-detached') {
        await this.handleFixAllDetached(interaction, panelId);
      } else if (actionPart === 'sync-all') {
        await this.handleUpdateAll(interaction, panelId);
      } else if (actionPart === 'status-all') {
        await this.handleStatusAll(interaction, panelId);
      } else if (actionPart.startsWith('pull-')) {
        const repoPath = actionPart.replace('pull-', '');
        await this.handlePullRepository(interaction, repoPath, panelId);
      } else if (actionPart.startsWith('update-sub-')) {
        const repoPath = actionPart.replace('update-sub-', '');
        await this.handleUpdateSubmodules(interaction, repoPath, panelId);
      } else if (actionPart.startsWith('fix-detached-')) {
        const repoPath = actionPart.replace('fix-detached-', '');
        await this.handleFixDetached(interaction, repoPath, panelId);
      } else if (actionPart.startsWith('fix-all-detached-')) {
        const repoPath = actionPart.replace('fix-all-detached-', '');
        await this.handleFixAllDetachedForRepo(interaction, repoPath, panelId);
      } else if (actionPart.startsWith('init-sub-')) {
        const repoPath = actionPart.replace('init-sub-', '');
        await this.handleInitSubmodules(interaction, repoPath, panelId);
      } else if (actionPart.startsWith('commit-')) {
        const repoPath = actionPart.replace('commit-', '');
        await this.handleShowCommitModal(interaction, repoPath, panelId);
      } else if (actionPart.startsWith('pull-stash-')) {
        const pathHash = actionPart.replace('pull-stash-', '');
        const repoPath = this.getRepoPath(pathHash);
        await this.handlePullWithMode(interaction, repoPath, 'stash', panelId);
      } else if (actionPart.startsWith('pull-force-')) {
        const pathHash = actionPart.replace('pull-force-', '');
        const repoPath = this.getRepoPath(pathHash);
        await this.handlePullWithMode(interaction, repoPath, 'force', panelId);
      } else if (actionPart.startsWith('pull-cancel-')) {
        await interaction.update({
          components: [],
          embeds: [
            new EmbedBuilder()
              .setTitle('Operação Cancelada')
              .setDescription('A operação de pull foi cancelada. Suas alterações locais foram mantidas.')
              .setColor(0x999999)
              .setFooter({ text: `ID do Painel: ${panelId}` })
              .setTimestamp()
          ]
        });
      } else if (actionPart.startsWith('update-all-stash-')) {
        const pathHash = actionPart.replace('update-all-stash-', '');
        const repoPath = this.getRepoPath(pathHash);
        await this.handleUpdateAllWithMode(interaction, repoPath, 'stash', panelId);
      } else if (actionPart.startsWith('update-all-force-')) {
        const pathHash = actionPart.replace('update-all-force-', '');
        const repoPath = this.getRepoPath(pathHash);
        await this.handleUpdateAllWithMode(interaction, repoPath, 'force', panelId);
      } else if (actionPart.startsWith('update-all-cancel-')) {
        await interaction.update({
          components: [],
          embeds: [
            new EmbedBuilder()
              .setTitle('Operação Cancelada')
              .setDescription('A operação de atualização foi cancelada. Suas alterações locais foram mantidas.')
              .setColor(0x999999)
              .setFooter({ text: `ID do Painel: ${panelId}` })
              .setTimestamp()
          ]
        });
      } else {
        await interaction.reply({
          content: `Ação não reconhecida: ${actionPart}`,
          ephemeral: true
        });
      }
    } catch (error) {
      console.error('Erro ao processar interação de botão:', error);
      try {
        const errorMessage = error.message || 'Ocorreu um erro ao processar sua solicitação.';
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: `Erro: ${errorMessage}`,
            ephemeral: true
          });
        } else {
          await interaction.followUp({
            content: `Erro: ${errorMessage}`,
            ephemeral: true
          });
        }
      } catch (replyError) {
        console.error('Erro ao enviar resposta de erro:', replyError);
      }
    }
  }


  async handleSelectMenuInteraction(interaction) {
    try {
      const customId = interaction.customId;
      
      const lastColonIndex = customId.lastIndexOf(':');
      if (lastColonIndex === -1) {
        await interaction.reply({
          content: 'Formato de menu inválido. Por favor, use o comando `/init` para criar um novo painel.',
          ephemeral: true
        });
        return;
      }
      
      const panelId = customId.substring(lastColonIndex + 1);
      const actionPart = customId.substring(0, lastColonIndex);
      
      console.log(`Processando seleção de menu: ${actionPart} para painel: ${panelId}`);

      if (actionPart === 'select-repo') {
        await this.handleRepositorySelected(interaction, panelId);
      } else {
        await interaction.reply({
          content: `Ação de menu não reconhecida: ${actionPart}`,
          ephemeral: true
        });
      }
    } catch (error) {
      console.error('Erro ao processar interação de menu:', error);
      try {
        const errorMessage = error.message || 'Ocorreu um erro ao processar sua solicitação.';
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: `Erro: ${errorMessage}`,
            ephemeral: true
          });
        } else {
          await interaction.followUp({
            content: `Erro: ${errorMessage}`,
            ephemeral: true
          });
        }
      } catch (replyError) {
        console.error('Erro ao enviar resposta de erro:', replyError);
      }
    }
  }


  async handleModalSubmit(interaction) {
    try {
      const customId = interaction.customId;
      
      const lastColonIndex = customId.lastIndexOf(':');
      if (lastColonIndex === -1) {
        await interaction.reply({
          content: 'Formato de modal inválido. Por favor, use o comando `/init` para criar um novo painel.',
          ephemeral: true
        });
        return;
      }
      
      const panelId = customId.substring(lastColonIndex + 1);
      const actionPart = customId.substring(0, lastColonIndex);
      
      if (actionPart.startsWith('commit-modal-')) {
        const repoPath = actionPart.replace('commit-modal-', '');
        await this.handleCommitModalSubmit(interaction, repoPath, panelId);
      } else {
        await interaction.reply({
          content: `Tipo de modal não reconhecido: ${actionPart}`,
          ephemeral: true
        });
      }
    } catch (error) {
      console.error('Erro ao processar envio de modal:', error);
      try {
        const errorMessage = error.message || 'Ocorreu um erro ao processar sua solicitação.';
        await interaction.reply({
          content: `Erro: ${errorMessage}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error('Erro ao enviar resposta de erro:', replyError);
      }
    }
  }
 

  async handleListRepositories(interaction, panelId) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const repositories = await gitManager.getRepositories();
      
      if (repositories.length === 0) {
        const emptyEmbed = new EmbedBuilder()
          .setTitle('❌ Nenhum Repositório Encontrado')
          .setDescription('Não foi possível encontrar repositórios Git no diretório configurado.')
          .setColor(0xfa5252) // Vermelho
          .setFooter({ text: 'Verifique o caminho no arquivo .env' })
          .setTimestamp();
          
        await interaction.editReply({
          embeds: [emptyEmbed]
        });
        return;
      }
      
      const repoOptions = repositories.map(repo => {
        let label = repo.name;
        let emoji = '📁';
        let description = `Repositório: ${repo.name}`;
        
        if (repo.isSubmodule) {
          label = `${repo.name} (Submódulo)`;
          emoji = '🔗';
          description = `Submódulo: ${repo.name}`;
          
          if (repo.status === 'não inicializado') {
            label = `${repo.name} (Não Inicializado)`;
            emoji = '⚠️';
            description = `Submódulo não inicializado: ${repo.name}`;
          }
        }
        
        return new StringSelectMenuOptionBuilder()
          .setLabel(label)
          .setValue(repo.path)
          .setDescription(description)
          .setEmoji(emoji);
      });
      
      const repoSelect = new StringSelectMenuBuilder()
        .setCustomId(`select-repo:${panelId}`)
        .setPlaceholder('Selecione um repositório')
        .addOptions(repoOptions);
      
      const row = new ActionRowBuilder()
        .addComponents(repoSelect);
      
      const mainReposCount = repositories.filter(r => !r.isSubmodule).length;
      const submodulesCount = repositories.filter(r => r.isSubmodule).length;
      const initializedSubmodules = repositories.filter(r => r.isSubmodule && r.status === 'inicializado').length;
      const uninitializedSubmodules = repositories.filter(r => r.isSubmodule && r.status === 'não inicializado').length;
      const detachedSubmodules = repositories.filter(r => r.isSubmodule && r.status === 'detached HEAD').length;
      
      const repoEmbed = new EmbedBuilder()
        .setTitle('📚 Repositórios Disponíveis')
        .setDescription(
          `### Encontrados ${repositories.length} repositórios Git\n` +
          `Selecione um repositório no menu abaixo para gerenciá-lo.`
        )
        .setColor(0x4c6ef5)
        .addFields(
          { 
            name: '📁 Repositórios Principais', 
            value: `${mainReposCount}`, 
            inline: true 
          },
          { 
            name: '🔗 Total de Submódulos', 
            value: `${submodulesCount}`, 
            inline: true 
          },
          { 
            name: '\u200B',
            value: '\u200B', 
            inline: true 
          },
          {
            name: '✅ Submódulos Inicializados',
            value: `${initializedSubmodules}`,
            inline: true
          },
          {
            name: '⚠️ Não Inicializados',
            value: `${uninitializedSubmodules}`,
            inline: true
          },
          {
            name: '🔧 Detached HEAD',
            value: `${detachedSubmodules}`,
            inline: true
          }
        )
        .setFooter({ 
          text: `ID do Painel: ${panelId}`,
          iconURL: 'https://git-scm.com/images/logos/downloads/Git-Icon-1788C.png'
        })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [repoEmbed],
        components: [row]
      });
    } catch (error) {
      console.error('Erro ao listar repositórios:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Erro ao Listar Repositórios')
        .setDescription(`Ocorreu um erro ao tentar listar os repositórios:\n\`\`\`${error.message}\`\`\``)
        .setColor(0xfa5252) // Vermelho
        .setFooter({ text: 'Verifique os logs para mais detalhes' })
        .setTimestamp();
        
      await interaction.editReply({
        embeds: [errorEmbed]
      });
    }
  }


  async handleRepositorySelected(interaction, panelId) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const selectedRepoPath = interaction.values[0];
      console.log(`Repositório selecionado: ${selectedRepoPath}`);
      
      const status = await gitManager.getRepositoryStatus(selectedRepoPath);
      
      let embedColor = 0x339af0;
      if (status.hasChanges) {
        embedColor = 0xfcc419;
      } else if (status.isDetached) {
        embedColor = 0xfa5252;
      } else if (!status.hasChanges) {
        embedColor = 0x40c057;
      }
      
      let branchIcon = '🌿';
      if (status.isDetached) {
        branchIcon = '⚠️';
      }
      
      let statusIcon = '✅';
      let statusText = 'Limpo';
      if (status.hasChanges) {
        statusIcon = '⚠️';
        statusText = 'Modificado';
      }
      
      const repoEmbed = new EmbedBuilder()
        .setTitle(`📁 ${status.name}`)
        .setDescription(
          `### Detalhes do Repositório\n` +
          `**Caminho**: \`${status.path}\`\n\n` +
          `${statusIcon} Status atual: **${statusText}**`
        )
        .setColor(embedColor)
        .addFields(
          { 
            name: `${branchIcon} Branch`,
            value: `\`${status.branch || 'Detached HEAD'}\``,
            inline: true
          },
          { 
            name: `📝 Arquivos modificados`,
            value: `${status.changesCount}`,
            inline: true
          }
        )
        .setFooter({ 
          text: `ID do Painel: ${panelId}`,
          iconURL: 'https://git-scm.com/images/logos/downloads/Git-Icon-1788C.png'
        })
        .setTimestamp();
      
      if (status.hasSubmodules && status.submodulesStatus) {
        repoEmbed.addFields(
          { 
            name: '\u200B',
            value: '### Informações de Submódulos',
            inline: false
          },
          { 
            name: '🔗 Total de Submódulos',
            value: `${status.submodulesStatus.total}`,
            inline: true
          },
          { 
            name: '✅ Inicializados',
            value: `${status.submodulesStatus.initialized}`,
            inline: true
          },
          { 
            name: '⚠️ Detached HEAD',
            value: `${status.submodulesStatus.detached}`,
            inline: true
          }
        );
      }
      
      const pathHash = this.mapRepoPath(selectedRepoPath);
      
      const actionButtons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`pull-${pathHash}:${panelId}`)
            .setLabel('Pull')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔄'),
          new ButtonBuilder()
            .setCustomId(`update-sub-${pathHash}:${panelId}`)
            .setLabel('Atualizar Submódulos')
            .setStyle(ButtonStyle.Success)
            .setEmoji('⬇️')
            .setDisabled(!status.hasSubmodules),
          new ButtonBuilder()
            .setCustomId(`fix-all-detached-${pathHash}:${panelId}`)
            .setLabel('Corrigir Detached')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔧')
            .setDisabled(!status.hasSubmodules || status.submodulesStatus?.detached === 0),
          new ButtonBuilder()
            .setCustomId(`commit-${pathHash}:${panelId}`)
            .setLabel('Commit')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📝')
            .setDisabled(!status.hasChanges)
        );
      
      await interaction.editReply({
        embeds: [repoEmbed],
        components: [actionButtons]
      });
      
    } catch (error) {
      console.error('Erro ao processar repositório selecionado:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Erro ao Carregar Repositório')
        .setDescription(`Ocorreu um erro ao processar o repositório selecionado:\n\`\`\`${error.message}\`\`\``)
        .setColor(0xfa5252)
        .setFooter({ text: 'Verifique os logs para mais detalhes' })
        .setTimestamp();
        
      await interaction.editReply({
        embeds: [errorEmbed]
      });
    }
  }


  async handlePullRepository(interaction, repoPath, panelId) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const progressEmbed = new EmbedBuilder()
        .setTitle('Atualizando Repositório')
        .setDescription(`Executando pull em: ${path.basename(repoPath)}`)
        .setColor(0x0099FF)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [progressEmbed]
      });
      
      const result = await gitManager.pullRepository(repoPath, false, 'normal');
      
      if (result === 'STATUS_HAS_CHANGES') {
        const optionsEmbed = new EmbedBuilder()
          .setTitle('⚠️ Mudanças não Commitadas Detectadas')
          .setDescription(
            `O repositório **${path.basename(repoPath)}** possui mudanças locais não commitadas.\n\n` +
            `Escolha uma das opções abaixo:`
          )
          .setColor(0xFFA500)
          .addFields(
            { name: '💾 Stash', value: 'Salvar alterações locais temporariamente e aplicá-las após o pull', inline: false },
            { name: '⚡ Forçar', value: 'Descartar todas as alterações locais (CUIDADO: mudanças serão perdidas)', inline: false },
            { name: '❌ Cancelar', value: 'Cancelar operação de pull', inline: false }
          )
          .setFooter({ text: `ID do Painel: ${panelId}` })
          .setTimestamp();
        
        const pathHash = this.mapRepoPath(repoPath);
        
        const actionButtons = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`pull-stash-${pathHash}:${panelId}`)
              .setLabel('Stash e Pull')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('💾'),
            new ButtonBuilder()
              .setCustomId(`pull-force-${pathHash}:${panelId}`)
              .setLabel('Forçar Pull')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('⚡'),
            new ButtonBuilder()
              .setCustomId(`pull-cancel-${pathHash}:${panelId}`)
              .setLabel('Cancelar')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('❌')
          );
        
        await interaction.editReply({
          embeds: [optionsEmbed],
          components: [actionButtons]
        });
        return;
      }
      
      const resultEmbed = new EmbedBuilder()
        .setTitle('Pull Concluído')
        .setDescription(result)
        .setColor(0x00FF00)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [resultEmbed],
        components: []
      });
    } catch (error) {
      console.error(`Erro ao atualizar repositório ${repoPath}:`, error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('Erro no Pull')
        .setDescription(`Falha ao atualizar repositório: ${error.message}`)
        .setColor(0xFF0000)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [errorEmbed],
        components: []
      });
    }
  }


  async handlePullWithMode(interaction, repoPath, mode, panelId) {
    await interaction.deferUpdate();
    
    try {
      const progressEmbed = new EmbedBuilder()
        .setTitle('Atualizando Repositório')
        .setDescription(
          mode === 'stash' 
            ? `Salvando alterações locais e executando pull em: ${path.basename(repoPath)}`
            : `Forçando pull em: ${path.basename(repoPath)} (alterações locais serão descartadas)`
        )
        .setColor(0x0099FF)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [progressEmbed],
        components: []
      });
      
      const result = await gitManager.pullRepository(repoPath, false, mode);
      
      const resultEmbed = new EmbedBuilder()
        .setTitle('Pull Concluído')
        .setDescription(result)
        .setColor(0x00FF00)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [resultEmbed],
        components: []
      });
    } catch (error) {
      console.error(`Erro ao atualizar repositório ${repoPath} com modo ${mode}:`, error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('Erro no Pull')
        .setDescription(`Falha ao atualizar repositório: ${error.message}`)
        .setColor(0xFF0000)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [errorEmbed],
        components: []
      });
    }
  }


  async handleUpdateAll(interaction, panelId) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const repositories = await gitManager.getRepositories();
      const mainRepo = repositories.find(r => !r.isSubmodule);
      
      if (!mainRepo) {
        await interaction.editReply({
          content: 'Nenhum repositório principal encontrado.'
        });
        return;
      }
      
      const updateEmbed = new EmbedBuilder()
        .setTitle('Atualização de Repositórios')
        .setDescription(`Verificando repositório principal: ${mainRepo.name}`)
        .setColor(0x0099FF)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [updateEmbed]
      });
      
      const result = await gitManager.pullRepository(mainRepo.path, true, 'normal');
      
      if (result === 'STATUS_HAS_CHANGES') {
        const optionsEmbed = new EmbedBuilder()
          .setTitle('⚠️ Mudanças não Commitadas Detectadas')
          .setDescription(
            `O repositório **${mainRepo.name}** possui mudanças locais não commitadas.\n\n` +
            `Escolha uma das opções abaixo:`
          )
          .setColor(0xFFA500)
          .addFields(
            { name: '💾 Stash', value: 'Salvar alterações locais temporariamente e aplicá-las após o pull', inline: false },
            { name: '⚡ Forçar', value: 'Descartar todas as alterações locais (CUIDADO: mudanças serão perdidas)', inline: false },
            { name: '❌ Cancelar', value: 'Cancelar operação de atualização', inline: false }
          )
          .setFooter({ text: `ID do Painel: ${panelId}` })
          .setTimestamp();
        
        const pathHash = this.mapRepoPath(mainRepo.path);
        
        const actionButtons = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`update-all-stash-${pathHash}:${panelId}`)
              .setLabel('Stash e Update')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('💾'),
            new ButtonBuilder()
              .setCustomId(`update-all-force-${pathHash}:${panelId}`)
              .setLabel('Forçar Update')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('⚡'),
            new ButtonBuilder()
              .setCustomId(`update-all-cancel-${pathHash}:${panelId}`)
              .setLabel('Cancelar')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('❌')
          );
        
        await interaction.editReply({
          embeds: [optionsEmbed],
          components: [actionButtons]
        });
        return;
      }
      
      const resultEmbed = new EmbedBuilder()
        .setTitle('Atualização Concluída')
        .setDescription(`Resultado: ${result}`)
        .setColor(0x00FF00)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [resultEmbed],
        components: []
      });
    } catch (error) {
      console.error('Erro ao atualizar repositórios:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('Erro na Atualização')
        .setDescription(`Falha ao atualizar: ${error.message}`)
        .setColor(0xFF0000)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [errorEmbed]
      });
    }
  }


  async handleUpdateAllWithMode(interaction, repoPath, mode, panelId) {
    await interaction.deferUpdate();
    
    try {
      const progressEmbed = new EmbedBuilder()
        .setTitle('Atualização de Repositórios')
        .setDescription(
          mode === 'stash' 
            ? `Salvando alterações locais e atualizando: ${path.basename(repoPath)}`
            : `Forçando atualização em: ${path.basename(repoPath)} (alterações locais serão descartadas)`
        )
        .setColor(0x0099FF)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [progressEmbed],
        components: []
      });
      
      const result = await gitManager.pullRepository(repoPath, true, mode);
      
      const resultEmbed = new EmbedBuilder()
        .setTitle('Atualização Concluída')
        .setDescription(result)
        .setColor(0x00FF00)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [resultEmbed],
        components: []
      });
    } catch (error) {
      console.error(`Erro ao atualizar repositórios com modo ${mode}:`, error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('Erro na Atualização')
        .setDescription(`Falha ao atualizar: ${error.message}`)
        .setColor(0xFF0000)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [errorEmbed],
        components: []
      });
    }
  }


  async handleUpdateSubmodules(interaction, repoPath, panelId) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const progressEmbed = new EmbedBuilder()
        .setTitle('Atualizando Submódulos')
        .setDescription(`Atualizando submódulos em: ${path.basename(repoPath)}`)
        .setColor(0x0099FF)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [progressEmbed]
      });
      
      const result = await gitManager.updateSubmodules(repoPath);
      
      const resultEmbed = new EmbedBuilder()
        .setTitle('Submódulos Atualizados')
        .setDescription(result)
        .setColor(0x00FF00)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [resultEmbed]
      });
    } catch (error) {
      console.error(`Erro ao atualizar submódulos de ${repoPath}:`, error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('Erro na Atualização')
        .setDescription(`Falha ao atualizar submódulos: ${error.message}`)
        .setColor(0xFF0000)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [errorEmbed]
      });
    }
  }


  async handleFixDetached(interaction, repoPath, panelId) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const progressEmbed = new EmbedBuilder()
        .setTitle('Corrigindo Submódulo')
        .setDescription(`Corrigindo estado detached em: ${path.basename(repoPath)}`)
        .setColor(0x0099FF)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [progressEmbed]
      });
      
      const git = simpleGit(repoPath);
      const remotes = await git.getRemotes(true);
      const defaultBranch = remotes[0]?.refs?.fetch?.match(/\/([^\/]+)$/)?.[1] || 'master';
      
      await git.checkout(defaultBranch);
      
      const resultEmbed = new EmbedBuilder()
        .setTitle('Correção Concluída')
        .setDescription(`Checkout realizado para a branch: ${defaultBranch}`)
        .setColor(0x00FF00)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [resultEmbed]
      });
    } catch (error) {
      console.error(`Erro ao corrigir submódulo detached ${repoPath}:`, error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('Erro na Correção')
        .setDescription(`Falha ao corrigir submódulo: ${error.message}`)
        .setColor(0xFF0000)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [errorEmbed]
      });
    }
  }


  async handleFixAllDetachedForRepo(interaction, repoPath, panelId) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const progressEmbed = new EmbedBuilder()
        .setTitle('Corrigindo Submódulos')
        .setDescription(`Corrigindo todos os submódulos em: ${path.basename(repoPath)}`)
        .setColor(0x0099FF)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [progressEmbed]
      });
      
      const result = await gitManager.fixDetachedSubmodules(repoPath);
      
      const resultEmbed = new EmbedBuilder()
        .setTitle('Correção Concluída')
        .setDescription(result.message)
        .setColor(0x00FF00)
        .addFields(
          { name: 'Total', value: `${result.total}`, inline: true },
          { name: 'Corrigidos', value: `${result.fixed}`, inline: true }
        )
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [resultEmbed]
      });
    } catch (error) {
      console.error(`Erro ao corrigir submódulos de ${repoPath}:`, error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('Erro na Correção')
        .setDescription(`Falha ao corrigir submódulos: ${error.message}`)
        .setColor(0xFF0000)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [errorEmbed]
      });
    }
  }


  async handleInitSubmodules(interaction, repoPath, panelId) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const progressEmbed = new EmbedBuilder()
        .setTitle('Inicializando Submódulos')
        .setDescription(`Inicializando submódulos em: ${path.basename(repoPath)}`)
        .setColor(0x0099FF)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [progressEmbed]
      });
      
      const result = await gitManager.initSubmodules(repoPath);
      
      const resultEmbed = new EmbedBuilder()
        .setTitle('Inicialização Concluída')
        .setDescription(result)
        .setColor(0x00FF00)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [resultEmbed]
      });
    } catch (error) {
      console.error(`Erro ao inicializar submódulos de ${repoPath}:`, error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('Erro na Inicialização')
        .setDescription(`Falha ao inicializar submódulos: ${error.message}`)
        .setColor(0xFF0000)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [errorEmbed]
      });
    }
  }

  async handleShowCommitModal(interaction, repoPath, panelId) {
    try {
      const pathHash = typeof repoPath === 'string' && repoPath.length > 32 
        ? this.mapRepoPath(repoPath)
        : repoPath;
      
      const modal = new ModalBuilder()
        .setCustomId(`commit-modal-${pathHash}:${panelId}`)
        .setTitle('Commitar Mudanças');
      
      const commitMessageInput = new TextInputBuilder()
        .setCustomId('commitMessage')
        .setLabel('Mensagem do Commit')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Descreva as mudanças realizadas')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(200);
      
      const actionRow = new ActionRowBuilder().addComponents(commitMessageInput);
      
      modal.addComponents(actionRow);
      
      await interaction.showModal(modal);
    } catch (error) {
      console.error(`Erro ao exibir modal de commit para ${repoPath}:`, error);
      await interaction.reply({
        content: `Erro ao exibir modal de commit: ${error.message}`,
        ephemeral: true
      });
    }
  }

  async handleCommitModalSubmit(interaction, repoPath, panelId) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const realPath = this.getRepoPath(repoPath) || repoPath;
      
      const commitMessage = interaction.fields.getTextInputValue('commitMessage');
      
      const progressEmbed = new EmbedBuilder()
        .setTitle('Realizando Commit')
        .setDescription(`Commitando mudanças em: ${path.basename(realPath)}`)
        .setColor(0x0099FF)
        .addFields(
          { name: 'Mensagem', value: commitMessage }
        )
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [progressEmbed]
      });
      
      const result = await gitManager.commitAndPush(realPath, commitMessage);
      
      const resultEmbed = new EmbedBuilder()
        .setTitle('Commit Concluído')
        .setDescription(result)
        .setColor(0x00FF00)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [resultEmbed]
      });
    } catch (error) {
      console.error(`Erro ao commitar mudanças:`, error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('Erro no Commit')
        .setDescription(`Falha ao commitar mudanças: ${error.message}`)
        .setColor(0xFF0000)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [errorEmbed]
      });
    }
  }


  async handleStatusAll(interaction, panelId) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const repositories = await gitManager.getRepositories();
      
      if (repositories.length === 0) {
        const emptyEmbed = new EmbedBuilder()
          .setTitle('❌ Nenhum Repositório Encontrado')
          .setDescription('Não foi possível encontrar repositórios Git no diretório configurado.')
          .setColor(0xfa5252) // Vermelho
          .setFooter({ text: 'Verifique o caminho no arquivo .env' })
          .setTimestamp();
          
        await interaction.editReply({
          embeds: [emptyEmbed]
        });
        return;
      }
      
      let totalRepos = 0;
      let totalSubmodules = 0;
      let reposWithChanges = 0;
      let initializedSubmodules = 0;
      let uninitializedSubmodules = 0;
      let detachedSubmodules = 0;
      const mainRepo = repositories.find(r => !r.isSubmodule);
      
      for (const repo of repositories) {
        if (repo.isSubmodule) {
          totalSubmodules++;
          if (repo.status === 'inicializado') {
            initializedSubmodules++;
          } else if (repo.status === 'não inicializado') {
            uninitializedSubmodules++;
          } else if (repo.status === 'detached HEAD') {
            detachedSubmodules++;
          }
        } else {
          totalRepos++;
          try {
            const status = await gitManager.getRepositoryStatus(repo.path);
            if (status.hasChanges) {
              reposWithChanges++;
            }
          } catch (error) {
            console.error(`Erro ao obter status de ${repo.name}:`, error);
          }
        }
      }
      
      const statusEmbed = new EmbedBuilder()
        .setTitle('📊 Status Geral dos Repositórios')
        .setDescription(
          `### Visão Geral de ${repositories.length} repositórios\n` +
          `Estatísticas de todos os repositórios e submódulos monitorados.`
        )
        .setColor(0x4c6ef5)
        .addFields(
          { 
            name: '📁 Repositórios Principais', 
            value: `${totalRepos}`, 
            inline: true 
          },
          { 
            name: '📝 Com Modificações', 
            value: `${reposWithChanges}`, 
            inline: true 
          },
          {
            name: '\u200B',
            value: '\u200B',
            inline: true
          },
          { 
            name: '🔗 Total de Submódulos', 
            value: `${totalSubmodules}`, 
            inline: true 
          },
          {
            name: '✅ Inicializados',
            value: `${initializedSubmodules}`,
            inline: true
          },
          {
            name: '⚠️ Detached HEAD',
            value: `${detachedSubmodules}`,
            inline: true
          }
        )
        .setFooter({ 
          text: `ID do Painel: ${panelId}`,
          iconURL: 'https://git-scm.com/images/logos/downloads/Git-Icon-1788C.png'
        })
        .setTimestamp();
        
      const actionComponents = [];
      
      const actionButtons1 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`list-repos:${panelId}`)
            .setLabel('Listar Repositórios')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📚'),
          new ButtonBuilder()
            .setCustomId(`sync-all:${panelId}`)
            .setLabel('Atualizar Todos')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🔄')
        );
      
      actionComponents.push(actionButtons1);
      
      if (detachedSubmodules > 0 && mainRepo) {
        const pathHash = this.mapRepoPath(mainRepo.path);
        
        const actionButtons2 = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`fix-all-detached-${pathHash}:${panelId}`)
              .setLabel(`Corrigir ${detachedSubmodules} Submódulo(s) Detached`)
              .setStyle(ButtonStyle.Danger)
              .setEmoji('🔧')
          );
        
        actionComponents.push(actionButtons2);
      }
      
      await interaction.editReply({
        embeds: [statusEmbed],
        components: actionComponents
      });
    } catch (error) {
      console.error('Erro ao obter status geral:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Erro ao Obter Status')
        .setDescription(`Ocorreu um erro ao processar o status dos repositórios:\n\`\`\`${error.message}\`\`\``)
        .setColor(0xfa5252)
        .setFooter({ text: 'Verifique os logs para mais detalhes' })
        .setTimestamp();
        
      await interaction.editReply({
        embeds: [errorEmbed]
      });
    }
  }
}

module.exports = ButtonHandler; 