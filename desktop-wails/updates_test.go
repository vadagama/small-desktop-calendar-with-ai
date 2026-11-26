package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/endpoint"
)

type testUpdateHost struct{}

func (testUpdateHost) Emit(string, ...any) bool         { return true }
func (testUpdateHost) OnEvent(string, func(any)) func() { return func() {} }
func (testUpdateHost) OpenWindow(updater.WindowOptions) updater.WindowHandle {
	panic("unexpected update window")
}
func (testUpdateHost) Quit() { panic("staging must not trigger restart") }

type updateTestTransport struct{ handler http.Handler }

func (r updateTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	recorder := httptest.NewRecorder()
	r.handler.ServeHTTP(recorder, req)
	response := recorder.Result()
	response.Request = req
	return response, nil
}

func TestWailsUpdaterStagesSignedGitHubRelease(t *testing.T) {
	key, secret, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	image, err := writer.Create("Ordo.app/Contents/Info.plist")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.WriteString(image, "synthetic application manifest")
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(archive.Bytes())
	sig := ed25519.Sign(secret, digest[:])
	const filename = "Small-Calendar-Wails-2.0.0-arm64.zip"
	const taggedRelease = updateRepo + "download/v2.0.0/"
	const assetHost = "https://release-assets.githubusercontent.com/synthetic/"
	current := map[string]any{
		"platform": "darwin", "arch": "arm64", "filetype": "zip",
		"filename": filename, "size": archive.Len(),
		"url": "https://github.com" + taggedRelease + filename, "digestAlgo": "sha256",
		"digest": base64.StdEncoding.EncodeToString(digest[:]), "signatureAlgo": "ed25519",
	}
	client := &http.Client{
		Transport: updateTestTransport{http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Host + r.URL.Path {
			case "github.com" + updateRepo + "latest/download/latest-wails-mac.json":
				query := r.URL.Query()
				if query.Get("platform") != "darwin" || query.Get("arch") != "arm64" ||
					query.Get("version") != "1.0.0" || query.Get("channel") != "stable" {
					t.Errorf("unexpected update query %v", query)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				http.Redirect(w, r, "https://github.com"+taggedRelease+"latest-wails-mac.json", http.StatusFound)
			case "github.com" + taggedRelease + "latest-wails-mac.json":
				http.Redirect(w, r, assetHost+"manifest", http.StatusFound)
			case "github.com" + taggedRelease + filename:
				http.Redirect(w, r, assetHost+filename, http.StatusFound)
			case "release-assets.githubusercontent.com/synthetic/manifest":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"schemaVersion": 1, "version": "2.0.0", "channel": "stable", "artifacts": []any{current},
				})
			case "release-assets.githubusercontent.com/synthetic/" + filename:
				_, _ = w.Write(archive.Bytes())
			default:
				t.Errorf("unexpected update URL %s", r.URL)
				http.NotFound(w, r)
			}
		})},
		CheckRedirect: func(r *http.Request, _ []*http.Request) error {
			if !updateURLAllowed(r.URL) {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
	provider, err := endpoint.New(endpoint.Config{URL: updateManifestURL, Channel: "stable", HTTPClient: client})
	if err != nil {
		t.Fatal(err)
	}
	stage := func(signature []byte) (string, error) {
		current["signature"] = base64.StdEncoding.EncodeToString(signature)
		up := updater.New(testUpdateHost{})
		if err := up.Init(updater.Config{
			CurrentVersion: "1.0.0", Providers: []updater.Provider{updateProvider{provider}},
			Channel: "stable", Platform: "darwin", Arch: "arm64", PublicKey: key, Window: updater.WindowNone,
		}); err != nil {
			t.Fatal(err)
		}
		release, err := up.Check(context.Background())
		if err != nil || release == nil {
			t.Fatalf("check: %+v %v", release, err)
		}
		err = up.DownloadAndInstall(context.Background())
		return up.DownloadedPath(), err
	}
	path, err := stage(sig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(filepath.Dir(path)) })
	if _, err := os.Stat(filepath.Join(path, "Contents", "Info.plist")); err != nil {
		t.Fatal("signed update was not staged", err)
	}
	sig[0] ^= 1
	if path, err := stage(sig); err == nil || path != "" {
		t.Fatal("altered update signature was accepted")
	}
	sig[0] ^= 1
	current["size"] = archive.Len() - 1
	if path, err := stage(sig); err == nil || path != "" {
		t.Fatal("archive larger than the declared size was accepted")
	}
}
