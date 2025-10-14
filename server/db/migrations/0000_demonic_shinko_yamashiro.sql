CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_id" uuid NOT NULL,
	"issuer" varchar(35) NOT NULL,
	"subject" varchar(35) NOT NULL,
	"vc_document" jsonb NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"ipfs_cid" text,
	"xrpl_tx_hash" varchar(64),
	"xrpl_ledger_index" varchar(20),
	"credential_type" text NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL,
	"accepted_at" timestamp,
	"revoked" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schemas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"version" varchar(50) DEFAULT '1.0.0' NOT NULL,
	"fields" jsonb NOT NULL,
	"creator" varchar(35) NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"ipfs_cid" text,
	"parent_schema_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_schema_id_schemas_id_fk" FOREIGN KEY ("schema_id") REFERENCES "public"."schemas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schemas" ADD CONSTRAINT "schemas_parent_schema_id_schemas_id_fk" FOREIGN KEY ("parent_schema_id") REFERENCES "public"."schemas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credentials_issuer_idx" ON "credentials" USING btree ("issuer");--> statement-breakpoint
CREATE INDEX "credentials_subject_idx" ON "credentials" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "credentials_schema_idx" ON "credentials" USING btree ("schema_id");--> statement-breakpoint
CREATE INDEX "credentials_accepted_idx" ON "credentials" USING btree ("accepted");--> statement-breakpoint
CREATE INDEX "credentials_revoked_idx" ON "credentials" USING btree ("revoked");--> statement-breakpoint
CREATE INDEX "schemas_creator_idx" ON "schemas" USING btree ("creator");--> statement-breakpoint
CREATE INDEX "schemas_public_idx" ON "schemas" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX "schemas_parent_idx" ON "schemas" USING btree ("parent_schema_id");