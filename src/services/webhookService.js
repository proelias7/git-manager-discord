const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const GitManager = require('../utils/gitManager');

class WebhookService {
  constructor(gitManager, client) {
    this.gitManager = gitManager;
    this.client = client;
    this.app = express();
    this.port = process.env.WEBHOOK_PORT || 3001;
    this.secret = process.env.GITHUB_WEBHOOK_SECRET || '';
    
    // Arquivo de mapeamento GitHub repo -> caminho local
    this.repoMappingFile = path.join(process.cwd(), 'data', 'repoMapping.json');
    this.repoMapping = this.loadRepoMapping();
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  loadRepoMapping() {
    try {
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(this.repoMappingFile)) {
        const content = fs.readFileSync(this.repoMappingFile, 'utf8');
        return JSON.parse(content);
      }
      
      // Criar arquivo vazio se não existir
      fs.writeFileSync(this.repoMappingFile, JSON.stringify({}, null, 2), 'utf8');
      return {};
    } catch (error) {
      console.error('Erro ao carregar mapeamento de repositórios:', error);
      return {};
    }
  }

  saveRepoMapping() {
    try {
      fs.writeFileSync(this.repoMappingFile, JSON.stringify(this.repoMapping, null, 2), 'utf8');
    } catch (error) {
      console.error('Erro ao salvar mapeamento de repositórios:', error);
    }
  }

  // Mapear repositório GitHub para caminho local
  mapRepository(githubRepo, localPath) {
    this.repoMapping[githubRepo.toLowerCase()] = localPath;
    this.saveRepoMapping();
  }

  // Obter caminho local de um repositório GitHub
  getLocalPath(githubRepo) {
    const repoLower = githubRepo.toLowerCase();
    // Tentar encontrar com o nome exato (case-insensitive) ou variações comuns
    return this.repoMapping[repoLower] || 
           this.repoMapping[githubRepo] || 
           this.repoMapping[repoLower.replace('-core', '-Core')] ||
           this.repoMapping[repoLower.replace('rise-core', 'Rise-core')] ||
           null;
  }

  setupMiddleware() {
    // Middleware para parsing JSON (deve vir primeiro)
    this.app.use(express.json());
    
    // Middleware para verificar assinatura do webhook (apenas para POST)
    // IMPORTANTE: GET não precisa de assinatura (usado para verificação do GitHub)
    this.app.post('/webhook', (req, res, next) => {
      // Se não tem secret configurado, passa direto
      if (!this.secret || this.secret.trim() === '') {
        return next();
      }
      
      const signature = req.headers['x-hub-signature-256'];
      if (!signature) {
        return next();
      }

      try {
        const hmac = crypto.createHmac('sha256', this.secret);
        const rawBody = JSON.stringify(req.body);
        const digest = 'sha256=' + hmac.update(rawBody).digest('hex');
        
        if (signature !== digest) {
          return next();
        }
      } catch (error) {
        console.error('Erro ao verificar assinatura:', error);
        return next();
      }
      
      next();
    });
  }

  setupRoutes() {
    // Rota raiz para verificar se o servidor está funcionando
    this.app.get('/', (req, res) => {
      res.json({ 
        status: 'ok', 
        service: 'github-webhook',
        endpoints: {
          webhook: '/webhook',
          health: '/health',
          mappings: '/mappings'
        }
      });
    });

    // Rota de health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', service: 'github-webhook' });
    });

    // Rota GET para verificação do GitHub (ping)
    this.app.get('/webhook', (req, res) => {
      res.json({ 
        status: 'ok', 
        message: 'Webhook endpoint está ativo',
        method: 'Use POST para enviar webhooks'
      });
    });

    // Rota principal do webhook
    this.app.post('/webhook', async (req, res) => {
      try {
        const event = req.headers['x-github-event'];
        
        if (event !== 'push') {
          return res.status(200).json({ message: 'Evento ignorado' });
        }

        const payload = req.body;
        const repository = payload.repository;
        const commits = payload.commits || [];
        const refBranch = payload.ref || '';

        if (!repository) {
          return res.status(400).json({ error: 'Repositório não encontrado no payload' });
        }

        // Verificar se o push foi feito na branch main
        const branch = refBranch.replace('refs/heads/', '');
        
        if (branch !== 'main') {
          return res.status(200).json({ 
            message: `Push ignorado - branch "${branch}" não é "main"`,
            repo: `${repository.owner?.name || repository.owner?.login}/${repository.name}`,
            branch: branch
          });
        }

        // GitHub pode enviar owner.name ou owner.login
        const owner = repository.owner?.name || repository.owner?.login || 'unknown';
        const repoFullName = `${owner}/${repository.name}`;
        const localPath = this.getLocalPath(repoFullName);

        if (!localPath) {
          console.log(`Repositório não mapeado: ${repoFullName}`);
          return res.status(200).json({ 
            message: 'Repositório não mapeado',
            repo: repoFullName 
          });
        }

        // Verificar se algum commit contém "@pull" na mensagem
        let shouldPull = false;
        let commitMessages = [];

        for (const commit of commits) {
          const message = commit.message || '';
          commitMessages.push(message);
          
          if (message.toLowerCase().includes('@pull')) {
            shouldPull = true;
            console.log(`[Webhook] Pull automático detectado: ${repoFullName} - ${commit.id.substring(0, 7)}`);
          }
        }

        if (!shouldPull) {
          return res.status(200).json({ 
            message: 'Nenhum commit com @pull encontrado',
            repo: repoFullName,
            branch: branch,
            commits: commitMessages.length
          });
        }

        // Executar pull automático apenas no repositório que recebeu o commit na branch main
        console.log(`[Webhook] Executando pull automático: ${repoFullName} -> ${localPath}`);
        
        try {
          // Apenas atualizar o repositório principal, sem submódulos
          const includeSubmodules = false;
          const result = await this.gitManager.pullRepository(localPath, includeSubmodules, 'normal');
          
          // Se houver mudanças locais, tentar com stash automaticamente
          if (result === 'STATUS_HAS_CHANGES') {
            console.log(`[Webhook] Mudanças locais detectadas, usando stash: ${repoFullName}`);
            try {
              const stashResult = await this.gitManager.pullRepository(localPath, false, 'stash');
              
              // Enviar notificação no Discord se configurado
              if (this.client && process.env.DISCORD_WEBHOOK_CHANNEL_ID) {
                await this.sendDiscordNotification(repoFullName, localPath, stashResult, commitMessages);
              }

              res.status(200).json({ 
                success: true,
                message: 'Pull executado com stash (mudanças locais foram salvas temporariamente)',
                repo: repoFullName,
                result: stashResult
              });
              return;
            } catch (stashError) {
              console.error(`[Webhook] Erro ao executar pull com stash:`, stashError);
              res.status(500).json({ 
                error: 'Erro ao executar pull',
                repo: repoFullName,
                message: `Não foi possível fazer pull devido a mudanças locais: ${stashError.message}`
              });
              return;
            }
          }
          
          // Pull bem-sucedido sem mudanças locais
          // Enviar notificação no Discord se configurado
          if (this.client && process.env.DISCORD_WEBHOOK_CHANNEL_ID) {
            await this.sendDiscordNotification(repoFullName, localPath, result, commitMessages);
          }

          res.status(200).json({ 
            success: true,
            message: 'Pull executado com sucesso',
            repo: repoFullName,
            result: result
          });
        } catch (error) {
          console.error(`[Webhook] Erro ao executar pull para ${repoFullName}:`, error);
          res.status(500).json({ 
            error: 'Erro ao executar pull',
            repo: repoFullName,
            message: error.message
          });
        }
      } catch (error) {
        console.error('Erro ao processar webhook:', error);
        res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
      }
    });

    // Rota para listar mapeamentos
    this.app.get('/mappings', (req, res) => {
      res.json(this.repoMapping);
    });

    // Rota para adicionar mapeamento
    this.app.post('/mappings', (req, res) => {
      const { githubRepo, localPath } = req.body;
      
      if (!githubRepo || !localPath) {
        return res.status(400).json({ error: 'githubRepo e localPath são obrigatórios' });
      }

      this.mapRepository(githubRepo, localPath);
      res.json({ 
        success: true, 
        message: 'Mapeamento adicionado',
        mapping: { [githubRepo]: localPath }
      });
    });
  }

  async sendDiscordNotification(repoFullName, localPath, result, commitMessages) {
    try {
      const channelId = process.env.DISCORD_WEBHOOK_CHANNEL_ID;
      const channel = await this.client.channels.fetch(channelId);
      
      if (!channel) {
        console.error(`Canal Discord não encontrado: ${channelId}`);
        return;
      }

      const { EmbedBuilder } = require('discord.js');
      
      const embed = new EmbedBuilder()
        .setTitle('🔄 Pull Automático Executado')
        .setDescription(`Repositório **${repoFullName}** foi atualizado automaticamente`)
        .addFields(
          { name: '📁 Caminho Local', value: `\`${localPath}\``, inline: false },
          { name: '📝 Commits', value: commitMessages.length.toString(), inline: true },
          { name: '✅ Resultado', value: result.substring(0, 200) || 'Sucesso', inline: false }
        )
        .setColor(0x00FF00)
        .setTimestamp()
        .setFooter({ text: 'GitHub Webhook' });

      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('Erro ao enviar notificação no Discord:', error);
    }
  }

  start() {
    this.app.listen(this.port, '0.0.0.0', () => {
      console.log(`🚀 Servidor de webhook GitHub iniciado na porta ${this.port}`);
      console.log(`📡 Endpoint: http://localhost:${this.port}/webhook`);
      console.log(`🌐 URL pública: http://dev.riseroleplay.com.br:${this.port}/webhook`);
      console.log(`✅ Servidor escutando em 0.0.0.0:${this.port} (todas as interfaces)`);
    });
  }
}

module.exports = WebhookService;

