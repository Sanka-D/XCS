package xcs

import (
	"encoding/json"
	"math"
	"strconv"
)

// parseJSONUint32 mirrors the TypeScript boundary check performed after
// JSON.parse: JSON numbers are interpreted as IEEE-754 doubles, then accepted
// when their value is an integer in the inclusive uint32 range. This admits
// equivalent JSON spellings such as 1, 1.0, 1e0, and -0.
func parseJSONUint32(value any) (uint32, bool) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	parsed, err := strconv.ParseFloat(number.String(), 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) || math.Trunc(parsed) != parsed || parsed < 0 || parsed > math.MaxUint32 {
		return 0, false
	}
	return uint32(parsed), true
}

func requireJSONUint32(object map[string]any, field string, path string, code string) (uint32, error) {
	value, exists := object[field]
	if !exists {
		return 0, invalid(code, path+"."+field, "must be a present uint32")
	}
	parsed, valid := parseJSONUint32(value)
	if !valid {
		return 0, invalid(code, path+"."+field, "must be a uint32")
	}
	return parsed, nil
}
