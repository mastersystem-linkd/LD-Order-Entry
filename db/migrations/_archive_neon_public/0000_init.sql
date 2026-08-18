CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'SALES', 'OPS', 'VIEWER');--> statement-breakpoint
CREATE TABLE "customer_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_no" varchar(50) NOT NULL,
	"order_date" date NOT NULL,
	"party_name" varchar(200) NOT NULL,
	"sales_person" varchar(100),
	"agent" varchar(120),
	"haste" varchar(120),
	"transport" varchar(120),
	"challan_no" varchar(100),
	"lot_no" varchar(100),
	"department" varchar(40) DEFAULT 'LD' NOT NULL,
	"remarks" text,
	"created_by" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_orders_order_no_unique" UNIQUE("order_no")
);
--> statement-breakpoint
CREATE TABLE "line_stage_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_line_item_id" uuid NOT NULL,
	"stage_key" varchar(40) NOT NULL,
	"planned_at" timestamp with time zone,
	"actual_at" timestamp with time zone,
	"is_done" boolean DEFAULT false NOT NULL,
	"delay_minutes" integer,
	"updated_by" varchar(120),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_line_stage_progress_line_stage" UNIQUE("order_line_item_id","stage_key")
);
--> statement-breakpoint
CREATE TABLE "lookup_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(30) NOT NULL,
	"value" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"quality" varchar(100) NOT NULL,
	"design_no" varchar(100) NOT NULL,
	"qty_mtr" numeric(10, 2) NOT NULL,
	"rate" numeric(10, 2),
	"line_total" numeric(12, 2) GENERATED ALWAYS AS (qty_mtr * rate) STORED,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text,
	"name" varchar(200),
	"role" "user_role" DEFAULT 'VIEWER' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workflow_stages" (
	"stage_key" varchar(40) PRIMARY KEY NOT NULL,
	"label" varchar(60) NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "line_stage_progress" ADD CONSTRAINT "line_stage_progress_order_line_item_id_order_line_items_id_fk" FOREIGN KEY ("order_line_item_id") REFERENCES "public"."order_line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_stage_progress" ADD CONSTRAINT "line_stage_progress_stage_key_workflow_stages_stage_key_fk" FOREIGN KEY ("stage_key") REFERENCES "public"."workflow_stages"("stage_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_order_id_customer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customer_orders_party_name" ON "customer_orders" USING btree ("party_name");--> statement-breakpoint
CREATE INDEX "idx_customer_orders_order_date" ON "customer_orders" USING btree ("order_date");--> statement-breakpoint
CREATE INDEX "idx_line_stage_progress_line" ON "line_stage_progress" USING btree ("order_line_item_id");--> statement-breakpoint
CREATE INDEX "idx_lookup_values_category" ON "lookup_values" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_order_line_items_order_id" ON "order_line_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_order_line_items_quality_design" ON "order_line_items" USING btree ("quality","design_no");