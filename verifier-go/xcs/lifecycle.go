package xcs

// CredentialLifecycleState is the state projected from a validated ledger object.
type CredentialLifecycleState string

const (
	CredentialLifecyclePending CredentialLifecycleState = "pending"
	CredentialLifecycleActive  CredentialLifecycleState = "active"
	CredentialLifecycleExpired CredentialLifecycleState = "expired"
	CredentialLifecycleDeleted CredentialLifecycleState = "deleted"
)

// CredentialLifecycleInput contains only authoritative ledger lifecycle evidence.
type CredentialLifecycleInput struct {
	ObjectExists bool
	Accepted     bool
	Expiration   *uint32
	CloseTime    uint32
}

// ProjectCredentialLifecycle applies the protocol's lifecycle precedence rules.
func ProjectCredentialLifecycle(input CredentialLifecycleInput) CredentialLifecycleState {
	if !input.ObjectExists {
		return CredentialLifecycleDeleted
	}
	if input.Expiration != nil && *input.Expiration <= input.CloseTime {
		return CredentialLifecycleExpired
	}
	if input.Accepted {
		return CredentialLifecycleActive
	}
	return CredentialLifecyclePending
}
