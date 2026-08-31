package xcs

import (
	"regexp"
	"time"
)

const (
	// RippleEpochUnixSeconds is the Unix timestamp of the XRPL epoch.
	RippleEpochUnixSeconds int64 = 946_684_800
	maxRippleTime          int64 = 1<<32 - 1
)

var iso8601WholeSecondPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$`)

// UnixSecondsToRippleTime converts whole Unix seconds to an XRPL uint32 time.
func UnixSecondsToRippleTime(unixSeconds int64) (uint32, error) {
	if unixSeconds < RippleEpochUnixSeconds || unixSeconds > RippleEpochUnixSeconds+maxRippleTime {
		return 0, invalid("RIPPLE_TIME_INVALID", "$time", "Unix time is outside the XRPL uint32 time range")
	}
	return uint32(unixSeconds - RippleEpochUnixSeconds), nil
}

// RippleTimeToUnixSeconds converts an XRPL time to whole Unix seconds.
func RippleTimeToUnixSeconds(rippleTime int64) (int64, error) {
	if rippleTime < 0 || rippleTime > maxRippleTime {
		return 0, invalid("RIPPLE_TIME_INVALID", "$time", "Ripple time must be a uint32")
	}
	return rippleTime + RippleEpochUnixSeconds, nil
}

// ISO8601ToRippleTime parses the protocol's strict whole-second UTC format.
func ISO8601ToRippleTime(value string) (uint32, error) {
	if !iso8601WholeSecondPattern.MatchString(value) {
		return 0, invalid(
			"RIPPLE_TIME_INVALID",
			"$time",
			"Expiration must be a UTC ISO-8601 timestamp with whole-second precision",
		)
	}

	layout := "2006-01-02T15:04:05Z"
	expected := value[:len(value)-1] + ".000Z"
	if len(value) == len("2006-01-02T15:04:05.000Z") {
		layout = "2006-01-02T15:04:05.000Z"
		expected = value
	}
	parsed, err := time.Parse(layout, value)
	if err != nil {
		return 0, invalid("RIPPLE_TIME_INVALID", "$time", "Expiration is not a real calendar date")
	}
	if parsed.UTC().Format("2006-01-02T15:04:05.000Z") != expected {
		return 0, invalid("RIPPLE_TIME_INVALID", "$time", "Expiration is not a canonical calendar date")
	}
	return UnixSecondsToRippleTime(parsed.Unix())
}

// RippleTimeToISO8601 formats an XRPL time in canonical UTC form.
func RippleTimeToISO8601(rippleTime int64) (string, error) {
	unixSeconds, err := RippleTimeToUnixSeconds(rippleTime)
	if err != nil {
		return "", err
	}
	return time.Unix(unixSeconds, 0).UTC().Format("2006-01-02T15:04:05.000Z"), nil
}
