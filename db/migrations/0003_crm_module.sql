ALTER TYPE "ld_order_entry"."user_role" ADD VALUE 'CRM';--> statement-breakpoint
CREATE TABLE "ld_order_entry"."crm_followup_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"followup_id" uuid NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" varchar(20) NOT NULL,
	"outcome" varchar(30) NOT NULL,
	"note" text,
	"created_by" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ld_order_entry"."crm_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_no" varchar(50) NOT NULL,
	"crr_customer_id" integer,
	"status" varchar(20) DEFAULT 'DUE' NOT NULL,
	"delivery_basis" varchar(20),
	"delivered_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"contacted_at" timestamp with time zone,
	"assigned_to" uuid,
	"contact_person" varchar(120),
	"contact_phone" varchar(30),
	"system_on_time" boolean,
	"customer_says_on_time" boolean,
	"delay_reason" varchar(30),
	"rating_delivery" smallint,
	"rating_quality" smallint,
	"rating_packing" smallint,
	"rating_coordination" smallint,
	"rating_overall" smallint,
	"rating_source" varchar(20),
	"reorder_intent" varchar(20) DEFAULT 'none' NOT NULL,
	"reorder_note" text,
	"delivered_line_ids" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"is_escalated" boolean DEFAULT false NOT NULL,
	"created_by" varchar(120),
	"completed_by" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_crm_followups_order" UNIQUE("order_id"),
	CONSTRAINT "ck_crm_followups_completed_rating" CHECK (status <> 'COMPLETED' OR rating_overall IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ld_order_entry"."crm_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"followup_id" uuid NOT NULL,
	"order_id" uuid,
	"order_line_item_id" uuid,
	"quality" varchar(100),
	"design_no" varchar(100),
	"category" varchar(30) NOT NULL,
	"severity" varchar(10) NOT NULL,
	"qty_affected" numeric(10, 2),
	"description" text,
	"owner_dept" varchar(30),
	"status" varchar(20) DEFAULT 'OPEN' NOT NULL,
	"resolution" varchar(30),
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" varchar(120),
	"created_by" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ld_order_entry"."crm_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transit_days_default" integer DEFAULT 3 NOT NULL,
	"followup_due_days" integer DEFAULT 2 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"escalate_rating_at" smallint DEFAULT 2 NOT NULL,
	"auto_create_followups" boolean DEFAULT true NOT NULL,
	"transport_transit_days" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ld_order_entry"."crm_followup_attempts" ADD CONSTRAINT "crm_followup_attempts_followup_id_crm_followups_id_fk" FOREIGN KEY ("followup_id") REFERENCES "ld_order_entry"."crm_followups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ld_order_entry"."crm_followups" ADD CONSTRAINT "crm_followups_order_id_customer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ld_order_entry"."customer_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ld_order_entry"."crm_followups" ADD CONSTRAINT "crm_followups_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "ld_order_entry"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ld_order_entry"."crm_issues" ADD CONSTRAINT "crm_issues_followup_id_crm_followups_id_fk" FOREIGN KEY ("followup_id") REFERENCES "ld_order_entry"."crm_followups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ld_order_entry"."crm_issues" ADD CONSTRAINT "crm_issues_order_line_item_id_order_line_items_id_fk" FOREIGN KEY ("order_line_item_id") REFERENCES "ld_order_entry"."order_line_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_crm_followup_attempts_followup" ON "ld_order_entry"."crm_followup_attempts" USING btree ("followup_id");--> statement-breakpoint
CREATE INDEX "idx_crm_followups_status" ON "ld_order_entry"."crm_followups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_crm_followups_due_at" ON "ld_order_entry"."crm_followups" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "idx_crm_followups_crr_customer" ON "ld_order_entry"."crm_followups" USING btree ("crr_customer_id");--> statement-breakpoint
CREATE INDEX "idx_crm_followups_rating_overall" ON "ld_order_entry"."crm_followups" USING btree ("rating_overall");--> statement-breakpoint
CREATE INDEX "idx_crm_issues_status" ON "ld_order_entry"."crm_issues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_crm_issues_category" ON "ld_order_entry"."crm_issues" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_crm_issues_owner_dept" ON "ld_order_entry"."crm_issues" USING btree ("owner_dept");--> statement-breakpoint
CREATE INDEX "idx_crm_issues_order" ON "ld_order_entry"."crm_issues" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_crm_issues_followup" ON "ld_order_entry"."crm_issues" USING btree ("followup_id");