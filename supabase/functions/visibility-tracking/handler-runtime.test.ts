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
  let authRequest: Request | null = null;
  let clientCreations = 0;
  const handler = createVisibilityTrackingHandler({
    getEnv: (name) => values[name],
    fetcher: async (input, init) => {
      authRequest = new Request(input, init);
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
  assertEquals(authRequest?.url, "https://project.supabase.co/auth/v1/user");
  assertEquals(authRequest?.headers.get("apikey"), "public-key");
  assertEquals(authRequest?.headers.get("Authorization"), "Bearer invalid-token");
  assertEquals(clientCreations, 0);
});
