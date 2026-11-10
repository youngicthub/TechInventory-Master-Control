CREATE TYPE "public"."customer_type" AS ENUM('retail', 'wholesale', 'distributor', 'business', 'other');
CREATE TYPE "public"."otp_purpose" AS ENUM('admin_registration', 'password_reset');
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank_transfer', 'pos', 'credit');
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'partially_paid', 'paid');
CREATE TYPE "public"."sale_status" AS ENUM('completed', 'credit', 'partially_paid', 'reversed');
CREATE TYPE "public"."stock_movement_type" AS ENUM('opening_stock', 'sale', 'supply', 'return', 'damage', 'loss', 'adjustment_in', 'adjustment_out', 'transfer');
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'admin', 'manager', 'accountant', 'store_keeper', 'sales_cashier', 'inventory_officer', 'viewer');
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shift_start" text,
	"shift_end" text,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "staff_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"signed_in_at" timestamp DEFAULT now() NOT NULL,
	"signed_out_at" timestamp,
	"end_reason" text
);

CREATE TABLE "otp_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"code_hash" text NOT NULL,
	"payload" jsonb,
	"user_id" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "supplier_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"delivery_number" text NOT NULL,
	"supplier_id" integer NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"amount_paid" numeric(12, 2) DEFAULT '0' NOT NULL,
	"balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"staff_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "supplier_delivery_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"delivery_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"unit" text NOT NULL,
	"quantity" integer NOT NULL,
	"base_unit_quantity" integer NOT NULL,
	"unit_cost" numeric(12, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL
);

CREATE TABLE "supplier_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_number" text NOT NULL,
	"supplier_id" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"notes" text,
	"staff_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"business_name" text,
	"phone" text NOT NULL,
	"email" text,
	"address" text,
	"opening_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"balance_owed" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "product_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_categories_name_unique" UNIQUE("name")
);

CREATE TABLE "product_packaging" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"unit_name" text NOT NULL,
	"base_unit_quantity" integer NOT NULL,
	"is_default_sale_unit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" text DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"category_id" integer NOT NULL,
	"description" text,
	"barcode" text,
	"image_url" text,
	"base_unit" text NOT NULL,
	"cost_price" numeric(12, 2) NOT NULL,
	"selling_price" numeric(12, 2) NOT NULL,
	"wholesale_price" numeric(12, 2),
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"min_stock" integer DEFAULT 0 NOT NULL,
	"max_stock" integer,
	"current_stock" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"type" "stock_movement_type" NOT NULL,
	"quantity" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" integer,
	"user_id" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "customer_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_number" text NOT NULL,
	"customer_id" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"notes" text,
	"staff_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" text DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"business_name" text,
	"phone" text NOT NULL,
	"email" text,
	"address" text,
	"type" "customer_type" DEFAULT 'retail' NOT NULL,
	"credit_limit" numeric(12, 2) DEFAULT '0' NOT NULL,
	"opening_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"outstanding_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_number" text NOT NULL,
	"sale_id" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "sale_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"unit" text NOT NULL,
	"quantity" integer NOT NULL,
	"base_unit_quantity" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	"unit_cost" numeric(12, 2)
);

CREATE TABLE "sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" text DEFAULT gen_random_uuid() NOT NULL,
	"receipt_number" text NOT NULL,
	"customer_id" integer,
	"subtotal" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"paid_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" "sale_status" DEFAULT 'completed' NOT NULL,
	"staff_id" integer NOT NULL,
	"notes" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "expense_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "expense_categories_name_unique" UNIQUE("name")
);

CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"date" date NOT NULL,
	"method" "payment_method" NOT NULL,
	"staff_id" integer NOT NULL,
	"reference" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" integer,
	"description" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "sale_return_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_id" integer NOT NULL,
	"sale_item_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"base_unit_quantity" integer NOT NULL,
	"value" numeric(12, 2) NOT NULL
);

CREATE TABLE "sale_returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_number" text NOT NULL,
	"sale_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"return_value" numeric(12, 2) NOT NULL,
	"balance_reduced" numeric(12, 2) DEFAULT '0' NOT NULL,
	"refund_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"refund_method" text,
	"restocked" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "cash_shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opening_cash" numeric(12, 2) DEFAULT '0' NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"expected_cash" numeric(12, 2),
	"counted_cash" numeric(12, 2),
	"variance" numeric(12, 2),
	"notes" text
);

ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "supplier_deliveries" ADD CONSTRAINT "supplier_deliveries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "supplier_deliveries" ADD CONSTRAINT "supplier_deliveries_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "supplier_delivery_items" ADD CONSTRAINT "supplier_delivery_items_delivery_id_supplier_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."supplier_deliveries"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "supplier_delivery_items" ADD CONSTRAINT "supplier_delivery_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "product_packaging" ADD CONSTRAINT "product_packaging_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "sales" ADD CONSTRAINT "sales_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_return_id_sale_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sale_returns"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_sale_item_id_sale_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
CREATE UNIQUE INDEX "users_phone_idx" ON "users" USING btree ("phone");
CREATE INDEX "staff_sessions_user_idx" ON "staff_sessions" USING btree ("user_id");
CREATE INDEX "staff_sessions_signed_in_idx" ON "staff_sessions" USING btree ("signed_in_at");
CREATE UNIQUE INDEX "supplier_deliveries_number_idx" ON "supplier_deliveries" USING btree ("delivery_number");
CREATE INDEX "supplier_deliveries_supplier_idx" ON "supplier_deliveries" USING btree ("supplier_id");
CREATE INDEX "supplier_deliveries_created_idx" ON "supplier_deliveries" USING btree ("created_at");
CREATE INDEX "supplier_delivery_items_delivery_idx" ON "supplier_delivery_items" USING btree ("delivery_id");
CREATE UNIQUE INDEX "supplier_payments_number_idx" ON "supplier_payments" USING btree ("payment_number");
CREATE INDEX "supplier_payments_supplier_idx" ON "supplier_payments" USING btree ("supplier_id");
CREATE INDEX "suppliers_phone_idx" ON "suppliers" USING btree ("phone");
CREATE INDEX "suppliers_name_idx" ON "suppliers" USING btree ("name");
CREATE INDEX "product_packaging_product_idx" ON "product_packaging" USING btree ("product_id");
CREATE UNIQUE INDEX "products_sku_idx" ON "products" USING btree ("sku");
CREATE UNIQUE INDEX "products_uuid_idx" ON "products" USING btree ("uuid");
CREATE UNIQUE INDEX "products_barcode_idx" ON "products" USING btree ("barcode") WHERE "products"."barcode" IS NOT NULL;
CREATE INDEX "products_name_idx" ON "products" USING btree ("name");
CREATE INDEX "products_updated_idx" ON "products" USING btree ("updated_at");
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");
CREATE INDEX "stock_movements_product_idx" ON "stock_movements" USING btree ("product_id","created_at");
CREATE INDEX "stock_movements_reference_idx" ON "stock_movements" USING btree ("reference_type","reference_id");
CREATE INDEX "stock_movements_created_idx" ON "stock_movements" USING btree ("created_at");
CREATE UNIQUE INDEX "customer_payments_number_idx" ON "customer_payments" USING btree ("payment_number");
CREATE INDEX "customer_payments_customer_idx" ON "customer_payments" USING btree ("customer_id");
CREATE UNIQUE INDEX "customers_uuid_idx" ON "customers" USING btree ("uuid");
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");
CREATE INDEX "customers_name_idx" ON "customers" USING btree ("name");
CREATE UNIQUE INDEX "payments_number_idx" ON "payments" USING btree ("payment_number");
CREATE INDEX "payments_sale_idx" ON "payments" USING btree ("sale_id");
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");
CREATE UNIQUE INDEX "sales_receipt_number_idx" ON "sales" USING btree ("receipt_number");
CREATE UNIQUE INDEX "sales_uuid_idx" ON "sales" USING btree ("uuid");
CREATE INDEX "sales_customer_idx" ON "sales" USING btree ("customer_id");
CREATE INDEX "sales_created_idx" ON "sales" USING btree ("created_at");
CREATE INDEX "sales_occurred_idx" ON "sales" USING btree ("occurred_at");
CREATE INDEX "sales_status_idx" ON "sales" USING btree ("status");
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("date");
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category_id");
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");
CREATE INDEX "sale_return_items_return_idx" ON "sale_return_items" USING btree ("return_id");
CREATE INDEX "sale_return_items_item_idx" ON "sale_return_items" USING btree ("sale_item_id");
CREATE UNIQUE INDEX "sale_returns_number_idx" ON "sale_returns" USING btree ("return_number");
CREATE INDEX "sale_returns_sale_idx" ON "sale_returns" USING btree ("sale_id");
CREATE INDEX "sale_returns_created_idx" ON "sale_returns" USING btree ("created_at");
CREATE INDEX "cash_shifts_staff_idx" ON "cash_shifts" USING btree ("staff_id","status");
CREATE INDEX "cash_shifts_opened_idx" ON "cash_shifts" USING btree ("opened_at");
CREATE UNIQUE INDEX "cash_shifts_one_open_idx" ON "cash_shifts" USING btree ("staff_id") WHERE "cash_shifts"."status" = 'open';
