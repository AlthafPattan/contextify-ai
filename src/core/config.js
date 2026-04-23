const { cosmiconfig } = require('cosmiconfig');
const path = require('path');
const fs = require('fs');

const MODULE_NAME = 'contextify';

const DEFAULT_CONFIG = {
  // LLM provider settings
  provider: 'claude',
  model: null, // auto-detect based on provider
  apiKey: null, // reads from env if prefixed with 'env:'

  // Hook mode
  mode: 'pre-commit', // 'pre-commit' | 'post-commit'

  // File scope
  include: [
    'src/**/*.tsx',
    'src/**/*.ts',
    'src/**/*.jsx',
    'src/**/*.js',
  ],
  exclude: [
    '**/*.test.*',
    '**/*.spec.*',
    '**/*.stories.*',
    '**/*.story.*',
    '**/*.context.md',
    '**/index.ts',
    '**/index.tsx',
    '**/index.js',
    '**/index.jsx',
    '**/*.d.ts',
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
  ],

  // Output
  output: 'colocated', // 'colocated' | 'centralized'
  outputDir: '.contexts', // only used if output === 'centralized'

  // Performance
  concurrency: 5,
  smartDiff: true, // skip files with no structural changes

  // Commit message tags
  commitTags: true,

  // AI tool integrations
  tools: {
    claudeCode: false,
    cursor: false,
    copilot: false,
    windsurf: false,
  },

  // Ollama settings (when provider is 'ollama')
  ollama: {
    host: 'http://localhost:11434',
  },
};

/**
 * Resolve an API key value.
 * Supports 'env:VARIABLE_NAME' syntax to read from environment.
 */
function resolveApiKey(value) {
  if (!value) return null;
  if (value.startsWith('env:')) {
    const envVar = value.slice(4);
    return process.env[envVar] || null;
  }
  return value;
}

/**
 * Get default model for a provider.
 */
function getDefaultModel(provider) {
  const defaults = {
    claude: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o',
    ollama: 'llama3',
  };
  return defaults[provider] || 'claude-sonnet-4-20250514';
}

/**
 * Load and merge config from .contextifyrc, contextify.config.js, etc.
 */
async function loadConfig(projectRoot) {
  const explorer = cosmiconfig(MODULE_NAME, {
    searchPlaces: [
      `.${MODULE_NAME}rc`,
      `.${MODULE_NAME}rc.json`,
      `.${MODULE_NAME}rc.yaml`,
      `.${MODULE_NAME}rc.yml`,
      `.${MODULE_NAME}rc.js`,
      `${MODULE_NAME}.config.js`,
      `${MODULE_NAME}.config.json`,
    ],
  });

  const root = projectRoot || process.cwd();
  let userConfig = {};

  try {
    const result = await explorer.search(root);
    if (result && result.config) {
      userConfig = result.config;
    }
  } catch (err) {
    // No config file found, use defaults
  }

  // Deep merge with defaults
  const config = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    tools: {
      ...DEFAULT_CONFIG.tools,
      ...(userConfig.tools || {}),
    },
    ollama: {
      ...DEFAULT_CONFIG.ollama,
      ...(userConfig.ollama || {}),
    },
  };

  // Resolve API key
  config.apiKey = resolveApiKey(config.apiKey);

  // Auto-detect API key from common env vars if not set
  if (!config.apiKey) {
    if (config.provider === 'claude') {
      config.apiKey = process.env.ANTHROPIC_API_KEY || null;
    } else if (config.provider === 'openai') {
      config.apiKey = process.env.OPENAI_API_KEY || null;
    }
    // Ollama doesn't need an API key
  }

  // Set default model if not specified
  if (!config.model) {
    config.model = getDefaultModel(config.provider);
  }

  // Resolve include/exclude to absolute globs
  config._root = root;

  return config;
}

/**
 * Write a default config file.
 */
function writeDefaultConfig(projectRoot, overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const configPath = path.join(projectRoot, '.contextifyrc');

  const content = JSON.stringify({
    provider: config.provider,
    apiKey: config.provider === 'claude'
      ? 'env:ANTHROPIC_API_KEY'
      : config.provider === 'openai'
        ? 'env:OPENAI_API_KEY'
        : undefined,
    model: config.model || getDefaultModel(config.provider),
    mode: config.mode,
    include: config.include,
    exclude: config.exclude,
    output: config.output,
    concurrency: config.concurrency,
    smartDiff: config.smartDiff,
    commitTags: config.commitTags,
    tools: config.tools,
  }, null, 2);

  fs.writeFileSync(configPath, content, 'utf-8');
  return configPath;
}

module.exports = {
  loadConfig,
  writeDefaultConfig,
  DEFAULT_CONFIG,
  getDefaultModel,
};
