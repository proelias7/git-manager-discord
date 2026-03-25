const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(process.cwd(), 'data', 'restartPullQueue.json');

/**
 * @returns {string[]}
 */
function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const d = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
      return Array.isArray(d.paths) ? d.paths.map((p) => path.normalize(p)) : [];
    }
  } catch (e) {
    console.error('[restartPullQueue] Erro ao carregar:', e.message);
  }
  return [];
}

/**
 * @param {string[]} paths
 */
function saveQueue(paths) {
  const dir = path.dirname(QUEUE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const unique = [...new Set(paths.map((p) => path.normalize(p)))];
  fs.writeFileSync(QUEUE_FILE, JSON.stringify({ paths: unique }, null, 2), 'utf8');
}

/**
 * @param {string} repoPath
 * @returns {number} tamanho da fila após enfileirar
 */
function enqueue(repoPath) {
  const n = path.normalize(repoPath);
  const paths = loadQueue();
  if (!paths.includes(n)) {
    paths.push(n);
  }
  saveQueue(paths);
  return paths.length;
}

/**
 * Limpa e devolve todos os caminhos pendentes.
 * @returns {string[]}
 */
function dequeueAll() {
  const paths = loadQueue();
  saveQueue([]);
  return paths;
}

/**
 * @returns {string[]}
 */
function peek() {
  return loadQueue();
}

/**
 * Remove um caminho da fila, se existir.
 * @param {string} repoPath
 * @returns {boolean} true se removeu
 */
function remove(repoPath) {
  const n = path.normalize(repoPath);
  const paths = loadQueue();
  const next = paths.filter((p) => path.normalize(p) !== n);
  const removed = next.length < paths.length;
  saveQueue(next);
  return removed;
}

function clear() {
  saveQueue([]);
}

module.exports = {
  enqueue,
  dequeueAll,
  peek,
  remove,
  clear,
  loadQueue,
  saveQueue
};
