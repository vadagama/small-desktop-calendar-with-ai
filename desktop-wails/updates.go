package main

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/endpoint"
)

const updateRepo = "/vadagama/small-desktop-calendar-with-ai/releases/"
const updateManifestURL = "https://github.com" + updateRepo + "latest/download/latest-wails-mac.json"
const updateBundleID = "kz.small.desktop-calendar.wails"
const updateAssetLimit = 256 << 20

var (
	buildVersion    = "Wails preview"
	updatePublicKey string
	updateTeam      string
	stableVersion   = regexp.MustCompile(`^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$`)
	teamIdentifier  = regexp.MustCompile(`^[A-Z0-9]{10}$`)
	stagingName     = regexp.MustCompile(`^wails-update-[0-9]+$`)
)

type updateState struct {
	Status         string  `json:"status"`
	CurrentVersion string  `json:"currentVersion"`
	Version        string  `json:"version,omitempty"`
	Notes          string  `json:"notes,omitempty"`
	Percent        float64 `json:"percent,omitempty"`
	CheckedAt      string  `json:"checkedAt,omitempty"`
	Message        string  `json:"message,omitempty"`
}

type updateProvider struct{ *endpoint.Provider }

func updateURLAllowed(u *url.URL) bool {
	if u == nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || u.Fragment != "" {
		return false
	}
	switch u.Host {
	case "github.com":
		return strings.HasPrefix(u.EscapedPath(), updateRepo)
	case "release-assets.githubusercontent.com", "objects.githubusercontent.com":
		return true
	}
	return false
}

func (p updateProvider) Check(ctx context.Context, req updater.CheckRequest) (*updater.Release, error) {
	rel, err := p.Provider.Check(ctx, req)
	if err != nil || rel == nil {
		return rel, err
	}
	if !validUpdateRelease(rel) {
		return nil, errors.New("unexpected Wails update")
	}
	return rel, nil
}

func validUpdateRelease(rel *updater.Release) bool {
	if !stableVersion.MatchString(rel.Version) || rel.Channel != "stable" ||
		rel.Artifact.Platform != "darwin" || rel.Artifact.Arch != "arm64" || rel.Artifact.Filetype != "zip" ||
		rel.Artifact.Size <= 0 || rel.Artifact.Size > updateAssetLimit ||
		rel.Verification == nil || rel.Verification.DigestAlgo != "sha256" || len(rel.Verification.Digest) != 32 ||
		rel.Verification.SignatureAlgo != "ed25519" || len(rel.Verification.Signature) != ed25519.SignatureSize ||
		len(rel.Notes) > 32<<10 {
		return false
	}
	filename := "Small-Calendar-Wails-" + rel.Version + "-arm64.zip"
	assetURL, _ := rel.Metadata["endpoint.artifact.url"].(string)
	return rel.Artifact.Filename == filename &&
		assetURL == "https://github.com"+updateRepo+"download/v"+rel.Version+"/"+filename
}

type updateWriter struct {
	io.Writer
	remaining int64
}

func (w *updateWriter) Write(data []byte) (int, error) {
	if int64(len(data)) > w.remaining {
		return 0, errors.New("update exceeds declared size")
	}
	n, err := w.Writer.Write(data)
	w.remaining -= int64(n)
	return n, err
}

func (p updateProvider) Download(ctx context.Context, rel *updater.Release, dst io.Writer, progress func(int64, int64)) error {
	w := &updateWriter{Writer: dst, remaining: rel.Artifact.Size}
	if err := p.Provider.Download(ctx, rel, w, progress); err != nil {
		return err
	}
	if w.remaining != 0 {
		return errors.New("incomplete update")
	}
	return nil
}

func verifySignedBundle(ctx context.Context, path, version string) error {
	if !strings.HasSuffix(path, ".app") || !stableVersion.MatchString(version) || !teamIdentifier.MatchString(updateTeam) {
		return errors.New("invalid update bundle identity")
	}
	requirement := `anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "` + updateTeam + `" and identifier "` + updateBundleID + `"`
	if err := exec.CommandContext(ctx, "/usr/bin/codesign", "--verify", "--deep", "--strict", "-R", "="+requirement, path).Run(); err != nil {
		return err
	}
	if err := exec.CommandContext(ctx, "/usr/sbin/spctl", "--assess", "--type", "execute", path).Run(); err != nil {
		return err
	}
	actual, err := exec.CommandContext(ctx, "/usr/bin/plutil", "-extract", "CFBundleShortVersionString", "raw", "-o", "-", filepath.Join(path, "Contents", "Info.plist")).Output()
	if err != nil || strings.TrimSpace(string(actual)) != version {
		return errors.New("update bundle version differs from manifest")
	}
	return nil
}

type UpdateService struct {
	mu      sync.Mutex
	state   updateState
	app     *application.App
	ctx     context.Context
	window  func() *application.WebviewWindow
	verify  func(context.Context, string, string) error
	handoff bool
}

func discardWailsUpdate(path string) {
	if path == "" || !strings.HasSuffix(path, ".app") {
		return
	}
	dir := filepath.Dir(path)
	executable, err := os.Executable()
	if err != nil {
		return
	}
	installed := filepath.Dir(filepath.Dir(filepath.Dir(executable)))
	info, err := os.Lstat(dir)
	if err == nil && info.IsDir() && info.Mode().Perm() == 0700 &&
		filepath.Dir(dir) == filepath.Dir(installed) && stagingName.MatchString(filepath.Base(dir)) {
		_ = os.RemoveAll(dir)
	}
}

func (s *UpdateService) shutdown() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.handoff {
		discardWailsUpdate(s.app.Updater.DownloadedPath())
	}
}

func (s *UpdateService) configure(ctx context.Context, app *application.App, defaultProfile bool) {
	s.app, s.ctx = app, ctx
	s.state = updateState{Status: "unsupported", CurrentVersion: buildVersion, Message: "Автообновление доступно для подписанной стабильной сборки с обычным профилем."}
	key, _ := base64.StdEncoding.DecodeString(updatePublicKey)
	if !defaultProfile || runtime.GOARCH != "arm64" || !stableVersion.MatchString(buildVersion) ||
		len(key) != ed25519.PublicKeySize || !teamIdentifier.MatchString(updateTeam) {
		return
	}
	bin, err := os.Executable()
	if err != nil {
		return
	}
	verifyCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	if verifySignedBundle(verifyCtx, filepath.Dir(filepath.Dir(filepath.Dir(bin))), buildVersion) != nil {
		return
	}
	client := &http.Client{Timeout: 90 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 5 || !updateURLAllowed(req.URL) {
			return errors.New("unexpected update redirect")
		}
		return nil
	}}
	provider, err := endpoint.New(endpoint.Config{
		URL:     updateManifestURL,
		Channel: "stable", HTTPClient: client,
	})
	if err != nil || app.Updater.Init(updater.Config{
		CurrentVersion: buildVersion, Providers: []updater.Provider{updateProvider{provider}},
		PublicKey: key, Channel: "stable", Window: updater.WindowNone,
	}) != nil {
		return
	}
	s.verify = verifySignedBundle
	s.state = updateState{Status: "idle", CurrentVersion: buildVersion}
	app.Event.On(updater.EventDownloadProgress, func(e *application.CustomEvent) {
		progress, ok := e.Data.(updater.Progress)
		if ok && progress.Total > 0 {
			s.mu.Lock()
			if s.state.Status == "downloading" {
				s.state.Percent = min(100, float64(progress.Written)*100/float64(progress.Total))
				s.publishLocked()
			}
			s.mu.Unlock()
		}
	})
}

func (s *UpdateService) publishLocked() { s.app.Event.Emit("small:update", s.state) }

func (s *UpdateService) Read() updateState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

func (s *UpdateService) Check() updateState {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch s.state.Status {
	case "idle", "current", "error":
		s.state = updateState{Status: "checking", CurrentVersion: buildVersion}
		s.publishLocked()
		go s.check()
	}
	return s.state
}

func (s *UpdateService) check() {
	ctx, cancel := context.WithTimeout(s.ctx, 2*time.Minute)
	defer cancel()
	release, err := s.app.Updater.Check(ctx)
	next := updateState{Status: "current", CurrentVersion: buildVersion, CheckedAt: time.Now().Format(time.RFC3339)}
	if err == nil && release != nil {
		next.Status, next.Version, next.Notes = "downloading", release.Version, release.Notes
		s.mu.Lock()
		s.state = next
		s.publishLocked()
		s.mu.Unlock()
		err = s.app.Updater.DownloadAndInstall(ctx)
		if err == nil {
			err = s.verify(ctx, s.app.Updater.DownloadedPath(), release.Version)
			if err != nil {
				discardWailsUpdate(s.app.Updater.DownloadedPath())
			}
		}
		next.Status, next.Percent = "ready", 100
	}
	if err != nil {
		next.Status, next.Message = "error", "Не удалось проверить или загрузить подписанное обновление. Повторите попытку."
	}
	s.mu.Lock()
	s.state = next
	s.publishLocked()
	s.mu.Unlock()
}

func (s *UpdateService) run() {
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-timer.C:
			s.Check()
			timer.Reset(4 * time.Hour)
		}
	}
}

func (s *UpdateService) Install() map[string]bool {
	s.mu.Lock()
	if s.state.Status != "ready" {
		s.mu.Unlock()
		return map[string]bool{"ok": false}
	}
	s.state.Status = "installing"
	version := s.state.Version
	s.publishLocked()
	s.mu.Unlock()
	dialog := s.app.Dialog.Question().SetTitle("Установить обновление?").
		SetMessage(appName + " перезапустится. Сохраните незавершённые изменения перед установкой.")
	if window := s.window(); window != nil {
		dialog.AttachToWindow(window)
	}
	dialog.AddButton("Отмена").SetAsCancel().SetAsDefault().OnClick(func() {
		s.finishInstall("ready", "")
	})
	dialog.AddButton("Установить и перезапустить").OnClick(func() {
		go func() {
			ctx, cancel := context.WithTimeout(s.ctx, 25*time.Second)
			defer cancel()
			if s.verify(ctx, s.app.Updater.DownloadedPath(), version) != nil {
				discardWailsUpdate(s.app.Updater.DownloadedPath())
				s.finishInstall("error", "Не удалось проверить пакет обновления.")
				return
			}
			s.mu.Lock()
			s.handoff = true
			s.mu.Unlock()
			if s.app.Updater.Restart(ctx) != nil {
				s.mu.Lock()
				s.handoff = false
				s.mu.Unlock()
				s.finishInstall("error", "Не удалось установить обновление. Повторите проверку.")
			}
		}()
	})
	dialog.Show()
	return map[string]bool{"ok": true}
}

func (s *UpdateService) finishInstall(status, message string) {
	s.mu.Lock()
	s.state.Status, s.state.Message = status, message
	s.publishLocked()
	s.mu.Unlock()
}
