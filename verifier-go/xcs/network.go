package xcs

import (
	"encoding/json"
	"regexp"
	"strings"
)

var networkProfileIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,127}$`)

type NetworkProfile struct {
	ProfileID               string `json:"profileId"`
	XCSVersion              string `json:"xcsVersion"`
	NetworkID               uint32 `json:"networkId"`
	RequiredAmendment       string `json:"requiredAmendment"`
	RegistryAddress         string `json:"registryAddress"`
	RegistrationAmountDrops string `json:"registrationAmountDrops"`
	ActivationLedgerIndex   uint32 `json:"activationLedgerIndex"`
	ActivationLedgerHash    string `json:"activationLedgerHash"`
}

func ValidateNetworkProfile(profile NetworkProfile) (NetworkProfile, error) {
	if !networkProfileIDPattern.MatchString(profile.ProfileID) {
		return NetworkProfile{}, invalid("NETWORK_PROFILE_INVALID", "$.profileId", "must be a lowercase stable identifier of at most 128 characters")
	}
	if profile.XCSVersion != "0.1" {
		return NetworkProfile{}, invalid("NETWORK_PROFILE_INVALID", "$.xcsVersion", "unsupported XCS version")
	}
	if !hashPattern.MatchString(profile.RequiredAmendment) {
		return NetworkProfile{}, invalid("NETWORK_PROFILE_INVALID", "$.requiredAmendment", "must be a 32-byte hexadecimal amendment ID")
	}
	if !IsClassicAddress(profile.RegistryAddress) {
		return NetworkProfile{}, invalid("NETWORK_PROFILE_INVALID", "$.registryAddress", "must be a checksummed XRPL classic address")
	}
	if profile.RegistrationAmountDrops != "1" {
		return NetworkProfile{}, invalid("NETWORK_PROFILE_INVALID", "$.registrationAmountDrops", "must be the string \"1\"")
	}
	if profile.ActivationLedgerIndex == 0 {
		return NetworkProfile{}, invalid("NETWORK_PROFILE_INVALID", "$.activationLedgerIndex", "must be a positive uint32")
	}
	if !hashPattern.MatchString(profile.ActivationLedgerHash) {
		return NetworkProfile{}, invalid("NETWORK_PROFILE_INVALID", "$.activationLedgerHash", "must be a 32-byte hexadecimal ledger hash")
	}
	profile.RequiredAmendment = strings.ToUpper(profile.RequiredAmendment)
	profile.ActivationLedgerHash = strings.ToLower(profile.ActivationLedgerHash)
	return profile, nil
}

func ParseNetworkProfile(data []byte) (NetworkProfile, error) {
	parsed, err := ParseJSON(data)
	if err != nil {
		return NetworkProfile{}, err
	}
	object, ok := parsed.(map[string]any)
	if !ok {
		return NetworkProfile{}, invalid("NETWORK_PROFILE_INVALID", "$", "network profile must be an object")
	}
	expected := map[string]bool{
		"profileId": true, "xcsVersion": true, "networkId": true,
		"requiredAmendment": true, "registryAddress": true,
		"registrationAmountDrops": true, "activationLedgerIndex": true,
		"activationLedgerHash": true,
	}
	if len(object) != len(expected) {
		return NetworkProfile{}, invalid("NETWORK_PROFILE_INVALID", "$", "network profile contains unknown or missing properties")
	}
	for key := range object {
		if !expected[key] {
			return NetworkProfile{}, invalid("NETWORK_PROFILE_INVALID", "$."+key, "unknown network profile property")
		}
	}
	networkID, err := requireJSONUint32(object, "networkId", "$", "NETWORK_PROFILE_INVALID")
	if err != nil {
		return NetworkProfile{}, err
	}
	activationLedgerIndex, err := requireJSONUint32(object, "activationLedgerIndex", "$", "NETWORK_PROFILE_INVALID")
	if err != nil {
		return NetworkProfile{}, err
	}

	var raw struct {
		ProfileID               string          `json:"profileId"`
		XCSVersion              string          `json:"xcsVersion"`
		NetworkID               json.RawMessage `json:"networkId"`
		RequiredAmendment       string          `json:"requiredAmendment"`
		RegistryAddress         string          `json:"registryAddress"`
		RegistrationAmountDrops string          `json:"registrationAmountDrops"`
		ActivationLedgerIndex   json.RawMessage `json:"activationLedgerIndex"`
		ActivationLedgerHash    string          `json:"activationLedgerHash"`
	}
	if err := decodeKnownJSON(data, &raw); err != nil {
		return NetworkProfile{}, invalid("NETWORK_PROFILE_INVALID", "$", "invalid network profile structure: %v", err)
	}
	profile := NetworkProfile{
		ProfileID: raw.ProfileID, XCSVersion: raw.XCSVersion, NetworkID: networkID,
		RequiredAmendment: raw.RequiredAmendment, RegistryAddress: raw.RegistryAddress,
		RegistrationAmountDrops: raw.RegistrationAmountDrops, ActivationLedgerIndex: activationLedgerIndex,
		ActivationLedgerHash: raw.ActivationLedgerHash,
	}
	return ValidateNetworkProfile(profile)
}
