CREATE TABLE "indexer_incidents" (
	"profile_id" text NOT NULL,
	"writer_epoch" bigint NOT NULL,
	"error_code" text NOT NULL,
	"primary_source_tip" bigint,
	"secondary_source_tip" bigint,
	"last_agreed_ledger_index" bigint,
	"last_agreed_ledger_hash" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexer_incidents_pk" PRIMARY KEY("profile_id","writer_epoch"),
	CONSTRAINT "indexer_incidents_writer_epoch" CHECK ("indexer_incidents"."writer_epoch" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "indexer_incidents_error_code" CHECK ("indexer_incidents"."error_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
	CONSTRAINT "indexer_incidents_primary_tip" CHECK ("indexer_incidents"."primary_source_tip" IS NULL OR "indexer_incidents"."primary_source_tip" BETWEEN 0 AND 4294967295),
	CONSTRAINT "indexer_incidents_secondary_tip" CHECK ("indexer_incidents"."secondary_source_tip" IS NULL OR "indexer_incidents"."secondary_source_tip" BETWEEN 0 AND 4294967295),
	CONSTRAINT "indexer_incidents_agreed_ledger" CHECK (("indexer_incidents"."last_agreed_ledger_index" IS NULL AND "indexer_incidents"."last_agreed_ledger_hash" IS NULL)
          OR ("indexer_incidents"."last_agreed_ledger_index" IS NOT NULL
          AND "indexer_incidents"."last_agreed_ledger_hash" IS NOT NULL
          AND "indexer_incidents"."last_agreed_ledger_index" BETWEEN 0 AND 4294967295
          AND "indexer_incidents"."last_agreed_ledger_hash" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "indexer_incidents" ADD CONSTRAINT "indexer_incidents_profile_id_network_profiles_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."network_profiles"("profile_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "public"."indexer_incidents" FROM PUBLIC;
--> statement-breakpoint
DO $xcs_incident_grants$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xcs_indexer') THEN
		GRANT SELECT, INSERT ON TABLE "public"."indexer_incidents" TO xcs_indexer;
	END IF;
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xcs_api') THEN
		GRANT SELECT ON TABLE "public"."indexer_incidents" TO xcs_api;
	END IF;
END
$xcs_incident_grants$;
