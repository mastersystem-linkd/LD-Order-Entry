CREATE TABLE "design_database" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid,
	"order_no" varchar(50) NOT NULL,
	"fabric_name" varchar(100) NOT NULL,
	"design_no" varchar(100) NOT NULL,
	CONSTRAINT "uq_design_database_order_fabric_design" UNIQUE("order_no","fabric_name","design_no")
);
--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD COLUMN "planned_offset_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "design_database" ADD CONSTRAINT "design_database_order_id_customer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_design_database_fabric" ON "design_database" USING btree ("fabric_name");--> statement-breakpoint
CREATE INDEX "idx_design_database_design" ON "design_database" USING btree ("design_no");--> statement-breakpoint
-- Time Tracking SLA defaults (editable in Settings → Time tracking).
UPDATE "workflow_stages" SET "planned_offset_days" = 3 WHERE "stage_key" = 'dispatch';--> statement-breakpoint
UPDATE "workflow_stages" SET "planned_offset_days" = 4 WHERE "stage_key" = 'received_lr';