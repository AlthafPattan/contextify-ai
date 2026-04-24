const https = require("https");
const http = require("http");

/**
 * Call an LLM provider with the given prompt.
 * Returns the generated text.
 *
 * Supported providers:
 *   claude   - Anthropic API (paid)
 *   openai   - OpenAI API (paid)
 *   github   - GitHub Models API (free with GitHub account)
 *   gemini   - Google Gemini API (free tier available)
 *   ollama   - Local Ollama instance (free, runs on your machine)
 */
async function callLLM(config, systemPrompt, userPrompt) {
  switch (config.provider) {
    case "claude":
      return callClaude(config, systemPrompt, userPrompt);
    case "openai":
      return callOpenAI(config, systemPrompt, userPrompt);
    case "github":
      return callGitHub(config, systemPrompt, userPrompt);
    case "gemini":
      return callGemini(config, systemPrompt, userPrompt);
    case "ollama":
      return callOllama(config, systemPrompt, userPrompt);
    default:
      throw new Error(
        `Unknown provider: ${config.provider}. Supported: claude, openai, github, gemini, ollama`
      );
  }
}

/**
 * Anthropic Claude API
 */
async function callClaude(config, systemPrompt, userPrompt) {
  if (!config.apiKey) {
    throw new Error(
      "Anthropic API key not found. Set ANTHROPIC_API_KEY env variable or add apiKey to .contextifyrc"
    );
  }

  const body = JSON.stringify({
    model: config.model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const data = await httpRequest(
    {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
    },
    body
  );

  const parsed = JSON.parse(data);
  if (parsed.error) {
    throw new Error(`Claude API error: ${parsed.error.message}`);
  }

  return parsed.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

/**
 * OpenAI API
 */
async function callOpenAI(config, systemPrompt, userPrompt) {
  if (!config.apiKey) {
    throw new Error(
      "OpenAI API key not found. Set OPENAI_API_KEY env variable or add apiKey to .contextifyrc"
    );
  }

  const body = JSON.stringify({
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 4096,
  });

  const data = await httpRequest(
    {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
    },
    body
  );

  const parsed = JSON.parse(data);
  if (parsed.error) {
    throw new Error(`OpenAI API error: ${parsed.error.message}`);
  }

  return parsed.choices[0].message.content;
}

/**
 * GitHub Models API (free with GitHub account)
 *
 * Uses the OpenAI-compatible endpoint at models.inference.ai.github.com
 * Requires a GitHub personal access token (PAT) with no special scopes.
 *
 * Generate token: https://github.com/settings/tokens
 * Set: GITHUB_TOKEN=ghp_your_token
 *
 * Available models: gpt-4o, gpt-4o-mini, Meta-Llama-3.1-405B-Instruct,
 *                   Mistral-Large-2, and more.
 * Full list: https://github.com/marketplace/models
 */
async function callGitHub(config, systemPrompt, userPrompt) {
  const apiKey = config.apiKey || process.env.GITHUB_TOKEN;
  if (!apiKey) {
    throw new Error(
      "GitHub token not found. Set GITHUB_TOKEN env variable or add apiKey to .contextifyrc.\n" +
        "Generate a free token at: https://github.com/settings/tokens (no special scopes needed)"
    );
  }

  const model = config.model || "gpt-4o-mini";

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 4096,
  });

  const data = await httpRequest(
    {
      hostname: "models.inference.ai.github.com",
      path: "/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    },
    body
  );

  const parsed = JSON.parse(data);
  if (parsed.error) {
    throw new Error(`GitHub Models API error: ${parsed.error.message}`);
  }

  return parsed.choices[0].message.content;
}

/**
 * Google Gemini API (free tier: 15 RPM, 1M TPM, 1500 RPD)
 *
 * Requires a Gemini API key.
 * Get one free: https://aistudio.google.com/apikey
 * Set: GEMINI_API_KEY=your_key
 *
 * Available models: gemini-2.0-flash, gemini-1.5-flash, gemini-1.5-pro
 */
async function callGemini(config, systemPrompt, userPrompt) {
  const apiKey = config.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Gemini API key not found. Set GEMINI_API_KEY env variable or add apiKey to .contextifyrc.\n" +
        "Get a free key at: https://aistudio.google.com/apikey"
    );
  }

  const model = config.model || "gemini-2.0-flash";

  const body = JSON.stringify({
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      maxOutputTokens: 4096,
    },
  });

  const data = await httpRequest(
    {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    },
    body
  );

  const parsed = JSON.parse(data);

  if (parsed.error) {
    throw new Error(`Gemini API error: ${parsed.error.message}`);
  }

  const candidates = parsed.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("Gemini returned no candidates");
  }

  return candidates[0].content.parts
    .filter((p) => p.text)
    .map((p) => p.text)
    .join("\n");
}

/**
 * Ollama local API (free, runs locally)
 */
async function callOllama(config, systemPrompt, userPrompt) {
  const url = new URL(config.ollama?.host || "http://localhost:11434");

  const body = JSON.stringify({
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    stream: false,
  });

  const isHTTPS = url.protocol === "https:";
  const transport = isHTTPS ? https : http;

  const data = await new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHTTPS ? 443 : 11434),
        path: "/api/chat",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (d) => (chunks += d));
        res.on("end", () => resolve(chunks));
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });

  const parsed = JSON.parse(data);
  return parsed.message?.content || "";
}

/**
 * Generic HTTPS request helper.
 */
function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let chunks = "";
      res.on("data", (d) => (chunks += d));
      res.on("end", () => resolve(chunks));
    });

    req.on("error", reject);
    req.setTimeout(60000, () => {
      req.destroy(new Error("LLM request timed out after 60s"));
    });
    req.write(body);
    req.end();
  });
}

module.exports = { callLLM };
