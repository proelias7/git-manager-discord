const path = require('path');

/**
 * @param {string} p
 * @returns {string}
 */
function normalizeGitPath(p) {
  if (!p) return '';
  return path.normalize(path.resolve(p)).toLowerCase();
}

/**
 * Verifica se o caminho é o repositório principal (raiz GIT_BASE_PATH).
 * @param {string} localPath
 * @param {string} [basePath]
 * @returns {boolean}
 */
function isMainRepositoryPath(localPath, basePath = process.env.GIT_BASE_PATH) {
  if (!basePath || !localPath) return false;
  return normalizeGitPath(localPath) === normalizeGitPath(basePath);
}

/**
 * @param {string} localPath
 * @param {string} [basePath]
 * @returns {boolean}
 */
function isSubmodulePath(localPath, basePath = process.env.GIT_BASE_PATH) {
  return !isMainRepositoryPath(localPath, basePath);
}

module.exports = {
  normalizeGitPath,
  isMainRepositoryPath,
  isSubmodulePath
};
