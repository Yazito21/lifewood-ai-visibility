import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createVisibilityTrackingHandler } from "./index.ts";

Deno.test("paused tracking exits before auth, database client creation, or provider requests", async () => {
  let fetchCalls = 0;
  let clientCreations = 0;
  const handler = createVisibilityTrackingHandler({
    getEnv: (name) => name === "TRACKING_REPLACEMENT_PAUSED" ? " TRUE " : undefined,
    fetcher: async () => {
      fetchCalls += 1;
      return new Response("unexpected fetch");
    },
    createAdminClient: (() => {
      clientCreations += 1;
      throw new Error("database client must not be created while paused");
    }) as never,
  });

  const response = await handler(new Request("https://edge.test/visibility-tracking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: "project-1" }),
  }));

  assertEquals(response.status, 503);
  assertEquals((await response.json()).error, "TRACKING_TEMPORARILY_PAUSED");
  assertEquals(fetchCalls, 0);
  assertEquals(clientCreations, 0);
});

Deno.test("CORS preflight is answered before the emergency pause gate", async () => {
  let fetchCalls = 0;
  const handler = createVisibilityTrackingHandler({
    getEnv: () => "true",
    fetcher: async () => {
      fetchCalls += 1;
      return new Response("unexpected fetch");
    },
  });

  const response = await handler(new Request("https://edge.test/visibility-tracking", {
    method: "OPTIONS",
  }));

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
  assertEquals(fetchCalls, 0);
});

Deno.test("missing bearer token is rejected before auth fetch or database creation", async () => {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  };
  let fetchCalls = 0;
  let clientCreations = 0;
  const handler = createVisibilityTrackingHandler({
    getEnv: (name) => values[name],
    fetcher: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    },
    createAdminClient: (() => {
      clientCreations += 1;
      throw new Error("database client must not be created without a token");
    }) as never,
  });

  const response = await handler(new Request("https://edge.test/visibility-tracking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: "project-1" }),
  }));

  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "AUTHORIZATION_TOKEN_MISSING");
  assertEquals(fetchCalls, 0);
  assertEquals(clientCreations, 0);
});

Deno.test("invalid bearer token is rejected before database client creation", async () => {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  };
  const authRequests: Request[] = [];
  let clientCreations = 0;
  const handler = createVisibilityTrackingHandler({
    getEnv: (name) => values[name],
    fetcher: async (input, init) => {
      authRequests.push(new Request(input, init));
      return new Response(JSON.stringify({ message: "invalid token" }), { status: 401 });
    },
    createAdminClient: (() => {
      clientCreations += 1;
      throw new Error("database client must not be created for invalid auth");
    }) as never,
  });

  const response = await handler(new Request("https://edge.test/visibility-tracking", {
    method: "POST",
    headers: { Authorization: "Bearer invalid-token", "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: "project-1" }),
  }));

  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "AUTH_VALIDATION_FAILED");
  assertEquals(authRequests[0]?.url, "https://project.supabase.co/auth/v1/user");
  assertEquals(authRequests[0]?.headers.get("apikey"), "public-key");
  assertEquals(authRequests[0]?.headers.get("Authorization"), "Bearer invalid-token");
  assertEquals(clientCreations, 0);
});

function createAccessLookupClient(fixtures: Record<string, unknown>, queriedTables: string[]) {
  return {
    from(table: string) {
      queriedTables.push(table);
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        maybeSingle() {
          return Promise.resolve({ data: fixtures[table] ?? null, error: null });
        },
      };
      return builder;
    },
  };
}

Deno.test("authenticated non-admin member cannot start a persistent tracking run", async () => {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  };
  const queriedTables: string[] = [];
  let providerRequests = 0;
  const handler = createVisibilityTrackingHandler({
    getEnv: (name) => values[name],
    fetcher: async (input) => {
      if (String(input).endsWith("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
      }
      providerRequests += 1;
      return new Response("provider should not be called", { status: 500 });
    },
    createAdminClient: (() => createAccessLookupClient({
      profiles: { role: "user" },
      project_members: { role: "member" },
      projects: { id: "project-1", categories: ["General"] },
    }, queriedTables)) as never,
  });

  const response = await handler(new Request("https://edge.test/visibility-tracking", {
    method: "POST",
    headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: "project-1" }),
  }));

  assertEquals(response.status, 403);
  assertEquals((await response.json()).error, "NOT_AUTHORIZED_TO_RUN_TRACKING");
  assertEquals(queriedTables.sort(), ["profiles", "project_members", "projects"].sort());
  assertEquals(providerRequests, 0);
});

Deno.test("authenticated user without project membership cannot run a sample", async () => {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  };
  const queriedTables: string[] = [];
  const handler = createVisibilityTrackingHandler({
    getEnv: (name) => values[name],
    fetcher: async (input) => String(input).endsWith("/auth/v1/user")
      ? new Response(JSON.stringify({ id: "user-1" }), { status: 200 })
      : new Response("unexpected provider request", { status: 500 }),
    createAdminClient: (() => createAccessLookupClient({
      profiles: { role: "user" },
      project_members: null,
      projects: { id: "project-1", categories: ["General"] },
    }, queriedTables)) as never,
  });

  const response = await handler(new Request("https://edge.test/visibility-tracking", {
    method: "POST",
    headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: "project-1", mode: "sample", prompt_ids: ["prompt-1"] }),
  }));

  assertEquals(response.status, 403);
  assertEquals((await response.json()).error, "NOT_AUTHORIZED_FOR_PROJECT");
  assertEquals(queriedTables.sort(), ["profiles", "project_members", "projects"].sort());
});
