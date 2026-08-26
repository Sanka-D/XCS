package xcs

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
)

func runRippleTimeVectors(t *testing.T, data []byte) {
	t.Helper()
	var vectors struct {
		Version string `json:"version"`
		Cases   []struct {
			ID        string          `json:"id"`
			Name      string          `json:"name"`
			Operation string          `json:"operation"`
			Input     json.RawMessage `json:"input"`
			Valid     bool            `json:"valid"`
			Expected  json.RawMessage `json:"expected"`
			ErrorCode string          `json:"errorCode"`
		} `json:"cases"`
	}
	if err := decodeStrictJSON(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors.Cases {
		t.Run(vector.ID+" "+vector.Name, func(t *testing.T) {
			actual, err := runRippleTimeOperation(vector.Operation, vector.Input)
			if !vector.Valid {
				var xcsError *Error
				if !errors.As(err, &xcsError) || xcsError.Code != vector.ErrorCode {
					t.Fatalf("expected %s, got %v", vector.ErrorCode, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("expected valid conversion: %v", err)
			}
			if len(vector.Expected) == 0 {
				t.Fatal("valid vector is missing expected output")
			}
			var expected any
			if err := decodeStrictJSON(vector.Expected, &expected); err != nil {
				t.Fatalf("decode expected output: %v", err)
			}
			actualJSON, err := json.Marshal(actual)
			if err != nil {
				t.Fatalf("encode actual output: %v", err)
			}
			expectedJSON, err := json.Marshal(expected)
			if err != nil {
				t.Fatalf("encode expected output: %v", err)
			}
			if !bytes.Equal(actualJSON, expectedJSON) {
				t.Fatalf("expected %v, got %v", expected, actual)
			}
		})
	}
}

func runRippleTimeOperation(operation string, rawInput json.RawMessage) (any, error) {
	switch operation {
	case "unix-to-ripple":
		var input int64
		if err := decodeStrictJSON(rawInput, &input); err != nil {
			return nil, err
		}
		return UnixSecondsToRippleTime(input)
	case "ripple-to-unix":
		var input int64
		if err := decodeStrictJSON(rawInput, &input); err != nil {
			return nil, err
		}
		return RippleTimeToUnixSeconds(input)
	case "iso-to-ripple":
		var input string
		if err := decodeStrictJSON(rawInput, &input); err != nil {
			return nil, err
		}
		return ISO8601ToRippleTime(input)
	case "ripple-to-iso":
		var input int64
		if err := decodeStrictJSON(rawInput, &input); err != nil {
			return nil, err
		}
		return RippleTimeToISO8601(input)
	default:
		return nil, fmt.Errorf("unknown Ripple time operation: %s", operation)
	}
}

func runLifecycleStateVectors(t *testing.T, data []byte) {
	t.Helper()
	var vectors struct {
		Version string `json:"version"`
		Cases   []struct {
			ID    string `json:"id"`
			Name  string `json:"name"`
			Input struct {
				ObjectExists bool    `json:"objectExists"`
				Accepted     bool    `json:"accepted"`
				Expiration   *uint32 `json:"expiration"`
				CloseTime    uint32  `json:"closeTime"`
			} `json:"input"`
			State CredentialLifecycleState `json:"state"`
		} `json:"cases"`
	}
	if err := decodeStrictJSON(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors.Cases {
		t.Run(vector.ID+" "+vector.Name, func(t *testing.T) {
			actual := ProjectCredentialLifecycle(CredentialLifecycleInput{
				ObjectExists: vector.Input.ObjectExists,
				Accepted:     vector.Input.Accepted,
				Expiration:   vector.Input.Expiration,
				CloseTime:    vector.Input.CloseTime,
			})
			if actual != vector.State {
				t.Fatalf("expected %s, got %s", vector.State, actual)
			}
		})
	}
}
