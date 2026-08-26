package xcs

import (
	"testing"

	"golang.org/x/net/idna"
)

func TestPinnedIDNAUnicodeVersion(t *testing.T) {
	if idna.UnicodeVersion != pinnedIDNAUnicodeVersion {
		t.Fatalf(
			"XCS v0.1 requires IDNA Unicode %s, but this toolchain selected %s",
			pinnedIDNAUnicodeVersion,
			idna.UnicodeVersion,
		)
	}
}
