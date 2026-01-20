# 📘 Guia Completo: Configurar Webhook (GitHub / GitLab)

Este guia mostra passo a passo como configurar webhooks para pull automático quando um commit contém `@pull`.

> **Suporte:** GitHub e GitLab com a mesma configuração!

## 📋 Pré-requisitos

- ✅ Bot do Discord rodando e configurado
- ✅ Servidor webhook rodando na porta 3001 (ou porta configurada)
- ✅ Firewall configurado e porta aberta
- ✅ Repositório que você deseja monitorar
- ✅ Acesso de administrador/maintainer ao repositório

## 🚀 Passo a Passo

### Passo 1: Obter URL do Webhook

Primeiro, você precisa da URL pública do seu servidor webhook.

#### Opção A: Servidor com IP Público
```
http://SEU_IP_PUBLICO:3001/webhook
```

Para descobrir seu IP público:
- Acesse: https://www.whatismyip.com/
- Ou execute: `curl ifconfig.me`

#### Opção B: Usar Túnel (Recomendado para desenvolvimento)

| Serviço | Comando |
|---------|---------|
| **ngrok** | `ngrok http 3001` |
| **Cloudflare Tunnel** | Gratuito e sem limites |
| **LocalTunnel** | `npx localtunnel --port 3001` |

Exemplo com ngrok:
```bash
ngrok http 3001
# Retorna: https://abc123.ngrok.io
# URL do webhook: https://abc123.ngrok.io/webhook
```

### Passo 2: Configurar o .env

Adicione as seguintes variáveis no arquivo `.env`:

```env
# Habilitar webhook
ENABLE_GITHUB_WEBHOOK=true

# Porta do servidor (padrão: 3001)
WEBHOOK_PORT=3001

# Secret para autenticação (use o mesmo no GitHub/GitLab)
WEBHOOK_SECRET=seu_secret_seguro_aqui

# Canal do Discord para notificações (opcional)
DISCORD_WEBHOOK_CHANNEL_ID=id_do_canal

# Diretório com seus repositórios (usado para bot e auto-mapping)
GIT_BASE_PATH=C:/seus/projetos
```

### Passo 3: Configurar o Webhook no Provedor

<details>
<summary><b>🐙 GitHub</b></summary>

1. Acesse seu repositório no GitHub
2. Vá em **Settings** → **Webhooks** → **Add webhook**
3. Preencha:

| Campo | Valor |
|-------|-------|
| **Payload URL** | `http://SEU_IP:3001/webhook` |
| **Content type** | `application/json` |
| **Secret** | Mesmo valor do `WEBHOOK_SECRET` no `.env` |
| **Events** | `Just the push event` |
| **Active** | ✅ Marcado |

4. Clique em **Add webhook**
5. GitHub enviará um ping de teste - deve mostrar ✅ verde

</details>

<details>
<summary><b>🦊 GitLab</b></summary>

1. Acesse seu projeto no GitLab
2. Vá em **Settings** → **Webhooks**
3. Preencha:

| Campo | Valor |
|-------|-------|
| **URL** | `http://SEU_IP:3001/webhook` |
| **Secret token** | Mesmo valor do `WEBHOOK_SECRET` no `.env` |
| **Trigger** | ✅ Push events |
| **SSL verification** | Desabilitar se usar HTTP |

4. Clique em **Add webhook**
5. Clique em **Test** → **Push events** para testar

</details>

### Passo 4: Mapear Repositórios (Opcional)

O sistema suporta **mapeamento automático** - ele escaneia o diretório `GIT_BASE_PATH` e encontra repositórios automaticamente baseado no remote origin.

#### Mapeamento Automático
Se você configurou `GIT_BASE_PATH` no `.env`, o sistema encontra os repositórios automaticamente (incluindo submódulos).

Para ver os repositórios descobertos:
```bash
curl http://localhost:3001/mappings/discovered
```

Para forçar um novo scan:
```bash
curl -X POST http://localhost:3001/mappings/refresh
```

#### Mapeamento Manual (se necessário)

Via API:
```bash
curl -X POST http://localhost:3001/mappings \
  -H "Content-Type: application/json" \
  -d '{"githubRepo": "usuario/repositorio", "localPath": "C:/caminho/local"}'
```

Ou edite diretamente o arquivo `data/repoMapping.json`:
```json
{
  "usuario/repositorio": "C:/caminho/local"
}
```

### Passo 5: Testar

Faça um commit com `@pull` na mensagem:

```bash
git add .
git commit -m "Atualização @pull"
git push
```

O bot deve:
1. ✅ Receber o webhook
2. ✅ Detectar `@pull` na mensagem
3. ✅ Executar pull automático no repositório local
4. ✅ Enviar notificação no Discord (se configurado)

## 🔍 Verificar se Está Funcionando

### Health Check
```bash
curl http://localhost:3001/health
```
Resposta esperada:
```json
{"status":"ok","service":"git-webhook","supportedSources":["github","gitlab"]}
```

### Ver Mapeamentos
```bash
curl http://localhost:3001/mappings
```

### Logs do Bot
```bash
# Com PM2
pm2 logs git-manager-discord

# Ou no console
```

Você deve ver:
```
🚀 Servidor de webhook Git iniciado na porta 3001
🔐 Secret: configurado
🐙 GitHub: Suportado
🦊 GitLab: Suportado
🗺️  Auto-mapping: habilitado
📦 Repositórios encontrados: 5
```

## 🐛 Troubleshooting

### Webhook não está sendo recebido

1. **Servidor rodando?**
   ```bash
   curl http://localhost:3001/health
   ```

2. **Porta acessível externamente?**
   - Teste: https://www.yougetsignal.com/tools/open-ports/

3. **Firewall configurado?**
   - Windows: `netsh advfirewall firewall show rule name="GitHub-Webhook-GitManager"`
   - Linux: `sudo ufw status`

### Erro: "Repositório não encontrado"

1. Verifique se `GIT_BASE_PATH` está configurado corretamente
2. Force um refresh: `curl -X POST http://localhost:3001/mappings/refresh`
3. Ou adicione mapeamento manual

### Erro: "Assinatura/Token inválido"

1. Verifique se `WEBHOOK_SECRET` no `.env` é igual ao configurado no GitHub/GitLab
2. Reinicie o bot após alterar o `.env`
3. O secret é case-sensitive!

### Pull não está sendo executado

1. O commit contém `@pull`? (case-insensitive)
2. O push foi na branch `main`?
3. Verifique os logs para erros detalhados

## 📝 Exemplo Completo

### 1. Estrutura de Diretórios
```
C:/projetos/
├── meu-projeto/           # Repo principal
│   ├── .git/
│   ├── .gitmodules
│   └── libs/
│       └── shared/        # Submódulo
└── outro-projeto/
    └── .git/
```

### 2. Configuração .env
```env
GIT_BASE_PATH=C:/projetos
ENABLE_GITHUB_WEBHOOK=true
WEBHOOK_PORT=3001
WEBHOOK_SECRET=meu_secret_super_seguro_123
AUTO_REPO_MAPPING=true
```

### 3. Webhook (GitHub ou GitLab)
- **URL**: `http://SEU_IP:3001/webhook`
- **Secret**: `meu_secret_super_seguro_123`
- **Events**: Push events

### 4. Resultado do Scan
```
[AutoMapping] [Repo] Encontrado: usuario/meu-projeto -> C:/projetos/meu-projeto
[AutoMapping] [Submódulo] Encontrado: usuario/shared -> C:/projetos/meu-projeto/libs/shared
[AutoMapping] [Repo] Encontrado: usuario/outro-projeto -> C:/projetos/outro-projeto
```

### 5. Teste
```bash
cd C:/projetos/meu-projeto
git commit -m "Nova feature @pull"
git push
```

## 🔄 Diferenças entre GitHub e GitLab

| Aspecto | GitHub | GitLab |
|---------|--------|--------|
| Header de autenticação | `X-Hub-Signature-256` (HMAC) | `X-Gitlab-Token` (simples) |
| Evento de push | `push` | `Push Hook` |
| Formato do repo | `owner/repo` | `namespace/project` |
| Subgrupos | Não suporta | Suporta (`grupo/sub/projeto`) |

> **Nota:** O sistema detecta automaticamente a origem e usa o método correto de validação.

## ✅ Checklist Final

- [ ] `GIT_BASE_PATH` apontando para diretório com repositórios
- [ ] `ENABLE_GITHUB_WEBHOOK=true` no `.env`
- [ ] `WEBHOOK_SECRET` definido (mesmo valor no provedor)
- [ ] Firewall configurado e porta aberta
- [ ] Webhook criado no GitHub/GitLab
- [ ] Teste realizado com commit contendo `@pull`
- [ ] Logs verificados e funcionando

## 🎉 Pronto!

Agora sempre que você fizer um commit com `@pull` na mensagem e der push para a branch main, o bot executará pull automático no repositório local!

**Funciona tanto para GitHub quanto GitLab com a mesma configuração!**
