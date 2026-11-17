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


function createScriptedQueryClient(
  fixtures: Record<string, unknown>,
  events: Array<{ table: string; operation: string; payload?: unknown }>,
) {
  return {
    from(table: string) {
      let operation = "select";
      let payload: unknown;
      const result = () => ({ data: fixtures[table] ?? null, error: null });
      const builder: Record<string, unknown> = {
        select() { operation = "select"; return builder; },
        eq() { return builder; },
        in() { return builder; },
        order() { return builder; },
        insert(value: unknown) { operation = "insert"; payload = value; events.push({ table, operation, payload }); return builder; },
        upsert(value: unknown) { operation = "upsert"; payload = value; events.push({ table, operation, payload }); return builder; },
        update(value: unknown) { operation = "update"; payload = value; events.push({ table, operation, payload }); return builder; },
        delete() { operation = "delete"; events.push({ table, operation }); return builder; },
        maybeSingle() { return Promise.resolve(result()); },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc() {
      throw new Error("RPC must not be called before brand configuration validation");
    },
  };
}

Deno.test("persistent tracking rejects a missing tracked-brand registry row before creating a run", async () => {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  };
  const events: Array<{ table: string; operation: string; payload?: unknown }> = [];
  let providerRequests = 0;
  const fixtures: Record<string, unknown> = {
    profiles: { role: "admin" },
    project_members: { role: "admin" },
    projects: {
      id: "lifewood-project",
      brand_name: "Lifewood",
      categories: ["General"],
      tracking_market: "MY",
      tracking_locations: ["MY"],
    },
    prompts: [{
      id: "prompt-1",
      prompt_number: 1,
      prompt: "Which providers offer multilingual AI data services?",
      category: "General",
      language: "English",
      active: true,
    }],
    category_brand_assignments: [{
      project_id: "lifewood-project",
      category: "General",
      brand_id: "tracked-brand-1",
      role: "tracked_brand",
      aliases: ["Lifewood"],
      websites: ["lifewood.ai"],
      include_in_metrics: true,
    }],
    // Deliberately missing the corresponding brand_registry row.
    brand_registry: [],
  };
  const handler = createVisibilityTrackingHandler({
    getEnv: (name) => values[name],
    fetcher: async (input) => {
      if (String(input).endsWith("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "admin-1" }), { status: 200 });
      }
      providerRequests += 1;
      return new Response("provider must not be called", { status: 500 });
    },
    createAdminClient: (() => createScriptedQueryClient(fixtures, events)) as never,
  });

  const response = await handler(new Request("https://edge.test/visibility-tracking", {
    method: "POST",
    headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: "lifewood-project",
      category: "General",
      prompt_ids: ["prompt-1"],
    }),
  }));

  assertEquals(response.status, 409);
  assertEquals((await response.json()).error, "TRACKED_BRAND_REGISTRY_INCOMPLETE");
  assertEquals(events.some((event) => event.table === "tracking_runs" && event.operation !== "select"), false);
  assertEquals(providerRequests, 0);
});


function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function encryptStoredSecret(secret: string, aad: string, plaintext: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return toBase64(iv) + "." + toBase64(new Uint8Array(ciphertext));
}

function createLifecycleQueryClient(
  fixtures: Record<string, unknown>,
  events: Array<{ kind: string; table?: string; operation?: string; payload?: unknown; name?: string; args?: Record<string, unknown> }>,
  promotionResult: { data: unknown; error: unknown } = { data: { status: "published" }, error: null },
) {
  return {
    from(table: string) {
      let operation = "select";
      let payload: unknown;
      const result = () => ({ data: fixtures[table] ?? null, error: null });
      const builder: Record<string, unknown> = {
        select() { operation = "select"; return builder; },
        eq() { return builder; },
        neq() { return builder; },
        in() { return builder; },
        order() { return builder; },
        range() { return builder; },
        insert(value: unknown) {
          operation = "insert";
          payload = value;
          events.push({ kind: "table", table, operation, payload });
          if (table === "ai_responses") {
            const rows = Array.isArray(value) ? value : [value];
            fixtures.ai_responses = [
              ...(Array.isArray(fixtures.ai_responses) ? fixtures.ai_responses : []),
              ...rows.map((row, index) => ({ ...(row as Record<string, unknown>), id: "response-" + (index + 1) })),
            ];
          }
          return builder;
        },
        upsert(value: unknown) {
          operation = "upsert";
          payload = value;
          events.push({ kind: "table", table, operation, payload });
          return builder;
        },
        update(value: unknown) {
          operation = "update";
          payload = value;
          events.push({ kind: "table", table, operation, payload });
          return builder;
        },
        delete() {
          operation = "delete";
          events.push({ kind: "table", table, operation });
          return builder;
        },
        maybeSingle() { return Promise.resolve(result()); },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      events.push({ kind: "rpc", name, args });
      if (name === "claim_daily_tracking_run") {
        return { data: { claimed: true }, error: null };
      }
      if (name === "stage_tracking_candidate_rows") {
        return { data: null, error: null };
      }
      if (name === "promote_tracking_run_candidate") {
        return promotionResult;
      }
      return { data: null, error: null };
    },
  };
}

Deno.test("provider failure finalizes an unpublished candidate and never calls promotion", async () => {
  const serviceSecret = "test-service-role-secret";
  const ciphertext = await encryptStoredSecret(serviceSecret, "lifewood-project:chatgpt", "test-openai-key");
  const values: Record<string, string> = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: serviceSecret,
  };
  const events: Array<{ kind: string; table?: string; operation?: string; payload?: unknown; name?: string; args?: Record<string, unknown> }> = [];
  let providerRequests = 0;
  const trackedBrand = {
    id: "brand-lifewood",
    canonical_name: "Lifewood",
    normalized_key: "lifewood",
    aliases: ["Lifewood"],
    primary_website: "https://lifewood.ai",
    additional_websites: [],
    is_tracked_brand: true,
    is_active: true,
  };
  const competitor = {
    id: "brand-competitor",
    canonical_name: "Example Data",
    normalized_key: "exampledata",
    aliases: ["Example Data"],
    primary_website: "https://exampledata.test",
    additional_websites: [],
    is_tracked_brand: false,
    is_active: true,
  };
  const fixtures: Record<string, unknown> = {
    profiles: { role: "admin" },
    project_members: { role: "admin" },
    projects: {
      id: "lifewood-project",
      brand_name: "Lifewood",
      brand_domains: ["lifewood.ai"],
      brand_terms: ["Lifewood"],
      categories: ["General"],
      tracking_market: "MY",
      tracking_locations: ["MY"],
    },
    prompts: [{
      id: "prompt-1",
      prompt_number: 1,
      prompt: "Which companies provide multilingual AI data services?",
      category: "General",
      language: "English",
      active: true,
    }],
    category_brand_assignments: [
      { project_id: "lifewood-project", category: "General", brand_id: trackedBrand.id, role: "tracked_brand", aliases: ["Lifewood"], websites: ["lifewood.ai"], include_in_metrics: true },
      { project_id: "lifewood-project", category: "General", brand_id: competitor.id, role: "competitor", aliases: ["Example Data"], websites: ["exampledata.test"], include_in_metrics: true },
    ],
    brand_registry: [trackedBrand, competitor],
    llm_secrets: { ciphertext },
    tracking_run_stages: null,
    ai_responses: [],
  };
  const handler = createVisibilityTrackingHandler({
    getEnv: (name) => values[name],
    fetcher: async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "admin-1" }), { status: 200 });
      }
      if (url === "https://api.openai.com/v1/responses") {
        providerRequests += 1;
        return new Response(JSON.stringify({
          error: { message: "Incorrect API key provided" },
        }), { status: 401 });
      }
      throw new Error("Unexpected external request: " + url);
    },
    createAdminClient: (() => createLifecycleQueryClient(fixtures, events)) as never,
  });

  const response = await handler(new Request("https://edge.test/visibility-tracking", {
    method: "POST",
    headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: "lifewood-project",
      category: "General",
      prompt_ids: ["prompt-1"],
    }),
  }));
  const payload = await response.json();

  assertEquals(response.status, 200);
  assertEquals(payload.status, "failed");
  assertEquals(payload.published, undefined);
  assertEquals(providerRequests, 1);
  assertEquals(events.some((event) => event.kind === "rpc" && event.name === "promote_tracking_run_candidate"), false);
  assertEquals(events.some((event) => event.kind === "table" && event.table === "ai_responses" && event.operation === "insert"), true);
  assertEquals(events.some((event) => event.kind === "table" && event.table === "tracking_runs" && event.operation === "update" &&
    (event.payload as Record<string, unknown>)?.status === "failed"), true);
  assertEquals(events.some((event) => event.kind === "table" && event.operation === "delete"), false);
  assertEquals(events.some((event) => event.kind === "rpc" && event.name === "stage_tracking_candidate_rows" &&
    event.args?.p_table_key === "visibility_daily"), true);
});


async function runSuccessfulLifecycle(
  promotionResult: { data: unknown; error: unknown } = { data: { status: "published" }, error: null },
) {
  const serviceSecret = "test-service-role-secret";
  const ciphertext = await encryptStoredSecret(serviceSecret, "lifewood-project:chatgpt", "test-openai-key");
  const values: Record<string, string> = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: serviceSecret,
  };
  const events: Array<{ kind: string; table?: string; operation?: string; payload?: unknown; name?: string; args?: Record<string, unknown> }> = [];
  let providerRequests = 0;
  let extractionRequests = 0;
  const trackedBrand = {
    id: "brand-lifewood",
    canonical_name: "Lifewood",
    normalized_key: "lifewood",
    aliases: ["Lifewood"],
    primary_website: "https://lifewood.ai",
    additional_websites: [],
    is_tracked_brand: true,
    is_active: true,
  };
  const competitor = {
    id: "brand-competitor",
    canonical_name: "Example Data",
    normalized_key: "exampledata",
    aliases: ["Example Data"],
    primary_website: "https://exampledata.test",
    additional_websites: [],
    is_tracked_brand: false,
    is_active: true,
  };
  const fixtures: Record<string, unknown> = {
    profiles: { role: "admin" },
    project_members: { role: "admin" },
    projects: {
      id: "lifewood-project",
      brand_name: "Lifewood",
      brand_domains: ["lifewood.ai"],
      brand_terms: ["Lifewood"],
      categories: ["General"],
      tracking_market: "MY",
      tracking_locations: ["MY"],
    },
    prompts: [{
      id: "prompt-1",
      prompt_number: 1,
      prompt: "Which companies provide multilingual AI data services?",
      category: "General",
      language: "English",
      active: true,
    }],
    category_brand_assignments: [
      { project_id: "lifewood-project", category: "General", brand_id: trackedBrand.id, role: "tracked_brand", aliases: ["Lifewood"], websites: ["lifewood.ai"], include_in_metrics: true },
      { project_id: "lifewood-project", category: "General", brand_id: competitor.id, role: "competitor", aliases: ["Example Data"], websites: ["exampledata.test"], include_in_metrics: true },
    ],
    brand_registry: [trackedBrand, competitor],
    llm_secrets: { ciphertext },
    tracking_run_stages: null,
    ai_responses: [],
  };
  const handler = createVisibilityTrackingHandler({
    getEnv: (name) => values[name],
    fetcher: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "admin-1" }), { status: 200 });
      }
      if (url === "https://api.openai.com/v1/responses") {
        const requestBody = JSON.parse(String(init?.body ?? "{}"));
        const inputText = JSON.stringify(requestBody.input ?? []);
        if (inputText.includes("Extract explicitly mentioned real-world organizations")) {
          extractionRequests += 1;
          return new Response(JSON.stringify({
            model: "gpt-4o-mini",
            output: [{
              type: "message",
              content: [{
                type: "output_text",
                text: JSON.stringify([{
                  response_id: "prompt-1|MY",
                  entities: [{
                    name: "Lifewood",
                    aliases: ["Lifewood"],
                    entity_type: "company",
                    evidence: "Lifewood provides multilingual AI data services.",
                  }],
                }]),
              }],
            }],
          }), { status: 200 });
        }
        providerRequests += 1;
        return new Response(JSON.stringify({
          id: "provider-response-1",
          status: "completed",
          model: "gpt-4o-mini",
          output: [
            {
              type: "message",
              content: [{
                type: "output_text",
                text: "Lifewood provides multilingual AI data services. Example Data is another provider.",
                annotations: [{
                  type: "url_citation",
                  url: "https://lifewood.ai/services",
                  title: "Lifewood Services",
                }],
              }],
            },
            {
              type: "web_search_call",
              action: { sources: [{ url: "https://lifewood.ai/services", title: "Lifewood Services" }] },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 20 },
        }), { status: 200 });
      }
      throw new Error("Unexpected external request: " + url);
    },
    createAdminClient: (() => createLifecycleQueryClient(fixtures, events, promotionResult)) as never,
  });

  const response = await handler(new Request("https://edge.test/visibility-tracking", {
    method: "POST",
    headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: "lifewood-project",
      category: "General",
      prompt_ids: ["prompt-1"],
    }),
  }));

  return {
    response,
    payload: await response.json(),
    events,
    providerRequests,
    extractionRequests,
    fixtures,
  };
}

Deno.test("successful provider response stages all candidate data before confirmed promotion", async () => {
  const result = await runSuccessfulLifecycle();

  assertEquals(result.response.status, 200);
  assertEquals(result.payload.status, "completed");
  assertEquals(result.payload.published, true);
  assertEquals(result.providerRequests, 1);
  assertEquals(result.extractionRequests, 1);
  assertEquals((result.fixtures.ai_responses as Array<Record<string, unknown>>).length, 1);
  assertEquals(result.events.some((event) => event.kind === "rpc" && event.name === "promote_tracking_run_candidate"), true);

  const stagedTables = new Set(result.events
    .filter((event) => event.kind === "rpc" && event.name === "stage_tracking_candidate_rows")
    .map((event) => String(event.args?.p_table_key)));
  for (const table of [
    "citations",
    "citation_occurrences",
    "response_brand_evidence",
    "third_party_mentions",
    "category_brand_observations",
    "visibility_daily",
  ]) {
    assertEquals(stagedTables.has(table), true, "expected staged candidate table: " + table);
  }

  const promotionIndex = result.events.findIndex((event) => event.kind === "rpc" && event.name === "promote_tracking_run_candidate");
  const completionIndex = result.events.findIndex((event) => event.kind === "table" && event.table === "tracking_runs" &&
    event.operation === "update" && (event.payload as Record<string, unknown>)?.status === "completed");
  assertEquals(completionIndex >= 0 && promotionIndex > completionIndex, true);
  assertEquals(result.events.some((event) => event.kind === "table" && event.operation === "delete"), false);
});

Deno.test("promotion RPC error leaves a completed candidate unpublished", async () => {
  const result = await runSuccessfulLifecycle({
    data: null,
    error: { message: "simulated promotion failure" },
  });

  assertEquals(result.response.status, 500);
  assertEquals(result.payload.error, "CANDIDATE_PROMOTION_FAILED");
  assertEquals(result.payload.status, "completed_unpublished");
  assertEquals(result.events.some((event) => event.kind === "rpc" && event.name === "promote_tracking_run_candidate"), true);
  assertEquals(result.events.some((event) => event.kind === "table" && event.operation === "delete"), false);
  assertEquals(result.events.some((event) => event.kind === "table" &&
    ["citations", "citation_occurrences", "response_brand_evidence", "third_party_mentions", "category_brand_observations", "visibility_daily"].includes(String(event.table)) &&
    event.operation === "delete"), false);
});
