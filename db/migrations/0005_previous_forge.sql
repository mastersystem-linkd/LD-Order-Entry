CREATE TABLE "ld_order_entry"."crm_followup_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"followup_id" uuid NOT NULL,
	"criterion_key" varchar(40) NOT NULL,
	"value" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crm_followup_ratings_value" CHECK (value between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "ld_order_entry"."crm_rating_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(40) NOT NULL,
	"label" varchar(80) NOT NULL,
	"hint" varchar(160),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ld_order_entry"."crm_issues" ALTER COLUMN "category" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "ld_order_entry"."crm_followup_ratings" ADD CONSTRAINT "crm_followup_ratings_followup_id_crm_followups_id_fk" FOREIGN KEY ("followup_id") REFERENCES "ld_order_entry"."crm_followups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_crm_followup_ratings" ON "ld_order_entry"."crm_followup_ratings" USING btree ("followup_id","criterion_key");--> statement-breakpoint
CREATE INDEX "idx_crm_followup_ratings_followup" ON "ld_order_entry"."crm_followup_ratings" USING btree ("followup_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_crm_rating_criteria_key" ON "ld_order_entry"."crm_rating_criteria" USING btree ("key");--> statement-breakpoint
ALTER TABLE "ld_order_entry"."crm_followups" DROP COLUMN "rating_delivery";--> statement-breakpoint
ALTER TABLE "ld_order_entry"."crm_followups" DROP COLUMN "rating_quality";--> statement-breakpoint
ALTER TABLE "ld_order_entry"."crm_followups" DROP COLUMN "rating_packing";--> statement-breakpoint
ALTER TABLE "ld_order_entry"."crm_followups" DROP COLUMN "rating_coordination";