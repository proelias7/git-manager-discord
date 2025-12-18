# 📘 Guia Completo: Configurar Webhook no GitHub

Este guia mostra passo a passo como configurar o webhook do GitHub para pull automático quando um commit contém `@pull`.

## 📋 Pré-requisitos

- ✅ Bot do Discord rodando e configurado
- ✅ Servidor webhook rodando na porta 3001 (ou porta configurada)
- ✅ Firewall configurado (já feito!)
- ✅ Repositório GitHub que você deseja monitorar
- ✅ Acesso de administrador ao repositório GitHub

## 🚀 Passo a Passo

### Passo 1: Obter URL do Webhook

Primeiro, você precisa da URL pública do seu servidor webhook. Existem duas opções:

#### Opção A: Servidor com IP Público
```
http://SEU_IP_PUBLICO:3001/webhook
```

Para descobrir seu IP público:
- Acesse: https://www.whatismyip.com/
- Ou execute: `curl ifconfig.me` no terminal

#### Opção B: Usar Túnel (Recomendado para desenvolvimento)
Use serviços como:
- **ngrok**: `ngrok http 3001`
- **Cloudflare Tunnel**: Gratuito e sem limites
- **LocalTunnel**: `npx localtunnel --port 3001`

Exemplo com ngrok:
```bash
ngrok http 3001
# Retorna algo como: https://abc123.ngrok.io
# URL do webhook: https://abc123.ngrok.io/webhook
```

### Passo 2: Mapear Repositório GitHub → Caminho Local

Antes de configurar o webhook, você precisa mapear o repositório GitHub para o caminho local.

#### Método 1: Via API REST (Recomendado)

```bash
curl -X POST http://localhost:3001/mappings \
  -H "Content-Type: application/json" \
  -d "{
    \"githubRepo\": \"usuario/nome-do-repositorio\",
    \"localPath\": \"C:/caminho/completo/para/repositorio\"
  }"
```

**Exemplo real:**
```bash
curl -X POST http://localhost:3001/mappings \
  -H "Content-Type: application/json" \
  -d "{
    \"githubRepo\": \"proelias7/git-manager-discord\",
    \"localPath\": \"C:/Users/Administrator/Desktop/BOTS/git-manager-discord\"
  }"
```

#### Método 2: Editar arquivo manualmente

1. Abra o arquivo: `git-manager-discord/data/repoMapping.json`
2. Adicione o mapeamento:
```json
{
  "usuario/nome-do-repositorio": "C:/caminho/completo/para/repositorio"
}
```

**Exemplo:**
```json
{
  "proelias7/git-manager-discord": "C:/Users/Administrator/Desktop/BOTS/git-manager-discord"
}
```

### Passo 3: Acessar Configurações do Repositório GitHub

1. Acesse seu repositório no GitHub
2. Clique na aba **Settings** (Configurações)
3. No menu lateral esquerdo, clique em **Webhooks**
4. Clique no botão **Add webhook** (Adicionar webhook)

### Passo 4: Configurar o Webhook

Preencha os campos conforme abaixo:

#### 📝 Payload URL
```
http://SEU_IP:3001/webhook
```
ou se usar túnel:
```
https://seu-tunel.ngrok.io/webhook
```

**⚠️ Importante:** 
- Use `http://` se for IP público direto
- Use `https://` se usar túnel (ngrok, etc.)
- Não esqueça de adicionar `/webhook` no final

#### 📝 Content type
Selecione: **application/json**

#### 📝 Secret (Opcional mas Recomendado)
1. Gere um secret seguro (pode usar: https://www.random.org/strings/)
2. Cole o secret aqui
3. **IMPORTANTE:** Adicione o mesmo secret no arquivo `.env`:
   ```env
   GITHUB_WEBHOOK_SECRET=seu_secret_aqui
   ```

#### 📝 Which events would you like to trigger this webhook?
Selecione: **Just the push event**

Isso garante que o webhook só seja acionado quando houver push de commits.

#### 📝 Active
✅ Deixe marcado (ativo)

### Passo 5: Salvar e Testar

1. Clique em **Add webhook** (Verde no final da página)
2. GitHub irá enviar um webhook de teste (ping)
3. Você verá uma marca verde ✅ se funcionou
4. Se houver erro, clique no webhook para ver os detalhes

### Passo 6: Verificar Logs

Verifique os logs do bot para confirmar que recebeu o webhook:

```bash
# Se estiver usando PM2
pm2 logs git-manager-discord

# Ou verifique o console onde o bot está rodando
```

Você deve ver mensagens como:
```
🚀 Servidor de webhook GitHub iniciado na porta 3001
📡 Endpoint: http://localhost:3001/webhook
```

### Passo 7: Testar com Commit Real

Agora teste fazendo um commit com `@pull`:

```bash
cd C:/caminho/do/seu/repositorio
git add .
git commit -m "Teste de pull automático @pull"
git push
```

O bot deve:
1. Receber o webhook do GitHub
2. Detectar `@pull` na mensagem do commit
3. Executar pull automático no repositório local
4. (Opcional) Enviar notificação no Discord

## 🔍 Verificar se Está Funcionando

### 1. Verificar Mapeamentos

```bash
curl http://localhost:3001/mappings
```

Deve retornar:
```json
{
  "usuario/repositorio": "C:/caminho/local"
}
```

### 2. Verificar Webhook no GitHub

1. Vá em Settings → Webhooks
2. Clique no webhook criado
3. Role até "Recent Deliveries"
4. Você verá os eventos recebidos
5. Clique em um evento para ver detalhes:
   - ✅ Verde = Sucesso (200)
   - ❌ Vermelho = Erro

### 3. Verificar Logs do Bot

Procure por mensagens como:
```
Commit com @pull detectado: abc1234 - Teste de pull automático @pull
Executando pull automático para usuario/repo em C:/caminho/local
Repositório atualizado com sucesso: ...
```

## ⚙️ Configurações Avançadas

### Múltiplos Repositórios

Para adicionar mais repositórios, repita o processo de mapeamento:

```bash
curl -X POST http://localhost:3001/mappings \
  -H "Content-Type: application/json" \
  -d "{\"githubRepo\": \"usuario/repo2\", \"localPath\": \"C:/outro/caminho\"}"
```

### Notificações no Discord

Se configurou `DISCORD_WEBHOOK_CHANNEL_ID` no `.env`, o bot enviará uma mensagem no canal sempre que executar pull automático.

### Usar Porta Diferente

Se precisar usar outra porta:

1. Altere no `.env`:
   ```env
   WEBHOOK_PORT=3002
   ```

2. Atualize a regra do firewall:
   ```bash
   # Edite setup-firewall.bat e altere PORT=3002
   # Execute novamente como administrador
   ```

3. Atualize a URL do webhook no GitHub

## 🐛 Troubleshooting

### Webhook não está sendo recebido

1. **Verifique se o servidor está rodando:**
   ```bash
   curl http://localhost:3001/health
   ```
   Deve retornar: `{"status":"ok","service":"github-webhook"}`

2. **Verifique o firewall:**
   ```bash
   netsh advfirewall firewall show rule name="GitHub-Webhook-GitManager"
   ```

3. **Verifique se a porta está acessível externamente:**
   - Teste de outro computador: `curl http://SEU_IP:3001/health`
   - Ou use: https://www.yougetsignal.com/tools/open-ports/

4. **Verifique os logs do GitHub:**
   - Settings → Webhooks → Clique no webhook
   - Veja "Recent Deliveries" para erros

### Erro: "Repositório não mapeado"

1. Verifique se mapeou o repositório:
   ```bash
   curl http://localhost:3001/mappings
   ```

2. O formato deve ser exatamente: `usuario/repositorio` (case-insensitive)

3. Verifique se o caminho local existe e é um repositório Git válido

### Erro: "Invalid signature"

1. Verifique se o `GITHUB_WEBHOOK_SECRET` no `.env` está igual ao configurado no GitHub
2. Reinicie o bot após alterar o `.env`

### Pull não está sendo executado

1. Verifique se o commit realmente contém `@pull` (case-insensitive)
2. Verifique os logs do bot para erros
3. Teste fazer pull manual pelo Discord primeiro para garantir que funciona

## 📝 Exemplo Completo

Aqui está um exemplo completo de configuração:

### 1. Repositório GitHub
- **Owner**: `proelias7`
- **Repo**: `meu-projeto`
- **Full name**: `proelias7/meu-projeto`

### 2. Caminho Local
- **Caminho**: `C:\Users\Administrator\Desktop\projetos\meu-projeto`

### 3. Mapeamento
```bash
curl -X POST http://localhost:3001/mappings \
  -H "Content-Type: application/json" \
  -d "{\"githubRepo\": \"proelias7/meu-projeto\", \"localPath\": \"C:/Users/Administrator/Desktop/projetos/meu-projeto\"}"
```

### 4. Webhook no GitHub
- **URL**: `http://192.168.1.100:3001/webhook` (ou seu IP/túnel)
- **Content type**: `application/json`
- **Events**: `Just the push event`
- **Secret**: `meu_secret_super_seguro_123`

### 5. Teste
```bash
cd C:\Users\Administrator\Desktop\projetos\meu-projeto
git commit -m "Atualização importante @pull"
git push
```

## ✅ Checklist Final

- [ ] Servidor webhook rodando na porta 3001
- [ ] Firewall configurado e porta aberta
- [ ] Repositório mapeado (GitHub → Local)
- [ ] Webhook criado no GitHub
- [ ] Secret configurado (se usando)
- [ ] Teste realizado com commit contendo `@pull`
- [ ] Logs verificados e funcionando
- [ ] Notificações Discord funcionando (se configurado)

## 🎉 Pronto!

Agora sempre que você fizer um commit com `@pull` na mensagem e der push, o bot executará pull automático no repositório local!

