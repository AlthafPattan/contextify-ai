const { loadConfig } = require('./core/config');
const { analyzeFile } = require('./core/analyzer');
const { smartDiff } = require('./core/smart-diff');
const { generateContext } = require('./core/generator');
const { buildIndex } = require('./core/indexer');

module.exports = {
  loadConfig,
  analyzeFile,
  smartDiff,
  generateContext,
  buildIndex,
};
