import { config } from '../config.js';

/**
 * Minimal text-generation client for Groq and Gemini.
 *
 * Deliberately plain `fetch` rather than a provider SDK: both APIs are a single
 * POST, the project already calls API-Football this way, and it keeps two large
 * dependencies (and their transitive trees) out of a service whose job is to
 * poll football scores. Swapping providers is an env var, not a code change.
 */

export type LlmProvider = 'groq' | 'gemini' | 'none';

const DEFAULT_MODELS: Record<Exclude<LlmProvider, 'none'>, string> = {
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.0-flash',
};

export function activeProvider(): LlmProvider {
  const provider = config.llmProvider;
  if (provider === 'groq') return config.groqApiKey ? 'groq' : 'none';
  if (provider === 'gemini') return config.geminiApiKey ? 'gemini' : 'none';
  return 'none';
}

function modelFor(provider: Exclude<LlmProvider, 'none'>): string {
  return config.llmModel || DEFAULT_MODELS[provider];
}

async function callGroq(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelFor('groq'),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(config.llmTimeoutMs),
  });

  if (!res.ok) {
    throw new Error(`Groq request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Groq returned no content');
  return text;
}

async function callGemini(system: string, user: string, maxTokens: number): Promise<string> {
  const model = modelFor('gemini');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': config.geminiApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
      }),
      signal: AbortSignal.timeout(config.llmTimeoutMs),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini returned no content');
  return text;
}

/**
 * Generates text, or returns null if no provider is configured or the call
 * fails. Callers are expected to have a non-LLM fallback: a summary is a nice
 * touch on an archived match, never a reason to lose the archive row.
 */
export async function generateText(
  system: string,
  user: string,
  maxTokens = 500
): Promise<string | null> {
  const provider = activeProvider();
  if (provider === 'none') return null;

  try {
    return provider === 'groq'
      ? await callGroq(system, user, maxTokens)
      : await callGemini(system, user, maxTokens);
  } catch (err) {
    console.error(
      `LLM summary failed (${provider}):`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
