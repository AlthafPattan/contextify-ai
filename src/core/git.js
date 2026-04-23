const simpleGit = require('simple-git');
const path = require('path');
const { glob } = require('glob');

/**
 * Get staged files that match the configured scope.
 */
async function getStagedFiles(config) {
  const git = simpleGit(config._root);

  // Get list of staged files
  const status = await git.status();
  const staged = [
    ...status.staged,
    ...status.created,
    ...status.renamed.map(r => r.to),
  ];

  // Filter to unique absolute paths
  const uniquePaths = [...new Set(staged)].map(f =>
    path.resolve(config._root, f)
  );

  // Filter by include/exclude patterns
  return filterByScope(uniquePaths, config);
}

/**
 * Filter file paths by include/exclude glob patterns.
 */
async function filterByScope(files, config) {
  const root = config._root;

  // Get all files matching include patterns
  const included = new Set();
  for (const pattern of config.include) {
    const matches = await glob(pattern, { cwd: root, absolute: true });
    matches.forEach(m => included.add(m));
  }

  // Get all files matching exclude patterns
  const excluded = new Set();
  for (const pattern of config.exclude) {
    const matches = await glob(pattern, { cwd: root, absolute: true });
    matches.forEach(m => excluded.add(m));
  }

  return files.filter(f => included.has(f) && !excluded.has(f));
}

/**
 * Stage .context.md files into the current commit.
 */
async function stageContextFiles(contextPaths, config) {
  const git = simpleGit(config._root);

  for (const contextPath of contextPaths) {
    const relativePath = path.relative(config._root, contextPath);
    await git.add(relativePath);
  }
}

/**
 * Append a tag to the most recent commit message.
 * Only used in post-commit mode.
 */
async function tagCommitMessage(tag, config) {
  if (!config.commitTags) return;

  const git = simpleGit(config._root);
  const log = await git.log({ maxCount: 1 });

  if (log.latest) {
    const currentMessage = log.latest.message;
    // Don't double-tag
    if (currentMessage.includes('[context:')) return;

    const newMessage = `${currentMessage} [context: ${tag}]`;
    await git.raw(['commit', '--amend', '-m', newMessage, '--no-verify']);
  }
}

/**
 * Get the most recent commit message (for post-commit mode).
 */
async function getLastCommitMessage(config) {
  const git = simpleGit(config._root);
  const log = await git.log({ maxCount: 1 });
  return log.latest?.message || '';
}

/**
 * Get all files in the project matching the configured scope.
 * Used for bulk generation during init.
 */
async function getAllScopedFiles(config) {
  const root = config._root;
  const allFiles = [];

  for (const pattern of config.include) {
    const matches = await glob(pattern, {
      cwd: root,
      absolute: true,
      ignore: config.exclude,
    });
    allFiles.push(...matches);
  }

  return [...new Set(allFiles)];
}

module.exports = {
  getStagedFiles,
  filterByScope,
  stageContextFiles,
  tagCommitMessage,
  getLastCommitMessage,
  getAllScopedFiles,
};
