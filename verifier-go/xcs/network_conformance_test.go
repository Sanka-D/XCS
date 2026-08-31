package xcs

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func runNetworkProfileVectors(t *testing.T, data []byte) {
	t.Helper()
	var vectors struct {
		Version string `json:"version"`
		Cases   []struct {
			ID        string          `json:"id"`
			Name      string          `json:"name"`
			Valid     bool            `json:"valid"`
			Input     json.RawMessage `json:"input"`
			InputJSON string          `json:"inputJson"`
			Expected  json.RawMessage `json:"expected"`
			ErrorCode string          `json:"errorCode"`
		} `json:"cases"`
	}
	if err := decodeStrictJSON(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors.Cases {
		t.Run(vector.ID+" "+vector.Name, func(t *testing.T) {
			input := vector.Input
			if vector.InputJSON != "" {
				input = json.RawMessage(vector.InputJSON)
			}
			actual, err := ParseNetworkProfile(input)
			if !vector.Valid {
				var protocolError *Error
				if !errors.As(err, &protocolError) || protocolError.Code != vector.ErrorCode {
					t.Fatalf("expected %s, got %v", vector.ErrorCode, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("expected valid profile: %v", err)
			}
			expected, err := ParseNetworkProfile(vector.Expected)
			if err != nil {
				t.Fatalf("invalid expected profile: %v", err)
			}
			if !reflect.DeepEqual(actual, expected) {
				t.Fatalf("profile mismatch\nwant %#v\ngot  %#v", expected, actual)
			}
		})
	}
}
