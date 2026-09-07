CREATE TABLE "agent_share_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_run_id" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_run_date" date,
	"grouping_key" text NOT NULL,
	"display_name" text NOT NULL,
	"effective_category" text,
	"association_count" integer NOT NULL,
	"denominator" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_share_history" ADD CONSTRAINT "agent_share_history_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_share_history_agent" ON "agent_share_history" USING btree ("grouping_key","captured_at");--> statement-breakpoint
CREATE INDEX "agent_share_history_run" ON "agent_share_history" USING btree ("import_run_id");