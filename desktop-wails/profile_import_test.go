package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestImportElectronProfilePreservesSourceAndPublishesOnce(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "Electron")
	target := filepath.Join(root, "Wails")
	writeProfileFixture(t, source, "agent-settings.json", []byte(`{"mood":"neutral"}`))
	writeProfileFixture(t, source, "participant-memory/"+eventHash("account")+".json", []byte(`[]`))
	writeProfileFixture(t, source, "voice/source.json", []byte(`"fixture-device"`))
	writeProfileFixture(t, source, "voice/temporary/recording.wav", []byte("discarded audio"))
	writeProfileFixture(t, source, "Cookies", []byte("unrelated Chromium storage"))
	key := make([]byte, 32)
	writeProfileFixture(t, source, "local-vault/master.key", key)
	legacyFile := electronSecretPath("small-auth-session-v1")
	snapshot := `{"csrf":"12345678-1234-4567-8123-123456789abc","cookies":[{"name":"sid","value":"fixture-token","domain":".small.kz","path":"/gate/auth","secure":true,"httpOnly":true,"sameSite":"lax","expirationDate":4102444800.25}]}`
	wrapper, _ := json.Marshal(map[string]any{"version": 3, "session": snapshot, "username": "fixture", "accountId": "employee-a", "expired": false})
	record := sealElectronFixture(t, key, wrapper, "secret:small-auth-session-v1")
	writeProfileFixture(t, source, legacyFile, record)
	writeProfileFixture(t, source, electronSecretPath("model-key"), sealElectronFixture(t, key, []byte("test-secret"), "secret:model-key"))

	results := make(chan error, 2)
	var workers sync.WaitGroup
	for range 2 {
		workers.Go(func() { results <- importElectronProfile(source, target) })
	}
	workers.Wait()
	if first, second := <-results, <-results; (first == nil) == (second == nil) {
		t.Fatalf("expected one import: %v / %v", first, second)
	}
	for _, path := range []string{"agent-settings.json", "voice/source.json", electronSecretPath("model-key")} {
		want, _ := os.ReadFile(filepath.Join(source, path))
		actual, err := os.ReadFile(filepath.Join(target, path))
		if err != nil || string(actual) != string(want) {
			t.Fatalf("file %s was not preserved", path)
		}
	}
	for _, path := range []string{legacyFile, "Cookies", "voice/temporary/recording.wav"} {
		if _, err := os.Lstat(filepath.Join(target, path)); !os.IsNotExist(err) {
			t.Fatalf("unexpected copied file %s: %v", path, err)
		}
	}
	if original, err := os.ReadFile(filepath.Join(source, legacyFile)); err != nil || string(original) != string(record) {
		t.Fatal("source session changed")
	}
	saved, err := (sessionStore{target}).load()
	if err != nil || saved.Username != "fixture" || saved.Account != "employee-a" || len(saved.Cookies) != 1 {
		t.Fatalf("saved session metadata was not imported: %v", err)
	}
	cookie := saved.Cookies[0]
	if saved.CSRF != "12345678-1234-4567-8123-123456789abc" || cookie.Path != "/gate/auth" || cookie.Domain != ".small.kz" ||
		!cookie.HttpOnly || !cookie.Secure || cookie.Expires.UnixMilli() != 4102444800250 {
		t.Fatal("cookie attributes changed")
	}
}

func TestImportElectronProfileLeavesNoTargetOnInvalidInput(t *testing.T) {
	for _, name := range []string{"link", "missing vault key", "damaged session", "unrecognized source"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			source := filepath.Join(root, "Electron")
			target := filepath.Join(root, "Wails")
			if err := os.Mkdir(source, 0700); err != nil {
				t.Fatal(err)
			}
			if name != "unrecognized source" {
				writeProfileFixture(t, source, "topic-rules.json", []byte(`[]`))
			}
			switch name {
			case "link":
				if err := os.Symlink("topic-rules.json", filepath.Join(source, "agent-settings.json")); err != nil {
					t.Fatal(err)
				}
			case "missing vault key":
				writeProfileFixture(t, source, electronSecretPath("model-key"), []byte("encrypted"))
			case "damaged session":
				writeProfileFixture(t, source, "local-vault/master.key", make([]byte, 32))
				writeProfileFixture(t, source, electronSecretPath("small-auth-session-v1"), []byte("damaged"))
			}
			if err := importElectronProfile(source, target); err == nil {
				t.Fatal("accepted invalid profile")
			}
			if _, err := os.Lstat(target); !os.IsNotExist(err) {
				t.Fatalf("failed import published destination: %v", err)
			}
			entries, err := os.ReadDir(root)
			if err != nil || len(entries) != 1 {
				t.Fatalf("failed import left a staging directory: %v", err)
			}
		})
	}
}

func writeProfileFixture(t *testing.T, root, name string, data []byte) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func sealElectronFixture(t *testing.T, key, data []byte, context string) []byte {
	t.Helper()
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, aead.NonceSize())
	sealed := aead.Seal(nil, nonce, data, []byte("small-calendar:1:"+context))
	return append(append(append([]byte("SCV1"), nonce...), sealed[len(data):]...), sealed[:len(data)]...)
}

func TestImportRejectsCaseVariantSourceAncestor(t *testing.T) {
	source := filepath.Join(t.TempDir(), "Electron")
	writeProfileFixture(t, source, "reminders.json", []byte(`{}`))
	alias := filepath.Join(filepath.Dir(source), "electron")
	if _, err := os.Stat(alias); err != nil {
		t.Skip("case-sensitive temporary filesystem")
	}
	target := filepath.Join(alias, "Wails")
	if err := importElectronProfile(source, target); err == nil {
		t.Fatal("published a Wails directory inside the source profile")
	}
}

func TestDecodeElectronSessionVersions(t *testing.T) {
	source := `{"csrf":"12345678-1234-4567-8123-123456789abc","cookies":[{"name":"a","value":"b","domain":"team.small.kz","path":"/","secure":true,"httpOnly":false,"sameSite":"unspecified"}]}`
	for _, tc := range []struct {
		name     string
		body     []byte
		account  string
		username string
		unbound  bool
		expired  bool
	}{
		{name: "original", body: []byte(source), unbound: true},
		{name: "version 2", body: mustEncodeSessionFixture(t, map[string]any{"version": 2, "session": source,
			"login": map[string]any{"accountId": "fixture", "username": "old", "password": "legacy-marker"}}), account: "fixture", username: "old"},
		{name: "expired tombstone", body: []byte(`{"version":3,"session":null,"accountId":null,"username":"saved","expired":true}`), username: "saved", expired: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result, err := decodeElectronSession(tc.body)
			if err != nil || result.Account != tc.account || result.Username != tc.username ||
				result.Unbound != tc.unbound || result.Expired != tc.expired {
				t.Fatalf("wrong decoded session: %v", err)
			}
			if bytes.Contains(mustEncodeSessionFixture(t, result), []byte("legacy-marker")) {
				t.Fatal("legacy password ended up in target snapshot")
			}
		})
	}
	if _, err := decodeElectronSession([]byte(`{"version":3,"accountId":"fixture","username":"test","expired":false}`)); err == nil {
		t.Fatal("accepted a v3 record without session field")
	}
}

func mustEncodeSessionFixture(t *testing.T, input any) []byte {
	t.Helper()
	result, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
