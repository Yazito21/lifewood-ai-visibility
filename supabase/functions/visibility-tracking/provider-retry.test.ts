import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { callWithRetry, CREDIT_STOP_AFTER, describeProviderFailures, newRetryState, RETRY_BUDGET_MS } from "./provider-retry.ts";

type Answer = { providerError?: string; text?: string };
const credits: Answer = { providerError: "PROVIDER_HTTP_429: You have no credits remaining. Add credits to continue." };
const ok: Answer = { text: "answer" };
const noSleep = { sleep: () => Promise.resolve(), random: () => 0.5 };

function scripted(...answers: Array<Answer | Error>) {
  let calls = 0;
  return {
    call: () => {
      const next = answers[Math.min(calls, answers.length - 1)];
      calls += 1;
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    calls: () => calls,
  };
}

Deno.test("a momentary 429 is retried until the call works", async () => {
  const s = scripted(credits, credits, ok);
  const state = newRetryState<Answer>();
  assertEquals(await callWithRetry(s.call, state, noSleep), ok);
  assertEquals(s.calls(), 3);
  assertEquals(state.succeeded, 1);
});

Deno.test("an error that is not retryable is returned at once", async () => {
  const bad: Answer = { providerError: "PROVIDER_HTTP_401: Incorrect API key" };
  const s = scripted(bad);
  assertEquals(await callWithRetry(s.call, newRetryState<Answer>(), noSleep), bad);
  assertEquals(s.calls(), 1);
});

Deno.test("gives up after the retries are used", async () => {
  const gate = scripted({ providerError: "PROVIDER_HTTP_503: unavailable" });
  const state = newRetryState<Answer>();
  state.succeeded = 1; // something already worked, so the credits shortcut does not apply
  const result = await callWithRetry(gate.call, state, noSleep);
  assertEquals(result.providerError, "PROVIDER_HTTP_503: unavailable");
  assertEquals(gate.calls(), 5);
});

Deno.test("with no credits and no success, the run stops calling the provider", async () => {
  const state = newRetryState<Answer>();
  for (let prompt = 0; prompt < CREDIT_STOP_AFTER; prompt++) {
    const s = scripted(credits);
    assertEquals(await callWithRetry(s.call, state, noSleep), credits);
    assertEquals(s.calls(), 5); // every retry was used before giving up
  }
  const later = scripted(ok);
  assertEquals(await callWithRetry(later.call, state, noSleep), credits);
  assertEquals(later.calls(), 0);
});

Deno.test("a flaky account does not stop the run: successes keep it going", async () => {
  const state = newRetryState<Answer>();
  for (let prompt = 0; prompt < CREDIT_STOP_AFTER; prompt++) {
    await callWithRetry(scripted(credits).call, state, noSleep);
  }
  state.succeeded = 0;
  state.creditsAnswer = null; // as if a request had worked before the third prompt gave up
  state.creditExhausted = 0;
  const s = scripted(credits, ok);
  assertEquals(await callWithRetry(s.call, state, noSleep), ok);
});

Deno.test("after a success, credit errors keep being retried", async () => {
  const state = newRetryState<Answer>();
  state.succeeded = 3;
  const s = scripted(credits, credits, credits, ok);
  assertEquals(await callWithRetry(s.call, state, noSleep), ok);
  assertEquals(s.calls(), 4);
});

Deno.test("no retry starts once the time budget is spent", async () => {
  const state = newRetryState<Answer>(() => 0);
  state.succeeded = 1;
  const s = scripted({ providerError: "PROVIDER_HTTP_500: boom" });
  const result = await callWithRetry(s.call, state, { ...noSleep, now: () => RETRY_BUDGET_MS + 1 });
  assertEquals(result.providerError, "PROVIDER_HTTP_500: boom");
  assertEquals(s.calls(), 1);
});

Deno.test("network errors are retried, timeouts are not", async () => {
  const flaky = scripted(new Error("fetch failed"), ok);
  assertEquals(await callWithRetry(flaky.call, newRetryState<Answer>(), noSleep), ok);
  assertEquals(flaky.calls(), 2);

  const timeout = scripted(new DOMException("aborted", "AbortError"));
  let thrown = false;
  try {
    await callWithRetry(timeout.call, newRetryState<Answer>(), noSleep);
  } catch {
    thrown = true;
  }
  assertEquals(thrown, true);
  assertEquals(timeout.calls(), 1);
});

Deno.test("failure summary names the most common cause", () => {
  assertEquals(describeProviderFailures([]), "");
  assertEquals(
    describeProviderFailures([{ error_message: "PROVIDER_HTTP_429: You have no credits remaining." }, { error_message: "PROVIDER_HTTP_500: x" }, { error_message: "PROVIDER_HTTP_429: You have no credits remaining." }]).includes("no credits remaining"),
    true,
  );
  assertEquals(describeProviderFailures([{ error_message: "PROVIDER_HTTP_500: boom" }]), " (PROVIDER_HTTP_500: boom)");
});
