const { PermissionFlagsBits } = require('discord.js');
const repoUserAccess = require('./repoUserAccess');

/**
 * Cargo configurado em GIT_ADMIN_ROLE_ID — acesso total ao bot (painel + todos os repos).
 * @param {import('discord.js').GuildMember | null | undefined} member
 * @returns {boolean}
 */
function isGitAdmin(member) {
  if (!member) return false;
  const roleId = process.env.GIT_ADMIN_ROLE_ID;
  if (roleId && roleId.trim() && member.roles?.cache?.has(roleId.trim())) {
    return true;
  }
  if (!roleId || !roleId.trim()) {
    return member.permissions?.has(PermissionFlagsBits.Administrator) === true;
  }
  return false;
}

/**
 * Pode executar ações Git no repositório (path absoluto).
 * @param {import('discord.js').GuildMember | null | undefined} member
 * @param {string} repoPath
 * @returns {boolean}
 */
function canUserActOnGit(member, repoPath) {
  if (!member || !repoPath) return false;
  if (isGitAdmin(member)) return true;
  return repoUserAccess.isUserAllowedOnRepo(member.id, repoPath);
}

/**
 * Pode criar painel com /init — admin ou lista vazia + Administrador Discord (bootstrap).
 * @param {import('discord.js').GuildMember | null | undefined} member
 * @param {string} mainRepoPath
 * @returns {boolean}
 */
function canCreateGitPanel(member, mainRepoPath) {
  if (!member) return false;
  if (isGitAdmin(member)) return true;
  const hasUsers = repoUserAccess.getUsersForRepo(mainRepoPath).length > 0;
  if (!hasUsers) {
    return member.permissions?.has(PermissionFlagsBits.Administrator) === true;
  }
  return canUserActOnGit(member, mainRepoPath);
}

module.exports = {
  isGitAdmin,
  canUserActOnGit,
  canCreateGitPanel
};
