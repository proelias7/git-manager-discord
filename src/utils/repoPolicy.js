const fs = require('fs');
const path = require('path');

const POLICY_FILE = path.join(process.cwd(), 'data', 'repoPolicy.json');

/**
 * @returns {{ pullOnRestartOnly: string[] }}
 */
function loadRepoPolicy() {
  try {
    if (fs.existsSync(POLICY_FILE)) {
      return JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[repoPolicy] Erro ao carregar:', e.message);
  }
  return { pullOnRestartOnly: [] };
}

/**
 * @param {{ pullOnRestartOnly: string[] }} data
 */
function saveRepoPolicy(data) {
  const dir = path.dirname(POLICY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(POLICY_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Caminhos absolutos que só devem receber pull no horário agendado (além da fila de submódulos).
 * @returns {string[]}
 */
function getPullOnRestartOnlyPaths() {
  const p = loadRepoPolicy();
  const arr = p.pullOnRestartOnly;
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => path.normalize(x));
}

/**
 * @param {string} localPath
 * @returns {boolean}
 */
function isPullOnRestartOnly(localPath) {
  const n = path.normalize(localPath);
  return getPullOnRestartOnlyPaths().some((x) => path.normalize(x) === n);
}

module.exports = {
  loadRepoPolicy,
  saveRepoPolicy,
  getPullOnRestartOnlyPaths,
  isPullOnRestartOnly
};
