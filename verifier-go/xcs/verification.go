package xcs

type PayloadVerificationStatus string

const (
	PayloadValid       PayloadVerificationStatus = "valid"
	PayloadUnavailable PayloadVerificationStatus = "unavailable"
	PayloadTampered    PayloadVerificationStatus = "tampered"
	PayloadInvalid     PayloadVerificationStatus = "invalid"
)

type PayloadRetrievalEvidence struct {
	Status  string
	Content []byte
}

// ClassifyCredentialPayload applies the complete deterministic payload decision after a caller has
// either retrieved bytes or established that retrieval is unavailable. Network I/O remains the
// caller's responsibility.
func ClassifyCredentialPayload(
	retrieval PayloadRetrievalEvidence,
	rawURI string,
	context PayloadContext,
) PayloadVerificationStatus {
	if _, err := InspectPayloadURI(rawURI); err != nil {
		return PayloadInvalid
	}
	if retrieval.Status == "unavailable" {
		return PayloadUnavailable
	}
	if retrieval.Status != "retrieved" {
		return PayloadInvalid
	}
	valid, _, _, err := VerifyPayloadIntegrity(retrieval.Content, rawURI)
	if err != nil {
		return PayloadInvalid
	}
	if !valid {
		return PayloadTampered
	}
	if _, err := ParseCredentialPayload(retrieval.Content, context); err != nil {
		return PayloadInvalid
	}
	return PayloadValid
}
