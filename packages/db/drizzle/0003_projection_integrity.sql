SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "ledger_checkpoints" ADD CONSTRAINT "ledger_checkpoints_index_uint32" CHECK ("ledger_checkpoints"."ledger_index" BETWEEN 0 AND 4294967295) NOT VALID;--> statement-breakpoint
ALTER TABLE "ledger_checkpoints" ADD CONSTRAINT "ledger_checkpoints_close_time_uint32" CHECK ("ledger_checkpoints"."close_time" BETWEEN 0 AND 4294967295) NOT VALID;--> statement-breakpoint
ALTER TABLE "schema_events" ADD CONSTRAINT "schema_events_ledger_index_uint32" CHECK ("schema_events"."ledger_index" BETWEEN 0 AND 4294967295) NOT VALID;--> statement-breakpoint
ALTER TABLE "schemas" ADD CONSTRAINT "schemas_ledger_index_uint32" CHECK ("schemas"."ledger_index" BETWEEN 0 AND 4294967295) NOT VALID;--> statement-breakpoint
ALTER TABLE "schemas" ADD CONSTRAINT "schemas_transaction_index" CHECK ("schemas"."transaction_index" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "credential_generations" ADD CONSTRAINT "credential_generations_expiration_uint32" CHECK ("credential_generations"."expiration" IS NULL OR "credential_generations"."expiration" BETWEEN 0 AND 4294967295) NOT VALID;--> statement-breakpoint
ALTER TABLE "credential_generations" ADD CONSTRAINT "credential_generations_created_ledger_uint32" CHECK ("credential_generations"."created_ledger_index" BETWEEN 0 AND 4294967295) NOT VALID;--> statement-breakpoint
ALTER TABLE "credential_generations" ADD CONSTRAINT "credential_generations_created_transaction_index" CHECK ("credential_generations"."created_transaction_index" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "credential_generations" ADD CONSTRAINT "credential_generations_last_ledger_uint32" CHECK ("credential_generations"."last_ledger_index" BETWEEN 0 AND 4294967295) NOT VALID;--> statement-breakpoint
ALTER TABLE "credential_generations" ADD CONSTRAINT "credential_generations_deleted_ledger_uint32" CHECK ("credential_generations"."deleted_ledger_index" IS NULL OR "credential_generations"."deleted_ledger_index" BETWEEN 0 AND 4294967295) NOT VALID;--> statement-breakpoint
ALTER TABLE "credential_generations" ADD CONSTRAINT "credential_generations_ledger_order" CHECK ("credential_generations"."last_ledger_index" >= "credential_generations"."created_ledger_index"
          AND ("credential_generations"."deleted_ledger_index" IS NULL OR "credential_generations"."deleted_ledger_index" = "credential_generations"."last_ledger_index")) NOT VALID;--> statement-breakpoint
ALTER TABLE "credential_events" ADD CONSTRAINT "credential_events_generation_id" CHECK ("credential_events"."generation_id" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "credential_events" ADD CONSTRAINT "credential_events_node_index" CHECK ("credential_events"."node_index" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "credential_events" ADD CONSTRAINT "credential_events_ledger_index_uint32" CHECK ("credential_events"."ledger_index" BETWEEN 0 AND 4294967295) NOT VALID;--> statement-breakpoint
ALTER TABLE "credential_events" ADD CONSTRAINT "credential_events_transaction_index" CHECK ("credential_events"."transaction_index" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "credential_events" ADD CONSTRAINT "credential_events_expiration_uint32" CHECK ("credential_events"."expiration" IS NULL OR "credential_events"."expiration" BETWEEN 0 AND 4294967295) NOT VALID;
