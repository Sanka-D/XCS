CREATE TABLE "indexer_status" (
	"profile_id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"primary_source_tip" bigint,
	"secondary_source_tip" bigint,
	"last_agreed_ledger_index" bigint,
	"last_agreed_ledger_hash" text,
	"error_code" text,
	"writer_id" text,
	"writer_epoch" bigint NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexer_status_state" CHECK ("indexer_status"."state" IN ('starting', 'catching_up', 'ready', 'halted')),
	CONSTRAINT "indexer_status_primary_tip" CHECK ("indexer_status"."primary_source_tip" IS NULL OR "indexer_status"."primary_source_tip" BETWEEN 0 AND 4294967295),
	CONSTRAINT "indexer_status_secondary_tip" CHECK ("indexer_status"."secondary_source_tip" IS NULL OR "indexer_status"."secondary_source_tip" BETWEEN 0 AND 4294967295),
	CONSTRAINT "indexer_status_agreed_ledger" CHECK (("indexer_status"."last_agreed_ledger_index" IS NULL AND "indexer_status"."last_agreed_ledger_hash" IS NULL)
          OR ("indexer_status"."last_agreed_ledger_index" IS NOT NULL
          AND "indexer_status"."last_agreed_ledger_hash" IS NOT NULL
          AND "indexer_status"."last_agreed_ledger_index" BETWEEN 0 AND 4294967295
          AND "indexer_status"."last_agreed_ledger_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "indexer_status_agreed_not_ahead" CHECK ("indexer_status"."state" = 'halted'
          OR "indexer_status"."last_agreed_ledger_index" IS NULL
          OR (("indexer_status"."primary_source_tip" IS NULL OR "indexer_status"."last_agreed_ledger_index" <= "indexer_status"."primary_source_tip")
          AND ("indexer_status"."secondary_source_tip" IS NULL OR "indexer_status"."last_agreed_ledger_index" <= "indexer_status"."secondary_source_tip"))),
	CONSTRAINT "indexer_status_ready_shape" CHECK ("indexer_status"."state" <> 'ready'
          OR ("indexer_status"."primary_source_tip" IS NOT NULL
          AND "indexer_status"."secondary_source_tip" IS NOT NULL
          AND "indexer_status"."last_agreed_ledger_index" IS NOT NULL
          AND "indexer_status"."last_agreed_ledger_hash" IS NOT NULL
          AND "indexer_status"."writer_id" IS NOT NULL
          AND "indexer_status"."lease_expires_at" IS NOT NULL
          AND "indexer_status"."last_agreed_ledger_index" = LEAST("indexer_status"."primary_source_tip", "indexer_status"."secondary_source_tip"))),
	CONSTRAINT "indexer_status_error_code" CHECK ("indexer_status"."error_code" IS NULL OR "indexer_status"."error_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
	CONSTRAINT "indexer_status_error_shape" CHECK (("indexer_status"."state" = 'halted' AND "indexer_status"."error_code" IS NOT NULL)
          OR ("indexer_status"."state" <> 'halted' AND "indexer_status"."error_code" IS NULL)),
	CONSTRAINT "indexer_status_writer_id" CHECK ("indexer_status"."writer_id" IS NULL OR "indexer_status"."writer_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
	CONSTRAINT "indexer_status_writer_epoch" CHECK ("indexer_status"."writer_epoch" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "indexer_status_lease_window" CHECK (("indexer_status"."writer_id" IS NULL AND "indexer_status"."lease_expires_at" IS NULL)
          OR ("indexer_status"."writer_id" IS NOT NULL
          AND "indexer_status"."lease_expires_at" IS NOT NULL
          AND "indexer_status"."lease_expires_at" >= "indexer_status"."updated_at"
          AND "indexer_status"."lease_expires_at" <= "indexer_status"."updated_at" + interval '5 minutes'))
);
--> statement-breakpoint
ALTER TABLE "ledger_checkpoints" ADD COLUMN "transaction_root" text;--> statement-breakpoint
ALTER TABLE "indexer_status" ADD CONSTRAINT "indexer_status_profile_id_network_profiles_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."network_profiles"("profile_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_checkpoints" ADD CONSTRAINT "ledger_checkpoints_transaction_root" CHECK ("ledger_checkpoints"."transaction_root" IS NULL OR "ledger_checkpoints"."transaction_root" ~ '^[0-9a-f]{64}$');