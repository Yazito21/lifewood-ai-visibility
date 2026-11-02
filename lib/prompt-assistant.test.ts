import test from "node:test";
import { strictEqual } from "node:assert/strict";
import { assistantErrorMessage, notShown, remainingSlots, PROMPT_LIMIT } from "./prompt-assistant.ts";

test("remaining slots count down from the 50-prompt limit", () => {
  strictEqual(PROMPT_LIMIT, 50);
  strictEqual(remainingSlots(0), 50);
  strictEqual(remainingSlots(48), 2);
});

test("remaining slots never go below zero", () => {
  strictEqual(remainingSlots(50), 0);
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

test("expired sessions ask the user to sign in again", () => {
  strictEqual(assistantErrorMessage("AUTH_VALIDATION_FAILED", undefined, 401), "Your session has expired. Sign in again.");
});

test("permission errors say so instead of asking for a retry", () => {
  strictEqual(assistantErrorMessage("Not authorized.", undefined, 403), "You don't have permission to use the AI assistant on this project.");
});

test("the server's message is shown when there is one", () => {
  strictEqual(assistantErrorMessage("INVALID_REQUEST", "Choose one of the project's topics.", 400), "Choose one of the project's topics.");
});

test("notShown drops prompts already in the panel, ignoring case and punctuation", () => {
  const result = notShown(["Best data vendors?", "Top annotation firms", "top annotation firms!"], ["best data vendors"]);
  strictEqual(JSON.stringify(result), JSON.stringify(["Top annotation firms"]));
});
