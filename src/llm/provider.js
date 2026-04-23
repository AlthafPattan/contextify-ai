const https = require('https');
const http = require('http');

/**
 * Call an LLM provider with the given prompt.
 * Returns the generated text.
 */
async function callLLM(config, systemPrompt, userPrompt) {
  switch (config.provider) {
    case 'claude':
      return callClaude(config, systemPrompt, userPrompt);
    case 'openai':
      return callOpenAI(config, systemPrompt, userPrompt);
    case 'ollama':
      return callOllama(config, systemPrompt, userPrompt);
    default:
      throw new Error(`Unknown provider: ${config.provider}. Supported: claude, openai, ollama`);
  }
}

/**
 * Anthropic Claude API
 */
async function callClaude(config, systemPrompt, userPrompt) {
  if (!config.apiKey) {
    throw new Error(
      'Anthropic API key not found. Set ANTHROPIC_API_KEY env variable or add apiKey to .contextifyrc'
    );
  }

  const body = JSON.stringify({
    model: config.model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const data = await httpRequest({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
  }, body);

  const parsed = JSON.parse(data);
  if (parsed.error) {
    throw new Error(`Claude API error: ${parsed.error.message}`);
  }

  return parsed.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n');
}

/**
 * OpenAI API
 */
async function callOpenAI(config, systemPrompt, userPrompt) {
  if (!config.apiKey) {
    throw new Error(
      'OpenAI API key not found. Set OPENAI_API_KEY env variable or add apiKey to .contextifyrc'
    );
  }

  const body = JSON.stringify({
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 4096,
  });

  const data = await httpRequest({
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
  }, body);

  const parsed = JSON.parse(data);
  if (parsed.error) {
    throw new Error(`OpenAI API error: ${parsed.error.message}`);
  }

  return parsed.choices[0].message.content;
}

/**
 * Ollama local API
 */
async function callOllama(config, systemPrompt, userPrompt) {
  const url = new URL(config.ollama?.host || 'http://localhost:11434');

  const body = JSON.stringify({
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    stream: false,
  });

  const isHTTPS = url.protocol === 'https:';
  const transport = isHTTPS ? https : http;

  const data = await new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (isHTTPS ? 443 : 11434),
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => resolve(chunks));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const parsed = JSON.parse(data);
  return parsed.message?.content || '';
}

/**
 * Generic HTTPS request helper.
 */
function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => resolve(chunks));
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy(new Error('LLM request timed out after 60s'));
    });
    req.write(body);
    req.end();
  });
}

module.exports = { callLLM };
