const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const simpleGit = require('simple-git');
const { isMainRepositoryPath } = require('../utils/repoPaths');

// Constantes para identificar a origem do webhook
const WEBHOOK_SOURCE = {
  GITHUB: 'github',
  GITLAB: 'gitlab',
  UNKNOWN: 'unknown'
};

class WebhookService {
  constructor(gitManager, client) {
    this.gitManager = gitManager;
    this.client = client;
    this.app = express();
    this.port = process.env.WEBHOOK_PORT || 3001;
    
    // Secret único para validação de webhooks (GitHub e GitLab)
    this.webhookSecret = process.env.WEBHOOK_SECRET || '';
    
    // Diretório base para busca automática de repositórios
    this.reposSearchPath = process.env.GIT_BASE_PATH || '';
    
    // Habilitar mapeamento automático (padrão: true)
    this.autoMapping = process.env.AUTO_REPO_MAPPING !== 'false';
    
    // Arquivo de mapeamento repo -> caminho local (suporta GitHub e GitLab)
    this.repoMappingFile = path.join(process.cwd(), 'data', 'repoMapping.json');
    this.repoMapping = this.loadRepoMapping();
    
    // Cache de repositórios encontrados
    this.repoCache = new Map();
    this.lastCacheScan = null;
    this.cacheTTL = 5 * 60 * 1000; // 5 minutos
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Verifica se um diretório é um repositório Git válido
   * @param {string} dirPath - Caminho do diretório
   * @returns {Promise<boolean>}
   */
  async isGitRepository(dirPath) {
    try {
      const gitPath = path.join(dirPath, '.git');
      return fs.existsSync(gitPath);
    } catch {
      return false;
    }
  }

  /**
   * Obtém o remote origin URL de um repositório
   * @param {string} repoPath - Caminho do repositório
   * @returns {Promise<string|null>}
   */
  async getRemoteOrigin(repoPath) {
    try {
      const git = simpleGit(repoPath);
      const remotes = await git.getRemotes(true);
      const origin = remotes.find(r => r.name === 'origin');
      return origin?.refs?.fetch || origin?.refs?.push || null;
    } catch {
      return null;
    }
  }

  /**
   * Extrai o nome do repositório (owner/repo) de uma URL remota
   * @param {string} remoteUrl - URL do remote
   * @returns {string|null}
   */
  extractRepoNameFromUrl(remoteUrl) {
    if (!remoteUrl) return null;
    
    try {
      // Suporta formatos:
      // https://github.com/owner/repo.git
      // git@github.com:owner/repo.git
      // https://gitlab.com/owner/repo.git
      // git@gitlab.com:owner/repo.git
      
      let match = remoteUrl.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
      if (match) {
        return `${match[1]}/${match[2]}`.toLowerCase();
      }
      
      // Para GitLab com subgrupos: https://gitlab.com/group/subgroup/repo.git
      match = remoteUrl.match(/[/:](.+?)(?:\.git)?$/);
      if (match) {
        const parts = match[1].split('/').filter(Boolean);
        if (parts.length >= 2) {
          return parts.join('/').toLowerCase();
        }
      }
    } catch {
      // Ignora erros de parsing
    }
    
    return null;
  }

  /**
   * Obtém a lista de submódulos de um repositório
   * @param {string} repoPath - Caminho do repositório
   * @returns {Promise<Array<{name: string, path: string, url: string}>>}
   */
  async getSubmodules(repoPath) {
    const submodules = [];
    
    try {
      const gitmodulesPath = path.join(repoPath, '.gitmodules');
      
      if (!fs.existsSync(gitmodulesPath)) {
        return submodules;
      }

      const git = simpleGit(repoPath);
      const result = await git.raw(['config', '--file', '.gitmodules', '--list']);
      
      if (!result) return submodules;
      
      const lines = result.split('\n').filter(Boolean);
      const submoduleMap = new Map();
      
      for (const line of lines) {
        const match = line.match(/submodule\.(.+?)\.(.+?)=(.+)/);
        if (match) {
          const name = match[1];
          const key = match[2];
          const value = match[3];
          
          if (!submoduleMap.has(name)) {
            submoduleMap.set(name, { name });
          }
          
          const submodule = submoduleMap.get(name);
          if (key === 'path') {
            submodule.path = value;
          } else if (key === 'url') {
            submodule.url = value;
          }
        }
      }
      
      for (const [name, submodule] of submoduleMap) {
        if (submodule.path) {
          submodules.push(submodule);
        }
      }
    } catch (error) {
      // Ignora erros ao ler submódulos
    }
    
    return submodules;
  }

  /**
   * Escaneia diretórios em busca de repositórios Git (incluindo submódulos)
   * @param {string} basePath - Diretório base para busca
   * @param {number} maxDepth - Profundidade máxima de busca
   * @returns {Promise<Map<string, string>>} - Map de repoName -> localPath
   */
  async scanForRepositories(basePath, maxDepth = 3) {
    const repos = new Map();
    
    if (!basePath || !fs.existsSync(basePath)) {
      return repos;
    }

    const scanDir = async (currentPath, depth, isSubmodule = false) => {
      if (depth > maxDepth) return;
      
      try {
        // Verifica se é um repositório Git
        if (await this.isGitRepository(currentPath)) {
          const remoteUrl = await this.getRemoteOrigin(currentPath);
          const repoName = this.extractRepoNameFromUrl(remoteUrl);
          
          if (repoName) {
            repos.set(repoName, currentPath);
            const label = isSubmodule ? '[Submódulo]' : '[Repo]';
            console.log(`[AutoMapping] ${label} Encontrado: ${repoName} -> ${currentPath}`);
          } else {
            // Usa o nome da pasta como fallback
            const folderName = path.basename(currentPath).toLowerCase();
            repos.set(folderName, currentPath);
          }
          
          // Se é um repositório, verifica se tem submódulos
          if (!isSubmodule) {
            const submodules = await this.getSubmodules(currentPath);
            
            for (const submodule of submodules) {
              const submodulePath = path.join(currentPath, submodule.path);
              
              // Verifica se o submódulo está inicializado
              if (fs.existsSync(path.join(submodulePath, '.git')) || 
                  fs.existsSync(submodulePath)) {
                
                // Tenta extrair o nome do repo da URL do submódulo
                const subRepoName = this.extractRepoNameFromUrl(submodule.url);
                
                if (subRepoName) {
                  repos.set(subRepoName, submodulePath);
                  console.log(`[AutoMapping] [Submódulo] Encontrado: ${subRepoName} -> ${submodulePath}`);
                } else {
                  // Se a URL não está no formato esperado, tenta pegar do remote
                  await scanDir(submodulePath, depth + 1, true);
                }
              }
            }
          }
          
          return; // Não precisa continuar buscando dentro de um repo
        }
        
        // Lista subdiretórios
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await scanDir(path.join(currentPath, entry.name), depth + 1, false);
          }
        }
      } catch (error) {
        // Ignora erros de permissão ou diretórios inacessíveis
      }
    };

    await scanDir(basePath, 0, false);
    return repos;
  }

  /**
   * Atualiza o cache de repositórios
   */
  async refreshRepoCache() {
    if (!this.reposSearchPath) {
      console.log('[AutoMapping] GIT_BASE_PATH não configurado, mapeamento automático desabilitado');
      return;
    }

    console.log(`[AutoMapping] Escaneando repositórios em: ${this.reposSearchPath}`);
    this.repoCache = await this.scanForRepositories(this.reposSearchPath);
    this.lastCacheScan = Date.now();
    console.log(`[AutoMapping] ${this.repoCache.size} repositórios encontrados`);
  }

  /**
   * Tenta encontrar automaticamente o caminho local de um repositório
   * @param {string} repoFullName - Nome completo do repositório (owner/repo)
   * @returns {Promise<string|null>}
   */
  async autoFindRepository(repoFullName) {
    if (!this.autoMapping) return null;
    
    const repoNameLower = repoFullName.toLowerCase();
    
    // Verifica se precisa atualizar o cache
    if (!this.lastCacheScan || Date.now() - this.lastCacheScan > this.cacheTTL) {
      await this.refreshRepoCache();
    }
    
    // Busca exata
    if (this.repoCache.has(repoNameLower)) {
      return this.repoCache.get(repoNameLower);
    }
    
    // Busca pelo nome do repositório apenas (sem owner)
    const repoNameOnly = repoNameLower.split('/').pop();
    for (const [cachedName, cachedPath] of this.repoCache) {
      const cachedRepoOnly = cachedName.split('/').pop();
      if (cachedRepoOnly === repoNameOnly) {
        return cachedPath;
      }
    }
    
    // Busca parcial (contém o nome)
    for (const [cachedName, cachedPath] of this.repoCache) {
      if (cachedName.includes(repoNameOnly) || repoNameOnly.includes(cachedName.split('/').pop())) {
        return cachedPath;
      }
    }
    
    return null;
  }

  /**
   * Detecta a origem do webhook baseado nos headers
   * @param {Object} headers - Headers da requisição
   * @returns {string} - 'github', 'gitlab' ou 'unknown'
   */
  detectWebhookSource(headers) {
    if (headers['x-github-event']) {
      return WEBHOOK_SOURCE.GITHUB;
    }
    if (headers['x-gitlab-event']) {
      return WEBHOOK_SOURCE.GITLAB;
    }
    return WEBHOOK_SOURCE.UNKNOWN;
  }

  /**
   * Valida a assinatura do webhook do GitHub
   * @param {Object} req - Requisição Express
   * @returns {boolean} - true se válido ou sem secret configurado
   */
  validateGitHubSignature(req) {
    if (!this.webhookSecret || this.webhookSecret.trim() === '') {
      return true; // Sem secret = não validar
    }
    
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) {
      return true; // Sem assinatura = aceitar (para compatibilidade)
    }

    try {
      const hmac = crypto.createHmac('sha256', this.webhookSecret);
      const rawBody = JSON.stringify(req.body);
      const digest = 'sha256=' + hmac.update(rawBody).digest('hex');
      return signature === digest;
    } catch (error) {
      console.error('Erro ao verificar assinatura GitHub:', error);
      return false;
    }
  }

  /**
   * Valida o token do webhook do GitLab
   * @param {Object} req - Requisição Express
   * @returns {boolean} - true se válido ou sem secret configurado
   */
  validateGitLabToken(req) {
    if (!this.webhookSecret || this.webhookSecret.trim() === '') {
      return true; // Sem secret = não validar
    }
    
    const token = req.headers['x-gitlab-token'];
    if (!token) {
      return true; // Sem token = aceitar (para compatibilidade)
    }

    return token === this.webhookSecret;
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

  // Mapear repositório GitHub/GitLab para caminho local
  mapRepository(repoName, localPath) {
    this.repoMapping[repoName.toLowerCase()] = localPath;
    this.saveRepoMapping();
    console.log(`[Mapping] Mapeamento salvo: ${repoName} -> ${localPath}`);
  }

  // Obter caminho local de um repositório (com fallback para busca automática)
  getLocalPath(repoName) {
    const repoLower = repoName.toLowerCase();
    
    // Tentar encontrar com o nome exato (case-insensitive)
    if (this.repoMapping[repoLower]) {
      return this.repoMapping[repoLower];
    }
    
    // Tentar variações comuns
    const variations = [
      repoName,
      repoLower.replace('-core', '-Core'),
      repoLower.replace('rise-core', 'Rise-core')
    ];
    
    for (const variation of variations) {
      if (this.repoMapping[variation]) {
        return this.repoMapping[variation];
      }
    }
    
    // Buscar pelo nome do repo apenas (sem owner)
    const repoNameOnly = repoLower.split('/').pop();
    for (const [mappedName, mappedPath] of Object.entries(this.repoMapping)) {
      const mappedNameOnly = mappedName.split('/').pop();
      if (mappedNameOnly === repoNameOnly) {
        return mappedPath;
      }
    }
    
    return null;
  }

  /**
   * Obtém o caminho local de um repositório, com suporte a mapeamento automático
   * @param {string} repoName - Nome do repositório (owner/repo)
   * @returns {Promise<string|null>}
   */
  async getLocalPathAsync(repoName) {
    // Primeiro tenta o mapeamento manual
    let localPath = this.getLocalPath(repoName);
    
    if (localPath) {
      return localPath;
    }
    
    // Se não encontrou, tenta mapeamento automático
    if (this.autoMapping) {
      console.log(`[AutoMapping] Tentando encontrar automaticamente: ${repoName}`);
      localPath = await this.autoFindRepository(repoName);
      
      if (localPath) {
        // Salva o mapeamento para uso futuro
        this.mapRepository(repoName, localPath);
        console.log(`[AutoMapping] Mapeamento automático criado: ${repoName} -> ${localPath}`);
        return localPath;
      }
    }
    
    return null;
  }

  setupMiddleware() {
    // Middleware para parsing JSON (deve vir primeiro)
    this.app.use(express.json());
    
    // Middleware para verificar assinatura/token do webhook (apenas para POST)
    // IMPORTANTE: GET não precisa de assinatura (usado para verificação)
    this.app.post('/webhook', (req, res, next) => {
      const source = this.detectWebhookSource(req.headers);
      
      // Validar baseado na origem
      if (source === WEBHOOK_SOURCE.GITHUB) {
        if (!this.validateGitHubSignature(req)) {
          console.log('[Webhook] Assinatura GitHub inválida');
          return res.status(401).json({ error: 'Assinatura inválida' });
        }
      } else if (source === WEBHOOK_SOURCE.GITLAB) {
        if (!this.validateGitLabToken(req)) {
          console.log('[Webhook] Token GitLab inválido');
          return res.status(401).json({ error: 'Token inválido' });
        }
      }
      
      // Armazenar a origem detectada para uso posterior
      req.webhookSource = source;
      next();
    });
  }

  /**
   * Parseia o payload do GitHub e extrai informações padronizadas
   * @param {Object} payload - Payload do webhook
   * @param {Object} headers - Headers da requisição
   * @returns {Object|null} - Dados padronizados ou null se evento não é push
   */
  parseGitHubPayload(payload, headers) {
    const event = headers['x-github-event'];
    
    if (event !== 'push') {
      return null;
    }

    const repository = payload.repository;
    if (!repository) {
      return null;
    }

    const refBranch = payload.ref || '';
    const branch = refBranch.replace('refs/heads/', '');
    const owner = repository.owner?.name || repository.owner?.login || 'unknown';
    const repoFullName = `${owner}/${repository.name}`;
    
    const commits = (payload.commits || []).map(commit => ({
      id: commit.id,
      message: commit.message || '',
      author: commit.author?.name || commit.author?.username || 'unknown'
    }));

    return {
      source: WEBHOOK_SOURCE.GITHUB,
      repoFullName,
      branch,
      commits,
      pusher: payload.pusher?.name || 'unknown'
    };
  }

  /**
   * Parseia o payload do GitLab e extrai informações padronizadas
   * @param {Object} payload - Payload do webhook
   * @param {Object} headers - Headers da requisição
   * @returns {Object|null} - Dados padronizados ou null se evento não é push
   */
  parseGitLabPayload(payload, headers) {
    const event = headers['x-gitlab-event'];
    
    // GitLab usa "Push Hook" para eventos de push
    if (event !== 'Push Hook') {
      return null;
    }

    const project = payload.project;
    if (!project) {
      return null;
    }

    // GitLab envia ref como "refs/heads/main" igual ao GitHub
    const refBranch = payload.ref || '';
    const branch = refBranch.replace('refs/heads/', '');
    
    // GitLab usa path_with_namespace no formato "usuario/repositorio"
    const repoFullName = project.path_with_namespace || `${project.namespace}/${project.name}`;
    
    const commits = (payload.commits || []).map(commit => ({
      id: commit.id,
      message: commit.message || '',
      author: commit.author?.name || 'unknown'
    }));

    return {
      source: WEBHOOK_SOURCE.GITLAB,
      repoFullName,
      branch,
      commits,
      pusher: payload.user_name || payload.user_username || 'unknown'
    };
  }

  setupRoutes() {
    // Rota raiz para verificar se o servidor está funcionando
    this.app.get('/', (req, res) => {
      res.json({ 
        status: 'ok', 
        service: 'git-webhook',
        supportedSources: ['github', 'gitlab'],
        endpoints: {
          webhook: '/webhook',
          health: '/health',
          mappings: '/mappings'
        }
      });
    });

    // Rota de health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        service: 'git-webhook',
        supportedSources: ['github', 'gitlab']
      });
    });

    // Rota GET para verificação (ping)
    this.app.get('/webhook', (req, res) => {
      res.json({ 
        status: 'ok', 
        message: 'Webhook endpoint está ativo',
        supportedSources: ['github', 'gitlab'],
        method: 'Use POST para enviar webhooks'
      });
    });

    // Rota principal do webhook (suporta GitHub e GitLab)
    this.app.post('/webhook', async (req, res) => {
      try {
        const source = req.webhookSource || this.detectWebhookSource(req.headers);
        const payload = req.body;
        
        // Parsear payload baseado na origem
        let webhookData = null;
        
        if (source === WEBHOOK_SOURCE.GITHUB) {
          webhookData = this.parseGitHubPayload(payload, req.headers);
        } else if (source === WEBHOOK_SOURCE.GITLAB) {
          webhookData = this.parseGitLabPayload(payload, req.headers);
        } else {
          return res.status(400).json({ 
            error: 'Origem do webhook não reconhecida',
            message: 'Apenas webhooks do GitHub e GitLab são suportados'
          });
        }

        // Se não é um evento de push, ignorar
        if (!webhookData) {
          return res.status(200).json({ 
            message: 'Evento ignorado (não é push)',
            source: source
          });
        }

        const { repoFullName, branch, commits, pusher } = webhookData;

        // Verificar se o push foi feito na branch main
        if (branch !== 'main') {
          return res.status(200).json({ 
            message: `Push ignorado - branch "${branch}" não é "main"`,
            source: source,
            repo: repoFullName,
            branch: branch
          });
        }

        // Buscar caminho local do repositório (com suporte a mapeamento automático)
        const localPath = await this.getLocalPathAsync(repoFullName);

        if (!localPath) {
          console.log(`[Webhook ${source}] Repositório não encontrado: ${repoFullName}`);
          return res.status(200).json({ 
            message: 'Repositório não encontrado (verifique GIT_BASE_PATH ou adicione mapeamento manual)',
            source: source,
            repo: repoFullName,
            autoMappingEnabled: this.autoMapping,
            searchPath: this.reposSearchPath || 'não configurado'
          });
        }

        if (!isMainRepositoryPath(localPath)) {
          return res.status(200).json({
            message:
              'O webhook @pull aplica-se apenas ao repositório principal (GIT_BASE_PATH). Submódulos não são atualizados automaticamente — use o Discord para enfileirar pull no horário de reinício.',
            source: source,
            repo: repoFullName,
            localPath: localPath
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
            console.log(`[Webhook ${source}] Pull automático detectado: ${repoFullName} - ${commit.id.substring(0, 7)}`);
          }
        }

        if (!shouldPull) {
          return res.status(200).json({ 
            message: 'Nenhum commit com @pull encontrado',
            source: source,
            repo: repoFullName,
            branch: branch,
            commits: commitMessages.length
          });
        }

        // Executar pull automático
        console.log(`[Webhook ${source}] Executando pull automático: ${repoFullName} -> ${localPath}`);
        
        try {
          const includeSubmodules = false;
          const result = await this.gitManager.pullRepository(localPath, includeSubmodules, 'normal');
          
          // Se houver mudanças locais, tentar com stash automaticamente
          if (result === 'STATUS_HAS_CHANGES') {
            console.log(`[Webhook ${source}] Mudanças locais detectadas, usando stash: ${repoFullName}`);
            try {
              const stashResult = await this.gitManager.pullRepository(localPath, false, 'stash');
              
              if (this.client && process.env.DISCORD_WEBHOOK_CHANNEL_ID) {
                await this.sendDiscordNotification(repoFullName, localPath, stashResult, commitMessages, source);
              }

              return res.status(200).json({ 
                success: true,
                message: 'Pull executado com stash (mudanças locais foram salvas temporariamente)',
                source: source,
                repo: repoFullName,
                result: stashResult
              });
            } catch (stashError) {
              console.error(`[Webhook ${source}] Erro ao executar pull com stash:`, stashError);
              return res.status(500).json({ 
                error: 'Erro ao executar pull',
                source: source,
                repo: repoFullName,
                message: `Não foi possível fazer pull devido a mudanças locais: ${stashError.message}`
              });
            }
          }
          
          // Pull bem-sucedido sem mudanças locais
          if (this.client && process.env.DISCORD_WEBHOOK_CHANNEL_ID) {
            await this.sendDiscordNotification(repoFullName, localPath, result, commitMessages, source);
          }

          res.status(200).json({ 
            success: true,
            message: 'Pull executado com sucesso',
            source: source,
            repo: repoFullName,
            result: result
          });
        } catch (error) {
          console.error(`[Webhook ${source}] Erro ao executar pull para ${repoFullName}:`, error);
          res.status(500).json({ 
            error: 'Erro ao executar pull',
            source: source,
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
      res.json({
        manual: this.repoMapping,
        autoMappingEnabled: this.autoMapping,
        searchPath: this.reposSearchPath || 'não configurado',
        cachedRepos: this.repoCache.size,
        lastCacheScan: this.lastCacheScan ? new Date(this.lastCacheScan).toISOString() : null
      });
    });

    // Rota para adicionar mapeamento manual
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

    // Rota para forçar refresh do cache de repositórios
    this.app.post('/mappings/refresh', async (req, res) => {
      try {
        await this.refreshRepoCache();
        
        const cachedRepos = {};
        for (const [name, path] of this.repoCache) {
          cachedRepos[name] = path;
        }
        
        res.json({
          success: true,
          message: `Cache atualizado: ${this.repoCache.size} repositórios encontrados`,
          searchPath: this.reposSearchPath,
          repositories: cachedRepos
        });
      } catch (error) {
        res.status(500).json({
          error: 'Erro ao atualizar cache',
          message: error.message
        });
      }
    });

    // Rota para listar repositórios encontrados automaticamente
    this.app.get('/mappings/discovered', async (req, res) => {
      try {
        // Atualiza o cache se necessário
        if (!this.lastCacheScan || Date.now() - this.lastCacheScan > this.cacheTTL) {
          await this.refreshRepoCache();
        }
        
        const discovered = {};
        for (const [name, path] of this.repoCache) {
          discovered[name] = path;
        }
        
        res.json({
          autoMappingEnabled: this.autoMapping,
          searchPath: this.reposSearchPath || 'não configurado',
          count: this.repoCache.size,
          lastScan: this.lastCacheScan ? new Date(this.lastCacheScan).toISOString() : null,
          repositories: discovered
        });
      } catch (error) {
        res.status(500).json({
          error: 'Erro ao listar repositórios',
          message: error.message
        });
      }
    });
  }

  async sendDiscordNotification(repoFullName, localPath, result, commitMessages, source = 'github') {
    try {
      const channelId = process.env.DISCORD_WEBHOOK_CHANNEL_ID;
      const channel = await this.client.channels.fetch(channelId);
      
      if (!channel) {
        console.error(`Canal Discord não encontrado: ${channelId}`);
        return;
      }

      const { EmbedBuilder } = require('discord.js');
      
      // Definir ícone e cor baseado na origem
      const sourceConfig = {
        github: { icon: '🐙', name: 'GitHub', color: 0x24292E },
        gitlab: { icon: '🦊', name: 'GitLab', color: 0xFC6D26 }
      };
      
      const config = sourceConfig[source] || sourceConfig.github;
      
      // Formatar mensagens de commit (limitar a 900 chars para não exceder limite do Discord)
      let formattedCommits = commitMessages
        .map((msg, index) => {
          // Limitar cada mensagem a 100 caracteres
          const truncatedMsg = msg.length > 100 ? msg.substring(0, 97) + '...' : msg;
          return `• ${truncatedMsg}`;
        })
        .join('\n');
      
      // Se ultrapassar 900 caracteres, truncar
      if (formattedCommits.length > 900) {
        formattedCommits = formattedCommits.substring(0, 897) + '...';
      }
      
      // Se não houver commits, mostrar mensagem padrão
      if (!formattedCommits || formattedCommits.trim() === '') {
        formattedCommits = '_Nenhuma mensagem disponível_';
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🔄 Pull Automático Executado')
        .setDescription(`Repositório **${repoFullName}** foi atualizado automaticamente`)
        .addFields(
          { name: `${config.icon} Origem`, value: config.name, inline: true },
          { name: '📝 Commits', value: commitMessages.length.toString(), inline: true },
          { name: '💬 Mensagens de Commit', value: formattedCommits, inline: false },
          { name: '📁 Caminho Local', value: `\`${localPath}\``, inline: false },
          { name: '✅ Resultado', value: result.substring(0, 200) || 'Sucesso', inline: false }
        )
        .setColor(config.color)
        .setTimestamp()
        .setFooter({ text: `${config.name} Webhook` });

      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('Erro ao enviar notificação no Discord:', error);
    }
  }

  async start() {
    // Scan inicial dos repositórios se mapeamento automático estiver habilitado
    if (this.autoMapping && this.reposSearchPath) {
      console.log('🔍 Iniciando scan de repositórios...');
      await this.refreshRepoCache();
    }

    this.app.listen(this.port, '0.0.0.0', () => {
      console.log(`\n🚀 Servidor de webhook Git iniciado na porta ${this.port}`);
      console.log(`📡 Endpoint: http://localhost:${this.port}/webhook`);
      console.log(`🔐 Secret: ${this.webhookSecret ? 'configurado' : 'não configurado'}`);
      console.log(`🐙 GitHub: Suportado`);
      console.log(`🦊 GitLab: Suportado`);
      console.log(`🗺️  Auto-mapping: ${this.autoMapping ? 'habilitado' : 'desabilitado'}`);
      if (this.autoMapping) {
        console.log(`📂 Search path: ${this.reposSearchPath || 'não configurado'}`);
        console.log(`📦 Repositórios encontrados: ${this.repoCache.size}`);
      }
      console.log(`✅ Servidor escutando em 0.0.0.0:${this.port} (todas as interfaces)\n`);
    });
  }
}

module.exports = WebhookService;

