

ALTER VIEW "public"."response_brand_evidence_scoped" OWNER TO "postgres";


COMMENT ON VIEW "public"."response_brand_evidence_scoped" IS 'Normalized entity evidence joined to immutable raw AI responses. Scope and run provenance derive from ai_responses; source rows are preserved.';



CREATE TABLE IF NOT EXISTS "public"."third_party_mentions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "response_id" "uuid",
    "metric_date" "date" NOT NULL,
    "category" "text" NOT NULL,
    "llm_provider" "text" NOT NULL,
    "tracking_location" "text" DEFAULT 'LEGACY'::"text" NOT NULL,
    "url" "text" NOT NULL,
    "canonical_url" "text" NOT NULL,
    "hostname" "text" NOT NULL,
    "website_name" "text",
    "source_type" "text" NOT NULL,
    "associated_brand_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "associated_brand_names" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "association_status" "text" DEFAULT 'unverified'::"text" NOT NULL,
    "frequency" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "third_party_mentions_association_status_check" CHECK (("association_status" = ANY (ARRAY['verified'::"text", 'inferred'::"text", 'unverified'::"text"]))),
    CONSTRAINT "third_party_mentions_frequency_check" CHECK (("frequency" >= 1)),
    CONSTRAINT "third_party_mentions_source_type_check" CHECK (("source_type" = ANY (ARRAY['citation_annotation'::"text", 'research_source'::"text", 'mentioned_url'::"text"])))
);


ALTER TABLE "public"."third_party_mentions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tracking_batch_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "ordinal" integer NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "tracking_run_id" "uuid",
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "last_error" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tracking_batch_categories_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "tracking_batch_categories_ordinal_check" CHECK (("ordinal" >= 0)),
    CONSTRAINT "tracking_batch_categories_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."tracking_batch_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tracking_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "category_order" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tracking_batches_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."tracking_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tracking_run_daily_claims" (
    "project_id" "uuid" NOT NULL,
    "run_date" "date" NOT NULL,
    "run_id" "uuid" NOT NULL,
    "started_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tracking_run_daily_claims" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tracking_run_stages" (
    "run_id" "uuid" NOT NULL,
    "stage_key" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "error_message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tracking_run_stages_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "tracking_run_stages_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."tracking_run_stages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tracking_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "started_by" "uuid",
    "provider" "text" DEFAULT 'chatgpt'::"text" NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "total_prompts" integer DEFAULT 0 NOT NULL,
    "completed_prompts" integer DEFAULT 0 NOT NULL,
    "failed_prompts" integer DEFAULT 0 NOT NULL,
    "error_message" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "tracking_location" "text" DEFAULT 'LEGACY'::"text" NOT NULL,
    "category" "text",
    "published_at" timestamp with time zone,
    "supersedes_run_id" "uuid",
    "run_kind" "text",
    "superseded_at" timestamp with time zone,
    "source_run_id" "uuid",
    "data_source" "text",
    "import_batch" "text",
    CONSTRAINT "tracking_runs_provider_check" CHECK (("provider" = ANY (ARRAY['chatgpt'::"text", 'gemini'::"text", 'perplexity'::"text", 'google_ai_overview'::"text", 'claude'::"text", 'Overall'::"text"]))),
    CONSTRAINT "tracking_runs_run_kind_check" CHECK ((("run_kind" IS NULL) OR ("run_kind" = ANY (ARRAY['topic'::"text", 'full'::"text", 'overall_aggregate'::"text"])))),
    CONSTRAINT "tracking_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'completed'::"text", 'partial'::"text", 'failed'::"text"]))),
    CONSTRAINT "tracking_runs_tracking_location_check" CHECK ((("tracking_location" = 'LEGACY'::"text") OR ("tracking_location" = 'GLOBAL'::"text") OR ("tracking_location" ~ '^[A-Z]{2}$'::"text")))
);


ALTER TABLE "public"."tracking_runs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tracking_runs"."tracking_location" IS 'Immutable country code or GLOBAL used by this run; LEGACY means location was not reliably recorded.';



COMMENT ON COLUMN "public"."tracking_runs"."category" IS 'Category grain for category-scoped runs. NULL means legacy/full-project run.';



COMMENT ON COLUMN "public"."tracking_runs"."published_at" IS 'Set only when the completed run successfully wrote its derived aggregates.';



COMMENT ON COLUMN "public"."tracking_runs"."supersedes_run_id" IS 'Previous published run for the same project/category/provider/location grain; retained for audit.';



COMMENT ON COLUMN "public"."tracking_runs"."run_kind" IS 'Stored value ''topic'' means a single-category run; ''full'' is a legacy all-category run (the word "topic" is kept in stored data).';



COMMENT ON COLUMN "public"."tracking_runs"."superseded_at" IS 'Set when a later published run replaced this run for the same project/category/provider/location/day. Superseded runs are retained for audit.';



COMMENT ON COLUMN "public"."tracking_runs"."source_run_id" IS 'For a backfilled category slice of an older all-category run: the run whose stored responses it republishes. Null for runs that own their responses.';



COMMENT ON COLUMN "public"."tracking_runs"."data_source" IS 'Where the run came from: null for platform runs, profound_import for imported Profound exports, cross_engine_pool for pooled aggregates.';



COMMENT ON COLUMN "public"."tracking_runs"."import_batch" IS 'Import batch label for data_source = profound_import.';



CREATE TABLE IF NOT EXISTS "public"."visibility_daily" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "metric_date" "date" NOT NULL,
    "category" "text" DEFAULT 'Overall'::"text" NOT NULL,
    "llm_provider" "text" DEFAULT 'Overall'::"text" NOT NULL,
    "visibility_score" numeric(10,4),
    "visibility_rank" integer,
    "share_of_voice_score" numeric(10,4),
    "share_of_voice_rank" integer,
    "average_position" numeric(10,4),
    "average_position_rank" integer,
    "citation_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tracking_location" "text" DEFAULT 'LEGACY'::"text" NOT NULL,
    "run_id" "uuid",
    "rank_population_count" integer,
    "rank_population_status" "text" DEFAULT 'unverified'::"text" NOT NULL,
    "presence_count" integer,
    "response_count" integer,
    "source_run_ids" "uuid"[],
    "metric_version" "text",
    CONSTRAINT "visibility_daily_counts_check" CHECK (((("presence_count" IS NULL) AND ("response_count" IS NULL)) OR (("presence_count" >= 0) AND ("response_count" >= 0) AND ("presence_count" <= "response_count")))),
    CONSTRAINT "visibility_daily_rank_population_count_check" CHECK ((("rank_population_count" IS NULL) OR ("rank_population_count" >= 0))),
    CONSTRAINT "visibility_daily_rank_population_status_check" CHECK (("rank_population_status" = ANY (ARRAY['verified'::"text", 'no_eligible_observations'::"text", 'unverified'::"text"]))),
    CONSTRAINT "visibility_daily_rank_valid_check" CHECK (((("visibility_rank" IS NULL) OR ("visibility_rank" >= 1)) AND (("rank_population_status" <> 'verified'::"text") OR (("visibility_rank" IS NOT NULL) AND ("rank_population_count" >= "visibility_rank"))) AND (("rank_population_status" <> 'no_eligible_observations'::"text") OR ("visibility_rank" IS NULL)))),
    CONSTRAINT "visibility_daily_tracking_location_check" CHECK ((("tracking_location" = 'LEGACY'::"text") OR ("tracking_location" = 'GLOBAL'::"text") OR ("tracking_location" ~ '^[A-Z]{2}$'::"text")))
);


ALTER TABLE "public"."visibility_daily" OWNER TO "postgres";


COMMENT ON COLUMN "public"."visibility_daily"."tracking_location" IS 'Country code or GLOBAL for the originating metrics; LEGACY means location was not reliably recorded.';



COMMENT ON COLUMN "public"."visibility_daily"."run_id" IS 'Tracking run that produced this canonical daily metric row; null for unverifiable legacy lineage.';



COMMENT ON COLUMN "public"."visibility_daily"."rank_population_count" IS 'Count of tracked brand plus eligible competitor observations for the exact metric scope. Null means historical scope is unverified.';



COMMENT ON COLUMN "public"."visibility_daily"."rank_population_status" IS 'verified for a complete scoped observation population; no_eligible_observations if none; unverified for legacy metrics.';



COMMENT ON COLUMN "public"."visibility_daily"."presence_count" IS 'Distinct valid responses in this exact scope that mention the tracked brand (visibility numerator).';



COMMENT ON COLUMN "public"."visibility_daily"."response_count" IS 'Distinct valid completed responses in this exact scope (visibility denominator).';



COMMENT ON COLUMN "public"."visibility_daily"."source_run_ids" IS 'Published runs that produced this row. One run for category rows; the member category runs for pooled Overall rows.';



COMMENT ON COLUMN "public"."visibility_daily"."metric_version" IS 'Calculation version from public.metric_definitions used to produce this row; null for unversioned legacy rows.';



ALTER TABLE ONLY "private"."llm_secrets"
    ADD CONSTRAINT "llm_secrets_pkey" PRIMARY KEY ("project_id", "provider");



ALTER TABLE ONLY "public"."ai_responses"
    ADD CONSTRAINT "ai_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_usage_log"
    ADD CONSTRAINT "ai_usage_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_reports"
    ADD CONSTRAINT "audit_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brand_registry"
    ADD CONSTRAINT "brand_registry_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brand_registry"
    ADD CONSTRAINT "brand_registry_project_normalized_key_key" UNIQUE ("project_id", "normalized_key");



ALTER TABLE ONLY "public"."category_brand_assignments"
    ADD CONSTRAINT "category_brand_assignments_pkey" PRIMARY KEY ("project_id", "category", "brand_id");



ALTER TABLE ONLY "public"."category_brand_observations"
    ADD CONSTRAINT "category_brand_observations_pkey" PRIMARY KEY ("project_id", "brand_id", "category", "metric_date", "tracking_location", "llm_provider");



ALTER TABLE "public"."category_brand_observations"
    ADD CONSTRAINT "category_brand_observations_run_id_required_for_new_rows" CHECK (("run_id" IS NOT NULL)) NOT VALID;



ALTER TABLE ONLY "public"."citation_occurrences"
    ADD CONSTRAINT "citation_occurrences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."citation_occurrences"
    ADD CONSTRAINT "citation_occurrences_response_entity_url_key" UNIQUE ("response_id", "entity_id", "canonical_url");



ALTER TABLE ONLY "public"."citations"
    ADD CONSTRAINT "citations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_reports"
    ADD CONSTRAINT "client_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."competitor_recompute_jobs"
    ADD CONSTRAINT "competitor_recompute_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."competitors"
    ADD CONSTRAINT "competitors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."direct_competitor_observations"
    ADD CONSTRAINT "direct_competitor_observations_pkey" PRIMARY KEY ("competitor_id", "metric_date", "tracking_location", "llm_provider");



ALTER TABLE ONLY "public"."direct_competitors"
    ADD CONSTRAINT "direct_competitors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."direct_competitors"
    ADD CONSTRAINT "direct_competitors_project_category_domain_key" UNIQUE ("project_id", "category", "normalized_domain");



ALTER TABLE ONLY "public"."llm_configs"
    ADD CONSTRAINT "llm_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."llm_configs"
    ADD CONSTRAINT "llm_configs_project_id_provider_key" UNIQUE ("project_id", "provider");



ALTER TABLE ONLY "public"."llm_secrets"
    ADD CONSTRAINT "llm_secrets_pkey" PRIMARY KEY ("project_id", "provider");



ALTER TABLE ONLY "public"."metric_definitions"
    ADD CONSTRAINT "metric_definitions_pkey" PRIMARY KEY ("metric_key", "version");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id", "user_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prompts"
    ADD CONSTRAINT "prompts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prompts"
    ADD CONSTRAINT "prompts_project_id_prompt_number_key" UNIQUE ("project_id", "prompt_number");



ALTER TABLE ONLY "public"."response_brand_evidence"
    ADD CONSTRAINT "response_brand_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."response_brand_evidence"
    ADD CONSTRAINT "response_brand_evidence_response_id_brand_id_category_match_key" UNIQUE ("response_id", "brand_id", "category", "match_source", "matched_value");



ALTER TABLE ONLY "public"."third_party_mentions"
    ADD CONSTRAINT "third_party_mentions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."third_party_mentions"
    ADD CONSTRAINT "third_party_mentions_project_id_response_id_canonical_url_s_key" UNIQUE ("project_id", "response_id", "canonical_url", "source_type", "category", "tracking_location");



ALTER TABLE ONLY "public"."tracking_batch_categories"
    ADD CONSTRAINT "tracking_batch_categories_batch_id_category_key" UNIQUE ("batch_id", "category");



ALTER TABLE ONLY "public"."tracking_batch_categories"
    ADD CONSTRAINT "tracking_batch_categories_batch_id_ordinal_key" UNIQUE ("batch_id", "ordinal");



ALTER TABLE ONLY "public"."tracking_batch_categories"
    ADD CONSTRAINT "tracking_batch_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tracking_batches"
    ADD CONSTRAINT "tracking_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tracking_run_daily_claims"
    ADD CONSTRAINT "tracking_run_daily_claims_pkey" PRIMARY KEY ("project_id", "run_date");



ALTER TABLE ONLY "public"."tracking_run_daily_claims"
    ADD CONSTRAINT "tracking_run_daily_claims_run_id_key" UNIQUE ("run_id");



ALTER TABLE ONLY "public"."tracking_run_stages"
    ADD CONSTRAINT "tracking_run_stages_pkey" PRIMARY KEY ("run_id", "stage_key");



ALTER TABLE ONLY "public"."tracking_runs"
    ADD CONSTRAINT "tracking_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."visibility_daily"
    ADD CONSTRAINT "visibility_daily_pkey" PRIMARY KEY ("id");



CREATE INDEX "ai_responses_project_date_idx" ON "public"."ai_responses" USING "btree" ("project_id", "captured_at");



CREATE INDEX "ai_responses_prompt_id_idx" ON "public"."ai_responses" USING "btree" ("prompt_id") WHERE ("prompt_id" IS NOT NULL);



CREATE INDEX "ai_responses_scope_run_valid_idx" ON "public"."ai_responses" USING "btree" ("project_id", "run_id", "tracking_location", "llm_provider", "response_status") INCLUDE ("id", "prompt_id", "captured_at") WHERE ("response_status" = 'completed'::"text");



COMMENT ON INDEX "public"."ai_responses_scope_run_valid_idx" IS 'Supports valid raw response denominator reconciliation by project/run/location/provider.';



CREATE INDEX "ai_usage_log_project_created_idx" ON "public"."ai_usage_log" USING "btree" ("project_id", "created_at" DESC);



CREATE UNIQUE INDEX "audit_reports_one_running_idx" ON "public"."audit_reports" USING "btree" ("project_id") WHERE ("status" = ANY (ARRAY['queued'::"text", 'running'::"text"]));



CREATE INDEX "audit_reports_project_created_idx" ON "public"."audit_reports" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "brand_registry_project_active_idx" ON "public"."brand_registry" USING "btree" ("project_id", "is_active");



CREATE INDEX "brand_registry_project_active_lookup_idx" ON "public"."brand_registry" USING "btree" ("project_id", "is_active");



CREATE INDEX "category_brand_assignments_lookup_idx" ON "public"."category_brand_assignments" USING "btree" ("project_id", "category", "include_in_metrics");



CREATE INDEX "category_brand_observations_period_idx" ON "public"."category_brand_observations" USING "btree" ("project_id", "category", "metric_date", "tracking_location", "llm_provider");



CREATE INDEX "category_brand_observations_run_category_idx" ON "public"."category_brand_observations" USING "btree" ("run_id", "category") WHERE ("run_id" IS NOT NULL);



CREATE INDEX "category_brand_observations_run_scope_idx" ON "public"."category_brand_observations" USING "btree" ("project_id", "run_id", "category", "metric_date", "llm_provider", "tracking_location", "brand_id") WHERE ("run_id" IS NOT NULL);



CREATE INDEX "category_brand_observations_scope_run_idx" ON "public"."category_brand_observations" USING "btree" ("project_id", "category", "metric_date", "llm_provider", "tracking_location", "run_id") INCLUDE ("brand_id", "response_count", "presence_count");



CREATE INDEX "citation_occurrences_response_lookup_idx" ON "public"."citation_occurrences" USING "btree" ("response_id", "entity_id");



CREATE INDEX "citation_occurrences_scoped_aggregate_idx" ON "public"."citation_occurrences" USING "btree" ("project_id", "metric_date", "category", "provider", "tracking_location", "entity_id") INCLUDE ("response_id", "canonical_url", "canonical_domain", "run_id");



CREATE UNIQUE INDEX "citations_daily_url_location_unique_idx" ON "public"."citations" USING "btree" ("project_id", "metric_date", "category", "llm_provider", "url", "tracking_location");



CREATE INDEX "citations_project_date_category_engine_idx" ON "public"."citations" USING "btree" ("project_id", "metric_date", "category", "llm_provider");



CREATE INDEX "citations_project_date_idx" ON "public"."citations" USING "btree" ("project_id", "metric_date" DESC);



CREATE INDEX "citations_project_location_date_category_idx" ON "public"."citations" USING "btree" ("project_id", "tracking_location", "metric_date", "category") INCLUDE ("llm_provider", "is_brand_related");



CREATE INDEX "citations_project_location_date_idx" ON "public"."citations" USING "btree" ("project_id", "tracking_location", "metric_date" DESC);



CREATE INDEX "citations_project_location_period_provider_idx" ON "public"."citations" USING "btree" ("project_id", "tracking_location", "metric_date", "llm_provider", "category", "is_brand_related");



CREATE INDEX "citations_project_prompt_idx" ON "public"."citations" USING "btree" ("project_id", "prompt_id");



CREATE INDEX "citations_prompt_id_idx" ON "public"."citations" USING "btree" ("prompt_id") WHERE ("prompt_id" IS NOT NULL);



CREATE INDEX "client_reports_project_created_idx" ON "public"."client_reports" USING "btree" ("project_id", "created_at" DESC);



CREATE UNIQUE INDEX "competitor_recompute_jobs_one_queued" ON "public"."competitor_recompute_jobs" USING "btree" ("project_id") WHERE ("status" = 'queued'::"text");



CREATE INDEX "competitor_recompute_jobs_project_idx" ON "public"."competitor_recompute_jobs" USING "btree" ("project_id", "requested_at" DESC);



CREATE UNIQUE INDEX "competitors_daily_brand_location_unique_idx" ON "public"."competitors" USING "btree" ("project_id", "metric_date", "category", "llm_provider", "brand_name", "tracking_location");



CREATE INDEX "competitors_project_date_category_engine_idx" ON "public"."competitors" USING "btree" ("project_id", "metric_date", "category", "llm_provider");



CREATE INDEX "competitors_project_date_idx" ON "public"."competitors" USING "btree" ("project_id", "metric_date" DESC);



CREATE INDEX "competitors_project_location_date_idx" ON "public"."competitors" USING "btree" ("project_id", "tracking_location", "metric_date" DESC);



CREATE INDEX "direct_competitor_observations_competitor_latest_idx" ON "public"."direct_competitor_observations" USING "btree" ("competitor_id", "project_id", "tracking_location", "llm_provider", "metric_date" DESC);



CREATE INDEX "direct_competitor_observations_period_idx" ON "public"."direct_competitor_observations" USING "btree" ("project_id", "metric_date", "tracking_location", "llm_provider");



CREATE INDEX "direct_competitor_observations_project_location_provider_date_i" ON "public"."direct_competitor_observations" USING "btree" ("project_id", "tracking_location", "llm_provider", "metric_date", "competitor_id");



CREATE INDEX "direct_competitors_project_category_idx" ON "public"."direct_competitors" USING "btree" ("project_id", "category", "normalized_domain");



CREATE INDEX "project_members_user_id_idx" ON "public"."project_members" USING "btree" ("user_id");



CREATE INDEX "projects_created_by_idx" ON "public"."projects" USING "btree" ("created_by") WHERE ("created_by" IS NOT NULL);



CREATE INDEX "response_brand_evidence_entity_response_idx" ON "public"."response_brand_evidence" USING "btree" ("response_id", "brand_id", "category");



COMMENT ON INDEX "public"."response_brand_evidence_entity_response_idx" IS 'Supports distinct response/entity/category evidence reconciliation.';



CREATE INDEX "response_brand_evidence_project_category_idx" ON "public"."response_brand_evidence" USING "btree" ("project_id", "category", "brand_id");



CREATE INDEX "response_brand_evidence_response_idx" ON "public"."response_brand_evidence" USING "btree" ("response_id");



CREATE INDEX "third_party_mentions_host_idx" ON "public"."third_party_mentions" USING "btree" ("project_id", "hostname");



CREATE INDEX "third_party_mentions_period_idx" ON "public"."third_party_mentions" USING "btree" ("project_id", "metric_date", "category", "llm_provider", "tracking_location");



CREATE INDEX "third_party_mentions_project_location_period_provider_idx" ON "public"."third_party_mentions" USING "btree" ("project_id", "tracking_location", "metric_date", "llm_provider", "category", "hostname");



CREATE INDEX "tracking_batch_categories_batch_status_idx" ON "public"."tracking_batch_categories" USING "btree" ("batch_id", "status", "ordinal");



CREATE INDEX "tracking_batches_project_created_idx" ON "public"."tracking_batches" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "tracking_run_daily_claims_started_by_idx" ON "public"."tracking_run_daily_claims" USING "btree" ("started_by") WHERE ("started_by" IS NOT NULL);



CREATE INDEX "tracking_run_stages_status_updated_idx" ON "public"."tracking_run_stages" USING "btree" ("status", "updated_at" DESC);



CREATE UNIQUE INDEX "tracking_runs_one_active_published_per_scope_day" ON "public"."tracking_runs" USING "btree" ("project_id", "provider", "tracking_location", COALESCE("category", ''::"text"), COALESCE("run_kind", ''::"text"), ((("published_at" AT TIME ZONE 'Asia/Kuala_Lumpur'::"text"))::"date")) WHERE (("status" = 'completed'::"text") AND ("published_at" IS NOT NULL) AND ("superseded_at" IS NULL));



CREATE INDEX "tracking_runs_project_location_started_idx" ON "public"."tracking_runs" USING "btree" ("project_id", "tracking_location", "started_at" DESC);



CREATE INDEX "tracking_runs_project_started_idx" ON "public"."tracking_runs" USING "btree" ("project_id", "started_at" DESC);



CREATE INDEX "tracking_runs_published_day_idx" ON "public"."tracking_runs" USING "btree" ("project_id", "tracking_location", "provider", ((("published_at" AT TIME ZONE 'Asia/Kuala_Lumpur'::"text"))::"date"), "category") WHERE (("status" = 'completed'::"text") AND ("published_at" IS NOT NULL));



CREATE INDEX "tracking_runs_published_grain_idx" ON "public"."tracking_runs" USING "btree" ("project_id", "category", "provider", "tracking_location", "completed_at" DESC) WHERE (("published_at" IS NOT NULL) AND ("status" = 'completed'::"text"));



CREATE INDEX "tracking_runs_published_scope_idx" ON "public"."tracking_runs" USING "btree" ("project_id", "category", "provider", "tracking_location", "published_at" DESC) WHERE (("status" = 'completed'::"text") AND ("published_at" IS NOT NULL));



CREATE INDEX "tracking_runs_started_by_idx" ON "public"."tracking_runs" USING "btree" ("started_by") WHERE ("started_by" IS NOT NULL);



CREATE INDEX "tracking_runs_supersedes_idx" ON "public"."tracking_runs" USING "btree" ("supersedes_run_id") WHERE ("supersedes_run_id" IS NOT NULL);



CREATE UNIQUE INDEX "visibility_daily_project_date_category_engine_location_key" ON "public"."visibility_daily" USING "btree" ("project_id", "metric_date", "category", "llm_provider", "tracking_location");



CREATE INDEX "visibility_daily_project_date_idx" ON "public"."visibility_daily" USING "btree" ("project_id", "metric_date" DESC);



CREATE INDEX "visibility_daily_project_location_date_idx" ON "public"."visibility_daily" USING "btree" ("project_id", "tracking_location", "metric_date" DESC);



CREATE INDEX "visibility_daily_project_location_provider_date_category_idx" ON "public"."visibility_daily" USING "btree" ("project_id", "tracking_location", "llm_provider", "metric_date", "category");



CREATE INDEX "visibility_daily_run_idx" ON "public"."visibility_daily" USING "btree" ("run_id") WHERE ("run_id" IS NOT NULL);



CREATE INDEX "visibility_daily_scope_run_idx" ON "public"."visibility_daily" USING "btree" ("project_id", "metric_date", "category", "llm_provider", "tracking_location", "run_id");



CREATE OR REPLACE TRIGGER "audit_reports_guard_update" BEFORE UPDATE ON "public"."audit_reports" FOR EACH ROW EXECUTE FUNCTION "public"."audit_reports_guard_update"();



CREATE OR REPLACE TRIGGER "client_reports_touch_updated_at" BEFORE UPDATE ON "public"."client_reports" FOR EACH ROW EXECUTE FUNCTION "public"."client_reports_touch_updated_at"();



CREATE OR REPLACE TRIGGER "competitor_assignment_changed_row" AFTER INSERT OR DELETE OR UPDATE ON "public"."category_brand_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."competitor_assignment_changed"();



CREATE OR REPLACE TRIGGER "competitor_registry_changed_row" AFTER UPDATE ON "public"."brand_registry" FOR EACH ROW EXECUTE FUNCTION "public"."competitor_registry_changed"();



CREATE OR REPLACE TRIGGER "preserve_raw_responses_before_project_delete" BEFORE DELETE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."preserve_raw_responses_on_project_delete"();



CREATE OR REPLACE TRIGGER "protect_superadmin_delete" BEFORE DELETE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."protect_superadmin_delete"();



CREATE OR REPLACE TRIGGER "protect_superadmin_profile" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."protect_superadmin_profile"();



CREATE OR REPLACE TRIGGER "tracking_batch_rebuild_overall" AFTER UPDATE OF "status" ON "public"."tracking_batches" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_rebuild_overall_after_batch_completion"();



CREATE OR REPLACE TRIGGER "tracking_runs_publication_guard_ins" BEFORE INSERT ON "public"."tracking_runs" FOR EACH ROW EXECUTE FUNCTION "public"."tracking_runs_publication_guard"();



CREATE OR REPLACE TRIGGER "tracking_runs_publication_guard_upd" BEFORE UPDATE ON "public"."tracking_runs" FOR EACH ROW EXECUTE FUNCTION "public"."tracking_runs_publication_guard"();



ALTER TABLE ONLY "private"."llm_secrets"
    ADD CONSTRAINT "llm_secrets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_responses"
    ADD CONSTRAINT "ai_responses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_responses"
    ADD CONSTRAINT "ai_responses_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_usage_log"
    ADD CONSTRAINT "ai_usage_log_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_reports"
    ADD CONSTRAINT "audit_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_reports"
    ADD CONSTRAINT "audit_reports_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."brand_registry"
    ADD CONSTRAINT "brand_registry_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."category_brand_assignments"
    ADD CONSTRAINT "category_brand_assignments_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brand_registry"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."category_brand_assignments"
    ADD CONSTRAINT "category_brand_assignments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."category_brand_observations"
    ADD CONSTRAINT "category_brand_observations_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brand_registry"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."category_brand_observations"
    ADD CONSTRAINT "category_brand_observations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."category_brand_observations"
    ADD CONSTRAINT "category_brand_observations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."tracking_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."citation_occurrences"
    ADD CONSTRAINT "citation_occurrences_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "public"."brand_registry"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."citation_occurrences"
    ADD CONSTRAINT "citation_occurrences_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."citation_occurrences"
    ADD CONSTRAINT "citation_occurrences_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."ai_responses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."citations"
    ADD CONSTRAINT "citations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."citations"
    ADD CONSTRAINT "citations_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_reports"
    ADD CONSTRAINT "client_reports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_reports"
    ADD CONSTRAINT "client_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."competitor_recompute_jobs"
    ADD CONSTRAINT "competitor_recompute_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."competitors"
    ADD CONSTRAINT "competitors_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."direct_competitor_observations"
    ADD CONSTRAINT "direct_competitor_observations_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "public"."direct_competitors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."direct_competitor_observations"
    ADD CONSTRAINT "direct_competitor_observations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."direct_competitors"
    ADD CONSTRAINT "direct_competitors_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."llm_configs"
    ADD CONSTRAINT "llm_configs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."llm_secrets"
    ADD CONSTRAINT "llm_secrets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."prompts"
    ADD CONSTRAINT "prompts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."response_brand_evidence"
    ADD CONSTRAINT "response_brand_evidence_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brand_registry"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."response_brand_evidence"
    ADD CONSTRAINT "response_brand_evidence_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."response_brand_evidence"
    ADD CONSTRAINT "response_brand_evidence_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."ai_responses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."third_party_mentions"
    ADD CONSTRAINT "third_party_mentions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."third_party_mentions"
    ADD CONSTRAINT "third_party_mentions_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."ai_responses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tracking_batch_categories"
    ADD CONSTRAINT "tracking_batch_categories_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."tracking_batches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tracking_batch_categories"
    ADD CONSTRAINT "tracking_batch_categories_tracking_run_id_fkey" FOREIGN KEY ("tracking_run_id") REFERENCES "public"."tracking_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tracking_batches"
    ADD CONSTRAINT "tracking_batches_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tracking_batches"
    ADD CONSTRAINT "tracking_batches_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."tracking_run_daily_claims"
    ADD CONSTRAINT "tracking_run_daily_claims_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tracking_run_daily_claims"
    ADD CONSTRAINT "tracking_run_daily_claims_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."tracking_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tracking_run_daily_claims"
    ADD CONSTRAINT "tracking_run_daily_claims_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tracking_run_stages"
    ADD CONSTRAINT "tracking_run_stages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."tracking_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tracking_runs"
    ADD CONSTRAINT "tracking_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tracking_runs"
    ADD CONSTRAINT "tracking_runs_source_run_id_fkey" FOREIGN KEY ("source_run_id") REFERENCES "public"."tracking_runs"("id");



ALTER TABLE ONLY "public"."tracking_runs"
    ADD CONSTRAINT "tracking_runs_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tracking_runs"
    ADD CONSTRAINT "tracking_runs_supersedes_run_id_fkey" FOREIGN KEY ("supersedes_run_id") REFERENCES "public"."tracking_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."visibility_daily"
    ADD CONSTRAINT "visibility_daily_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visibility_daily"
    ADD CONSTRAINT "visibility_daily_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."tracking_runs"("id") ON DELETE SET NULL;



CREATE POLICY "Project admins can create tracking batches" ON "public"."tracking_batches" FOR INSERT TO "authenticated" WITH CHECK ((("requested_by" = "auth"."uid"()) AND ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "tracking_batches"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))))));



CREATE POLICY "Project admins can insert batch categories" ON "public"."tracking_batch_categories" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."tracking_batches" "b"
  WHERE (("b"."id" = "tracking_batch_categories"."batch_id") AND ((EXISTS ( SELECT 1
           FROM "public"."profiles" "p"
          WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'superadmin'::"public"."app_role")))) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "b"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))))))));



CREATE POLICY "Project admins can read batch categories" ON "public"."tracking_batch_categories" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."tracking_batches" "b"
  WHERE (("b"."id" = "tracking_batch_categories"."batch_id") AND ((EXISTS ( SELECT 1
           FROM "public"."profiles" "p"
          WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'superadmin'::"public"."app_role")))) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "b"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))))))));