import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { callOpenRouter } from "./openrouter.ts";

const messages = [{ role: "user" as const, content: "hi" }];
const ok = () => new Response(JSON.stringify({
  model: "google/gemini-2.5-flash-lite",
  choices: [{ message: { content: '{"prompts":[]}' } }],
  usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.00001 },
}), { status: 200 });

Deno.test("returns text, model and usage", async () => {
  const result = await callOpenRouter(messages, 100, { apiKey: "k", model: "m", fetch: () => Promise.resolve(ok()) });
  assertEquals(result, { text: '{"prompts":[]}', model: "google/gemini-2.5-flash-lite", promptTokens: 12, completionTokens: 5, cost: 0.00001 });
});

Deno.test("missing key is AI_NOT_CONFIGURED", async () => {
  await assertRejects(() => callOpenRouter(messages, 100, { apiKey: "", model: "m" }), Error, "AI_NOT_CONFIGURED");
});

Deno.test("402 is AI_CREDIT_EXHAUSTED without retry", async () => {
  let calls = 0;
  const fetch = () => { calls++; return Promise.resolve(new Response("{}", { status: 402 })); };
  await assertRejects(() => callOpenRouter(messages, 100, { apiKey: "k", model: "m", fetch }), Error, "AI_CREDIT_EXHAUSTED");
  assertEquals(calls, 1);
});

Deno.test("retries once after a 500", async () => {
  let calls = 0;
  const fetch = () => { calls++; return Promise.resolve(calls === 1 ? new Response("{}", { status: 500 }) : ok()); };
  const result = await callOpenRouter(messages, 100, { apiKey: "k", model: "m", fetch });
  assertEquals(calls, 2);
  assertEquals(result.promptTokens, 12);
});

Deno.test("two failures are AI_UNAVAILABLE", async () => {
  const fetch = () => Promise.resolve(new Response("{}", { status: 503 }));
  await assertRejects(() => callOpenRouter(messages, 100, { apiKey: "k", model: "m", fetch }), Error, "AI_UNAVAILABLE");
});
