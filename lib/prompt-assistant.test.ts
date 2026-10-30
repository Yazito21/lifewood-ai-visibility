import test from "node:test";
import { strictEqual } from "node:assert/strict";
import { assistantErrorMessage, remainingSlots, PROMPT_LIMIT } from "./prompt-assistant.ts";

test("remaining slots count down from the 100-prompt limit", () => {
  strictEqual(PROMPT_LIMIT, 100);
  strictEqual(remainingSlots(0), 100);
  strictEqual(remainingSlots(98), 2);
});

test("remaining slots never go below zero", () => {
  strictEqual(remainingSlots(100), 0);
  strictEqual(remainingSlots(120), 0);
});

test("credit exhaustion has a plain-language message", () => {
  strictEqual(assistantErrorMessage("AI_CREDIT_EXHAUSTED"), "AI credit has run out. Top up OpenRouter or ask an admin.");
});

test("missing configuration has a plain-language message", () => {
  strictEqual(assistantErrorMessage("AI_NOT_CONFIGURED"), "The AI assistant isn't set up yet. An admin needs to add the OpenRouter key.");
});

test("unknown errors fall back to a retry message", () => {
  strictEqual(assistantErrorMessage("SOMETHING_ELSE"), "The AI didn't respond. Try again.");
  strictEqual(assistantErrorMessage(undefined), "The AI didn't respond. Try again.");
});
