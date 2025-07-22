const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const simpleGit = require('simple-git');
require('dotenv').config();


const execPromise = promisify(exec);


class GitManager {

  constructor(basePath) {
    this.basePath = basePath;
    
    this.validateBasePath();
    
    console.log(`GitManager inicializado com o caminho: ${this.basePath}`);
  }


  validateBasePath() {
    if (!this.basePath) {
      throw new Error('Caminho base não definido');
    }
    
    if (!fs.existsSync(this.basePath)) {
      throw new Error(`O caminho base não existe: ${this.basePath}`);
    }
    
    if (!fs.statSync(this.basePath).isDirectory()) {
      throw new Error(`O caminho base não é um diretório: ${this.basePath}`);
    }
    
    if (!fs.existsSync(path.join(this.basePath, '.git'))) {
      console.warn(`Aviso: O diretório base não parece ser um repositório Git válido: ${this.basePath}`);
    }
  }


  async ensureSafeDirectory(repoPath) {
    try {
      // Tenta uma operação simples para verificar se há problemas de ownership
      const git = simpleGit(repoPath);
      await git.raw(['config', '--get', 'user.name']);
    } catch (error) {
      if (error.message && error.message.includes('dubious ownership')) {
        console.log(`Detectado problema de dubious ownership em: ${repoPath}`);
        console.log('Configurando diretório como seguro...');
        
        try {
          // Configura o diretório como seguro globalmente
          await execPromise(`git config --global --add safe.directory "${repoPath}"`);
          console.log(`Diretório ${repoPath} configurado como seguro com sucesso`);
          
          // Também configura submódulos se existirem
          await this.ensureSafeSubmodules(repoPath);
        } catch (configError) {
          console.error(`Erro ao configurar diretório seguro: ${configError.message}`);
          // Não falha completamente, apenas registra o erro
        }
      } else if (error.message && error.message.includes('not a git repository')) {
        // Ignora se não for um repositório Git
        return;
      } else {
        // Para outros erros, apenas registra mas não falha
        console.warn(`Aviso ao verificar diretório ${repoPath}: ${error.message}`);
      }
    }
  }


  async ensureSafeSubmodules(repoPath) {
    try {
      const submodules = await this.getSubmodules(repoPath);
      
      for (const submodule of submodules) {
        const submodulePath = path.join(repoPath, submodule.path);
        
        if (fs.existsSync(path.join(submodulePath, '.git'))) {
          try {
            await execPromise(`git config --global --add safe.directory "${submodulePath}"`);
            console.log(`Submódulo ${submodulePath} configurado como seguro`);
          } catch (subError) {
            console.warn(`Aviso ao configurar submódulo seguro ${submodulePath}: ${subError.message}`);
          }
        }
      }
    } catch (error) {
      console.warn(`Aviso ao configurar submódulos seguros: ${error.message}`);
    }
  }


  async getRepositories() {
    try {

      const results = [];
      

      const mainRepo = {
        name: path.basename(this.basePath),
        path: this.basePath,
        isSubmodule: false,
        parentPath: null,
        status: 'não verificado'
      };
      

      results.push(mainRepo);
      

      const hasSubmodules = await this.hasSubmodules(this.basePath);
      
      if (hasSubmodules) {
        try {
     
          const submodules = await this.getSubmodules(this.basePath);
          
          for (const submodule of submodules) {
            try {

              const submoduleName = submodule.nameSafe || submodule.name;
              const submodulePath = submodule.path; 
              const submodulePathFull = path.join(this.basePath, submodulePath);
              

              let status = 'não inicializado';
              if (fs.existsSync(path.join(submodulePathFull, '.git'))) {
                status = 'inicializado';
                

                try {
                  const isDetached = await this.isDetachedHead(submodulePathFull);
                  if (isDetached) {
                    status = 'detached HEAD';
                  }
                } catch (detachedError) {
                  console.error(`Erro ao verificar estado detached para ${submoduleName}:`, detachedError);
                  status = 'erro ao verificar';
                }
              }
              
              results.push({
                name: submoduleName,
                path: submodulePathFull,
                isSubmodule: true,
                parentPath: this.basePath,
                status
              });
            } catch (submoduleError) {
              console.error(`Erro ao processar submódulo:`, submoduleError);

            }
          }
        } catch (submodulesError) {
          console.error(`Erro ao obter lista de submódulos:`, submodulesError);

        }
      }
      
      return results;
    } catch (error) {
      console.error('Erro ao obter repositórios:', error);
      throw new Error(`Erro ao obter repositórios: ${error.message}`);
    }
  }


  async hasSubmodules(repoPath) {
    try {
      const git = simpleGit(repoPath);
      const result = await git.raw(['config', '--file', '.gitmodules', '--get-regexp', 'path']);
      return !!result;
    } catch (error) {
      return false;
    }
  }


  async getSubmodules(repoPath) {
    try {
      const git = simpleGit(repoPath);
      const result = await git.raw(['config', '--file', '.gitmodules', '--list']);
      
      if (!result) return [];
      
      const lines = result.split('\n').filter(Boolean);
      const submodules = [];
      let currentSubmodule = null;
      
      for (const line of lines) {
        try {
          const match = line.match(/submodule\.(.+?)\.(.+?)=(.+)/);
          if (match) {

            const name = match[1].substring(0, 1000); 
            const key = match[2];
            const value = match[3].substring(0, 1000); 
            
            if (key === 'path') {
              currentSubmodule = { 
                name, 
                path: value,
                nameSafe: name.length > 100 ? name.substring(0, 100) + '...' : name,
                pathSafe: value.length > 100 ? value.substring(0, 100) + '...' : value
              };
              submodules.push(currentSubmodule);
            }
          }
        } catch (lineError) {
          console.error(`Erro ao processar linha de submódulo: ${line}`, lineError);

        }
      }
      
      return submodules;
    } catch (error) {
      console.error('Erro ao obter submódulos:', error);
      return [];
    }
  }


  async isDetachedHead(repoPath) {
    try {
      const git = simpleGit(repoPath);
      const status = await git.status();
      return status.detached;
    } catch (error) {
      console.error(`Erro ao verificar estado detached para ${repoPath}:`, error);
      return false;
    }
  }


  async pullRepository(repoPath, includeSubmodules = false, mode = 'normal') {
    try {
      await this.ensureSafeDirectory(repoPath);
      const git = simpleGit(repoPath);
      let pullResult;
      
      const statusResult = await git.status();
      const hasChanges = !statusResult.isClean();
      
      if (hasChanges && mode === 'normal') {
        return 'STATUS_HAS_CHANGES';
      }
      
      let stashName = null;
      if (hasChanges && mode === 'stash') {
        stashName = `stash_before_pull_${Date.now()}`;
        await git.stash(['save', stashName]);
        console.log(`Alterações não commitadas foram salvas em stash: ${stashName}`);
      }
      
      const isDetached = await this.isDetachedHead(repoPath);
      
      if (isDetached) {
        console.log(`Repositório ${repoPath} está em estado detached HEAD. Tentando corrigir...`);
        
        try {
          const branchSummary = await git.branch();
          let availableBranches = branchSummary.all.filter(branch => !branch.startsWith('remotes/') && branch !== 'HEAD');
          
          if (availableBranches.length > 0) {
            const defaultBranch = availableBranches.find(b => b === 'main' || b === 'master') || availableBranches[0];
            console.log(`Tentando checkout para branch local existente: ${defaultBranch}`);
            await git.checkout(defaultBranch);
            console.log(`Checkout bem-sucedido para branch: ${defaultBranch}`);
          } else {
            const remoteBranches = branchSummary.all.filter(branch => branch.startsWith('remotes/'));
            
            if (remoteBranches.length > 0) {
              const remoteBranch = remoteBranches[0];
              const branchName = remoteBranch.replace(/^remotes\/[^\/]+\//, '');
              
              console.log(`Tentando criar branch local a partir de remota: ${branchName}`);
              await git.checkout(['-b', branchName, remoteBranch]);
              console.log(`Branch criada com sucesso: ${branchName}`);
            } else {
              const tempBranch = `temp-branch-${Date.now()}`;
              console.log(`Criando branch temporária: ${tempBranch}`);
              await git.checkout(['-b', tempBranch]);
              console.log(`AVISO: Branch temporária criada, mas não possui upstream. Pull não será possível.`);
            }
          }
        } catch (checkoutError) {
          console.error(`Erro ao tentar corrigir detached HEAD: ${checkoutError.message}`);

        }
      }
      
      try {
        const branchInfo = await git.branch();
        const currentBranch = branchInfo.current;
        const upstream = branchInfo.branches[currentBranch]?.upstream;
        
        if (upstream) {
          console.log(`Branch tem upstream configurado, executando pull normal`);
          
          try {
            pullResult = await git.pull();
          } catch (pullError) {
            if (pullError.message.includes('couldn\'t find remote ref')) {
              console.log(`Não foi possível encontrar referência remota, tentando pull sem especificar branch`);
              try {
                pullResult = await git.pull(['--no-rebase']);
              } catch (genericPullError) {
                console.log(`Pull falhou, tentando fetch e reset como alternativa`);
                await git.fetch(['--all']);
                await git.reset(['--hard', `origin/${currentBranch}`]);
                pullResult = { summary: { changes: 0, insertions: 0, deletions: 0 } };
              }
            } else {
              throw pullError;
            }
          }
        } else {
          console.log(`Branch não tem upstream configurado. Tentando fetch e reset para branch comum.`);
          
          await git.fetch(['--all']);
          
          const commonBranches = ['main', 'master', 'develop', 'development'];
          let resetSuccess = false;
          
          for (const branch of commonBranches) {
            try {
              await git.reset(['--hard', `origin/${branch}`]);
              console.log(`Reset bem-sucedido para origin/${branch}`);
              resetSuccess = true;
              break;
            } catch (resetError) {
              console.log(`Não foi possível resetar para origin/${branch}, tentando próxima.`);
            }
          }
          
          if (!resetSuccess) {
            return 'Não foi possível atualizar o repositório. Nenhuma branch remota válida encontrada.';
          }
          
          pullResult = { summary: { changes: 0, insertions: 0, deletions: 0 } };
        }
      } catch (branchError) {
        console.error(`Erro ao verificar informações da branch: ${branchError.message}`);
        return `Erro ao verificar informações da branch: ${branchError.message}`;
      }
      
      if (hasChanges && mode === 'stash') {
        try {
          await git.stash(['pop']);
          console.log(`Stash aplicado com sucesso após pull`);
        } catch (stashError) {
          return `Pull realizado com sucesso, mas ocorreram conflitos ao tentar restaurar suas mudanças. Verifique o stash manualmente (${stashName}).`;
        }
      }
      
      if (includeSubmodules) {
        try {
          await this.updateSubmodules(repoPath);
        } catch (submoduleError) {
          return `Repositório atualizado, mas ocorreu um erro ao atualizar submódulos: ${submoduleError.message}`;
        }
      }
      
      const summary = pullResult?.summary || {};
      return `Repositório atualizado com sucesso: ${summary.changes || 0} arquivos alterados, ${summary.insertions || 0} inserções, ${summary.deletions || 0} exclusões.`;
    } catch (error) {
      console.error(`Erro ao atualizar repositório ${repoPath}:`, error);
      throw new Error(`Erro ao atualizar repositório: ${error.message}`);
    }
  }


  async updateSubmodules(repoPath) {
    try {
      await this.ensureSafeDirectory(repoPath);
      const git = simpleGit(repoPath);
      
      const hasSubmodules = await this.hasSubmodules(repoPath);
      if (!hasSubmodules) {
        return 'Este repositório não tem submódulos';
      }
      
      await git.submoduleUpdate(['--init', '--recursive']);
      
      return 'Submódulos atualizados com sucesso';
    } catch (error) {
      console.error(`Erro ao atualizar submódulos de ${repoPath}:`, error);
      throw new Error(`Erro ao atualizar submódulos: ${error.message}`);
    }
  }


  async initSubmodules(repoPath) {
    try {
      await this.ensureSafeDirectory(repoPath);
      const git = simpleGit(repoPath);
      
      const hasSubmodules = await this.hasSubmodules(repoPath);
      if (!hasSubmodules) {
        return 'Este repositório não tem submódulos';
      }
      
      await git.submoduleInit();
      await git.submoduleUpdate();
      
      return 'Submódulos inicializados com sucesso';
    } catch (error) {
      console.error(`Erro ao inicializar submódulos de ${repoPath}:`, error);
      throw new Error(`Erro ao inicializar submódulos: ${error.message}`);
    }
  }


  async fixDetachedSubmodules(repoPath) {
    try {
      await this.ensureSafeDirectory(repoPath);
      const submodules = await this.getSubmodules(repoPath);
      
      if (submodules.length === 0) {
        return {
          success: true,
          message: 'Este repositório não tem submódulos',
          fixed: 0,
          total: 0,
          errors: 0
        };
      }
      
      let fixed = 0;
      let total = 0;
      let errors = 0;
      let skipped = 0;
      const resultDetails = [];
      
      for (const submodule of submodules) {
        try {

          const submoduleName = submodule.nameSafe || submodule.name;
          const submodulePath = submodule.path;
          const submodulePathFull = path.join(repoPath, submodulePath);
          
          if (!fs.existsSync(path.join(submodulePathFull, '.git'))) {
            skipped++;
            resultDetails.push(`Submódulo ${submoduleName} não inicializado, ignorado.`);
            continue;
          }
          
          let isDetached = false;
          try {
            isDetached = await this.isDetachedHead(submodulePathFull);
          } catch (detachedError) {
            console.error(`Erro ao verificar estado detached para ${submoduleName}:`, detachedError);
            errors++;
            resultDetails.push(`❌ Erro ao verificar estado de ${submoduleName}: ${detachedError.message}`);
            continue;
          }
          
          if (isDetached) {
            total++;
            const git = simpleGit(submodulePathFull);
            
            try {
              await git.fetch(['--all']);
              const branches = await git.branch(['-a']);
              
              const commonBranches = ['main', 'master', 'develop', 'development'];
              let success = false;
              let branchUsed = '';
              
              for (const branch of commonBranches) {
                if (branches.all.includes(branch)) {
                  try {
                    console.log(`Tentando checkout para branch local comum '${branch}' no submódulo ${submoduleName}`);
                    await git.checkout(branch);
                    success = true;
                    branchUsed = branch;
                    break;
                  } catch (e) {
                    console.log(`Falha ao fazer checkout para ${branch}: ${e.message}`);
                  }
                }
              }
              
              if (!success) {
                const localBranches = branches.all.filter(b => !b.includes('remotes/') && b !== 'HEAD');
                if (localBranches.length > 0) {
                  try {
                    console.log(`Tentando checkout para branch local '${localBranches[0]}' no submódulo ${submoduleName}`);
                    await git.checkout(localBranches[0]);
                    success = true;
                    branchUsed = localBranches[0];
                  } catch (e) {
                    console.log(`Falha ao fazer checkout para ${localBranches[0]}: ${e.message}`);
                  }
                }
              }
              
              if (!success) {
                const remotes = await git.getRemotes(true);
                if (remotes && remotes.length > 0) {
                  const remoteName = remotes[0].name;
                  
                  for (const branch of commonBranches) {
                    const remoteBranch = `remotes/${remoteName}/${branch}`;
                    if (branches.all.includes(remoteBranch)) {
                      try {
                        console.log(`Criando branch local '${branch}' rastreando '${remoteBranch}' no submódulo ${submoduleName}`);
                        await git.checkout(['-b', branch, '--track', remoteBranch]);
                        success = true;
                        branchUsed = branch;
                        break;
                      } catch (e) {
                        console.log(`Falha ao criar branch rastreando ${remoteBranch}: ${e.message}`);
                      }
                    }
                  }
                }
              }
              
              if (!success && remotes && remotes.length > 0) {
                const remoteName = remotes[0].name;
                const remoteBranches = branches.all.filter(b => b.startsWith(`remotes/${remoteName}/`) && !b.endsWith('/HEAD'));
                
                if (remoteBranches.length > 0) {
                  const remoteBranch = remoteBranches[0];
                  const branchName = remoteBranch.split('/').pop();
                  
                  try {
                    console.log(`Criando branch local '${branchName}' rastreando '${remoteBranch}' no submódulo ${submoduleName}`);
                    await git.checkout(['-b', branchName, '--track', remoteBranch]);
                    success = true;
                    branchUsed = branchName;
                  } catch (e) {
                    console.log(`Falha ao criar branch rastreando ${remoteBranch}: ${e.message}`);
                  }
                }
              }
              
              if (!success) {
                const tempBranch = `branch-${Date.now()}`;
                try {
                  console.log(`Criando branch temporária '${tempBranch}' no submódulo ${submoduleName}`);
                  await git.checkoutLocalBranch(tempBranch);
                  success = true;
                  branchUsed = tempBranch;
                } catch (e) {
                  throw new Error(`Não foi possível criar branch temporária: ${e.message}`);
                }
              }
              
              if (success) {
                fixed++;
                resultDetails.push(`✅ ${submoduleName}: Corrigido, usando branch '${branchUsed}'`);
              } else {
                throw new Error('Todas as tentativas de criar/checkout de branch falharam');
              }
            } catch (error) {
              console.error(`Erro ao corrigir submódulo ${submoduleName}:`, error);
              errors++;
              resultDetails.push(`❌ Erro ao corrigir ${submoduleName}: ${error.message}`);
            }
          } else {
            resultDetails.push(`🟢 ${submoduleName}: Já está em uma branch (não detached), ignorado.`);
          }
        } catch (submoduleError) {
          console.error(`Erro ao processar submódulo:`, submoduleError);
          errors++;
          resultDetails.push(`❌ Erro ao processar submódulo: ${submoduleError.message}`);
        }
      }
      
      const detailsText = resultDetails.length > 0 
        ? 'Detalhes:\n- ' + resultDetails.join('\n- ') 
        : '';
      
      return {
        success: true,
        message: `Corrigidos ${fixed} de ${total} submódulos em estado detached HEAD (${errors} erros, ${skipped} ignorados)\n\n${detailsText}`,
        fixed,
        total,
        errors,
        skipped,
        details: resultDetails
      };
    } catch (error) {
      console.error(`Erro ao corrigir submódulos detached de ${repoPath}:`, error);
      throw new Error(`Erro ao corrigir submódulos detached: ${error.message}`);
    }
  }


  async commitAndPush(repoPath, message) {
    try {
      await this.ensureSafeDirectory(repoPath);
      const git = simpleGit(repoPath);
      
      const status = await git.status();
      if (status.files.length === 0) {
        return 'Não há mudanças para commitar';
      }
      
      await git.add('.');
      
      await git.commit(message);
      
      await git.push();
      
      return `Commit e push realizados com sucesso: ${message}`;
    } catch (error) {
      console.error(`Erro ao fazer commit e push em ${repoPath}:`, error);
      throw new Error(`Erro ao fazer commit e push: ${error.message}`);
    }
  }


  async getRepositoryStatus(repoPath) {
    try {
      await this.ensureSafeDirectory(repoPath);
      const git = simpleGit(repoPath);
      
      const status = await git.status();
      

      const branch = status.current;
      

      const hasSubmodules = await this.hasSubmodules(repoPath);
      
      let submodulesStatus = null;
      if (hasSubmodules) {
        try {
          const submodules = await this.getSubmodules(repoPath);
          
          const submodulesInfo = [];
          for (const submodule of submodules) {
            try {
              const submoduleName = submodule.nameSafe || submodule.name;
              const submodulePath = submodule.path;
              const submodulePathFull = path.join(repoPath, submodulePath);
              
              let status = 'não inicializado';
              if (fs.existsSync(path.join(submodulePathFull, '.git'))) {
                status = 'inicializado';
                
                try {
                  const isDetached = await this.isDetachedHead(submodulePathFull);
                  if (isDetached) {
                    status = 'detached HEAD';
                  }
                } catch (detachedError) {
                  console.error(`Erro ao verificar estado detached para ${submoduleName}:`, detachedError);
                  status = 'erro ao verificar';
                }
              }
              
              submodulesInfo.push({
                name: submoduleName,
                path: submodulePath,
                status
              });
            } catch (submoduleError) {
              console.error(`Erro ao processar status do submódulo:`, submoduleError);

            }
          }
          
          submodulesStatus = {
            total: submodules.length,
            initialized: submodulesInfo.filter(s => s.status !== 'não inicializado').length,
            detached: submodulesInfo.filter(s => s.status === 'detached HEAD').length,
            error: submodulesInfo.filter(s => s.status === 'erro ao verificar').length,
            submodules: submodulesInfo
          };
        } catch (submodulesError) {
          console.error(`Erro ao obter status dos submódulos:`, submodulesError);

          submodulesStatus = {
            total: 0,
            initialized: 0,
            detached: 0,
            error: 1,
            errorMessage: submodulesError.message,
            submodules: []
          };
        }
      }
      
      return {
        name: path.basename(repoPath),
        path: repoPath,
        branch,
        isDetached: status.detached,
        hasChanges: status.files.length > 0,
        changesCount: status.files.length,
        hasSubmodules,
        submodulesStatus
      };
    } catch (error) {
      console.error(`Erro ao obter status do repositório ${repoPath}:`, error);
      throw new Error(`Erro ao obter status do repositório: ${error.message}`);
    }
  }


  async commitAndPull(repoPath, includeSubmodules = false) {
    try {
      await this.ensureSafeDirectory(repoPath);
      const git = simpleGit(repoPath);
      
      const status = await git.status();
      if (status.files.length === 0) {
        // Se não há mudanças locais, apenas fazer pull
        const pullResult = await this.pullRepository(repoPath, includeSubmodules, 'normal');
        return `Não há mudanças locais para commitar.\n\nPull: ${pullResult}`;
      }
      
      // Contar arquivos que serão commitados
      const filesCount = status.files.length;
      const modifiedFiles = status.files.filter(f => f.working_dir === 'M' || f.index === 'M').length;
      const newFiles = status.files.filter(f => f.working_dir === '?' || f.index === 'A').length;
      const deletedFiles = status.files.filter(f => f.working_dir === 'D' || f.index === 'D').length;
      
      // Gerar mensagem de commit automática com timestamp
      const timestamp = new Date().toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const commitMessage = `Auto-commit: Mudanças locais commitadas automaticamente - ${timestamp}`;
      
      // Adicionar todas as mudanças
      await git.add('.');
      
      // Fazer commit
      await git.commit(commitMessage);
      console.log(`Commit automático realizado: ${commitMessage}`);
      
      // Fazer push das mudanças commitadas
      let pushSuccess = false;
      try {
        await git.push();
        console.log('Push realizado com sucesso após commit automático');
        pushSuccess = true;
      } catch (pushError) {
        console.warn('Aviso: Não foi possível fazer push, mas o commit foi realizado. Continuando com pull...');
      }
      
      // Agora fazer pull para verificar atualizações do remoto
      let pullInfo = '';
      try {
        const pullResult = await this.pullRepository(repoPath, includeSubmodules, 'normal');
        if (pullResult.includes('0 arquivos alterados')) {
          pullInfo = 'Repositório remoto já estava atualizado.';
        } else {
          pullInfo = pullResult;
        }
      } catch (pullError) {
        pullInfo = 'Erro ao fazer pull após commit, mas commit foi realizado com sucesso.';
      }
      
      let resultMessage = `✅ Commit automático realizado com sucesso!\n`;
      resultMessage += `📁 Arquivos processados: ${filesCount} arquivos\n`;
      if (modifiedFiles > 0) resultMessage += `📝 Modificados: ${modifiedFiles}\n`;
      if (newFiles > 0) resultMessage += `➕ Novos: ${newFiles}\n`;
      if (deletedFiles > 0) resultMessage += `➖ Removidos: ${deletedFiles}\n`;
      resultMessage += `💬 Mensagem: "${commitMessage}"\n`;
      resultMessage += pushSuccess ? `📤 Push: Realizado com sucesso\n` : `⚠️ Push: Falhou, mas commit foi salvo localmente\n`;
      resultMessage += `🔄 Pull: ${pullInfo}`;
      
      return resultMessage;
    } catch (error) {
      console.error(`Erro ao fazer commit e pull em ${repoPath}:`, error);
      throw new Error(`Erro ao fazer commit e pull: ${error.message}`);
    }
  }
}

module.exports = GitManager; 