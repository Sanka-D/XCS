package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/XRPL-Commons/xcs/verifier-go/xcs"
)

func read(path string) []byte {
	data, err := os.ReadFile(path)
	if err != nil {
		fatal(err)
	}
	return data
}

func write(value any) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		fatal(err)
	}
}

func fatal(err error) {
	var protocolError *xcs.Error
	if errors.As(err, &protocolError) {
		_ = json.NewEncoder(os.Stderr).Encode(protocolError)
	} else {
		_ = json.NewEncoder(os.Stderr).Encode(map[string]string{
			"code": "INTERNAL", "message": err.Error(),
		})
	}
	os.Exit(1)
}

func usage() {
	fmt.Fprintln(os.Stderr, `Offline XCS v0.1 verifier

Usage:
  xcs-verify uid UID_INPUT.json
  xcs-verify schema SCHEMA.json
  xcs-verify claims SCHEMA.json CLAIMS.json
  xcs-verify claims --catalog CATALOG.json CLAIMS.json
  xcs-verify catalog CATALOG.json
  xcs-verify payload SCHEMA.json PAYLOAD.json URI ISSUER SUBJECT SCHEMA_UID
  xcs-verify payload --catalog CATALOG.json PAYLOAD.json URI ISSUER SUBJECT SCHEMA_UID`)
	os.Exit(2)
}

func verifyClaims(schemaData []byte, claimsData []byte) error {
	schema, err := xcs.ParseSchema(schemaData)
	if err != nil {
		return err
	}
	claims, err := xcs.ParseJSON(claimsData)
	if err != nil {
		return err
	}
	return xcs.ValidateClaimsAgainstSchema(claims, schema)
}

func resolveCatalog(data []byte) (xcs.ResolvedSchemaCatalogBundleV1, error) {
	catalog, err := xcs.ParseSchemaCatalogBundle(data)
	if err != nil {
		return xcs.ResolvedSchemaCatalogBundleV1{}, err
	}
	return xcs.ResolveSchemaCatalogBundle(catalog)
}

func verifyCatalogClaims(catalogData []byte, claimsData []byte) error {
	resolved, err := resolveCatalog(catalogData)
	if err != nil {
		return err
	}
	claims, err := xcs.ParseJSON(claimsData)
	if err != nil {
		return err
	}
	return xcs.ValidateClaims(claims, resolved.ResolvedTarget.Fields)
}

func main() {
	if len(os.Args) < 3 {
		usage()
	}
	switch os.Args[1] {
	case "uid":
		if len(os.Args) != 3 {
			usage()
		}
		input, err := xcs.ParseSchemaUIDInput(read(os.Args[2]))
		if err != nil {
			fatal(err)
		}
		uid, preimage, err := xcs.ComputeSchemaUID(input)
		if err != nil {
			fatal(err)
		}
		write(map[string]any{"valid": true, "uid": uid, "canonicalPreimage": string(preimage)})
	case "schema":
		if len(os.Args) != 3 {
			usage()
		}
		if _, err := xcs.ParseSchema(read(os.Args[2])); err != nil {
			fatal(err)
		}
		write(map[string]any{"valid": true})
	case "claims":
		var err error
		if len(os.Args) == 5 && os.Args[2] == "--catalog" {
			err = verifyCatalogClaims(read(os.Args[3]), read(os.Args[4]))
		} else if len(os.Args) == 4 {
			err = verifyClaims(read(os.Args[2]), read(os.Args[3]))
		} else {
			usage()
		}
		if err != nil {
			fatal(err)
		}
		write(map[string]any{"valid": true})
	case "catalog":
		if len(os.Args) != 3 {
			usage()
		}
		resolved, err := resolveCatalog(read(os.Args[2]))
		if err != nil {
			fatal(err)
		}
		write(map[string]any{
			"valid":                    true,
			"validationScope":          "internal-consistency",
			"xrplRegistrationVerified": false,
			"targetUid":                resolved.Target.UID,
			"lineage":                  resolved.ResolvedTarget.Lineage,
			"checkpoint":               resolved.Bundle.Checkpoint,
		})
	case "payload":
		var schema xcs.SchemaDefinition
		var resolutionContext *xcs.SchemaResolutionContext
		var payloadPath, uri, issuer, subject, schemaUID string
		if len(os.Args) == 9 && os.Args[2] == "--catalog" {
			resolved, err := resolveCatalog(read(os.Args[3]))
			if err != nil {
				fatal(err)
			}
			schema = resolved.Target.Definition
			resolutionContext = &resolved.ResolutionContext
			payloadPath, uri, issuer, subject, schemaUID = os.Args[4], os.Args[5], os.Args[6], os.Args[7], os.Args[8]
			if schemaUID != resolved.Target.UID {
				fatal(&xcs.Error{Code: "SCHEMA_CATALOG_INVALID", Path: "$schemaUid", Msg: "schema UID does not match catalog targetUid"})
			}
		} else if len(os.Args) == 8 {
			var err error
			schema, err = xcs.ParseSchema(read(os.Args[2]))
			if err != nil {
				fatal(err)
			}
			payloadPath, uri, issuer, subject, schemaUID = os.Args[3], os.Args[4], os.Args[5], os.Args[6], os.Args[7]
		} else {
			usage()
		}
		payloadBytes := read(payloadPath)
		integrity, expected, actual, err := xcs.VerifyPayloadIntegrity(payloadBytes, uri)
		if err != nil {
			fatal(err)
		}
		if _, err := xcs.ParseCredentialPayload(payloadBytes, xcs.PayloadContext{
			Issuer: issuer, Subject: subject, SchemaUID: schemaUID, Schema: schema,
			ResolutionContext: resolutionContext,
		}); err != nil {
			fatal(err)
		}
		write(map[string]any{
			"valid": integrity, "expectedDigestHex": expected, "actualDigestHex": actual,
		})
		if !integrity {
			os.Exit(1)
		}
	default:
		usage()
	}
}
