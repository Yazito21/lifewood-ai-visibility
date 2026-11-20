import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { promoteCompletedTrackingCandidate } from "./candidate-promotion.ts";

Deno.test("incomplete candidate never invokes the publication RPC", async () => {
  let calls = 0;
  const admin = {
    async rpc() {
      calls += 1;
      return { data: { status: "published" }, error: null };
    },
  };

  const result = await promoteCompletedTrackingCandidate(admin, "run-1", "user-1", "partial");

  assertEquals(result, {
    published: false,
    skipped: true,
    reason: "candidate_not_complete",
  });
  assertEquals(calls, 0);
});

Deno.test("completed candidate is published only when the RPC confirms publication", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: { status: "published" }, error: null };
    },
  };

  const result = await promoteCompletedTrackingCandidate(admin, "run-1", "user-1", "completed");

  assertEquals(result, { published: true, promotion: { status: "published" } });
  assertEquals(calls, [{
    name: "promote_tracking_run_candidate",
    args: { p_run_id: "run-1", p_actor_id: "user-1" },
  }]);
});

Deno.test("RPC error leaves the completed candidate unpublished", async () => {
  const admin = {
    async rpc() {
      return { data: null, error: { message: "simulated transaction failure" } };
    },
  };

  const result = await promoteCompletedTrackingCandidate(admin, "run-1", "user-1", "completed");

  assertEquals(result, {
    published: false,
    skipped: false,
    reason: "promotion_not_confirmed",
    message: "simulated transaction failure",
  });
});

Deno.test("unexpected RPC response fails closed", async () => {
  const admin = {
    async rpc() {
      return { data: { status: "already_exists" }, error: null };
    },
  };

  const result = await promoteCompletedTrackingCandidate(admin, "run-1", "user-1", "completed");

  assertEquals(result, {
    published: false,
    skipped: false,
    reason: "promotion_not_confirmed",
    message: "The promotion RPC did not confirm publication.",
  });
});
