package xcs

import (
	"errors"
	"math"
	"testing"
)

func TestRippleTimeBoundaryConversions(t *testing.T) {
	if RippleEpochUnixSeconds != 946_684_800 {
		t.Fatalf("unexpected Ripple epoch: %d", RippleEpochUnixSeconds)
	}

	tests := []struct {
		name       string
		unix       int64
		rippleTime uint32
	}{
		{name: "epoch", unix: RippleEpochUnixSeconds, rippleTime: 0},
		{name: "maximum", unix: RippleEpochUnixSeconds + int64(math.MaxUint32), rippleTime: math.MaxUint32},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			converted, err := UnixSecondsToRippleTime(test.unix)
			if err != nil {
				t.Fatal(err)
			}
			if converted != test.rippleTime {
				t.Fatalf("expected %d, got %d", test.rippleTime, converted)
			}
			unixSeconds, err := RippleTimeToUnixSeconds(int64(converted))
			if err != nil {
				t.Fatal(err)
			}
			if unixSeconds != test.unix {
				t.Fatalf("expected %d, got %d", test.unix, unixSeconds)
			}
		})
	}
}

func TestRippleTimeRejectsOutOfRangeValues(t *testing.T) {
	tests := []struct {
		name string
		run  func() error
	}{
		{name: "Unix before epoch", run: func() error { _, err := UnixSecondsToRippleTime(RippleEpochUnixSeconds - 1); return err }},
		{name: "Unix after maximum", run: func() error {
			_, err := UnixSecondsToRippleTime(RippleEpochUnixSeconds + int64(math.MaxUint32) + 1)
			return err
		}},
		{name: "minimum int64 Unix", run: func() error { _, err := UnixSecondsToRippleTime(math.MinInt64); return err }},
		{name: "maximum int64 Unix", run: func() error { _, err := UnixSecondsToRippleTime(math.MaxInt64); return err }},
		{name: "negative Ripple time", run: func() error { _, err := RippleTimeToUnixSeconds(-1); return err }},
		{name: "Ripple time after maximum", run: func() error { _, err := RippleTimeToUnixSeconds(int64(math.MaxUint32) + 1); return err }},
		{name: "maximum int64 Ripple time", run: func() error { _, err := RippleTimeToISO8601(math.MaxInt64); return err }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertRippleTimeError(t, test.run())
		})
	}
}

func TestISO8601RippleTimeRoundTrip(t *testing.T) {
	for _, input := range []string{
		"2000-01-01T00:00:00Z",
		"2000-01-01T00:00:00.000Z",
		"2030-05-06T07:08:09Z",
		"2136-02-07T06:28:15.000Z",
	} {
		t.Run(input, func(t *testing.T) {
			rippleTime, err := ISO8601ToRippleTime(input)
			if err != nil {
				t.Fatal(err)
			}
			formatted, err := RippleTimeToISO8601(int64(rippleTime))
			if err != nil {
				t.Fatal(err)
			}
			expected := input
			if len(input) == len("2000-01-01T00:00:00Z") {
				expected = input[:len(input)-1] + ".000Z"
			}
			if formatted != expected {
				t.Fatalf("expected %s, got %s", expected, formatted)
			}
		})
	}
}

func TestISO8601RippleTimeRejectsNonCanonicalValues(t *testing.T) {
	inputs := []string{
		"",
		"1999-12-31T23:59:59Z",
		"2030-05-06T07:08:09.123Z",
		"2030-05-06T07:08:09+00:00",
		"2030-05-06 07:08:09Z",
		"2030-5-06T07:08:09Z",
		"2030-05-06T07:08:09z",
		"2030-02-29T00:00:00Z",
		"2030-05-06T07:08:60Z",
		"2136-02-07T06:28:16Z",
	}
	for _, input := range inputs {
		t.Run(input, func(t *testing.T) {
			_, err := ISO8601ToRippleTime(input)
			assertRippleTimeError(t, err)
		})
	}
}

func assertRippleTimeError(t *testing.T, err error) {
	t.Helper()
	var xcsError *Error
	if !errors.As(err, &xcsError) || xcsError.Code != "RIPPLE_TIME_INVALID" || xcsError.Path != "$time" {
		t.Fatalf("expected RIPPLE_TIME_INVALID at $time, got %v", err)
	}
}
