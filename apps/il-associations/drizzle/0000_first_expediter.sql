CREATE TABLE "agent_classification_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"action" text NOT NULL,
	"previous_category" text,
	"new_category" text,
	"previous_note" text,
	"new_note" text,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "association_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"import_run_id" integer NOT NULL,
	"association_id" integer,
	"file_number" text NOT NULL,
	"entity_family" text NOT NULL,
	"legal_name" text NOT NULL,
	"agent_name_exact" text,
	"agent_grouping_key" text,
	"status_code_raw" text,
	"source_run_date" date,
	"record_hash" text NOT NULL,
	"change_type" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "associations" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_number" text NOT NULL,
	"entity_family" text NOT NULL,
	"legal_name" text NOT NULL,
	"legal_name_normalized" text NOT NULL,
	"has_multiple_name_records" boolean DEFAULT false NOT NULL,
	"entity_type_code_raw" text,
	"entity_type_label" text,
	"inclusion_rule_set_id" integer NOT NULL,
	"inclusion_signals" jsonb NOT NULL,
	"agent_name_exact" text,
	"agent_grouping_key" text,
	"agent_organization_id" integer,
	"agent_street" text,
	"agent_city" text,
	"agent_state" text,
	"agent_zip" text,
	"agent_county" text,
	"registered_office_street" text,
	"registered_office_city" text,
	"registered_office_state" text,
	"registered_office_zip" text,
	"organization_date" date,
	"effective_date" date,
	"extended_date" date,
	"status_code_raw" text,
	"status_label" text DEFAULT 'Source code not yet mapped.' NOT NULL,
	"status_is_mapped" boolean DEFAULT false NOT NULL,
	"source_bundle_id" integer NOT NULL,
	"source_run_date" date,
	"record_hash" text NOT NULL,
	"raw_source" jsonb NOT NULL,
	"first_seen_import_run_id" integer,
	"last_import_run_id" integer,
	"is_current" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_table" text NOT NULL,
	"entity_id" text,
	"field_changes" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"filters" jsonb NOT NULL,
	"classification_mode" text DEFAULT 'effective' NOT NULL,
	"rule_set_version" integer,
	"denominator" integer,
	"row_count" integer,
	"data_as_of" date,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"segmented" boolean DEFAULT false NOT NULL,
	"requested_by" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_errors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"import_run_id" integer NOT NULL,
	"source_file_id" integer,
	"family" text,
	"file_kind" text,
	"record_number" integer,
	"file_number" text,
	"severity" text DEFAULT 'error' NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"raw_excerpt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_file_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_run_id" integer NOT NULL,
	"source_file_id" integer NOT NULL,
	"records_loaded" integer DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"bundle_id" integer NOT NULL,
	"rule_set_id" integer NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"phase" text DEFAULT 'queued' NOT NULL,
	"counts" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bundle_digest" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"triggered_by" text,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inclusion_rule_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"rules" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_layouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"family" text NOT NULL,
	"file_kind" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'unconfirmed' NOT NULL,
	"record_length" integer,
	"header" jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_document" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registered_agent_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"alias_exact_name" text NOT NULL,
	"alias_grouping_key" text NOT NULL,
	"note" text,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registered_agent_organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"grouping_key" text NOT NULL,
	"canonical_source_name" text NOT NULL,
	"display_name" text,
	"automatic_category" text NOT NULL,
	"automatic_confidence" text NOT NULL,
	"automatic_explanation" text NOT NULL,
	"automatic_matched_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"override_category" text,
	"override_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"effective_category" text GENERATED ALWAYS AS (coalesce(override_category, automatic_category)) STORED NOT NULL,
	"merged_into_id" integer,
	"association_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_bundles" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"earliest_run_date" date,
	"latest_run_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"bundle_id" integer NOT NULL,
	"family" text NOT NULL,
	"file_kind" text NOT NULL,
	"original_filename" text NOT NULL,
	"container_format" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"header_line" text,
	"source_run_date" date,
	"run_date_is_operator_supplied" boolean DEFAULT false NOT NULL,
	"record_count" integer,
	"layout_id" integer,
	"inspection" jsonb,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staging_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"import_run_id" integer NOT NULL,
	"family" text NOT NULL,
	"file_kind" text NOT NULL,
	"file_number" text NOT NULL,
	"record_number" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"unmapped" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"record_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'analyst' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_classification_reviews" ADD CONSTRAINT "agent_classification_reviews_organization_id_registered_agent_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."registered_agent_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_snapshots" ADD CONSTRAINT "association_snapshots_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_snapshots" ADD CONSTRAINT "association_snapshots_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "associations" ADD CONSTRAINT "associations_inclusion_rule_set_id_inclusion_rule_sets_id_fk" FOREIGN KEY ("inclusion_rule_set_id") REFERENCES "public"."inclusion_rule_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "associations" ADD CONSTRAINT "associations_agent_organization_id_registered_agent_organizations_id_fk" FOREIGN KEY ("agent_organization_id") REFERENCES "public"."registered_agent_organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "associations" ADD CONSTRAINT "associations_source_bundle_id_source_bundles_id_fk" FOREIGN KEY ("source_bundle_id") REFERENCES "public"."source_bundles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "associations" ADD CONSTRAINT "associations_first_seen_import_run_id_import_runs_id_fk" FOREIGN KEY ("first_seen_import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "associations" ADD CONSTRAINT "associations_last_import_run_id_import_runs_id_fk" FOREIGN KEY ("last_import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_source_file_id_source_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."source_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_file_progress" ADD CONSTRAINT "import_file_progress_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_file_progress" ADD CONSTRAINT "import_file_progress_source_file_id_source_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."source_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_bundle_id_source_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."source_bundles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_rule_set_id_inclusion_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."inclusion_rule_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registered_agent_aliases" ADD CONSTRAINT "registered_agent_aliases_organization_id_registered_agent_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."registered_agent_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_bundle_id_source_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."source_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_layout_id_record_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."record_layouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_records" ADD CONSTRAINT "staging_records_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_reviews_org" ON "agent_classification_reviews" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_reviews_created" ON "agent_classification_reviews" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "association_snapshots_run" ON "association_snapshots" USING btree ("import_run_id");--> statement-breakpoint
CREATE INDEX "association_snapshots_identity" ON "association_snapshots" USING btree ("file_number","entity_family");--> statement-breakpoint
CREATE INDEX "association_snapshots_change" ON "association_snapshots" USING btree ("import_run_id","change_type");--> statement-breakpoint
CREATE UNIQUE INDEX "associations_source_identity_unique" ON "associations" USING btree ("file_number","entity_family");--> statement-breakpoint
CREATE INDEX "associations_name_normalized" ON "associations" USING btree ("legal_name_normalized");--> statement-breakpoint
CREATE INDEX "associations_agent_grouping_key" ON "associations" USING btree ("agent_grouping_key");--> statement-breakpoint
CREATE INDEX "associations_agent_org" ON "associations" USING btree ("agent_organization_id");--> statement-breakpoint
CREATE INDEX "associations_family" ON "associations" USING btree ("entity_family");--> statement-breakpoint
CREATE INDEX "associations_rule_set" ON "associations" USING btree ("inclusion_rule_set_id");--> statement-breakpoint
CREATE INDEX "associations_import_run" ON "associations" USING btree ("last_import_run_id");--> statement-breakpoint
CREATE INDEX "associations_run_date" ON "associations" USING btree ("source_run_date");--> statement-breakpoint
CREATE INDEX "associations_status_code" ON "associations" USING btree ("status_code_raw");--> statement-breakpoint
CREATE INDEX "associations_current" ON "associations" USING btree ("is_current");--> statement-breakpoint
CREATE INDEX "associations_agent_exact" ON "associations" USING btree ("agent_name_exact");--> statement-breakpoint
CREATE INDEX "audit_log_entity" ON "audit_log" USING btree ("entity_table","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_created" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor" ON "audit_log" USING btree ("actor");--> statement-breakpoint
CREATE INDEX "export_runs_kind" ON "export_runs" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "export_runs_created" ON "export_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "import_errors_run" ON "import_errors" USING btree ("import_run_id");--> statement-breakpoint
CREATE INDEX "import_errors_code" ON "import_errors" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "import_file_progress_unique" ON "import_file_progress" USING btree ("import_run_id","source_file_id");--> statement-breakpoint
CREATE INDEX "import_runs_bundle" ON "import_runs" USING btree ("bundle_id");--> statement-breakpoint
CREATE INDEX "import_runs_status" ON "import_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "import_runs_digest" ON "import_runs" USING btree ("bundle_digest","mode");--> statement-breakpoint
CREATE UNIQUE INDEX "inclusion_rule_sets_version_unique" ON "inclusion_rule_sets" USING btree ("version");--> statement-breakpoint
CREATE INDEX "inclusion_rule_sets_active" ON "inclusion_rule_sets" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "record_layouts_family_kind_version" ON "record_layouts" USING btree ("family","file_kind","version");--> statement-breakpoint
CREATE INDEX "record_layouts_active" ON "record_layouts" USING btree ("family","file_kind","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_aliases_key_unique" ON "registered_agent_aliases" USING btree ("alias_grouping_key");--> statement-breakpoint
CREATE INDEX "agent_aliases_org" ON "registered_agent_aliases" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_orgs_grouping_key_unique" ON "registered_agent_organizations" USING btree ("grouping_key");--> statement-breakpoint
CREATE INDEX "agent_orgs_automatic_category" ON "registered_agent_organizations" USING btree ("automatic_category");--> statement-breakpoint
CREATE INDEX "agent_orgs_effective_category" ON "registered_agent_organizations" USING btree ("effective_category");--> statement-breakpoint
CREATE INDEX "agent_orgs_count" ON "registered_agent_organizations" USING btree ("association_count");--> statement-breakpoint
CREATE INDEX "agent_orgs_merged_into" ON "registered_agent_organizations" USING btree ("merged_into_id");--> statement-breakpoint
CREATE INDEX "source_bundles_status" ON "source_bundles" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "source_files_bundle_slot_unique" ON "source_files" USING btree ("bundle_id","family","file_kind");--> statement-breakpoint
CREATE INDEX "source_files_sha256" ON "source_files" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "staging_records_join" ON "staging_records" USING btree ("import_run_id","family","file_kind","file_number");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));