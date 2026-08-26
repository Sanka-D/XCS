package xcs

import "testing"

func TestProjectCredentialLifecyclePrecedence(t *testing.T) {
	expired := uint32(100)
	future := uint32(101)
	tests := []struct {
		name     string
		input    CredentialLifecycleInput
		expected CredentialLifecycleState
	}{
		{
			name:     "missing object is deleted regardless of other fields",
			input:    CredentialLifecycleInput{ObjectExists: false, Accepted: true, Expiration: &expired, CloseTime: 100},
			expected: CredentialLifecycleDeleted,
		},
		{
			name:     "expiration at close time dominates accepted",
			input:    CredentialLifecycleInput{ObjectExists: true, Accepted: true, Expiration: &expired, CloseTime: 100},
			expected: CredentialLifecycleExpired,
		},
		{
			name:     "past expiration dominates pending",
			input:    CredentialLifecycleInput{ObjectExists: true, Accepted: false, Expiration: &expired, CloseTime: 101},
			expected: CredentialLifecycleExpired,
		},
		{
			name:     "accepted object without expiration is active",
			input:    CredentialLifecycleInput{ObjectExists: true, Accepted: true, CloseTime: 100},
			expected: CredentialLifecycleActive,
		},
		{
			name:     "accepted object before expiration is active",
			input:    CredentialLifecycleInput{ObjectExists: true, Accepted: true, Expiration: &future, CloseTime: 100},
			expected: CredentialLifecycleActive,
		},
		{
			name:     "unaccepted object without expiration is pending",
			input:    CredentialLifecycleInput{ObjectExists: true, CloseTime: ^uint32(0)},
			expected: CredentialLifecyclePending,
		},
		{
			name:     "unaccepted object before expiration is pending",
			input:    CredentialLifecycleInput{ObjectExists: true, Expiration: &future, CloseTime: 100},
			expected: CredentialLifecyclePending,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := ProjectCredentialLifecycle(test.input); actual != test.expected {
				t.Fatalf("expected %s, got %s", test.expected, actual)
			}
		})
	}
}
