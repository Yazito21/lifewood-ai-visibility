


CREATE POLICY "Project admins can read tracking batches" ON "public"."tracking_batches" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'superadmin'::"public"."app_role")))) OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "tracking_batches"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"])))))));



CREATE POLICY "Project admins can update batch categories" ON "public"."tracking_batch_categories" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."tracking_batches" "b"
  WHERE (("b"."id" = "tracking_batch_categories"."batch_id") AND ((EXISTS ( SELECT 1
           FROM "public"."profiles" "p"
          WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'superadmin'::"public"."app_role")))) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "b"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"])))))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."tracking_batches" "b"
  WHERE (("b"."id" = "tracking_batch_categories"."batch_id") AND ((EXISTS ( SELECT 1
           FROM "public"."profiles" "p"
          WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'superadmin'::"public"."app_role")))) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "b"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))))))));



CREATE POLICY "Project admins can update tracking batches" ON "public"."tracking_batches" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'superadmin'::"public"."app_role")))) OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "tracking_batches"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'superadmin'::"public"."app_role")))) OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "tracking_batches"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"])))))));



CREATE POLICY "Project members can view daily tracking claims" ON "public"."tracking_run_daily_claims" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "tracking_run_daily_claims"."project_id") AND ("pm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = ( SELECT "auth"."uid"() AS "uid")) AND (("p"."role")::"text" = 'superadmin'::"text"))))));



CREATE POLICY "Superadmins read AI usage" ON "public"."ai_usage_log" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("p"."role" = 'superadmin'::"public"."app_role")))));



ALTER TABLE "public"."ai_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_usage_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "analytics visible to members" ON "public"."visibility_daily" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



CREATE POLICY "audit reports edits by editors" ON "public"."audit_reports" FOR UPDATE TO "authenticated" USING ("public"."can_edit_project"("project_id")) WITH CHECK ("public"."can_edit_project"("project_id"));



CREATE POLICY "audit reports visible to members" ON "public"."audit_reports" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."audit_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "brand registry editable by admins" ON "public"."brand_registry" TO "authenticated" USING ("public"."can_edit_project"("project_id")) WITH CHECK ("public"."can_edit_project"("project_id"));



CREATE POLICY "brand registry visible to members" ON "public"."brand_registry" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."brand_registry" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "category assignments editable by admins" ON "public"."category_brand_assignments" TO "authenticated" USING ("public"."can_edit_project"("project_id")) WITH CHECK ("public"."can_edit_project"("project_id"));



CREATE POLICY "category assignments visible to members" ON "public"."category_brand_assignments" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



CREATE POLICY "category brand observations visible to members" ON "public"."category_brand_observations" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."category_brand_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."category_brand_assignments_archive" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."category_brand_observations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."category_brand_observations_archive" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."citation_occurrences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."citations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "citations visible to members" ON "public"."citations" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



CREATE POLICY "client reports created by project editors" ON "public"."client_reports" FOR INSERT TO "authenticated" WITH CHECK (("public"."can_edit_project"("project_id") AND (("created_by" IS NULL) OR ("created_by" = "auth"."uid"()))));



CREATE POLICY "client reports deletable by project editors" ON "public"."client_reports" FOR DELETE TO "authenticated" USING ("public"."can_edit_project"("project_id"));



CREATE POLICY "client reports editable by project editors" ON "public"."client_reports" FOR UPDATE TO "authenticated" USING ("public"."can_edit_project"("project_id")) WITH CHECK ("public"."can_edit_project"("project_id"));



CREATE POLICY "client reports visible to project members" ON "public"."client_reports" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."client_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."competitor_recompute_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."competitors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "competitors visible to members" ON "public"."competitors" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



CREATE POLICY "direct competitor observations visible to members" ON "public"."direct_competitor_observations" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



CREATE POLICY "direct competitors visible to members" ON "public"."direct_competitors" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."direct_competitor_observations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."direct_competitors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "llm configs editable by admins" ON "public"."llm_configs" TO "authenticated" USING ("public"."can_edit_project"("project_id")) WITH CHECK ("public"."can_edit_project"("project_id"));



CREATE POLICY "llm configs visible to members" ON "public"."llm_configs" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."llm_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."llm_secrets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "members admins can remove" ON "public"."project_members" FOR DELETE TO "authenticated" USING ("public"."can_manage_project_members"("project_id"));



CREATE POLICY "members editable by admins" ON "public"."project_members" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_manage_project_members"("project_id"));



CREATE POLICY "members read recompute jobs" ON "public"."competitor_recompute_jobs" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



CREATE POLICY "members visible to project users" ON "public"."project_members" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."metric_definitions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "metric_definitions readable by authenticated" ON "public"."metric_definitions" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles self or superadmin" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_superadmin"()));



CREATE POLICY "profiles visible to project admins" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("public"."is_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."user_id" = "profiles"."id") AND "public"."can_manage_project_members"("pm"."project_id"))))));



ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects admins can insert" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_superadmin"() OR (("public"."current_app_role"() = 'admin'::"public"."app_role") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "projects admins can update" ON "public"."projects" FOR UPDATE TO "authenticated" USING ("public"."can_edit_project"("id")) WITH CHECK ("public"."can_edit_project"("id"));



CREATE POLICY "projects only superadmin can delete" ON "public"."projects" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());



CREATE POLICY "projects visible to members" ON "public"."projects" FOR SELECT TO "authenticated" USING (("public"."is_project_member"("id") OR (("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("public"."current_app_role"() = 'admin'::"public"."app_role"))));



ALTER TABLE "public"."prompts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prompts delete by admins" ON "public"."prompts" FOR DELETE TO "authenticated" USING ("public"."can_edit_project"("project_id"));



CREATE POLICY "prompts editable by admins" ON "public"."prompts" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_edit_project"("project_id"));



CREATE POLICY "prompts update by admins" ON "public"."prompts" FOR UPDATE TO "authenticated" USING ("public"."can_edit_project"("project_id")) WITH CHECK ("public"."can_edit_project"("project_id"));



CREATE POLICY "prompts visible to members" ON "public"."prompts" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."prompts_backup_20261101" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "raw ai response superadmin" ON "public"."ai_responses" FOR SELECT TO "authenticated" USING ("public"."is_superadmin"());



CREATE POLICY "response brand evidence visible to members" ON "public"."response_brand_evidence" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."response_brand_evidence" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "third-party mentions visible to members" ON "public"."third_party_mentions" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."third_party_mentions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tracking_batch_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tracking_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tracking_run_daily_claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tracking_run_stages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tracking_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visibility_daily" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "private" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































REVOKE ALL ON FUNCTION "public"."backfill_verified_category_runs"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."backfill_verified_category_runs"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."build_profound_third_party_mentions"("p_project_id" "uuid", "p_date_from" "date", "p_date_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."build_profound_third_party_mentions"("p_project_id" "uuid", "p_date_from" "date", "p_date_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_edit_project"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_edit_project"("p_project_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."can_manage_project_members"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_project_members"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_project_members"("p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."canonical_scoped_rank"("p_project_id" "uuid", "p_run_id" "uuid", "p_category" "text", "p_metric_date" "date", "p_provider" "text", "p_location" "text", "p_tracked_presence" integer, "p_tracked_responses" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."canonical_scoped_rank"("p_project_id" "uuid", "p_run_id" "uuid", "p_category" "text", "p_metric_date" "date", "p_provider" "text", "p_location" "text", "p_tracked_presence" integer, "p_tracked_responses" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_metric_integrity"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_metric_integrity"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_daily_tracking_run"("p_project_id" "uuid", "p_started_by" "uuid", "p_run_id" "uuid", "p_total_prompts" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_daily_tracking_run"("p_project_id" "uuid", "p_started_by" "uuid", "p_run_id" "uuid", "p_total_prompts" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_app_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_app_role"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."enqueue_competitor_recompute"("p_project_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_competitor_recompute"("p_project_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_run_metrics"("p_run_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_run_metrics"("p_run_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_competitor_counts_for_period"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_tracking_location" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_competitor_counts_for_period"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_tracking_location" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_cumulative_citations"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_engines" "text"[], "p_brand_related_only" boolean, "p_tracking_location" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_cumulative_citations"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_engines" "text"[], "p_brand_related_only" boolean, "p_tracking_location" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_cumulative_citations"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_engines" "text"[], "p_brand_related_only" boolean, "p_tracking_location" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_cumulative_competitors"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_engines" "text"[], "p_tracking_location" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_cumulative_competitors"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_engines" "text"[], "p_tracking_location" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_direct_competitor_metrics_for_period"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_tracking_location" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_direct_competitor_metrics_for_period"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_tracking_location" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_direct_competitor_metrics_for_period"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_tracking_location" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_latest_competitor_counts"("p_project_id" "uuid", "p_tracking_location" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_published_competitor_observations"("p_project_id" "uuid", "p_metric_date" "date", "p_category" "text", "p_provider" "text", "p_tracking_location" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_published_competitor_observations"("p_project_id" "uuid", "p_metric_date" "date", "p_category" "text", "p_provider" "text", "p_tracking_location" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_published_run_ids_for_leaderboard"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_provider" "text", "p_tracking_location" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_published_run_ids_for_leaderboard"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_provider" "text", "p_tracking_location" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_published_run_ids_for_leaderboard"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_provider" "text", "p_tracking_location" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_report_prompt_gaps"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_tracking_location" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_report_prompt_gaps"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_tracking_location" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_report_prompt_gaps"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_tracking_location" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_third_party_mentions"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_engines" "text"[], "p_tracking_location" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_third_party_mentions"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_engines" "text"[], "p_tracking_location" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_third_party_mentions"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_engines" "text"[], "p_tracking_location" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_auth_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "public"."import_profound_batch"("p_project_id" "uuid", "p_batch" "text", "p_replace_existing" boolean, "p_presence_source" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_profound_batch"("p_project_id" "uuid", "p_batch" "text", "p_replace_existing" boolean, "p_presence_source" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_project_member"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_superadmin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_superadmin"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."preserve_raw_responses_on_project_delete"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."process_competitor_recompute_jobs"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_competitor_recompute_jobs"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."protect_superadmin_delete"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."protect_superadmin_profile"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."publish_cross_engine_metrics"("p_project_id" "uuid", "p_metric_date" "date", "p_location" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_cross_engine_metrics"("p_project_id" "uuid", "p_metric_date" "date", "p_location" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_engine_overall_metrics"("p_project_id" "uuid", "p_metric_date" "date", "p_location" "text", "p_provider" "text", "p_write_overall_provider" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_engine_overall_metrics"("p_project_id" "uuid", "p_metric_date" "date", "p_location" "text", "p_provider" "text", "p_write_overall_provider" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_overall_metrics"("p_project_id" "uuid", "p_metric_date" "date", "p_location" "text", "p_provider" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_overall_metrics"("p_project_id" "uuid", "p_metric_date" "date", "p_location" "text", "p_provider" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rebuild_overall_metrics_for_tracking_batch"("p_batch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rebuild_overall_metrics_for_tracking_batch"("p_batch_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."recompute_competitor_metrics"("p_project_id" "uuid", "p_date_from" "date", "p_date_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recompute_competitor_metrics"("p_project_id" "uuid", "p_date_from" "date", "p_date_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_stale_tracking_runs"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_stale_tracking_runs"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_competitor_recompute"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_competitor_recompute"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_competitor_recompute"("p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."run_tracked_presence"("p_run_id" "uuid", "p_category" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."run_tracked_presence"("p_run_id" "uuid", "p_category" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_my_ui_preferences"("p_preferences" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_my_ui_preferences"("p_preferences" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."text_contains_any_term_boundary"("p_text" "text", "p_terms" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."text_contains_any_term_boundary"("p_text" "text", "p_terms" "text"[]) TO "service_role";
























GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "private"."llm_secrets" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ai_responses" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ai_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_responses" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ai_usage_log" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ai_usage_log" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ai_usage_log" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_reports" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."audit_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_reports" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."brand_registry" TO "anon";
GRANT ALL ON TABLE "public"."brand_registry" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_registry" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."category_brand_assignments" TO "anon";
GRANT ALL ON TABLE "public"."category_brand_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."category_brand_assignments" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."category_brand_assignments_archive" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."category_brand_assignments_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."category_brand_assignments_archive" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."category_brand_observations" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."category_brand_observations" TO "authenticated";
GRANT ALL ON TABLE "public"."category_brand_observations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."category_brand_observations_archive" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."category_brand_observations_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."category_brand_observations_archive" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."citation_occurrences" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."citation_occurrences" TO "authenticated";
GRANT ALL ON TABLE "public"."citation_occurrences" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."citations" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."citations" TO "authenticated";
GRANT ALL ON TABLE "public"."citations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_reports" TO "anon";
GRANT ALL ON TABLE "public"."client_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."client_reports" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."competitor_recompute_jobs" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."competitor_recompute_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."competitor_recompute_jobs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."competitors" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."competitors" TO "authenticated";
GRANT ALL ON TABLE "public"."competitors" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."direct_competitor_observations" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."direct_competitor_observations" TO "authenticated";
GRANT ALL ON TABLE "public"."direct_competitor_observations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."direct_competitors" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."direct_competitors" TO "authenticated";
GRANT ALL ON TABLE "public"."direct_competitors" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."llm_configs" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."llm_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."llm_configs" TO "service_role";



GRANT SELECT("project_id") ON TABLE "public"."llm_configs" TO "authenticated";



GRANT SELECT("provider") ON TABLE "public"."llm_configs" TO "authenticated";



GRANT SELECT("enabled") ON TABLE "public"."llm_configs" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."llm_configs" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."llm_configs" TO "authenticated";



GRANT SELECT("api_key_last4") ON TABLE "public"."llm_configs" TO "authenticated";



GRANT SELECT("key_updated_at") ON TABLE "public"."llm_configs" TO "authenticated";



GRANT ALL ON TABLE "public"."llm_secrets" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."metric_definitions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."metric_definitions" TO "authenticated";
GRANT ALL ON TABLE "public"."metric_definitions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."project_members" TO "anon";
GRANT ALL ON TABLE "public"."project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."projects" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."prompts" TO "anon";
GRANT ALL ON TABLE "public"."prompts" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."prompts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."prompts_backup_20261101" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."response_brand_evidence" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."response_brand_evidence" TO "authenticated";
GRANT ALL ON TABLE "public"."response_brand_evidence" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."response_brand_evidence_scoped" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."response_brand_evidence_scoped" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."response_brand_evidence_scoped" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."third_party_mentions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."third_party_mentions" TO "authenticated";
GRANT ALL ON TABLE "public"."third_party_mentions" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."tracking_batch_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."tracking_batch_categories" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."tracking_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."tracking_batches" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."tracking_run_daily_claims" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."tracking_run_daily_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."tracking_run_daily_claims" TO "service_role";



GRANT ALL ON TABLE "public"."tracking_run_stages" TO "service_role";



GRANT ALL ON TABLE "public"."tracking_runs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."visibility_daily" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."visibility_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."visibility_daily" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";


































