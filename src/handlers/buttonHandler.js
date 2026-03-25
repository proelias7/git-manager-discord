const { 
  EmbedBuilder, 
  ActionRowBuilder, 
  StringSelectMenuBuilder, 
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder
} = require('discord.js');
const path = require('path');
const fs = require('fs');
const simpleGit = require('simple-git');
const GitManager = require('../utils/gitManager');
const { isMainRepositoryPath } = require('../utils/repoPaths');
const { isPullOnRestartOnly } = require('../utils/repoPolicy');
const restartPullQueue = require('../utils/restartPullQueue');
const gitPermissions = require('../utils/gitPermissions');
const repoUserAccess = require('../utils/repoUserAccess');

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
    /** @type {Map<string, { mode: string, pathHash?: string|null, userIds?: string[], userIdToRemove?: string|null }>} */
    this.accessWizardState = new Map();
  }

  accessWizardKey(userId, panelId) {
    return `${userId}:${panelId}`;
  }

  clearAccessWizardState(key) {
    this.accessWizardState.delete(key);
  }

  /**
   * Resolve apelido/tag para mostrar no embed e no StringSelect (membro do servidor ou API user).
   * @param {import('discord.js').Guild | null} guild
   * @param {string} userId
   * @returns {Promise<{ label: string, description: string, embedLine: string, summaryLine: string }>}
   */
  async resolveUserDisplayForAccess(guild, userId) {
    try {
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          const tag = member.user?.tag ?? member.user?.username ?? userId;
          const dn = (member.displayName || member.user?.username || 'user').slice(0, 60);
          const shortId = userId.length > 8 ? `…${userId.slice(-6)}` : userId;
          return {
            label: `${dn} ${shortId}`.slice(0, 100),
            description: `ID ${userId}`.slice(0, 100),
            embedLine: `• **${dn}** · \`${tag}\` — <@${userId}>`,
            summaryLine: `**${dn}** (${tag}) — <@${userId}>`
          };
        }
      }
      if (this.client) {
        const u = await this.client.users.fetch(userId).catch(() => null);
        if (u) {
          const dn = (u.globalName || u.username).slice(0, 60);
          return {
            label: `${dn} · ${userId.slice(-6)}`.slice(0, 100),
            description: `ID ${userId}`.slice(0, 100),
            embedLine: `• **${dn}** · \`${u.tag}\` — <@${userId}>`,
            summaryLine: `**${dn}** (${u.tag}) — <@${userId}>`
          };
        }
      }
    } catch (_) {
      /* fallback abaixo */
    }
    return {
      label: `ID ${userId}`.slice(0, 100),
      description: 'Utilizador',
      embedLine: `• <@${userId}> — \`${userId}\``,
      summaryLine: `<@${userId}> (\`${userId}\`)`
    };
  }

  /**
   * @param {import('discord.js').Guild | null} guild
   * @param {string[]} userIds
   */
  async buildAccessListEmbedBlock(guild, userIds) {
    if (!userIds.length) {
      return '*Ninguém na lista — só quem tem o cargo admin Git pode usar até alguém ser adicionado.*';
    }
    const lines = [];
    for (const id of userIds) {
      const info = await this.resolveUserDisplayForAccess(guild, id);
      lines.push(info.embedLine);
    }
    let text = lines.join('\n');
    if (text.length > 3500) {
      text = `${lines.slice(0, 20).join('\n')}\n*… e mais ${userIds.length - 20} utilizador(es).*`;
    }
    return text;
  }

  /**
   * @param {import('discord.js').Guild | null} guild
   * @param {string[]} userIds
   * @param {string | null} defaultUserId
   */
  async buildRemoveUserSelectOptions(guild, userIds, defaultUserId) {
    const slice = userIds.slice(0, 25);
    const options = [];
    for (const uid of slice) {
      const info = await this.resolveUserDisplayForAccess(guild, uid);
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(info.label)
        .setValue(uid)
        .setDescription(info.description);
      if (defaultUserId && uid === defaultUserId) {
        opt.setDefault(true);
      }
      options.push(opt);
    }
    return options;
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

  /**
   * Resolve caminho do repositório a partir do customId de botão (pathHash ou legado).
   * @param {string} actionPart
   * @returns {string|null}
   */
  resolveRepoPathFromButtonAction(actionPart) {
    if (/^(pull-|update-sub-|fix-detached-|init-sub-|commit-)[a-f0-9]{16}$/.test(actionPart)) {
      const pathHash = actionPart.substring(actionPart.lastIndexOf('-') + 1);
      return this.getRepoPath(pathHash) || null;
    }
    if (actionPart.startsWith('fix-all-detached-')) {
      const pathHash = actionPart.substring('fix-all-detached-'.length);
      return this.getRepoPath(pathHash) || null;
    }
    const hashPrefixes = [
      'pull-commit-',
      'pull-stash-',
      'pull-force-',
      'update-all-commit-',
      'update-all-stash-',
      'update-all-force-'
    ];
    for (const p of hashPrefixes) {
      if (actionPart.startsWith(p)) {
        const pathHash = actionPart.substring(p.length);
        if (/^[a-f0-9]{16}$/.test(pathHash)) {
          return this.getRepoPath(pathHash) || null;
        }
      }
    }
    if (actionPart.startsWith('pull-')) {
      const rest = actionPart.substring('pull-'.length);
      if (/^[a-f0-9]{16}$/.test(rest)) return this.getRepoPath(rest) || null;
      return rest || null;
    }
    if (actionPart.startsWith('update-sub-')) {
      const rest = actionPart.substring('update-sub-'.length);
      if (/^[a-f0-9]{16}$/.test(rest)) return this.getRepoPath(rest) || null;
      return rest || null;
    }
    if (actionPart.startsWith('fix-detached-')) {
      const rest = actionPart.substring('fix-detached-'.length);
      if (/^[a-f0-9]{16}$/.test(rest)) return this.getRepoPath(rest) || null;
      return rest || null;
    }
    if (actionPart.startsWith('init-sub-')) {
      const rest = actionPart.substring('init-sub-'.length);
      if (/^[a-f0-9]{16}$/.test(rest)) return this.getRepoPath(rest) || null;
      return rest || null;
    }
    if (actionPart.startsWith('commit-')) {
      const rest = actionPart.substring('commit-'.length);
      if (/^[a-f0-9]{16}$/.test(rest)) return this.getRepoPath(rest) || null;
      return rest || null;
    }
    return null;
  }

  /**
   * @param {import('discord.js').ButtonInteraction} interaction
   * @param {string} actionPart
   * @returns {Promise<boolean>}
   */
  async assertPermissionForGitAction(interaction, actionPart) {
    const member = interaction.member;
    const mainPath = process.env.GIT_BASE_PATH;
    if (!member) {
      await interaction.reply({ content: 'Esta ação só está disponível no servidor.', ephemeral: true });
      return false;
    }

    if (actionPart.startsWith('pull-cancel') || actionPart.startsWith('update-all-cancel')) {
      return true;
    }

    if (actionPart === 'manage-access') {
      if (!gitPermissions.isGitAdmin(member)) {
        await interaction.reply({
          content: 'Apenas membros com o cargo de administrador Git (`GIT_ADMIN_ROLE_ID`) podem gerir acessos.',
          ephemeral: true
        });
        return false;
      }
      return true;
    }

    if (actionPart.startsWith('access-wizard-')) {
      if (!gitPermissions.isGitAdmin(member)) {
        await interaction.reply({
          content: 'Apenas administradores Git podem gerir acessos.',
          ephemeral: true
        });
        return false;
      }
      return true;
    }

    if (actionPart === 'scheduled-pulls-clear') {
      if (!gitPermissions.isGitAdmin(member)) {
        await interaction.reply({
          content: 'Apenas administradores Git podem esvaziar a fila inteira.',
          ephemeral: true
        });
        return false;
      }
      return true;
    }

    const panelMainActions = [
      'list-repos',
      'sync-all',
      'update-all',
      'status-all',
      'fix-all-detached',
      'scheduled-pulls',
      'scheduled-pulls-close',
      'scheduled-pull-remove'
    ];
    if (panelMainActions.includes(actionPart)) {
      if (!mainPath || !gitPermissions.canUserActOnGit(member, mainPath)) {
        await interaction.reply({
          content: 'Sem permissão para ações no repositório principal. Peça um administrador Git para autorizar o seu utilizador.',
          ephemeral: true
        });
        return false;
      }
      return true;
    }

    const repoPath = this.resolveRepoPathFromButtonAction(actionPart);
    if (repoPath) {
      if (!gitPermissions.canUserActOnGit(member, repoPath)) {
        await interaction.reply({
          content: 'Sem permissão para este repositório. Peça um administrador Git para o adicionar em **Gerir acessos**.',
          ephemeral: true
        });
        return false;
      }
      return true;
    }

    return true;
  }

  /**
   * Submódulos e caminhos em pullOnRestartOnly só entram na fila para o horário agendado.
   * @param {string} repoPath
   * @returns {boolean}
   */
  shouldQueuePullForDiscord(repoPath) {
    if (!isMainRepositoryPath(repoPath)) return true;
    if (isPullOnRestartOnly(repoPath)) return true;
    return false;
  }

  /**
   * @param {import('discord.js').Interaction} interaction
   * @param {string} repoPath
   * @param {string} panelId
   */
  async replyPullQueued(interaction, repoPath, panelId) {
    restartPullQueue.enqueue(repoPath);
    const queued = restartPullQueue.peek().length;
    const embed = new EmbedBuilder()
      .setTitle('Pull enfileirado')
      .setDescription(
        `**${path.basename(repoPath)}** foi adicionado à fila para o próximo horário de reinício ` +
          '(pull automático alguns minutos antes, conforme `RESTART_SCHEDULE` no `.env`).\n' +
          `Caminhos únicos na fila: **${queued}**.\n\n` +
          'No painel principal use **Pulls agendados** para ver ou retirar da fila.'
      )
      .setColor(0x3498db)
      .setFooter({ text: `ID do Painel: ${panelId} | Auto-exclusão em 15s` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed], components: [] });
    await this.scheduleInteractionReplyDeletion(interaction, 15);
  }

  /**
   * Enfileira todos os submódulos conhecidos (após pull do principal).
   * @returns {Promise<string[]>}
   */
  async enqueueAllSubmodulesForRestart() {
    try {
      const repos = await gitManager.getRepositories();
      const names = [];
      for (const r of repos) {
        if (r.isSubmodule && r.path) {
          restartPullQueue.enqueue(r.path);
          names.push(r.name || path.basename(r.path));
        }
      }
      return names;
    } catch {
      return [];
    }
  }

  /**
   * Embed + componentes do painel **Pulls agendados** (fila persistida).
   * @param {string} panelId
   * @param {import('discord.js').GuildMember | null} member
   */
  async buildScheduledPullsPanelPayload(panelId, member) {
    const paths = restartPullQueue.peek();
    let desc = '';
    if (paths.length === 0) {
      desc =
        'A fila está **vazia**. Repositórios entram aqui quando o pull é enfileirado para o próximo ' +
        'reinício agendado (ex.: submódulos ou repositório principal com pull só no restart).';
    } else {
      const lines = paths.map((p, i) => `${i + 1}. **${path.basename(p)}**\n\`${p}\``);
      desc =
        `**${paths.length}** repositório(s) na fila (serão processados no próximo ciclo do agendador):\n\n` +
        `${lines.join('\n\n')}`;
      if (desc.length > 3800) {
        desc = `${desc.slice(0, 3797)}…`;
      }
      desc +=
        '\n\n*No menu abaixo pode **retirar** da fila os repositórios em que tem permissão Git.*';
    }

    const removable = member
      ? paths.filter((p) => gitPermissions.canUserActOnGit(member, p))
      : [];
    if (paths.length > 0 && removable.length === 0 && member) {
      desc +=
        '\n\n*Não pode remover entradas: não tem permissão em nenhum destes repositórios (ou peça um admin Git).*';
    }
    if (removable.length > 25) {
      desc +=
        '\n\n*Só os primeiros 25 removíveis aparecem no menu; remova e reabra para ver o resto.*';
    }
    if (desc.length > 4090) {
      desc = `${desc.slice(0, 4087)}…`;
    }

    const embed = new EmbedBuilder()
      .setTitle('⏱️ Pulls agendados')
      .setDescription(desc)
      .setColor(0x3498db)
      .setFooter({ text: `data/restartPullQueue.json | Painel: ${panelId}` })
      .setTimestamp();

    const components = [];
    if (removable.length > 0) {
      const slice = removable.slice(0, 25);
      const options = slice.map((p) => {
        const pathHash = this.mapRepoPath(p);
        return new StringSelectMenuOptionBuilder()
          .setLabel(path.basename(p).slice(0, 100))
          .setValue(pathHash)
          .setDescription((p.length > 100 ? `…${p.slice(-99)}` : p).slice(0, 100));
      });
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`scheduled-pull-remove:${panelId}`)
            .setPlaceholder('Remover da fila…')
            .addOptions(options)
        )
      );
    }

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`scheduled-pulls-close:${panelId}`)
        .setLabel('Fechar')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖')
    );
    if (member && gitPermissions.isGitAdmin(member) && paths.length > 0) {
      closeRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`scheduled-pulls-clear:${panelId}`)
          .setLabel('Limpar fila')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🗑️')
      );
    }
    components.push(closeRow);

    return { embeds: [embed], components };
  }

  async handleScheduledPulls(interaction, panelId) {
    await interaction.deferReply({ ephemeral: true });
    const payload = await this.buildScheduledPullsPanelPayload(panelId, interaction.member);
    await interaction.editReply(payload);
  }

  async handleScheduledPullsClose(interaction, panelId) {
    await interaction.deferUpdate();
    await interaction.editReply({
      content: 'Painel de pulls agendados fechado.',
      embeds: [],
      components: []
    });
    await this.scheduleInteractionReplyDeletion(interaction, 6);
  }

  async handleScheduledPullsClear(interaction, panelId) {
    await interaction.deferUpdate();
    if (!gitPermissions.isGitAdmin(interaction.member)) {
      await interaction.followUp({
        content: 'Apenas administradores Git podem esvaziar a fila.',
        ephemeral: true
      });
      return;
    }
    restartPullQueue.clear();
    const payload = await this.buildScheduledPullsPanelPayload(panelId, interaction.member);
    await interaction.editReply(payload);
  }

  async handleScheduledPullRemove(interaction, panelId) {
    await interaction.deferUpdate();
    const pathHash = interaction.values[0];
    const repoPath = this.getRepoPath(pathHash);
    if (!repoPath) {
      await interaction.editReply({
        content: 'Entrada inválida. Abra **Pulls agendados** outra vez.',
        embeds: [],
        components: []
      });
      return;
    }
    if (!gitPermissions.canUserActOnGit(interaction.member, repoPath)) {
      await interaction.followUp({
        content: 'Sem permissão para remover este repositório da fila.',
        ephemeral: true
      });
      return;
    }
    restartPullQueue.remove(repoPath);
    const payload = await this.buildScheduledPullsPanelPayload(panelId, interaction.member);
    await interaction.editReply(payload);
  }

  async cleanupAndReply(interaction) {
    try {
      // Verifica se é o painel principal - NÃO deletar o painel inicial
      const isMainPanel = this.isMainPanel(interaction.message);
      
      // Deleta apenas mensagens de interações, não o painel principal
      if (!isMainPanel && interaction.message && interaction.message.deletable) {
        await interaction.message.delete();
        console.log('Mensagem de interação anterior deletada para manter chat limpo');
      }
      
      // Responde normalmente (não ephemeral para permitir futuras interações)
      await interaction.deferReply({ ephemeral: false });
    } catch (error) {
      console.error('Erro ao limpar mensagem anterior:', error);
      // Se falhar ao deletar, apenas defere a resposta
      try {
        await interaction.deferReply({ ephemeral: false });
      } catch (deferError) {
        console.error('Erro ao defer reply:', deferError);
      }
    }
  }


  async scheduleMessageDeletion(message, delayInSeconds = 30) {
    try {
      if (!message || !message.deletable) {
        return;
      }

      // Programa a exclusão da mensagem após o tempo especificado
      setTimeout(async () => {
        try {
          if (message.deletable) {
            await message.delete();
            console.log(`Mensagem de resultado auto-deletada após ${delayInSeconds} segundos`);
          }
        } catch (error) {
          console.error('Erro ao auto-deletar mensagem:', error);
        }
      }, delayInSeconds * 1000);
      
    } catch (error) {
      console.error('Erro ao programar exclusão de mensagem:', error);
    }
  }

  /**
   * Apaga a resposta da interação (deferReply/editReply) via API de webhook.
   * Mais fiável do que message.delete() quando deletable vem false em respostas do bot.
   * @param {import('discord.js').Interaction} interaction
   * @param {number} delayInSeconds
   */
  async scheduleInteractionReplyDeletion(interaction, delayInSeconds = 10) {
    setTimeout(async () => {
      try {
        await interaction.deleteReply();
        console.log(`Resposta da interação apagada após ${delayInSeconds}s`);
      } catch (e) {
        console.error('Erro ao deleteReply:', e?.message || e);
        try {
          const msg = await interaction.fetchReply().catch(() => null);
          if (msg?.deletable) await msg.delete();
        } catch (e2) {
          console.error('Erro ao apagar mensagem (fallback):', e2?.message || e2);
        }
      }
    }, delayInSeconds * 1000);
  }


  async sendTemporaryResult(interaction, embed, delayInSeconds = 10) {
    try {
      await interaction.editReply({
        embeds: [embed],
        components: []
      });

      this.scheduleInteractionReplyDeletion(interaction, delayInSeconds);
    } catch (error) {
      console.error('Erro ao enviar resultado temporário:', error);
      throw error;
    }
  }


  isMainPanel(message) {
    if (!message || !message.embeds || message.embeds.length === 0) {
      return false;
    }
    
    const embed = message.embeds[0];
    
    // Verifica se é o painel principal pelo título
    if (embed.title === '🛠️ Painel de Controle Git') {
      return true;
    }
    
    // Verifica se é o painel principal pela descrição característica
    if (embed.description && embed.description.includes('Bem-vindo ao Painel de Controle Git!')) {
      return true;
    }
    
    return false;
  }


  async cleanupAndUpdate(interaction) {
    try {
      // Para interações que usam update ao invés de reply
      await interaction.deferUpdate();
    } catch (error) {
      console.error('Erro ao fazer defer update:', error);
    }
  }


  async handleButtonInteraction(interaction) {
    try {
      const customId = interaction.customId;

      /** Adicionar/Remover com repositório: access-wizard-(add|remove):pathHash(16):panelId */
      const accessRepoBtn = /^access-wizard-(add|remove):([a-f0-9]{16}):(.+)$/.exec(customId);

      let panelId;
      let actionPart;

      if (accessRepoBtn) {
        actionPart = `access-wizard-${accessRepoBtn[1]}`;
        panelId = accessRepoBtn[3];
      } else {
        const lastColonIndex = customId.lastIndexOf(':');
        if (lastColonIndex === -1) {
          await interaction.reply({
            content: 'Formato de botão inválido. Por favor, use o comando `/init` para criar um novo painel.',
            ephemeral: true
          });
          return;
        }
        panelId = customId.substring(lastColonIndex + 1);
        actionPart = customId.substring(0, lastColonIndex);
      }

      console.log(`Processando ação de botão: ${actionPart} para painel: ${panelId}`);

      const permissionOk = await this.assertPermissionForGitAction(interaction, actionPart);
      if (!permissionOk) {
        return;
      }

      if (actionPart === 'manage-access') {
        await this.handleManageAccess(interaction, panelId);
        return;
      }

      if (accessRepoBtn) {
        const pathHash = accessRepoBtn[2];
        if (accessRepoBtn[1] === 'add') {
          await this.handleAccessWizardOpenAdd(interaction, panelId, pathHash);
        } else {
          await this.handleAccessWizardOpenRemove(interaction, panelId, pathHash);
        }
        return;
      }

      if (actionPart.startsWith('access-wizard-')) {
        if (actionPart === 'access-wizard-confirm-add') {
          await this.handleAccessWizardConfirmAdd(interaction, panelId);
          return;
        }
        if (actionPart === 'access-wizard-confirm-remove') {
          await this.handleAccessWizardConfirmRemove(interaction, panelId);
          return;
        }
        if (actionPart === 'access-wizard-cancel') {
          await this.handleAccessWizardCancel(interaction, panelId);
          return;
        }
        if (actionPart === 'access-wizard-back-remove') {
          await this.handleAccessWizardBackToMain(interaction, panelId);
          return;
        }
        if (actionPart === 'access-wizard-close') {
          await this.handleAccessWizardClose(interaction, panelId);
          return;
        }
      }

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
      } else if (actionPart === 'scheduled-pulls') {
        await this.handleScheduledPulls(interaction, panelId);
      } else if (actionPart === 'scheduled-pulls-close') {
        await this.handleScheduledPullsClose(interaction, panelId);
      } else if (actionPart === 'scheduled-pulls-clear') {
        await this.handleScheduledPullsClear(interaction, panelId);
      } else if (actionPart.startsWith('pull-commit-')) {
        const pathHash = actionPart.replace('pull-commit-', '');
        const repoPath = this.getRepoPath(pathHash);
        await this.handlePullWithCommit(interaction, repoPath, panelId);
      } else if (actionPart.startsWith('pull-stash-')) {
        const pathHash = actionPart.replace('pull-stash-', '');
        const repoPath = this.getRepoPath(pathHash);
        await this.handlePullWithMode(interaction, repoPath, 'stash', panelId);
      } else if (actionPart.startsWith('pull-force-')) {
        const pathHash = actionPart.replace('pull-force-', '');
        const repoPath = this.getRepoPath(pathHash);
        await this.handlePullWithMode(interaction, repoPath, 'force', panelId);
      } else if (actionPart.startsWith('pull-cancel-')) {
        const reply = await interaction.update({
          components: [],
          embeds: [
            new EmbedBuilder()
              .setTitle('Operação Cancelada')
              .setDescription('A operação de pull foi cancelada. Suas alterações locais foram mantidas.')
              .setColor(0x999999)
              .setFooter({ text: `ID do Painel: ${panelId} | Auto-exclusão em 8s` })
              .setTimestamp()
          ]
        });
        await this.scheduleMessageDeletion(reply, 8);
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
      } else if (actionPart.startsWith('update-all-commit-')) {
        const pathHash = actionPart.replace('update-all-commit-', '');
        const repoPath = this.getRepoPath(pathHash);
        await this.handleUpdateAllWithCommit(interaction, repoPath, panelId);
      } else if (actionPart.startsWith('update-all-stash-')) {
        const pathHash = actionPart.replace('update-all-stash-', '');
        const repoPath = this.getRepoPath(pathHash);
        await this.handleUpdateAllWithMode(interaction, repoPath, 'stash', panelId);
      } else if (actionPart.startsWith('update-all-force-')) {
        const pathHash = actionPart.replace('update-all-force-', '');
        const repoPath = this.getRepoPath(pathHash);
        await this.handleUpdateAllWithMode(interaction, repoPath, 'force', panelId);
      } else if (actionPart.startsWith('update-all-cancel-')) {
        const reply = await interaction.update({
          components: [],
          embeds: [
            new EmbedBuilder()
              .setTitle('Operação Cancelada')
              .setDescription('A operação de atualização foi cancelada. Suas alterações locais foram mantidas.')
              .setColor(0x999999)
              .setFooter({ text: `ID do Painel: ${panelId} | Auto-exclusão em 8s` })
              .setTimestamp()
          ]
        });
        await this.scheduleMessageDeletion(reply, 8);
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
      } else if (actionPart === 'access-wizard-main-repo') {
        if (!gitPermissions.isGitAdmin(interaction.member)) {
          await interaction.reply({ content: 'Apenas administradores Git.', ephemeral: true });
          return;
        }
        await this.handleAccessMainRepoSelect(interaction, panelId);
      } else if (actionPart === 'scheduled-pull-remove') {
        const permissionOk = await this.assertPermissionForGitAction(interaction, actionPart);
        if (!permissionOk) {
          return;
        }
        await this.handleScheduledPullRemove(interaction, panelId);
      } else if (actionPart === 'access-wizard-user-remove') {
        if (!gitPermissions.isGitAdmin(interaction.member)) {
          await interaction.reply({ content: 'Apenas administradores Git.', ephemeral: true });
          return;
        }
        await this.handleAccessWizardUserRemovePick(interaction, panelId);
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

  async renderManageAccessMainPanel(panelId) {
    const embed = new EmbedBuilder()
      .setTitle('Gerir acessos')
      .setDescription(
        'Escolha **Adicionar** ou **Remover** utilizador.\n\n' +
          '1. Selecione o **repositório** no menu abaixo.\n' +
          '2. Depois use **Adicionar** ou **Remover** (os botões ficam ativos após escolher o repositório).\n\n' +
          '• **Adicionar:** escolha utilizadores no menu e **Confirmar**.\n' +
          '• **Remover:** escolha o utilizador e **Confirmar**.\n' +
          '• **Cancelar** volta a este menu sem guardar (pode continuar a gerir).\n' +
          '• **Fechar** encerra o painel **Gerir acessos**.'
      )
      .setColor(0x5865f2)
      .setFooter({ text: `ID do Painel: ${panelId}` })
      .setTimestamp();

    const options = await this.buildAccessWizardRepoOptions();
    const rowSelect = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`access-wizard-main-repo:${panelId}`)
        .setPlaceholder('Selecione o repositório')
        .addOptions(options)
    );
    const rowBtns = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`access-wizard-add-pending:${panelId}`)
        .setLabel('Adicionar utilizador')
        .setStyle(ButtonStyle.Success)
        .setEmoji('➕')
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`access-wizard-remove-pending:${panelId}`)
        .setLabel('Remover utilizador')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('➖')
        .setDisabled(true)
    );

    return {
      embeds: [embed],
      components: [rowSelect, rowBtns, this.buildAccessWizardCloseRow(panelId)]
    };
  }

  /**
   * Botão para fechar o fluxo **Gerir acessos** (mensagem ephemeral).
   * @param {string} panelId
   */
  buildAccessWizardCloseRow(panelId) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`access-wizard-close:${panelId}`)
        .setLabel('Fechar')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖')
    );
  }

  async handleManageAccess(interaction, panelId) {
    await interaction.deferReply({ ephemeral: true });
    const repos = await gitManager.getRepositories();
    if (repos.length === 0) {
      await interaction.editReply({ content: 'Nenhum repositório encontrado.' });
      return;
    }
    const payload = await this.renderManageAccessMainPanel(panelId);
    await interaction.editReply(payload);
  }

  /**
   * @param {string | null} selectedPathHash
   */
  async buildAccessWizardRepoOptions(selectedPathHash = null) {
    const repos = await gitManager.getRepositories();
    return repos.slice(0, 25).map((repo) => {
      const pathHash = this.mapRepoPath(repo.path);
      let label = repo.name;
      if (repo.isSubmodule) label = `${repo.name} (sub)`;
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(label.slice(0, 100))
        .setValue(pathHash)
        .setDescription((repo.path || '').slice(0, 100));
      if (selectedPathHash && pathHash === selectedPathHash) {
        opt.setDefault(true);
      }
      return opt;
    });
  }

  async handleAccessMainRepoSelect(interaction, panelId) {
    await interaction.deferUpdate();
    const pathHash = interaction.values[0];
    const repoPath = this.getRepoPath(pathHash);
    const options = await this.buildAccessWizardRepoOptions(pathHash);

    const guild = interaction.guild;
    const withAccess = repoPath ? repoUserAccess.getUsersForRepo(repoPath) : [];
    const listBlock = await this.buildAccessListEmbedBlock(guild, withAccess);

    const embed = new EmbedBuilder()
      .setTitle('Gerir acessos')
      .setDescription(
        `**Repositório selecionado:** \`${repoPath || '(inválido)'}\`\n\n` +
          `**Quem tem acesso** (${withAccess.length}):\n${listBlock}\n\n` +
          'Use **Adicionar** ou **Remover** para alterar a lista.\n\n' +
          '**Fechar** encerra este painel.'
      )
      .setColor(0x5865f2)
      .setFooter({ text: `ID do Painel: ${panelId}` })
      .setTimestamp();

    const rowSelect = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`access-wizard-main-repo:${panelId}`)
        .setPlaceholder('Selecione o repositório')
        .addOptions(options)
    );
    const rowBtns = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`access-wizard-add:${pathHash}:${panelId}`)
        .setLabel('Adicionar utilizador')
        .setStyle(ButtonStyle.Success)
        .setEmoji('➕'),
      new ButtonBuilder()
        .setCustomId(`access-wizard-remove:${pathHash}:${panelId}`)
        .setLabel('Remover utilizador')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('➖')
    );

    await interaction.editReply({
      embeds: [embed],
      components: [rowSelect, rowBtns, this.buildAccessWizardCloseRow(panelId)]
    });
  }

  async handleAccessWizardClose(interaction, panelId) {
    await interaction.deferUpdate();
    const key = this.accessWizardKey(interaction.user.id, panelId);
    this.clearAccessWizardState(key);
    await interaction.editReply({
      content: '**Gerir acessos** fechado.',
      embeds: [],
      components: []
    });
    await this.scheduleInteractionReplyDeletion(interaction, 8);
  }

  async handleAccessWizardBackToMain(interaction, panelId) {
    await interaction.deferUpdate();
    const payload = await this.renderManageAccessMainPanel(panelId);
    await interaction.editReply(payload);
  }

  async handleAccessWizardOpenAdd(interaction, panelId, pathHash) {
    await interaction.deferUpdate();
    const key = this.accessWizardKey(interaction.user.id, panelId);
    this.accessWizardState.set(key, { mode: 'add', pathHash, userIds: [] });

    const repoPath = this.getRepoPath(pathHash);
    const guild = interaction.guild;
    const already = repoPath ? repoUserAccess.getUsersForRepo(repoPath) : [];
    const listBlock = await this.buildAccessListEmbedBlock(guild, already);

    const embed = new EmbedBuilder()
      .setTitle('Adicionar utilizador')
      .setDescription(
        `**Repositório:** \`${repoPath || '(inválido)'}\`\n\n` +
          `**Quem já tem acesso** (${already.length}):\n${listBlock}\n\n` +
          'Use o menu **Utilizadores a adicionar** para escolher quem acrescentar à lista e clique em **Confirmar** (ou **Cancelar**).'
      )
      .setColor(0x57f287)
      .setFooter({ text: `Painel: ${panelId}` })
      .setTimestamp();

    const rowUser = new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`access-wizard-user-add:${panelId}`)
        .setPlaceholder('Utilizadores a adicionar')
        .setMinValues(1)
        .setMaxValues(10)
    );
    const rowBtns = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`access-wizard-confirm-add:${panelId}`)
        .setLabel('Confirmar')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`access-wizard-cancel:${panelId}`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [rowUser, rowBtns] });
  }

  async handleAccessWizardUserAddSelect(interaction, panelId) {
    const userIds = interaction.values;
    const key = this.accessWizardKey(interaction.user.id, panelId);
    const st = this.accessWizardState.get(key) || { mode: 'add', pathHash: null, userIds: [] };
    st.mode = 'add';
    st.userIds = userIds;
    this.accessWizardState.set(key, st);

    await interaction.deferUpdate();

    const repoPath = st.pathHash ? this.getRepoPath(st.pathHash) : null;
    const guild = interaction.guild;
    const already = repoPath ? repoUserAccess.getUsersForRepo(repoPath) : [];
    const listBlock = await this.buildAccessListEmbedBlock(guild, already);

    const pickedLines = [];
    for (const id of userIds) {
      const info = await this.resolveUserDisplayForAccess(guild, id);
      pickedLines.push(`• ${info.summaryLine}`);
    }
    const usersLine = pickedLines.join('\n');

    const embed = new EmbedBuilder()
      .setTitle('Adicionar utilizador')
      .setDescription(
        `**Repositório:** ${repoPath ? `\`${repoPath}\`` : '*(inválido)*'}\n\n` +
          `**Quem já tem acesso** (${already.length}):\n${listBlock}\n\n` +
          `**A adicionar agora:**\n${usersLine}\n\n` +
          'Clique em **Confirmar** para guardar ou **Cancelar**.'
      )
      .setColor(0x57f287)
      .setFooter({ text: `Painel: ${panelId}` })
      .setTimestamp();

    const rowUser = new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`access-wizard-user-add:${panelId}`)
        .setPlaceholder('Utilizadores a adicionar')
        .setMinValues(1)
        .setMaxValues(10)
    );
    const rowBtns = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`access-wizard-confirm-add:${panelId}`)
        .setLabel('Confirmar')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`access-wizard-cancel:${panelId}`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [rowUser, rowBtns] });
  }

  async handleAccessWizardConfirmAdd(interaction, panelId) {
    const key = this.accessWizardKey(interaction.user.id, panelId);
    const st = this.accessWizardState.get(key);
    if (!st?.pathHash || !st.userIds?.length) {
      await interaction.reply({
        content:
          'Escolha primeiro **um ou mais utilizadores** no menu **Utilizadores a adicionar** e só depois clique em **Confirmar**.',
        ephemeral: true
      });
      return;
    }
    const repoPath = this.getRepoPath(st.pathHash);
    if (!repoPath) {
      this.clearAccessWizardState(key);
      await interaction.reply({
        content: 'Repositório inválido. Abra **Gerir acessos** novamente.',
        ephemeral: true
      });
      return;
    }

    await interaction.deferUpdate();
    for (const id of st.userIds) {
      repoUserAccess.addUser(repoPath, id);
    }
    const n = st.userIds.length;
    this.clearAccessWizardState(key);

    const payload = await this.renderManageAccessMainPanel(panelId);
    await interaction.editReply({
      content:
        `**${n}** utilizador(es) adicionado(s) ao repositório \`${repoPath}\`.\n` +
          '— *Menu de ações abaixo: pode escolher outro repositório ou adicionar/remover de novo.*',
      embeds: payload.embeds,
      components: payload.components
    });
  }

  async handleAccessWizardOpenRemove(interaction, panelId, pathHash) {
    await interaction.deferUpdate();
    const key = this.accessWizardKey(interaction.user.id, panelId);
    const st = { mode: 'remove', pathHash, userIdToRemove: null };
    this.accessWizardState.set(key, st);

    const repoPath = this.getRepoPath(pathHash);
    if (!repoPath) {
      await interaction.followUp({ content: 'Repositório inválido.', ephemeral: true });
      return;
    }
    const users = repoUserAccess.getUsersForRepo(repoPath);
    const guild = interaction.guild;

    if (users.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('Remover utilizador')
        .setDescription(
          `**Repositório:** \`${repoPath}\`\n\n*Não há utilizadores nesta lista (só o admin Git por cargo).*`
        )
        .setColor(0xed4245)
        .setFooter({ text: `Painel: ${panelId}` })
        .setTimestamp();
      const rowBack = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`access-wizard-back-remove:${panelId}`)
          .setLabel('« Voltar')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`access-wizard-cancel:${panelId}`)
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Secondary)
      );
      await interaction.editReply({ embeds: [embed], components: [rowBack] });
      return;
    }

    const defaultUid = users[0];
    st.userIdToRemove = defaultUid;
    this.accessWizardState.set(key, st);

    const listBlock = await this.buildAccessListEmbedBlock(guild, users);
    const firstPick = await this.resolveUserDisplayForAccess(guild, defaultUid);

    const userOptions = await this.buildRemoveUserSelectOptions(guild, users, defaultUid);

    const embed = new EmbedBuilder()
      .setTitle('Remover utilizador')
      .setDescription(
        `**Repositório:** \`${repoPath}\`\n\n` +
          `**Quem tem acesso** (${users.length}):\n${listBlock}\n\n` +
          `**A remover (pré-selecionado):** ${firstPick.summaryLine}\n` +
          'Altere no menu abaixo ou clique em **Confirmar**.'
      )
      .setColor(0xed4245)
      .setFooter({ text: `Painel: ${panelId}` })
      .setTimestamp();

    const rowUser = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`access-wizard-user-remove:${panelId}`)
        .setPlaceholder('Escolha quem remover da lista')
        .addOptions(userOptions)
    );
    const rowBtns = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`access-wizard-confirm-remove:${panelId}`)
        .setLabel('Confirmar')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`access-wizard-cancel:${panelId}`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`access-wizard-back-remove:${panelId}`)
        .setLabel('« Voltar')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [rowUser, rowBtns] });
  }

  async handleAccessWizardUserRemovePick(interaction, panelId) {
    const uid = interaction.values[0];
    const key = this.accessWizardKey(interaction.user.id, panelId);
    const st = this.accessWizardState.get(key) || { mode: 'remove' };
    st.userIdToRemove = uid;
    this.accessWizardState.set(key, st);

    await interaction.deferUpdate();

    const repoPath = st.pathHash ? this.getRepoPath(st.pathHash) : null;
    const guild = interaction.guild;
    const users = repoPath ? repoUserAccess.getUsersForRepo(repoPath) : [];
    const listBlock = await this.buildAccessListEmbedBlock(guild, users);
    const pickInfo = await this.resolveUserDisplayForAccess(guild, uid);

    const embed = new EmbedBuilder()
      .setTitle('Remover utilizador')
      .setDescription(
        `**Repositório:** \`${repoPath || ''}\`\n\n` +
          `**Quem tem acesso** (${users.length}):\n${listBlock}\n\n` +
          `**A remover (selecionado):** ${pickInfo.summaryLine}\n\n` +
          'Clique em **Confirmar** para guardar ou **Cancelar**.'
      )
      .setColor(0xed4245)
      .setFooter({ text: `Painel: ${panelId}` })
      .setTimestamp();

    const userOptions = await this.buildRemoveUserSelectOptions(guild, users, uid);

    const rowUser = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`access-wizard-user-remove:${panelId}`)
        .setPlaceholder('Escolha quem remover da lista')
        .addOptions(userOptions)
    );
    const rowBtns = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`access-wizard-confirm-remove:${panelId}`)
        .setLabel('Confirmar')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`access-wizard-cancel:${panelId}`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`access-wizard-back-remove:${panelId}`)
        .setLabel('« Voltar')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [rowUser, rowBtns] });
  }

  async handleAccessWizardConfirmRemove(interaction, panelId) {
    const key = this.accessWizardKey(interaction.user.id, panelId);
    const st = this.accessWizardState.get(key);
    if (!st?.pathHash || !st.userIdToRemove) {
      await interaction.reply({
        content:
          'Selecione o **utilizador** no menu (ou use o pré-selecionado) e só depois clique em **Confirmar**.',
        ephemeral: true
      });
      return;
    }
    const repoPath = this.getRepoPath(st.pathHash);
    if (!repoPath) {
      this.clearAccessWizardState(key);
      await interaction.reply({
        content: 'Repositório inválido.',
        ephemeral: true
      });
      return;
    }

    await interaction.deferUpdate();
    repoUserAccess.removeUser(repoPath, st.userIdToRemove);
    this.clearAccessWizardState(key);

    const payload = await this.renderManageAccessMainPanel(panelId);
    await interaction.editReply({
      content:
        `Utilizador removido de \`${repoPath}\`.\n` +
          '— *Menu de ações abaixo: pode escolher outro repositório ou adicionar/remover de novo.*',
      embeds: payload.embeds,
      components: payload.components
    });
  }

  async handleAccessWizardCancel(interaction, panelId) {
    await interaction.deferUpdate();
    const key = this.accessWizardKey(interaction.user.id, panelId);
    this.clearAccessWizardState(key);
    const payload = await this.renderManageAccessMainPanel(panelId);
    await interaction.editReply({
      content:
        'Operação cancelada — voltou ao **menu de ações**. Pode continuar a gerir abaixo.',
      embeds: payload.embeds,
      components: payload.components
    });
  }

  async handleUserSelectInteraction(interaction) {
    const customId = interaction.customId;
    const parts = customId.split(':');
    if (parts[0] === 'access-wizard-user-add' && parts.length === 2) {
      const panelId = parts[1];
      if (!gitPermissions.isGitAdmin(interaction.member)) {
        await interaction.reply({ content: 'Apenas administradores Git.', ephemeral: true });
        return;
      }
      await this.handleAccessWizardUserAddSelect(interaction, panelId);
      return;
    }
    await interaction.reply({ content: 'Menu inválido.', ephemeral: true });
  }


  async handleListRepositories(interaction, panelId) {
    await this.cleanupAndReply(interaction);
    
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
    const selectedRepoPath = interaction.values[0];
    if (!gitPermissions.canUserActOnGit(interaction.member, selectedRepoPath)) {
      await interaction.reply({
        content: 'Sem permissão para este repositório. Peça um administrador Git para o autorizar em **Gerir acessos**.',
        ephemeral: true
      });
      return;
    }

    await this.cleanupAndReply(interaction);
    
    try {
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
    await this.cleanupAndReply(interaction);
    
    try {
      if (this.shouldQueuePullForDiscord(repoPath)) {
        await this.replyPullQueued(interaction, repoPath, panelId);
        return;
      }

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
            { name: '📝 Commit e Pull', value: 'Commitar alterações locais automaticamente e depois fazer pull', inline: false },
            { name: '💾 Stash', value: 'Salvar alterações locais temporariamente e aplicá-las após o pull', inline: false },
            { name: '⚡ Forçar', value: 'Descartar todas as alterações locais (CUIDADO: mudanças serão perdidas)', inline: false },
            { name: '❌ Cancelar', value: 'Cancelar operação de pull', inline: false }
          )
          .setFooter({ text: `ID do Painel: ${panelId}` })
          .setTimestamp();
        
        const pathHash = this.mapRepoPath(repoPath);
        
        const actionButtons1 = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`pull-commit-${pathHash}:${panelId}`)
              .setLabel('Commit e Pull')
              .setStyle(ButtonStyle.Success)
              .setEmoji('📝'),
            new ButtonBuilder()
              .setCustomId(`pull-stash-${pathHash}:${panelId}`)
              .setLabel('Stash e Pull')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('💾'),
            new ButtonBuilder()
              .setCustomId(`pull-force-${pathHash}:${panelId}`)
              .setLabel('Forçar Pull')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('⚡')
          );
          
        const actionButtons2 = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`pull-cancel-${pathHash}:${panelId}`)
              .setLabel('Cancelar')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('❌')
          );
        
        await interaction.editReply({
          embeds: [optionsEmbed],
          components: [actionButtons1, actionButtons2]
        });
        return;
      }
      
      const resultEmbed = new EmbedBuilder()
        .setTitle('Pull Concluído')
        .setDescription(result)
        .setColor(0x00FF00)
        .setFooter({ text: `ID do Painel: ${panelId} | Auto-exclusão em 10s` })
        .setTimestamp();
      
      await this.sendTemporaryResult(interaction, resultEmbed, 10);
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
      await this.scheduleInteractionReplyDeletion(interaction, 15);
    }
  }


  async handlePullWithMode(interaction, repoPath, mode, panelId) {
    await this.cleanupAndUpdate(interaction);
    
    try {
      if (this.shouldQueuePullForDiscord(repoPath)) {
        const warn = new EmbedBuilder()
          .setTitle('Use a fila de reinício')
          .setDescription(
            'Este caminho só atualiza no horário de reinício. Use o botão **Pull** no repositório para enfileirar; stash/forçar não se aplicam à fila.'
          )
          .setColor(0x999999)
          .setFooter({ text: `ID do Painel: ${panelId}` })
          .setTimestamp();
        await interaction.editReply({ embeds: [warn], components: [] });
        await this.scheduleInteractionReplyDeletion(interaction, 15);
        return;
      }

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
        .setFooter({ text: `ID do Painel: ${panelId} | Auto-exclusão em 10s` })
        .setTimestamp();
      
      await this.sendTemporaryResult(interaction, resultEmbed, 10);
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
      await this.scheduleInteractionReplyDeletion(interaction, 15);
    }
  }


  async handleUpdateAll(interaction, panelId) {
    await this.cleanupAndReply(interaction);
    
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
      
      const result = await gitManager.pullRepository(mainRepo.path, false, 'normal');
      
      if (result === 'STATUS_HAS_CHANGES') {
        const optionsEmbed = new EmbedBuilder()
          .setTitle('⚠️ Mudanças não Commitadas Detectadas')
          .setDescription(
            `O repositório **${mainRepo.name}** possui mudanças locais não commitadas.\n\n` +
            `Escolha uma das opções abaixo:`
          )
          .setColor(0xFFA500)
          .addFields(
            { name: '📝 Commit e Update', value: 'Commitar alterações locais automaticamente e depois fazer update (apenas principal)', inline: false },
            { name: '💾 Stash', value: 'Salvar alterações locais temporariamente e aplicá-las após o pull', inline: false },
            { name: '⚡ Forçar', value: 'Descartar todas as alterações locais (CUIDADO: mudanças serão perdidas)', inline: false },
            { name: '❌ Cancelar', value: 'Cancelar operação de atualização', inline: false }
          )
          .setFooter({ text: `ID do Painel: ${panelId}` })
          .setTimestamp();
        
        const pathHash = this.mapRepoPath(mainRepo.path);
        
        const actionButtons1 = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`update-all-commit-${pathHash}:${panelId}`)
              .setLabel('Commit e Update')
              .setStyle(ButtonStyle.Success)
              .setEmoji('📝'),
            new ButtonBuilder()
              .setCustomId(`update-all-stash-${pathHash}:${panelId}`)
              .setLabel('Stash e Update')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('💾'),
            new ButtonBuilder()
              .setCustomId(`update-all-force-${pathHash}:${panelId}`)
              .setLabel('Forçar Update')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('⚡')
          );
          
        const actionButtons2 = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`update-all-cancel-${pathHash}:${panelId}`)
              .setLabel('Cancelar')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('❌')
          );
        
        await interaction.editReply({
          embeds: [optionsEmbed],
          components: [actionButtons1, actionButtons2]
        });
        return;
      }
      
      const subNames = await this.enqueueAllSubmodulesForRestart();
      let desc = `Resultado: ${result}`;
      if (subNames.length > 0) {
        desc += `\n\n**Submódulos enfileirados** para o próximo reinício (${subNames.length}): ${subNames.join(', ')}`;
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle('Atualização Concluída')
        .setDescription(desc)
        .setColor(0x00FF00)
        .setFooter({ text: `ID do Painel: ${panelId} | Auto-exclusão em 10s` })
        .setTimestamp();
      
      await this.sendTemporaryResult(interaction, resultEmbed, 10);
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
      await this.scheduleInteractionReplyDeletion(interaction, 15);
    }
  }


  async handleUpdateAllWithMode(interaction, repoPath, mode, panelId) {
    await this.cleanupAndUpdate(interaction);
    
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
      
      const result = await gitManager.pullRepository(repoPath, false, mode);
      
      const subNames = await this.enqueueAllSubmodulesForRestart();
      let desc = result;
      if (subNames.length > 0) {
        desc += `\n\n**Submódulos enfileirados** para o próximo reinício (${subNames.length}): ${subNames.join(', ')}`;
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle('Atualização Concluída')
        .setDescription(desc)
        .setColor(0x00FF00)
        .setFooter({ text: `ID do Painel: ${panelId} | Auto-exclusão em 10s` })
        .setTimestamp();
      
      await this.sendTemporaryResult(interaction, resultEmbed, 10);
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
      await this.scheduleInteractionReplyDeletion(interaction, 15);
    }
  }


  async handleUpdateSubmodules(interaction, repoPath, panelId) {
    await this.cleanupAndReply(interaction);
    
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
    await this.cleanupAndReply(interaction);
    
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
    await this.cleanupAndReply(interaction);
    
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
    await this.cleanupAndReply(interaction);
    
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
    await this.cleanupAndReply(interaction);
    
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
    await this.cleanupAndReply(interaction);
    
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


  async handlePullWithCommit(interaction, repoPath, panelId) {
    await this.cleanupAndUpdate(interaction);
    
    try {
      if (this.shouldQueuePullForDiscord(repoPath)) {
        await this.replyPullQueued(interaction, repoPath, panelId);
        return;
      }

      const progressEmbed = new EmbedBuilder()
        .setTitle('Commitando e Atualizando Repositório')
        .setDescription(
          `Fazendo commit automático das alterações locais e executando pull em: ${path.basename(repoPath)}`
        )
        .setColor(0x0099FF)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [progressEmbed],
        components: []
      });
      
      const result = await gitManager.commitAndPull(repoPath, false);
      
      const resultEmbed = new EmbedBuilder()
        .setTitle('Commit e Pull Concluídos')
        .setDescription(result)
        .setColor(0x00FF00)
        .setFooter({ text: `ID do Painel: ${panelId} | Auto-exclusão em 10s` })
        .setTimestamp();
      
      await this.sendTemporaryResult(interaction, resultEmbed, 10);
    } catch (error) {
      console.error(`Erro ao fazer commit e pull do repositório ${repoPath}:`, error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('Erro no Commit e Pull')
        .setDescription(`Falha ao fazer commit e atualizar repositório: ${error.message}`)
        .setColor(0xFF0000)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [errorEmbed],
        components: []
      });
    }
  }


  async handleUpdateAllWithCommit(interaction, repoPath, panelId) {
    await this.cleanupAndUpdate(interaction);
    
    try {
      const progressEmbed = new EmbedBuilder()
        .setTitle('Commitando e Atualizando Repositório')
        .setDescription(
          `Fazendo commit automático das alterações locais e atualizando: ${path.basename(repoPath)}`
        )
        .setColor(0x0099FF)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [progressEmbed],
        components: []
      });
      
      const result = await gitManager.commitAndPull(repoPath, false);
      
      const subNames = await this.enqueueAllSubmodulesForRestart();
      let desc = result;
      if (subNames.length > 0) {
        desc += `\n\n**Submódulos enfileirados** para o próximo reinício (${subNames.length}): ${subNames.join(', ')}`;
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle('Commit e Atualização Concluídos')
        .setDescription(desc)
        .setColor(0x00FF00)
        .setFooter({ text: `ID do Painel: ${panelId} | Auto-exclusão em 10s` })
        .setTimestamp();
      
      await this.sendTemporaryResult(interaction, resultEmbed, 10);
    } catch (error) {
      console.error(`Erro ao fazer commit e atualizar repositório ${repoPath}:`, error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('Erro no Commit e Atualização')
        .setDescription(`Falha ao fazer commit e atualizar: ${error.message}`)
        .setColor(0xFF0000)
        .setFooter({ text: `ID do Painel: ${panelId}` })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [errorEmbed],
        components: []
      });
    }
  }
}

module.exports = ButtonHandler; 