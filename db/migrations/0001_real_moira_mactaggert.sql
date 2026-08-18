CREATE TABLE "ld_order_entry"."crr_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" integer NOT NULL,
	"alias" varchar(120),
	"full_raw_name" varchar(250) NOT NULL,
	"display_name" varchar(250) NOT NULL,
	"canon" varchar(250) NOT NULL,
	"tight" varchar(250) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_crr_customers_id_name" UNIQUE("customer_id","full_raw_name")
);
--> statement-breakpoint
ALTER TABLE "ld_order_entry"."customer_orders" ADD COLUMN "crr_customer_id" integer;--> statement-breakpoint
ALTER TABLE "ld_order_entry"."customer_orders" ADD COLUMN "party_name_original" varchar(200);--> statement-breakpoint
ALTER TABLE "ld_order_entry"."customer_orders" ADD COLUMN "haste_original" varchar(120);--> statement-breakpoint
CREATE INDEX "idx_crr_customers_canon" ON "ld_order_entry"."crr_customers" USING btree ("canon");--> statement-breakpoint
CREATE INDEX "idx_crr_customers_tight" ON "ld_order_entry"."crr_customers" USING btree ("tight");--> statement-breakpoint
CREATE INDEX "idx_crr_customers_customer_id" ON "ld_order_entry"."crr_customers" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_customer_orders_crr_customer" ON "ld_order_entry"."customer_orders" USING btree ("crr_customer_id");