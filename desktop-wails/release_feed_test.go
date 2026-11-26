package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/endpoint"
)

// Explicit release gate: public feed, signature, archive and Developer ID identity.
// Normal test runs remain offline and never download production packages.
func TestPublishedOrdoUpdate(t *testing.T) {
	keyFile := os.Getenv("ORDO_RELEASE_PUBLIC_KEY_FILE")
	if keyFile == "" {
		t.Skip("release verification requires the public update key")
	}
	body, err := os.ReadFile(keyFile)
	if err != nil {
		t.Fatal(err)
	}
	var keyInfo struct {
		PublicKey string `json:"publicKey"`
	}
	if err := json.Unmarshal(body, &keyInfo); err != nil {
		t.Fatal(err)
	}
	key, err := base64.StdEncoding.DecodeString(keyInfo.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	version := os.Getenv("ORDO_RELEASE_VERSION")
	if !stableVersion.MatchString(version) {
		t.Fatal("missing stable release version")
	}
	updateTeam = os.Getenv("ORDO_RELEASE_TEAM")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	provider, err := endpoint.New(endpoint.Config{URL: updateManifestURL, Channel: "stable", HTTPClient: &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if len(via) > 5 || !updateURLAllowed(r.URL) {
			return http.ErrUseLastResponse
		}
		return nil
	}}})
	if err != nil {
		t.Fatal(err)
	}
	makeUpdater := func(current string) *updater.Updater {
		up := updater.New(testUpdateHost{})
		if err := up.Init(updater.Config{CurrentVersion: current, Providers: []updater.Provider{updateProvider{provider}}, Channel: "stable", Platform: "darwin", Arch: "arm64", PublicKey: key, Window: updater.WindowNone}); err != nil {
			t.Fatal(err)
		}
		return up
	}
	old := makeUpdater("0.0.0")
	release, err := old.Check(ctx)
	if err != nil || release == nil || release.Version != version {
		t.Fatalf("published update not offered: %+v %v", release, err)
	}
	if err := old.DownloadAndInstall(ctx); err != nil {
		t.Fatal(err)
	}
	path := old.DownloadedPath()
	if path == "" || !strings.HasSuffix(path, ".app") {
		t.Fatal("missing staged app path")
	}
	parent := filepath.Dir(path)
	defer func() {
		info, err := os.Lstat(parent)
		if err == nil && info.IsDir() && info.Mode().Perm() == 0700 && strings.HasPrefix(filepath.Base(parent), "wails-update-") {
			_ = os.RemoveAll(parent)
		}
	}()
	if err := verifySignedBundle(ctx, path, version); err != nil {
		t.Fatal(err)
	}
	current := makeUpdater(version)
	if release, err := current.Check(ctx); err != nil || release != nil {
		t.Fatalf("current version not recognised: %+v %v", release, err)
	}
	t.Log("public update discovered, staged, Ed25519 and Developer ID verified; current version is up to date")
}
