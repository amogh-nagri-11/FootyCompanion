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

/** One turn of a conversation. The system prompt is passed separately. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Groq retires hosted models on its own schedule and a decommissioned id fails
// every call with a 400, so treat these as a starting point rather than a
// fixture: `LLM_MODEL` overrides without a code change, and
// `curl -sH "Authorization: Bearer $GROQ_API_KEY" \
//   https://api.groq.com/openai/v1/models | jq -r '.data[].id'`
// lists what the key can currently reach.
const DEFAULT_MODELS: Record<Exclude<LlmProvider, 'none'>, string> = {
  // Groq namespaces this one — the bare 'gpt-oss-120b' is rejected as unknown.
  groq: 'openai/gpt-oss-120b',
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

/**
 * Seconds to wait from a 429 body, which names its own delay:
 * "Please try again in 2.13s". Falls back to a second when it does not.
 */
function retryAfterSeconds(body: string): number {
  const match = body.match(/try again in ([\d.]+)\s*s/i);
  const parsed = match ? Number(match[1]) : NaN;
  // Cap it: a provider asking for a minute should fail fast, not hold the
  // reader's request open while they wait for a spinner.
  return Number.isFinite(parsed) ? Math.min(parsed, 8) : 1;
}

const MAX_RATE_LIMIT_RETRIES = 2;

async function callGroq(
  system: string,
  turns: ChatMessage[],
  maxTokens: number,
  attempt = 0
): Promise<string> {
  const groqModel = modelFor('groq');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: groqModel,
      messages: [{ role: 'system', content: system }, ...turns],
      max_tokens: maxTokens,
      temperature: 0.7,
      // Reasoning tokens are billed against max_tokens, and at the default
      // effort gpt-oss spends most of the budget thinking — a 400-token cap
      // left ~100 for prose and truncated the report mid-sentence. Summarising
      // a supplied event log needs no deliberation, so keep it minimal. Only
      // the reasoning models accept the field; others reject it outright.
      ...(/gpt-oss/.test(groqModel) ? { reasoning_effort: 'low' } : {}),
    }),
    signal: AbortSignal.timeout(config.llmTimeoutMs),
  });

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);

    // Rate limits are a matter of waiting, not a failure. The free tier's
    // per-minute token budget is easily hit by two readers asking at once, and
    // without this the second one is told the model "did not return an answer"
    // for something that would have worked a second later.
    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const wait = retryAfterSeconds(body);
      console.warn(
        `Groq rate limited; retrying in ${wait}s (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})`
      );
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      return callGroq(system, turns, maxTokens, attempt + 1);
    }

    // A retired model is the one failure that looks identical to "no provider
    // configured" from the outside — every summary quietly reverts to the
    // template — so name it rather than leaving it in a generic 400.
    if (res.status === 400 && /decommission|does not exist|not found/i.test(body)) {
      throw new Error(
        `Groq model '${groqModel}' is unavailable (retired or misspelled). ` +
          `Set LLM_MODEL to a current id; list them with: ` +
          `curl -sH "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models`
      );
    }
    throw new Error(`Groq request failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = data.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (!text) throw new Error('Groq returned no content');
  // A summary cut off mid-sentence reads worse than the templated one, so treat
  // it as a failure and let the caller fall back rather than publishing it.
  if (choice?.finish_reason === 'length') {
    throw new Error(
      `Groq response hit the ${maxTokens}-token cap and was truncated (model '${groqModel}')`
    );
  }
  return text;
}

async function callGemini(
  system: string,
  turns: ChatMessage[],
  maxTokens: number
): Promise<string> {
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
        // Gemini names the assistant role 'model'; everything else maps across.
        contents: turns.map((t) => ({
          role: t.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: t.content }],
        })),
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
  return generateChat(system, [{ role: 'user', content: user }], maxTokens);
}

/**
 * Multi-turn variant. Returns null on the same terms as `generateText`.
 *
 * `turns` must end with a user message — every provider here expects the last
 * turn to be the one it is answering.
 */
export async function generateChat(
  system: string,
  turns: ChatMessage[],
  maxTokens = 500
): Promise<string | null> {
  const provider = activeProvider();
  if (provider === 'none') return null;
  if (turns.length === 0) return null;

  try {
    return provider === 'groq'
      ? await callGroq(system, turns, maxTokens)
      : await callGemini(system, turns, maxTokens);
  } catch (err) {
    console.error(`LLM call failed (${provider}):`, err instanceof Error ? err.message : err);
    return null;
  }
}
