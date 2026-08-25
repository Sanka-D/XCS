package main

import (
	"errors"
	"testing"

	"github.com/XRPL-Commons/xcs/verifier-go/xcs"
)

const claimsTestSchema = `{"xcsVersion":"0.1","name":"Race participation","description":"Confirms participation in a race.","fields":{"bib":{"type":"uint"}}}`

func TestVerifyClaimsRejectsValidJSONThatIsNotAnObject(t *testing.T) {
	for _, claims := range []string{"[]", "null"} {
		t.Run(claims, func(t *testing.T) {
			err := verifyClaims([]byte(claimsTestSchema), []byte(claims))
			var protocolError *xcs.Error
			if !errors.As(err, &protocolError) || protocolError.Code != "CLAIMS_INVALID" {
				t.Fatalf("expected CLAIMS_INVALID, got %v", err)
			}
		})
	}
}
