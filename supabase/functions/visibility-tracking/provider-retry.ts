/**
 * Retry policy for provider (OpenAI) calls during a tracking run.
 *
 * A category run only counts as complete when every prompt succeeds, so one rejected request used to leave the whole
 * category "partial" and the batch "interrupted". Rejections such as HTTP 429 are often momentary (a top-up that has not
 * reached every OpenAI server yet, a rate limit, a 5xx), so these are retried with a short backoff.
 *
 * When the account really has no credits, nothing in the run succeeds. Once a few prompts have used up every retry on a
 * credits error with no success at all, the run stops calling the provider and reports that failure for the remaining
 * prompts straight away instead of waiting out the retries for every prompt. (If only some requests are rejected, which
 * is what a top-up still spreading looks like, successes keep the run going.)
 */

export const RETRY_DELAYS_MS = [2000, 4000, 6000, 8000];
/** No new retry starts once the run has been going this long, which keeps the whole request inside the function's time limit. */
export const RETRY_BUDGET_MS = 90_000;

/** Prompts that must exhaust their retries on a credits error, with no success in the run, before the run stops calling. */
export const CREDIT_STOP_AFTER = 3;

export type RetryState<T> = { startedAt: number; succeeded: number; creditExhausted: number; creditsAnswer: T | null };

export type RetryDeps = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

export function newRetryState<T>(now: () => number = Date.now): RetryState<T> {
  return { startedAt: now(), succeeded: 0, creditExhausted: 0, creditsAnswer: null };
}

export function isRetryableProviderError(providerError: string): boolean {
  return /^PROVIDER_HTTP_(408|409|429|500|502|503|504|529)\b/.test(providerError);
}

export function isCreditsError(message: string): boolean {
  return /no credits remaining|insufficient_quota|exceeded your current quota/i.test(message);
}

function isRetryableThrown(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false; // a 65 s timeout is too slow to repeat
  return error instanceof Error && /network|fetch failed|connection|ECONNRESET|socket/i.test(error.message);
}

export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
  return Math.round(base * (0.75 + random() * 0.5));
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callWithRetry<T extends { providerError?: string }>(
  call: () => Promise<T>,
  state: RetryState<T>,
  deps: RetryDeps = {},
): Promise<T> {
  const sleep = deps.sleep ?? sleepMs;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const outOfRetries = (attempt: number) => attempt >= RETRY_DELAYS_MS.length || now() - state.startedAt > RETRY_BUDGET_MS;

  for (let attempt = 0; ; attempt++) {
    if (state.creditsAnswer && state.succeeded === 0) return state.creditsAnswer;
    let answer: T;
    try {
      answer = await call();
    } catch (error) {
      if (!isRetryableThrown(error) || outOfRetries(attempt)) throw error;
      await sleep(retryDelayMs(attempt, random));
      continue;
    }
    if (!answer.providerError) {
      state.succeeded += 1;
      return answer;
    }
    if (!isRetryableProviderError(answer.providerError)) return answer;
    if (outOfRetries(attempt)) {
      if (isCreditsError(answer.providerError) && state.succeeded === 0) {
        state.creditExhausted += 1;
        if (state.creditExhausted >= CREDIT_STOP_AFTER) state.creditsAnswer = answer;
      }
      return answer;
    }
    await sleep(retryDelayMs(attempt, random));
  }
}

/** One short sentence for the most common provider failure of a run, appended to "N prompt(s) failed". */
export function describeProviderFailures(failed: Array<Record<string, unknown>>): string {
  const counts = new Map<string, number>();
  for (const result of failed) {
    const message = String(result.error_message ?? "").trim();
    if (message) counts.set(message, (counts.get(message) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!top) return "";
  if (isCreditsError(top)) {
    return " (OpenAI reports no credits remaining. If you just added credits, wait a few minutes for them to apply, then resume.)";
  }
  return " (" + top.slice(0, 160) + ")";
}
