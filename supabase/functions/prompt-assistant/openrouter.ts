export type ChatMessage = { role: "system" | "user"; content: string };

export type OpenRouterResult = {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number | null;
};

type Deps = { apiKey?: string; model?: string; fetch?: typeof fetch };

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const TIMEOUT_MS = 30_000;

class RetryableError extends Error {}

async function attempt(messages: ChatMessage[], maxTokens: number, apiKey: string, model: string, doFetch: typeof fetch) {
  let response: Response;
  try {
    response = await doFetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://lifewood-ai-visibility.vercel.app",
        "X-Title": "Lifewood AI Visibility",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new RetryableError("AI_UNAVAILABLE");
  }
  if (response.status === 402) throw new Error("AI_CREDIT_EXHAUSTED");
  if (response.status === 429 || response.status >= 500) throw new RetryableError("AI_UNAVAILABLE");
  if (!response.ok) {
    console.error("OPENROUTER_REQUEST_FAILED", response.status, (await response.text()).slice(0, 300));
    throw new Error("AI_UNAVAILABLE");
  }
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new RetryableError("AI_UNAVAILABLE");
  return {
    text,
    model: String(payload?.model || model),
    promptTokens: Number(payload?.usage?.prompt_tokens) || 0,
    completionTokens: Number(payload?.usage?.completion_tokens) || 0,
    cost: typeof payload?.usage?.cost === "number" ? payload.usage.cost : null,
  };
}

/** One chat completion through OpenRouter, retried once on rate limits, server errors and timeouts. */
export async function callOpenRouter(messages: ChatMessage[], maxTokens: number, deps: Deps = {}): Promise<OpenRouterResult> {
  const apiKey = deps.apiKey ?? Deno.env.get("OPENROUTER_API_KEY") ?? "";
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");
  const model = deps.model || Deno.env.get("OPENROUTER_MODEL") || DEFAULT_MODEL;
  const doFetch = deps.fetch ?? fetch;
  try {
    return await attempt(messages, maxTokens, apiKey, model, doFetch);
  } catch (error) {
    if (!(error instanceof RetryableError)) throw error;
    try {
      return await attempt(messages, maxTokens, apiKey, model, doFetch);
    } catch (retryError) {
      throw retryError instanceof RetryableError ? new Error("AI_UNAVAILABLE") : retryError;
    }
  }
}
