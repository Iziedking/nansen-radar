import {
  CLAUDE_MODEL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENCLAW_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_GEMINI_MODEL,
} from './config.js';

export function buildProviderConfig(overrides = {}) {
  const provider = overrides.provider || process.env.LLM_PROVIDER || 'anthropic';
  // LLM_MODEL is a universal override — works for any provider
  const modelOverride = overrides.model || process.env.LLM_MODEL || null;

  switch (provider) {
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error(
        'LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY.\n' +
        '  Add it to .env or export ANTHROPIC_API_KEY=sk-ant-...\n' +
        '  Or switch to a free provider: LLM_PROVIDER=ollama'
      );
      return {
        provider: 'anthropic',
        endpoint: 'https://api.anthropic.com/v1/messages',
        model: modelOverride || CLAUDE_MODEL,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        format: 'anthropic',
      };
    }

    case 'ollama': {
      const base = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
      const model = modelOverride || process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
      return {
        provider: 'ollama',
        endpoint: `${base}/v1/chat/completions`,
        model,
        headers: { 'Content-Type': 'application/json' },
        format: 'openai',
      };
    }

    case 'openclaw': {
      const base = process.env.OPENCLAW_BASE_URL || DEFAULT_OPENCLAW_BASE_URL;
      const model = modelOverride || process.env.OPENCLAW_MODEL || CLAUDE_MODEL;
      const headers = { 'Content-Type': 'application/json' };
      if (process.env.OPENCLAW_TOKEN) headers['Authorization'] = `Bearer ${process.env.OPENCLAW_TOKEN}`;
      return {
        provider: 'openclaw',
        endpoint: `${base}/v1/chat/completions`,
        model,
        headers,
        format: 'openai',
      };
    }

    case 'openrouter': {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('LLM_PROVIDER=openrouter requires OPENROUTER_API_KEY.');
      const model = modelOverride || process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
      return {
        provider: 'openrouter',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        model,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        format: 'openai',
      };
    }

    case 'gemini': {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('LLM_PROVIDER=gemini requires GEMINI_API_KEY.');
      const model = modelOverride || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
      return {
        provider: 'gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        model,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        format: 'openai',
      };
    }

    default:
      throw new Error(
        `Unknown LLM_PROVIDER="${provider}". Valid options: anthropic, ollama, openclaw, openrouter, gemini`
      );
  }
}

export async function callLLM(systemPrompt, userMessage, providerConfig, maxTokens = 4096) {
  const { provider, endpoint, model, headers, format } = providerConfig;

  const body = format === 'anthropic'
    ? { model, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userMessage }] }
    : { model, max_tokens: maxTokens, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }] };

  // Ollama JSON mode — forces valid JSON output regardless of model
  // OpenAI-compat endpoint uses response_format, native endpoint uses format
  if (provider === 'ollama') {
    body.format = 'json';                                    // native /api/chat fallback
    body.response_format = { type: 'json_object' };         // OpenAI-compat /v1/chat/completions
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`${provider} API ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();

  if (format === 'anthropic') {
    return data.content.map(b => b.text || '').join('');
  }
  return data.choices?.[0]?.message?.content || '';
}
