import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stageTrackingCandidateRows } from "./candidate-staging.ts";

Deno.test("candidate staging chunks rows and preserves the exact run/table scope", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, ...args });
      return { error: null };
    },
  };

  await stageTrackingCandidateRows(
    admin,
    "run-123",
    "third_party_mentions",
    Array.from({ length: 5 }, (_, i) => ({ id: "row-" + i })),
    2,
  );

  assertEquals(calls.length, 3);
  assertEquals(calls.map((call) => (call.p_rows as unknown[]).length), [2, 2, 1]);
  assertEquals(calls.every((call) => call.name === "stage_tracking_candidate_rows"), true);
  assertEquals(calls.every((call) => call.p_run_id === "run-123"), true);
  assertEquals(calls.every((call) => call.p_table_key === "third_party_mentions"), true);
});

Deno.test("candidate staging keys distinguish source types and citation indices", async () => {
  let staged: Array<Record<string, unknown>> = [];
  const admin = {
    async rpc(_name: string, args: Record<string, unknown>) {
      staged = args.p_rows as Array<Record<string, unknown>>;
      return { error: null };
    },
  };

  await stageTrackingCandidateRows(admin, "run-123", "third_party_mentions", [
    { response_id: "r1", url: "https://example.com", source_type: "citation" },
    { response_id: "r1", url: "https://example.com", source_type: "research" },
  ]);
  assertEquals(staged[0]._candidate_key === staged[1]._candidate_key, false);

  await stageTrackingCandidateRows(admin, "run-123", "citation_occurrences", [
    { response_id: "r1", canonical_url: "https://example.com", citation_index: 0 },
    { response_id: "r1", canonical_url: "https://example.com", citation_index: 1 },
  ]);
  assertEquals(staged[0]._candidate_key === staged[1]._candidate_key, false);
});

Deno.test("candidate staging fails closed and reports the target table", async () => {
  const admin = {
    async rpc() {
      return { error: { message: "simulated database outage" } };
    },
  };

  await assertRejects(
    () => stageTrackingCandidateRows(admin, "run-123", "citations", [{ url: "https://example.com" }]),
    Error,
    "CANDIDATE_STAGING_FAILED (citations): simulated database outage",
  );
});

Deno.test("candidate staging is a no-op without a run or rows", async () => {
  let calls = 0;
  const admin = {
    async rpc() {
      calls += 1;
      return { error: null };
    },
  };
  await stageTrackingCandidateRows(admin, null, "citations", [{ url: "https://example.com" }]);
  await stageTrackingCandidateRows(admin, "run-123", "citations", []);
  assertEquals(calls, 0);
});
