package xcs

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/net/idna"
)

const maxPayloadBytes = 1024 * 1024
const httpsPrefix = "https://"
const pinnedIDNAUnicodeVersion = "15.0.0"
const canonicalHTTPSPathASCII = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@/"
const canonicalHTTPSQueryASCII = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&()*+,;=:@/?"

var (
	ipfsPattern        = regexp.MustCompile(`^ipfs://(b[a-z2-7]+)$`)
	httpsDigestPattern = regexp.MustCompile(`^xcs-sha256=([0-9a-f]{64})$`)
	whatwgHostProfile  = idna.New(
		idna.MapForLookup(),
		idna.Transitional(false),
		idna.StrictDomainName(false),
		idna.CheckHyphens(false),
		idna.CheckJoiners(true),
		idna.BidiRule(),
		idna.VerifyDNSLength(false),
	)
)

const base32Alphabet = "abcdefghijklmnopqrstuvwxyz234567"

func hasValidRawHTTPSEnvelope(rawURI string) bool {
	if !strings.HasPrefix(rawURI, httpsPrefix) {
		return false
	}
	for index := 0; index < len(rawURI); index++ {
		character := rawURI[index]
		if character <= 0x20 || character == 0x7f || character == '\\' {
			return false
		}
	}
	remainder := rawURI[len(httpsPrefix):]
	authorityEnd := strings.IndexAny(remainder, "/?#")
	if authorityEnd >= 0 {
		remainder = remainder[:authorityEnd]
	}
	return remainder != "" && !strings.Contains(remainder, "@")
}

func normalizeHTTPSPortSuffix(portSuffix string) (string, bool) {
	if portSuffix == "" {
		return "", true
	}
	if portSuffix[0] != ':' {
		return "", false
	}
	port := 0
	for index := 1; index < len(portSuffix); index++ {
		digit := portSuffix[index]
		if digit < '0' || digit > '9' {
			return "", false
		}
		port = port*10 + int(digit-'0')
		if port > 65535 {
			return "", false
		}
	}
	if len(portSuffix) == 1 || port == 443 {
		return "", true
	}
	return ":" + strconv.Itoa(port), true
}

func parseIPv4Number(input string) (uint64, bool) {
	base := uint64(10)
	if len(input) >= 2 && input[0] == '0' {
		if input[1] == 'x' || input[1] == 'X' {
			input = input[2:]
			base = 16
		} else {
			input = input[1:]
			base = 8
		}
	}
	if input == "" {
		return 0, true
	}
	var result uint64
	for index := 0; index < len(input); index++ {
		character := input[index]
		var digit uint64
		switch {
		case character >= '0' && character <= '9':
			digit = uint64(character - '0')
		case character >= 'a' && character <= 'f':
			digit = uint64(character-'a') + 10
		case character >= 'A' && character <= 'F':
			digit = uint64(character-'A') + 10
		default:
			return 0, false
		}
		if digit >= base {
			return 0, false
		}
		result = result*base + digit
		if result > 1<<32-1 {
			return 0, false
		}
	}
	return result, true
}

func hostEndsInNumber(host string) bool {
	parts := strings.Split(host, ".")
	if len(parts) > 1 && parts[len(parts)-1] == "" {
		parts = parts[:len(parts)-1]
	}
	if len(parts) == 0 || parts[len(parts)-1] == "" {
		return false
	}
	last := parts[len(parts)-1]
	allDecimal := true
	for index := 0; index < len(last); index++ {
		if last[index] < '0' || last[index] > '9' {
			allDecimal = false
			break
		}
	}
	if allDecimal {
		return true
	}
	_, ok := parseIPv4Number(last)
	return ok
}

func parseIPv4Host(host string) (string, bool) {
	parts := strings.Split(host, ".")
	if len(parts) > 1 && parts[len(parts)-1] == "" {
		parts = parts[:len(parts)-1]
	}
	if len(parts) < 1 || len(parts) > 4 {
		return "", false
	}
	numbers := make([]uint64, len(parts))
	for index, part := range parts {
		if part == "" {
			return "", false
		}
		number, ok := parseIPv4Number(part)
		if !ok {
			return "", false
		}
		numbers[index] = number
	}
	for _, number := range numbers[:len(numbers)-1] {
		if number > 255 {
			return "", false
		}
	}
	lastLimit := uint64(1) << (8 * (5 - len(numbers)))
	if numbers[len(numbers)-1] >= lastLimit {
		return "", false
	}
	address := numbers[len(numbers)-1]
	for index, number := range numbers[:len(numbers)-1] {
		address += number << (8 * (3 - index))
	}
	return netip.AddrFrom4([4]byte{
		byte(address >> 24), byte(address >> 16), byte(address >> 8), byte(address),
	}).String(), true
}

// net/url neither percent-decodes nor applies UTS #46 to a host like the WHATWG
// URL parser used by the TypeScript reference. Normalize only the domain host;
// percent escapes in the port and bracketed IP literals remain invalid.
func normalizeHTTPSAuthority(rawURI string) (string, bool) {
	if idna.UnicodeVersion != pinnedIDNAUnicodeVersion {
		return "", false
	}
	remainder := rawURI[len(httpsPrefix):]
	authorityEnd := strings.IndexAny(remainder, "/?#")
	authority := remainder
	suffix := ""
	if authorityEnd >= 0 {
		authority = remainder[:authorityEnd]
		suffix = remainder[authorityEnd:]
	}
	if strings.HasPrefix(authority, "[") {
		closingBracket := strings.IndexByte(authority, ']')
		if closingBracket < 0 || strings.Contains(authority, "%") {
			return "", false
		}
		afterHost := authority[closingBracket+1:]
		address, err := netip.ParseAddr(authority[1:closingBracket])
		normalizedPort, validPort := normalizeHTTPSPortSuffix(afterHost)
		if err != nil || !address.Is6() || address.Is4In6() || !validPort {
			return "", false
		}
		return httpsPrefix + "[" + address.String() + "]" + normalizedPort + suffix, true
	}
	if strings.Count(authority, ":") > 1 {
		return "", false
	}
	host := authority
	portSuffix := ""
	if portSeparator := strings.LastIndexByte(authority, ':'); portSeparator >= 0 {
		host = authority[:portSeparator]
		portSuffix = authority[portSeparator:]
	}
	normalizedPort, validPort := normalizeHTTPSPortSuffix(portSuffix)
	if !validPort {
		return "", false
	}
	decodedHost, err := url.PathUnescape(host)
	if err != nil || !utf8.ValidString(decodedHost) {
		return "", false
	}
	asciiHost, err := whatwgHostProfile.ToASCII(decodedHost)
	if err != nil || asciiHost == "" || strings.ContainsAny(asciiHost, "/?#@:[]\\%<>^|`{}") {
		return "", false
	}
	for index := 0; index < len(asciiHost); index++ {
		character := asciiHost[index]
		if character <= 0x20 || character == 0x7f {
			return "", false
		}
	}
	if hostEndsInNumber(asciiHost) {
		normalizedIPv4, valid := parseIPv4Host(asciiHost)
		if !valid {
			return "", false
		}
		asciiHost = normalizedIPv4
	}
	return httpsPrefix + asciiHost + normalizedPort + suffix, true
}

func hasCanonicalHTTPSComponent(value string, allowedASCII string) bool {
	for index := 0; index < len(value); index++ {
		character := value[index]
		if character == '%' {
			if index+2 >= len(value) || !isHexDigit(value[index+1]) || !isHexDigit(value[index+2]) {
				return false
			}
			index += 2
		} else if !strings.ContainsRune(allowedASCII, rune(character)) {
			return false
		}
	}
	return true
}

func isHexDigit(character byte) bool {
	return character >= '0' && character <= '9' ||
		character >= 'a' && character <= 'f' ||
		character >= 'A' && character <= 'F'
}

func canonicalHTTPSFetchURL(normalizedURI string) (string, bool) {
	fragmentIndex := strings.IndexByte(normalizedURI, '#')
	if fragmentIndex < 0 {
		return "", false
	}
	withoutFragment := normalizedURI[:fragmentIndex]
	remainder := withoutFragment[len(httpsPrefix):]
	resourceIndex := strings.IndexAny(remainder, "/?")
	authority := remainder
	resource := ""
	if resourceIndex >= 0 {
		authority = remainder[:resourceIndex]
		resource = remainder[resourceIndex:]
	}
	queryIndex := strings.IndexByte(resource, '?')
	path := resource
	query := ""
	hasQuery := queryIndex >= 0
	if hasQuery {
		path = resource[:queryIndex]
		query = resource[queryIndex+1:]
	}
	if !hasCanonicalHTTPSComponent(path, canonicalHTTPSPathASCII) ||
		(hasQuery && !hasCanonicalHTTPSComponent(query, canonicalHTTPSQueryASCII)) {
		return "", false
	}
	for _, segment := range strings.Split(path, "/") {
		normalizedDots := strings.NewReplacer("%2e", ".", "%2E", ".").Replace(segment)
		if normalizedDots == "." || normalizedDots == ".." {
			return "", false
		}
	}
	if path == "" {
		path = "/"
	}
	if hasQuery {
		return httpsPrefix + authority + path + "?" + query, true
	}
	return httpsPrefix + authority + path, true
}

func decodeBase32Lower(value string) ([]byte, bool) {
	bits := 0
	accumulator := 0
	decoded := make([]byte, 0, len(value)*5/8)
	for _, character := range value {
		digit := strings.IndexRune(base32Alphabet, character)
		if digit < 0 {
			return nil, false
		}
		accumulator = accumulator<<5 | digit
		bits += 5
		if bits >= 8 {
			bits -= 8
			decoded = append(decoded, byte(accumulator>>bits&0xff))
			accumulator &= 1<<bits - 1
		}
	}
	return decoded, bits == 0 || accumulator == 0
}

type CredentialPayload struct {
	XCSVersion string         `json:"xcsVersion"`
	Issuer     string         `json:"issuer"`
	Subject    string         `json:"subject"`
	Schema     string         `json:"schema"`
	Claims     map[string]any `json:"claims"`
}

type PayloadContext struct {
	Issuer            string
	Subject           string
	SchemaUID         string
	Schema            SchemaDefinition
	ResolutionContext *SchemaResolutionContext
}

type PayloadURI struct {
	Kind      string `json:"kind"`
	URI       string `json:"uri"`
	FetchURL  string `json:"fetchUrl,omitempty"`
	CID       string `json:"cid,omitempty"`
	DigestHex string `json:"digestHex"`
}

func ParseCredentialPayload(data []byte, context PayloadContext) (CredentialPayload, error) {
	if len(data) > maxPayloadBytes {
		return CredentialPayload{}, invalid("PAYLOAD_INVALID", "$payload", "payload exceeds 1 MiB")
	}
	if !utf8.Valid(data) {
		return CredentialPayload{}, invalid("UTF8_INVALID", "$payload", "payload bytes are not valid UTF-8")
	}
	value, err := ParseJSON(data)
	if err != nil {
		return CredentialPayload{}, err
	}
	object, ok := value.(map[string]any)
	if !ok {
		return CredentialPayload{}, invalid("PAYLOAD_INVALID", "$", "payload must be an object")
	}
	allowed := map[string]bool{
		"xcsVersion": true, "issuer": true, "subject": true, "schema": true, "claims": true,
	}
	for key := range object {
		if !allowed[key] {
			return CredentialPayload{}, invalid("PAYLOAD_INVALID", "$."+key, "unknown payload property")
		}
	}
	version, versionOK := object["xcsVersion"].(string)
	issuer, issuerOK := object["issuer"].(string)
	subject, subjectOK := object["subject"].(string)
	schemaUID, schemaOK := object["schema"].(string)
	claimsValue := object["claims"]
	if !versionOK || version != "0.1" {
		return CredentialPayload{}, invalid("PAYLOAD_INVALID", "$.xcsVersion", "must be 0.1")
	}
	if !issuerOK || !IsClassicAddress(issuer) || issuer != context.Issuer {
		return CredentialPayload{}, invalid("PAYLOAD_INVALID", "$.issuer", "does not match credential issuer")
	}
	if !subjectOK || !IsClassicAddress(subject) || subject != context.Subject {
		return CredentialPayload{}, invalid("PAYLOAD_INVALID", "$.subject", "does not match credential subject")
	}
	if !schemaOK || !uidPattern.MatchString(schemaUID) || schemaUID != context.SchemaUID {
		return CredentialPayload{}, invalid("PAYLOAD_INVALID", "$.schema", "does not match CredentialType")
	}
	if err := validateClaimsAgainstSchema(claimsValue, context.Schema, context.ResolutionContext); err != nil {
		return CredentialPayload{}, err
	}
	claims, ok := claimsValue.(map[string]any)
	if !ok {
		return CredentialPayload{}, invalid("CLAIMS_INVALID", "$.claims", "claims must be an object")
	}
	canonical, err := Canonicalize(object)
	if err != nil {
		return CredentialPayload{}, err
	}
	if !bytes.Equal(canonical, data) {
		return CredentialPayload{}, invalid("PAYLOAD_INVALID", "$payload", "payload is not RFC 8785 canonical JSON")
	}
	return CredentialPayload{
		XCSVersion: version,
		Issuer:     issuer,
		Subject:    subject,
		Schema:     schemaUID,
		Claims:     claims,
	}, nil
}

func InspectPayloadURI(rawURI string) (PayloadURI, error) {
	if !utf8.ValidString(rawURI) || len(rawURI) < 1 || len(rawURI) > 256 {
		return PayloadURI{}, invalid("PAYLOAD_URI_INVALID", "$uri", "must contain 1 to 256 UTF-8 bytes")
	}
	if match := ipfsPattern.FindStringSubmatch(rawURI); match != nil {
		cid := match[1]
		decoded, ok := decodeBase32Lower(cid[1:])
		if !ok || len(cid) != 59 || len(decoded) != 36 || decoded[0] != 1 || decoded[1] != 0x55 || decoded[2] != 0x12 || decoded[3] != 0x20 {
			return PayloadURI{}, invalid("PAYLOAD_URI_INVALID", "$uri", "IPFS URI is not a raw sha2-256 CIDv1")
		}
		return PayloadURI{
			Kind: "ipfs", URI: rawURI, CID: cid, DigestHex: hex.EncodeToString(decoded[4:]),
		}, nil
	}
	if !hasValidRawHTTPSEnvelope(rawURI) {
		return PayloadURI{}, invalid("PAYLOAD_URI_INVALID", "$uri", "HTTPS URI has an invalid raw envelope")
	}
	normalizedURI, ok := normalizeHTTPSAuthority(rawURI)
	if !ok {
		return PayloadURI{}, invalid("PAYLOAD_URI_INVALID", "$uri", "HTTPS authority is invalid")
	}
	fetchURL, ok := canonicalHTTPSFetchURL(normalizedURI)
	if !ok {
		return PayloadURI{}, invalid("PAYLOAD_URI_INVALID", "$uri", "HTTPS path or query is not canonical")
	}
	parsed, err := url.Parse(normalizedURI)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return PayloadURI{}, invalid("PAYLOAD_URI_INVALID", "$uri", "must be HTTPS without user information")
	}
	// net/url percent-decodes Fragment and retains the original spelling in
	// RawFragment. XCS requires the digest fragment itself to be literal.
	if parsed.RawFragment != "" {
		return PayloadURI{}, invalid("PAYLOAD_URI_INVALID", "$uri", "digest fragment must not be percent-encoded")
	}
	digestMatch := httpsDigestPattern.FindStringSubmatch(parsed.Fragment)
	if digestMatch == nil {
		return PayloadURI{}, invalid("PAYLOAD_URI_INVALID", "$uri", "missing lowercase xcs-sha256 fragment")
	}
	digest := digestMatch[1]
	return PayloadURI{
		Kind: "https", URI: rawURI, FetchURL: fetchURL, DigestHex: digest,
	}, nil
}

func VerifyPayloadIntegrity(data []byte, rawURI string) (bool, string, string, error) {
	if len(data) > maxPayloadBytes {
		return false, "", "", invalid("PAYLOAD_INVALID", "$payload", "payload exceeds 1 MiB")
	}
	digest := sha256.Sum256(data)
	actual := hex.EncodeToString(digest[:])
	parsed, err := InspectPayloadURI(rawURI)
	if err != nil {
		return false, "", actual, err
	}
	return parsed.DigestHex == actual, parsed.DigestHex, actual, nil
}
