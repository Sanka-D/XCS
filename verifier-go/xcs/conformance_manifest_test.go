package xcs

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

const (
	conformanceFormatVersion   = 1
	conformanceProtocolVersion = "0.1"
)

type conformanceHandler string

const (
	canonicalizationHandler  conformanceHandler = "canonicalization"
	schemaValidationHandler  conformanceHandler = "schema-validation"
	schemaUIDHandler         conformanceHandler = "schema-uid"
	claimsHandler            conformanceHandler = "claims"
	payloadIntegrityHandler  conformanceHandler = "payload-integrity"
	payloadValidationHandler conformanceHandler = "payload-validation"
)

var conformanceHandlerFiles = map[conformanceHandler]string{
	canonicalizationHandler:  "canonicalization.json",
	schemaValidationHandler:  "schema-validation.json",
	schemaUIDHandler:         "schema-uid.json",
	claimsHandler:            "claims.json",
	payloadIntegrityHandler:  "payload-integrity.json",
	payloadValidationHandler: "payload-validation.json",
}

var conformanceHandlers = []conformanceHandler{
	canonicalizationHandler,
	schemaValidationHandler,
	schemaUIDHandler,
	claimsHandler,
	payloadIntegrityHandler,
	payloadValidationHandler,
}

type conformanceManifestEntry struct {
	File    string             `json:"file"`
	Handler conformanceHandler `json:"handler"`
}

type conformanceManifest struct {
	FormatVersion   int                        `json:"formatVersion"`
	ProtocolVersion string                     `json:"protocolVersion"`
	Revision        int                        `json:"revision"`
	Files           []conformanceManifestEntry `json:"files"`
}

type loadedConformanceFile struct {
	conformanceManifestEntry
	Data []byte
}

type loadedConformanceSuite struct {
	Manifest conformanceManifest
	Files    []loadedConformanceFile
}

type conformanceEnvelope struct {
	Version string `json:"version"`
	Cases   []struct {
		ID string `json:"id"`
	} `json:"cases"`
}

func conformanceDirectory() string {
	return filepath.Join("..", "..", "conformance", "v0.1")
}

func decodeStrictJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func loadConformanceSuite(directory string) (loadedConformanceSuite, error) {
	manifestData, err := os.ReadFile(filepath.Join(directory, "manifest.json"))
	if err != nil {
		return loadedConformanceSuite{}, fmt.Errorf("read conformance manifest: %w", err)
	}
	var manifest conformanceManifest
	if err := decodeStrictJSON(manifestData, &manifest); err != nil {
		return loadedConformanceSuite{}, fmt.Errorf("decode conformance manifest: %w", err)
	}
	if manifest.FormatVersion != conformanceFormatVersion {
		return loadedConformanceSuite{}, fmt.Errorf("unknown conformance manifest formatVersion: %d", manifest.FormatVersion)
	}
	if manifest.ProtocolVersion != conformanceProtocolVersion {
		return loadedConformanceSuite{}, fmt.Errorf("unknown conformance protocolVersion: %s", manifest.ProtocolVersion)
	}
	if manifest.Revision < 1 {
		return loadedConformanceSuite{}, errors.New("conformance manifest revision must be positive")
	}

	seenFiles := make(map[string]bool, len(manifest.Files))
	seenHandlers := make(map[conformanceHandler]bool, len(manifest.Files))
	declaredFiles := make([]string, 0, len(manifest.Files))
	for index, entry := range manifest.Files {
		expectedFile, known := conformanceHandlerFiles[entry.Handler]
		if !known {
			return loadedConformanceSuite{}, fmt.Errorf("unknown conformance handler: %s", entry.Handler)
		}
		if entry.File != expectedFile {
			return loadedConformanceSuite{}, fmt.Errorf("unknown conformance file for %s: %s", entry.Handler, entry.File)
		}
		if seenFiles[entry.File] {
			return loadedConformanceSuite{}, fmt.Errorf("duplicate conformance file: %s", entry.File)
		}
		if seenHandlers[entry.Handler] {
			return loadedConformanceSuite{}, fmt.Errorf("duplicate conformance handler: %s", entry.Handler)
		}
		if entry.File == "" || entry.Handler == "" {
			return loadedConformanceSuite{}, fmt.Errorf("manifest file entry %d is incomplete", index)
		}
		seenFiles[entry.File] = true
		seenHandlers[entry.Handler] = true
		declaredFiles = append(declaredFiles, entry.File)
	}
	for _, handler := range conformanceHandlers {
		if !seenHandlers[handler] {
			return loadedConformanceSuite{}, fmt.Errorf("missing conformance handler: %s", handler)
		}
	}

	entries, err := os.ReadDir(directory)
	if err != nil {
		return loadedConformanceSuite{}, fmt.Errorf("read conformance directory: %w", err)
	}
	actualFiles := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") && entry.Name() != "manifest.json" {
			actualFiles = append(actualFiles, entry.Name())
		}
	}
	sort.Strings(actualFiles)
	sort.Strings(declaredFiles)
	undeclared := difference(actualFiles, declaredFiles)
	missing := difference(declaredFiles, actualFiles)
	if len(undeclared) > 0 || len(missing) > 0 {
		return loadedConformanceSuite{}, fmt.Errorf(
			"conformance file inventory mismatch (undeclared: %s; missing: %s)",
			formatInventory(undeclared),
			formatInventory(missing),
		)
	}

	caseIDs := make(map[string]bool)
	files := make([]loadedConformanceFile, 0, len(manifest.Files))
	for _, entry := range manifest.Files {
		data, err := os.ReadFile(filepath.Join(directory, entry.File))
		if err != nil {
			return loadedConformanceSuite{}, fmt.Errorf("read conformance file %s: %w", entry.File, err)
		}
		var envelope conformanceEnvelope
		if err := json.Unmarshal(data, &envelope); err != nil {
			return loadedConformanceSuite{}, fmt.Errorf("decode conformance file %s: %w", entry.File, err)
		}
		if envelope.Version != manifest.ProtocolVersion {
			return loadedConformanceSuite{}, fmt.Errorf("%s has unknown vector version: %s", entry.File, envelope.Version)
		}
		if len(envelope.Cases) == 0 {
			return loadedConformanceSuite{}, fmt.Errorf("%s must contain at least one case", entry.File)
		}
		for index, vector := range envelope.Cases {
			if strings.TrimSpace(vector.ID) == "" {
				return loadedConformanceSuite{}, fmt.Errorf("%s case %d must have a non-empty id", entry.File, index)
			}
			if caseIDs[vector.ID] {
				return loadedConformanceSuite{}, fmt.Errorf("duplicate conformance case id: %s", vector.ID)
			}
			caseIDs[vector.ID] = true
		}
		files = append(files, loadedConformanceFile{conformanceManifestEntry: entry, Data: data})
	}

	return loadedConformanceSuite{Manifest: manifest, Files: files}, nil
}

func difference(left []string, right []string) []string {
	rightSet := make(map[string]bool, len(right))
	for _, value := range right {
		rightSet[value] = true
	}
	result := make([]string, 0)
	for _, value := range left {
		if !rightSet[value] {
			result = append(result, value)
		}
	}
	return result
}

func formatInventory(values []string) string {
	if len(values) == 0 {
		return "none"
	}
	return strings.Join(values, ", ")
}

func copyConformanceFixture(t *testing.T) string {
	t.Helper()
	directory := t.TempDir()
	entries, err := os.ReadDir(conformanceDirectory())
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(conformanceDirectory(), entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, entry.Name()), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return directory
}

func readJSONObject(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func writeJSONObject(t *testing.T, path string, value map[string]any) {
	t.Helper()
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func manifestEntries(t *testing.T, manifest map[string]any) []any {
	t.Helper()
	entries, ok := manifest["files"].([]any)
	if !ok {
		t.Fatal("manifest files are not an array")
	}
	return entries
}

func manifestEntry(t *testing.T, entry any) map[string]any {
	t.Helper()
	value, ok := entry.(map[string]any)
	if !ok {
		t.Fatal("manifest entry is not an object")
	}
	return value
}

func vectorCases(t *testing.T, vector map[string]any) []any {
	t.Helper()
	cases, ok := vector["cases"].([]any)
	if !ok {
		t.Fatal("vector cases are not an array")
	}
	return cases
}

func vectorCase(t *testing.T, value any) map[string]any {
	t.Helper()
	vector, ok := value.(map[string]any)
	if !ok {
		t.Fatal("vector case is not an object")
	}
	return vector
}

func TestConformanceManifestLoaderRejectsUnknownVersions(t *testing.T) {
	tests := []struct {
		name     string
		property string
		value    any
	}{
		{name: "format", property: "formatVersion", value: 2},
		{name: "protocol", property: "protocolVersion", value: "0.2"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			directory := copyConformanceFixture(t)
			path := filepath.Join(directory, "manifest.json")
			manifest := readJSONObject(t, path)
			manifest[test.property] = test.value
			writeJSONObject(t, path, manifest)
			if _, err := loadConformanceSuite(directory); err == nil || !strings.Contains(err.Error(), "unknown conformance") {
				t.Fatalf("expected unknown conformance version error, got %v", err)
			}
		})
	}
}

func TestConformanceManifestLoaderRejectsUnknownHandlerAndFile(t *testing.T) {
	t.Run("handler", func(t *testing.T) {
		directory := copyConformanceFixture(t)
		path := filepath.Join(directory, "manifest.json")
		manifest := readJSONObject(t, path)
		manifestEntry(t, manifestEntries(t, manifest)[0])["handler"] = "future-handler"
		writeJSONObject(t, path, manifest)
		if _, err := loadConformanceSuite(directory); err == nil || !strings.Contains(err.Error(), "unknown conformance handler") {
			t.Fatalf("expected unknown handler error, got %v", err)
		}
	})

	t.Run("file", func(t *testing.T) {
		directory := copyConformanceFixture(t)
		path := filepath.Join(directory, "manifest.json")
		manifest := readJSONObject(t, path)
		manifestEntry(t, manifestEntries(t, manifest)[0])["file"] = "renamed.json"
		writeJSONObject(t, path, manifest)
		if _, err := loadConformanceSuite(directory); err == nil || !strings.Contains(err.Error(), "unknown conformance file") {
			t.Fatalf("expected unknown file error, got %v", err)
		}
	})
}

func TestConformanceManifestLoaderRequiresCompleteInventory(t *testing.T) {
	t.Run("missing handler", func(t *testing.T) {
		directory := copyConformanceFixture(t)
		path := filepath.Join(directory, "manifest.json")
		manifest := readJSONObject(t, path)
		manifest["files"] = manifestEntries(t, manifest)[1:]
		writeJSONObject(t, path, manifest)
		if err := os.Remove(filepath.Join(directory, "canonicalization.json")); err != nil {
			t.Fatal(err)
		}
		if _, err := loadConformanceSuite(directory); err == nil || !strings.Contains(err.Error(), "missing conformance handler") {
			t.Fatalf("expected missing handler error, got %v", err)
		}
	})

	t.Run("missing file", func(t *testing.T) {
		directory := copyConformanceFixture(t)
		if err := os.Remove(filepath.Join(directory, "canonicalization.json")); err != nil {
			t.Fatal(err)
		}
		if _, err := loadConformanceSuite(directory); err == nil || !strings.Contains(err.Error(), "missing: canonicalization.json") {
			t.Fatalf("expected missing file error, got %v", err)
		}
	})

	t.Run("undeclared file", func(t *testing.T) {
		directory := copyConformanceFixture(t)
		if err := os.WriteFile(filepath.Join(directory, "future.json"), []byte("{}\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := loadConformanceSuite(directory); err == nil || !strings.Contains(err.Error(), "undeclared: future.json") {
			t.Fatalf("expected undeclared file error, got %v", err)
		}
	})
}

func TestConformanceManifestLoaderRejectsUnknownVectorVersion(t *testing.T) {
	directory := copyConformanceFixture(t)
	path := filepath.Join(directory, "claims.json")
	vector := readJSONObject(t, path)
	vector["version"] = "0.2"
	writeJSONObject(t, path, vector)
	if _, err := loadConformanceSuite(directory); err == nil || !strings.Contains(err.Error(), "unknown vector version") {
		t.Fatalf("expected unknown vector version error, got %v", err)
	}
}

func TestConformanceManifestLoaderRequiresUniqueCaseIDs(t *testing.T) {
	t.Run("empty", func(t *testing.T) {
		directory := copyConformanceFixture(t)
		path := filepath.Join(directory, "claims.json")
		vector := readJSONObject(t, path)
		vectorCase(t, vectorCases(t, vector)[0])["id"] = ""
		writeJSONObject(t, path, vector)
		if _, err := loadConformanceSuite(directory); err == nil || !strings.Contains(err.Error(), "non-empty id") {
			t.Fatalf("expected empty case ID error, got %v", err)
		}
	})

	t.Run("duplicate", func(t *testing.T) {
		directory := copyConformanceFixture(t)
		path := filepath.Join(directory, "payload-integrity.json")
		vector := readJSONObject(t, path)
		vectorCase(t, vectorCases(t, vector)[0])["id"] = "claims.all-supported-types"
		writeJSONObject(t, path, vector)
		if _, err := loadConformanceSuite(directory); err == nil || !strings.Contains(err.Error(), "duplicate conformance case id") {
			t.Fatalf("expected duplicate case ID error, got %v", err)
		}
	})
}
