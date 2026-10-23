export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_responses: {
        Row: {
          brand_name_snapshot: string | null
          captured_at: string
          error_message: string | null
          id: string
          llm_provider: string
          project_id: string | null
          project_snapshot: Json
          prompt_id: string | null
          prompt_snapshot: string
          raw_response: Json
          response_analysis: Json
          response_status: string | null
          response_text: string | null
          run_id: string | null
          tracking_location: string
        }
        Insert: {
          brand_name_snapshot?: string | null
          captured_at?: string
          error_message?: string | null
          id?: string
          llm_provider: string
          project_id?: string | null
          project_snapshot?: Json
          prompt_id?: string | null
          prompt_snapshot: string
          raw_response: Json
          response_analysis?: Json
          response_status?: string | null
          response_text?: string | null
          run_id?: string | null
          tracking_location?: string
        }
        Update: {
          brand_name_snapshot?: string | null
          captured_at?: string
          error_message?: string | null
          id?: string
          llm_provider?: string
          project_id?: string | null
          project_snapshot?: Json
          prompt_id?: string | null
          prompt_snapshot?: string
          raw_response?: Json
          response_analysis?: Json
          response_status?: string | null
          response_text?: string | null
          run_id?: string | null
          tracking_location?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_responses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_responses_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_registry: {
        Row: {
          additional_websites: string[]
          aliases: string[]
          canonical_name: string
          created_at: string
          id: string
          is_active: boolean
          is_tracked_brand: boolean
          normalized_key: string
          primary_website: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          additional_websites?: string[]
          aliases?: string[]
          canonical_name: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_tracked_brand?: boolean
          normalized_key: string
          primary_website?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          additional_websites?: string[]
          aliases?: string[]
          canonical_name?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_tracked_brand?: boolean
          normalized_key?: string
          primary_website?: string | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_registry_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      citations: {
        Row: {
          brand_name: string | null
          created_at: string
          frequency: number
          id: string
          is_brand_related: boolean
          llm_provider: string | null
          metric_date: string
          page_name: string | null
          project_id: string
          prompt_id: string | null
          topic: string | null
          tracking_location: string
          url: string
        }
        Insert: {
          brand_name?: string | null
          created_at?: string
          frequency?: number
          id?: string
          is_brand_related?: boolean
          llm_provider?: string | null
          metric_date: string
          page_name?: string | null
          project_id: string
          prompt_id?: string | null
          topic?: string | null
          tracking_location?: string
          url: string
        }
        Update: {
          brand_name?: string | null
          created_at?: string
          frequency?: number
          id?: string
          is_brand_related?: boolean
          llm_provider?: string | null
          metric_date?: string
          page_name?: string | null
          project_id?: string
          prompt_id?: string | null
          topic?: string | null
          tracking_location?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "citations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "citations_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          brand_name: string
          citation_count: number
          created_at: string
          id: string
          llm_provider: string | null
          metric_date: string
          project_id: string
          topic: string | null
          tracking_location: string
          visibility_score: number | null
          website: string | null
        }
        Insert: {
          brand_name: string
          citation_count?: number
          created_at?: string
          id?: string
          llm_provider?: string | null
          metric_date: string
          project_id: string
          topic?: string | null
          tracking_location?: string
          visibility_score?: number | null
          website?: string | null
        }
        Update: {
          brand_name?: string
          citation_count?: number
          created_at?: string
          id?: string
          llm_provider?: string | null
          metric_date?: string
          project_id?: string
          topic?: string | null
          tracking_location?: string
          visibility_score?: number | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_competitor_observations: {
        Row: {
          citation_count: number
          competitor_id: string
          created_at: string
          llm_provider: string
          metric_date: string
          presence_count: number
          project_id: string
          response_count: number
          tracking_location: string
        }
        Insert: {
          citation_count?: number
          competitor_id: string
          created_at?: string
          llm_provider?: string
          metric_date: string
          presence_count?: number
          project_id: string
          response_count?: number
          tracking_location?: string
        }
        Update: {
          citation_count?: number
          competitor_id?: string
          created_at?: string
          llm_provider?: string
          metric_date?: string
          presence_count?: number
          project_id?: string
          response_count?: number
          tracking_location?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_competitor_observations_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "direct_competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_competitor_observations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_competitors: {
        Row: {
          aliases: string[]
          brand_name: string
          created_at: string
          first_seen_date: string
          id: string
          last_seen_date: string
          normalized_domain: string
          project_id: string
          topic: string
          website: string | null
        }
        Insert: {
          aliases?: string[]
          brand_name: string
          created_at?: string
          first_seen_date: string
          id?: string
          last_seen_date: string
          normalized_domain: string
          project_id: string
          topic: string
          website?: string | null
        }
        Update: {
          aliases?: string[]
          brand_name?: string
          created_at?: string
          first_seen_date?: string
          id?: string
          last_seen_date?: string
          normalized_domain?: string
          project_id?: string
          topic?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "direct_competitors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_configs: {
        Row: {
          api_key_encrypted: string | null
          api_key_last4: string | null
          api_key_secret_id: string | null
          created_at: string
          enabled: boolean
          id: string
          key_updated_at: string | null
          project_id: string
          provider: string
          updated_at: string
        }
        Insert: {
          api_key_encrypted?: string | null
          api_key_last4?: string | null
          api_key_secret_id?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          key_updated_at?: string | null
          project_id: string
          provider: string
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string | null
          api_key_last4?: string | null
          api_key_secret_id?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          key_updated_at?: string | null
          project_id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "llm_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_secrets: {
        Row: {
          ciphertext: string
          key_last4: string
          project_id: string
          provider: string
          updated_at: string
        }
        Insert: {
          ciphertext: string
          key_last4: string
          project_id: string
          provider: string
          updated_at?: string
        }
        Update: {
          ciphertext?: string
          key_last4?: string
          project_id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "llm_secrets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_permanent: boolean
          role: Database["public"]["Enums"]["app_role"]
          ui_preferences: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          is_permanent?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          ui_preferences?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_permanent?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          ui_preferences?: Json
          updated_at?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          project_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          project_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          project_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          brand_description: string | null
          brand_domains: string[]
          brand_logo_url: string | null
          brand_name: string
          brand_terms: string[]
          created_at: string
          created_by: string | null
          id: string
          topics: string[]
          tracking_locations: string[]
          tracking_market: string
          updated_at: string
        }
        Insert: {
          brand_description?: string | null
          brand_domains?: string[]
          brand_logo_url?: string | null
          brand_name: string
          brand_terms?: string[]
          created_at?: string
          created_by?: string | null
          id?: string
          topics?: string[]
          tracking_locations?: string[]
          tracking_market?: string
          updated_at?: string
        }
        Update: {
          brand_description?: string | null
          brand_domains?: string[]
          brand_logo_url?: string | null
          brand_name?: string
          brand_terms?: string[]
          created_at?: string
          created_by?: string | null
          id?: string
          topics?: string[]
          tracking_locations?: string[]
          tracking_market?: string
          updated_at?: string
        }
        Relationships: []
      }
      prompts: {
        Row: {
          active: boolean
          created_at: string
          id: string
          language: string
          project_id: string
          prompt: string
          prompt_number: number
          topic: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          language: string
          project_id: string
          prompt: string
          prompt_number: number
          topic: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          language?: string
          project_id?: string
          prompt?: string
          prompt_number?: number
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      response_brand_evidence: {
        Row: {
          brand_id: string
          confidence: string
          created_at: string
          evidence_text: string | null
          first_position: number | null
          id: string
          match_source: string
          matched_value: string
          occurrence_count: number
          project_id: string
          response_id: string
          topic: string
        }
        Insert: {
          brand_id: string
          confidence?: string
          created_at?: string
          evidence_text?: string | null
          first_position?: number | null
          id?: string
          match_source: string
          matched_value: string
          occurrence_count?: number
          project_id: string
          response_id: string
          topic: string
        }
        Update: {
          brand_id?: string
          confidence?: string
          created_at?: string
          evidence_text?: string | null
          first_position?: number | null
          id?: string
          match_source?: string
          matched_value?: string
          occurrence_count?: number
          project_id?: string
          response_id?: string
          topic?: string
        }
        Relationships: [
          {
            foreignKeyName: "response_brand_evidence_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "response_brand_evidence_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "response_brand_evidence_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "ai_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      third_party_mentions: {
        Row: {
          associated_brand_ids: string[]
          associated_brand_names: string[]
          association_status: string
          canonical_url: string
          created_at: string
          frequency: number
          hostname: string
          id: string
          llm_provider: string
          metric_date: string
          project_id: string
          response_id: string | null
          source_type: string
          topic: string
          tracking_location: string
          url: string
          website_name: string | null
        }
        Insert: {
          associated_brand_ids?: string[]
          associated_brand_names?: string[]
          association_status?: string
          canonical_url: string
          created_at?: string
          frequency?: number
          hostname: string
          id?: string
          llm_provider: string
          metric_date: string
          project_id: string
          response_id?: string | null
          source_type: string
          topic: string
          tracking_location?: string
          url: string
          website_name?: string | null
        }
        Update: {
          associated_brand_ids?: string[]
          associated_brand_names?: string[]
          association_status?: string
          canonical_url?: string
          created_at?: string
          frequency?: number
          hostname?: string
          id?: string
          llm_provider?: string
          metric_date?: string
          project_id?: string
          response_id?: string | null
          source_type?: string
          topic?: string
          tracking_location?: string
          url?: string
          website_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "third_party_mentions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "third_party_mentions_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "ai_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_brand_assignments: {
        Row: {
          aliases: string[]
          brand_id: string
          created_at: string
          include_in_metrics: boolean
          notes: string | null
          project_id: string
          role: string
          topic: string
          updated_at: string
          websites: string[]
        }
        Insert: {
          aliases?: string[]
          brand_id: string
          created_at?: string
          include_in_metrics?: boolean
          notes?: string | null
          project_id: string
          role?: string
          topic: string
          updated_at?: string
          websites?: string[]
        }
        Update: {
          aliases?: string[]
          brand_id?: string
          created_at?: string
          include_in_metrics?: boolean
          notes?: string | null
          project_id?: string
          role?: string
          topic?: string
          updated_at?: string
          websites?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "topic_brand_assignments_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_brand_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_brand_observations: {
        Row: {
          average_position: number | null
          brand_id: string
          citation_count: number
          created_at: string
          llm_provider: string
          mention_count: number
          metric_date: string
          presence_count: number
          project_id: string
          response_count: number
          topic: string
          tracking_location: string
        }
        Insert: {
          average_position?: number | null
          brand_id: string
          citation_count?: number
          created_at?: string
          llm_provider?: string
          mention_count?: number
          metric_date: string
          presence_count?: number
          project_id: string
          response_count?: number
          topic: string
          tracking_location?: string
        }
        Update: {
          average_position?: number | null
          brand_id?: string
          citation_count?: number
          created_at?: string
          llm_provider?: string
          mention_count?: number
          metric_date?: string
          presence_count?: number
          project_id?: string
          response_count?: number
          topic?: string
          tracking_location?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_brand_observations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_brand_observations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_batch_topics: {
        Row: {
          attempt_count: number
          batch_id: string
          completed_at: string | null
          id: string
          last_error: string | null
          ordinal: number
          started_at: string | null
          status: string
          topic: string
          tracking_run_id: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          batch_id: string
          completed_at?: string | null
          id?: string
          last_error?: string | null
          ordinal: number
          started_at?: string | null
          status?: string
          topic: string
          tracking_run_id?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          batch_id?: string
          completed_at?: string | null
          id?: string
          last_error?: string | null
          ordinal?: number
          started_at?: string | null
          status?: string
          topic?: string
          tracking_run_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_batch_topics_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "tracking_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_batch_topics_tracking_run_id_fkey"
            columns: ["tracking_run_id"]
            isOneToOne: false
            referencedRelation: "tracking_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_batches: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          project_id: string
          requested_by: string
          started_at: string | null
          status: string
          topic_order: Json
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          project_id: string
          requested_by: string
          started_at?: string | null
          status?: string
          topic_order?: Json
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          project_id?: string
          requested_by?: string
          started_at?: string | null
          status?: string
          topic_order?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_run_daily_claims: {
        Row: {
          created_at: string
          project_id: string
          run_date: string
          run_id: string
          started_by: string | null
        }
        Insert: {
          created_at?: string
          project_id: string
          run_date: string
          run_id: string
          started_by?: string | null
        }
        Update: {
          created_at?: string
          project_id?: string
          run_date?: string
          run_id?: string
          started_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tracking_run_daily_claims_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_run_daily_claims_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "tracking_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_run_stages: {
        Row: {
          attempt_count: number
          completed_at: string | null
          error_message: string | null
          metadata: Json
          run_id: string
          stage_key: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          error_message?: string | null
          metadata?: Json
          run_id: string
          stage_key: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          error_message?: string | null
          metadata?: Json
          run_id?: string
          stage_key?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_run_stages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "tracking_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_runs: {
        Row: {
          completed_at: string | null
          completed_prompts: number
          error_message: string | null
          failed_prompts: number
          id: string
          project_id: string
          provider: string
          published_at: string | null
          started_at: string
          started_by: string | null
          status: string
          supersedes_run_id: string | null
          topic: string | null
          total_prompts: number
          tracking_location: string
        }
        Insert: {
          completed_at?: string | null
          completed_prompts?: number
          error_message?: string | null
          failed_prompts?: number
          id?: string
          project_id: string
          provider?: string
          published_at?: string | null
          started_at?: string
          started_by?: string | null
          status?: string
          supersedes_run_id?: string | null
          topic?: string | null
          total_prompts?: number
          tracking_location?: string
        }
        Update: {
          completed_at?: string | null
          completed_prompts?: number
          error_message?: string | null
          failed_prompts?: number
          id?: string
          project_id?: string
          provider?: string
          published_at?: string | null
          started_at?: string
          started_by?: string | null
          status?: string
          supersedes_run_id?: string | null
          topic?: string | null
          total_prompts?: number
          tracking_location?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_runs_supersedes_run_id_fkey"
            columns: ["supersedes_run_id"]
            isOneToOne: false
            referencedRelation: "tracking_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      visibility_daily: {
        Row: {
          average_position: number | null
          average_position_rank: number | null
          citation_count: number
          created_at: string
          id: string
          llm_provider: string
          metric_date: string
          project_id: string
          share_of_voice_rank: number | null
          share_of_voice_score: number | null
          topic: string
          tracking_location: string
          visibility_rank: number | null
          visibility_score: number | null
        }
        Insert: {
          average_position?: number | null
          average_position_rank?: number | null
          citation_count?: number
          created_at?: string
          id?: string
          llm_provider?: string
          metric_date: string
          project_id: string
          share_of_voice_rank?: number | null
          share_of_voice_score?: number | null
          topic?: string
          tracking_location?: string
          visibility_rank?: number | null
          visibility_score?: number | null
        }
        Update: {
          average_position?: number | null
          average_position_rank?: number | null
          citation_count?: number
          created_at?: string
          id?: string
          llm_provider?: string
          metric_date?: string
          project_id?: string
          share_of_voice_rank?: number | null
          share_of_voice_score?: number | null
          topic?: string
          tracking_location?: string
          visibility_rank?: number | null
          visibility_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "visibility_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_edit_project: { Args: { p_project_id: string }; Returns: boolean }
      can_manage_project_members: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      canonicalize_citation_url: {
        Args: { input_url: string }
        Returns: string
      }
      claim_daily_tracking_run: {
        Args: {
          p_project_id: string
          p_run_id: string
          p_started_by: string
          p_total_prompts: number
        }
        Returns: {
          claimed: boolean
          run_date: string
          run_id: string
          started_at: string
          status: string
        }[]
      }
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_competitor_counts_for_period: {
        Args: {
          p_end_date: string
          p_project_id: string
          p_start_date: string
          p_tracking_location?: string
        }
        Returns: {
          competitor_count: number
          metric_date: string
          topic: string
        }[]
      }
      get_cumulative_citations: {
        Args: {
          p_brand_related_only?: boolean
          p_end_date: string
          p_engines?: string[]
          p_project_id: string
          p_start_date: string
          p_topic?: string
          p_tracking_location?: string
        }
        Returns: {
          brand_name: string
          frequency: number
          page_name: string
          url: string
        }[]
      }
      get_cumulative_competitors: {
        Args: {
          p_end_date: string
          p_engines?: string[]
          p_project_id: string
          p_start_date: string
          p_topic?: string
          p_tracking_location?: string
        }
        Returns: {
          brand_name: string
          citations: number
          visibility_score: number
          website: string
        }[]
      }
      get_direct_competitor_metrics_for_period: {
        Args: {
          p_end_date: string
          p_project_id: string
          p_start_date: string
          p_tracking_location?: string
        }
        Returns: {
          competitor_count: number
          metric_date: string
          topic: string
          visibility_rank: number
        }[]
      }
      get_latest_competitor_counts: {
        Args: { p_project_id: string; p_tracking_location?: string }
        Returns: {
          competitor_count: number
          metric_date: string
          topic: string
        }[]
      }
      get_third_party_mentions: {
        Args: {
          p_end_date: string
          p_engines?: string[]
          p_project_id: string
          p_start_date: string
          p_topic?: string
          p_tracking_location?: string
        }
        Returns: {
          brand_coverage: number
          example_url: string
          frequency: number
          hostname: string
          response_frequency: number
          source_types: string[]
          website_name: string
        }[]
      }
      is_project_member: { Args: { p_project_id: string }; Returns: boolean }
      is_superadmin: { Args: never; Returns: boolean }
      reconcile_stale_tracking_runs: { Args: never; Returns: number }
      save_my_ui_preferences: {
        Args: { p_preferences: Json }
        Returns: undefined
      }
      text_contains_any_term_boundary: {
        Args: { p_terms: string[]; p_text: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "superadmin" | "admin" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["superadmin", "admin", "viewer"],
    },
  },
} as const
