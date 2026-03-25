const cron = require('node-cron');
const path = require('path');
const restartPullQueue = require('../utils/restartPullQueue');
const repoPolicy = require('../utils/repoPolicy');

/**
 * @param {string} slot "HH:mm"
 * @param {number} leadMin
 * @returns {number} minutos desde meia-noite (0–1439) do instante do pull
 */
function computeTriggerMinutesFromRestart(slot, leadMin) {
  const parts = slot.trim().split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  let total = h * 60 + m - leadMin;
  while (total < 0) total += 24 * 60;
  while (total >= 24 * 60) total -= 24 * 60;
  return total;
}

/**
 * @param {number} totalMinutes
 * @returns {string} expressão cron node-cron (minuto hora * * *)
 */
function minutesToCronExpression(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${m} ${h} * * *`;
}

/**
 * @param {import('../utils/gitManager')} gitManager
 * @returns {{ stop: () => void }}
 */
function startRestartPullScheduler(gitManager) {
  if (process.env.RESTART_SCHEDULE_ENABLED === 'false') {
    console.log('ℹ️  Agendador de pull no reinício desligado (RESTART_SCHEDULE_ENABLED=false)');
    return { stop: () => {} };
  }

  const scheduleRaw = process.env.RESTART_SCHEDULE || '';
  const lead = Math.max(0, parseInt(process.env.RESTART_PULL_LEAD_MINUTES || '2', 10));
  const slots = scheduleRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (slots.length === 0) {
    console.log('ℹ️  RESTART_SCHEDULE vazio — agendador de pull no reinício não iniciado');
    return { stop: () => {} };
  }

  const tasks = [];

  for (const slot of slots) {
    if (!/^\d{1,2}:\d{2}$/.test(slot)) {
      console.warn(`[RestartScheduler] Horário ignorado (formato use HH:mm): "${slot}"`);
      continue;
    }

    const triggerMin = computeTriggerMinutesFromRestart(slot, lead);
    if (triggerMin < 0) continue;

    const expr = minutesToCronExpression(triggerMin);
    const th = Math.floor(triggerMin / 60);
    const tm = triggerMin % 60;
    console.log(
      `[RestartScheduler] Reinício configurado ${slot} → pull às ${String(th).padStart(2, '0')}:${String(tm).padStart(2, '0')} (local, ${lead} min antes) | cron "${expr}"`
    );

    const task = cron.schedule(expr, async () => {
      await runScheduledPulls(gitManager);
    });
    tasks.push(task);
  }

  if (tasks.length === 0) {
    console.warn('[RestartScheduler] Nenhum horário válido — agendador não iniciado');
    return { stop: () => {} };
  }

  console.log(`✅ RestartScheduler: ${tasks.length} job(s) ativo(s) (relógio local do sistema)`);

  return {
    stop: () => {
      tasks.forEach((t) => {
        try {
          t.stop();
        } catch (_) {}
      });
    }
  };
}

/**
 * @param {import('../utils/gitManager')} gitManager
 */
async function runScheduledPulls(gitManager) {
  const fromQueue = restartPullQueue.dequeueAll();
  const fromPolicy = repoPolicy.getPullOnRestartOnlyPaths();
  const allPaths = [...new Set([...fromQueue, ...fromPolicy].map((p) => path.normalize(p)))];

  if (allPaths.length === 0) {
    console.log('[RestartScheduler] Nada a puxar (fila vazia e sem pullOnRestartOnly)');
    return;
  }

  console.log(`[RestartScheduler] Executando pull em ${allPaths.length} caminho(s)`);

  for (const repoPath of allPaths) {
    try {
      let result = await gitManager.pullRepository(repoPath, false, 'normal');
      if (result === 'STATUS_HAS_CHANGES') {
        result = await gitManager.pullRepository(repoPath, false, 'stash');
      }
      console.log(`[RestartScheduler] OK: ${repoPath} → ${String(result).slice(0, 120)}`);
    } catch (e) {
      console.error(`[RestartScheduler] Erro em ${repoPath}:`, e.message);
      restartPullQueue.enqueue(repoPath);
    }
  }
}

module.exports = {
  startRestartPullScheduler,
  runScheduledPulls
};
