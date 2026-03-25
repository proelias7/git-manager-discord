const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(process.cwd(), 'data', 'repoUserAccess.json');

/**
 * @returns {{ repos: Record<string, string[]> }}
 */
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (raw && typeof raw.repos === 'object' && raw.repos !== null) {
        return { repos: raw.repos };
      }
    }
  } catch (e) {
    console.error('[repoUserAccess] Erro ao carregar:', e.message);
  }
  return { repos: {} };
}

function saveData(data) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * @param {string} repoPath
 * @returns {string}
 */
function keyPath(repoPath) {
  return path.normalize(repoPath);
}

/**
 * @param {string} repoPath
 * @returns {string[]}
 */
function getUsersForRepo(repoPath) {
  const k = keyPath(repoPath);
  const { repos } = loadData();
  const list = repos[k];
  return Array.isArray(list) ? [...list] : [];
}

/**
 * @param {string} userId
 * @param {string} repoPath
 * @returns {boolean}
 */
function isUserAllowedOnRepo(userId, repoPath) {
  return getUsersForRepo(repoPath).includes(userId);
}

/**
 * @param {string} repoPath
 * @param {string} userId
 */
function addUser(repoPath, userId) {
  const data = loadData();
  const k = keyPath(repoPath);
  if (!data.repos[k]) data.repos[k] = [];
  if (!data.repos[k].includes(userId)) {
    data.repos[k].push(userId);
  }
  saveData(data);
}

/**
 * @param {string} repoPath
 * @param {string} userId
 */
function removeUser(repoPath, userId) {
  const data = loadData();
  const k = keyPath(repoPath);
  if (!data.repos[k]) return;
  data.repos[k] = data.repos[k].filter((id) => id !== userId);
  if (data.repos[k].length === 0) {
    delete data.repos[k];
  }
  saveData(data);
}

module.exports = {
  loadData,
  getUsersForRepo,
  isUserAllowedOnRepo,
  addUser,
  removeUser,
  keyPath
};
