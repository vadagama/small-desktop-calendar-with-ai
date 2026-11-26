package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestSmallSession(t *testing.T) {
	var responses atomic.Int32
	var denyResponse atomic.Bool
	token := func(id, signature string) string {
		claims := fmt.Sprintf(`{"uid":%q,"name":"Test User","preferred_username":"test","guidfl":"participant"}`, id)
		return "header." + base64.RawURLEncoding.EncodeToString([]byte(claims)) + "." + signature
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(r.Header.Get("X-K-Csrf")) != 36 {
			t.Error("missing CSRF UUID")
		}
		switch r.URL.Path {
		case "/gate/auth/login":
			var credentials struct {
				Username string `json:"username"`
				Password string `json:"password"`
				Remember bool   `json:"remember_me"`
			}
			if r.Method != http.MethodPost || json.NewDecoder(r.Body).Decode(&credentials) != nil ||
				credentials.Username != "test" || credentials.Password != "fixture" || !credentials.Remember {
				t.Error("invalid login contract")
			}
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "fixture", Path: "/"})
			fmt.Fprintf(w, `{"data":{"access_token":%q}}`, token("test-account", "initial"))
		case "/gate/team/api/user/info":
			fmt.Fprint(w, `{"data":{}}`)
		case "/gate/team/api/calendars/public":
			if r.Header.Get("Authorization") != "Bearer "+token("test-account", "renewed") {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			fmt.Fprint(w, `{"data":[{"id":"calendar","name":"Test calendar"}]}`)
		case "/gate/team/api/calendars/my/events":
			if r.Method != http.MethodGet || r.URL.Query().Get("start_date") != "2026-11-24T19:00:00.000Z" ||
				r.URL.Query().Get("end_date") != "2026-11-25T19:00:00.000Z" {
				t.Error("invalid event range contract")
			}
			fmt.Fprint(w, `{"data":[]}`)
		case "/gate/team/api/calendar/events/42":
			fmt.Fprint(w, `{"data":{"id":42,"participants":[{"id":"participant"}]}}`)
		case "/gate/team/api/calendar/events/43":
			fmt.Fprint(w, `{"data":{"id":43,"participants":[{"id":"somebody-else"}]}}`)
		case "/gate/team/api/calendar/events/42/participant-status":
			responses.Add(1)
			var input struct {
				Status string `json:"status"`
			}
			if r.Method != http.MethodPatch || json.NewDecoder(r.Body).Decode(&input) != nil ||
				(input.Status != "accepted" && input.Status != "declined") {
				t.Error("invalid invitation response contract")
			}
			if denyResponse.Load() {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			fmt.Fprint(w, `{}`)
		case "/gate/auth/refresh":
			if _, err := r.Cookie("session"); err != nil {
				t.Error("refresh did not retain its isolated cookie")
			}
			fmt.Fprintf(w, `{"data":{"access_token":%q}}`, token("test-account", "renewed"))
		case "/gate/auth/logout":
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected endpoint: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)

	ctx := context.Background()
	service := newSmallService(server.URL)
	if reply := service.Read(ctx); !reply.OK || reply.State.Status != "signed-out" {
		t.Fatalf("expected a clean signed-out state: %+v", reply)
	}
	login := service.Login(ctx, smallCredentials{Username: " T e s t ", Password: "fixture"})
	if !login.OK || login.State.Profile.ID != "test-account" {
		t.Fatalf("unexpected login reply: %+v", login)
	}
	if reply := service.Calendars(ctx, calendarAccount{AccountID: "another"}); reply.Kind != "auth" {
		t.Fatalf("expected an account mismatch rejection: %+v", reply)
	}
	catalog := service.Calendars(ctx, calendarAccount{AccountID: "test-account"})
	if !catalog.OK || len(*catalog.Data) != 1 || (*catalog.Data)[0].ID != "calendar" {
		t.Fatalf("unexpected catalog after refresh: %+v", catalog)
	}
	const start, end = "2026-11-24T19:00:00.000Z", "2026-11-25T19:00:00.000Z"
	if reply := service.EventSource(ctx, "test-account", "../private", start, end, true); reply.Kind != "invalid" {
		t.Fatalf("expected invalid calendar source: %+v", reply)
	}
	if reply := service.EventSource(ctx, "test-account", "my", start, end, true); !reply.OK || reply.Data.Body != `{"data":[]}` {
		t.Fatalf("unexpected event source: %+v", reply)
	}
	for _, reserved := range []string{"from-template", "busy-intervals", "find-slots", "generated"} {
		if reply := service.EventDetail(ctx, "test-account", reserved, ""); reply.Kind != "invalid" {
			t.Fatalf("reserved event route %q must be rejected: %+v", reserved, reply)
		}
	}
	if reply := service.Respond(ctx, invitationResponse{"other", "42", "accepted"}); reply.Kind != "auth" {
		t.Fatalf("expected account isolation: %+v", reply)
	}
	if reply := service.Respond(ctx, invitationResponse{"test-account", "43", "accepted"}); reply.Kind != "denied" {
		t.Fatalf("expected membership check: %+v", reply)
	}
	if reply := service.Respond(ctx, invitationResponse{"test-account", "42", "maybe"}); reply.Kind != "invalid" {
		t.Fatalf("expected invalid status: %+v", reply)
	}
	if responses.Load() != 0 {
		t.Fatal("rejected requests must not send a write")
	}
	if reply := service.Respond(ctx, invitationResponse{"test-account", "42", "accepted"}); !reply.OK {
		t.Fatalf("expected a successful write: %+v", reply)
	}
	denyResponse.Store(true)
	if reply := service.Respond(ctx, invitationResponse{"test-account", "42", "declined"}); reply.Kind != "auth" || responses.Load() != 2 {
		t.Fatalf("unauthorized mutations must not be replayed: reply=%+v requests=%d", reply, responses.Load())
	}
	logout := service.Logout(ctx)
	if !logout.OK || logout.State.Status != "signed-out" || logout.State.Username != "test" {
		t.Fatalf("unexpected logout reply: %+v", logout)
	}
	if reply := service.Calendars(ctx, calendarAccount{AccountID: "test-account"}); reply.Kind != "auth" {
		t.Fatalf("expected a signed-out rejection: %+v", reply)
	}
}

func TestSessionStoreReopensAfterOfflineStartup(t *testing.T) {
	const user = "fixture-user"
	const password = "fixture-password"
	const cookie = "fixture-authentication-cookie"
	const claims = `{"uid":"account","name":"Test User","preferred_username":"fixture-user"}`
	token := "header." + base64.RawURLEncoding.EncodeToString([]byte(claims)) + ".signature"
	var offline, expired, eventsOffline, profileDenied atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/gate/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "sid", Value: cookie, Path: "/gate", MaxAge: 3600})
			fmt.Fprintf(w, `{"data":{"access_token":%q}}`, token)
		case "/gate/auth/refresh":
			if offline.Load() {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			if expired.Load() {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			sid, err := r.Cookie("sid")
			if err != nil || sid.Value != cookie {
				t.Error("refresh did not restore the saved cookie")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			fmt.Fprintf(w, `{"data":{"access_token":%q}}`, token)
		case "/gate/team/api/user/info":
			if profileDenied.Load() {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			fmt.Fprint(w, `{"data":{}}`)
		case "/gate/team/api/calendars/other/events":
			w.WriteHeader(http.StatusNotFound)
		case "/gate/team/api/calendars/my/events":
			if eventsOffline.Load() {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			fmt.Fprint(w, `{"data":[{"id":"a","title":"Test private meeting","starts_at":"2026-11-25T05:00:00Z","ends_at":"2026-11-25T06:00:00Z"}]}`)
		case "/gate/auth/logout":
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected endpoint: %s", r.URL.Path)
		}
	}))
	t.Cleanup(server.Close)

	directory := t.TempDir()
	open := func() *SmallService {
		service := newSmallService(server.URL)
		service.store = &sessionStore{directory: directory}
		service.pendingRestore = true
		return service
	}
	ctx := context.Background()
	initial := open()
	if login := initial.Login(ctx, smallCredentials{Username: user, Password: password}); !login.OK {
		t.Fatalf("expected successful login: %+v", login)
	}
	const start, end = "2026-11-24T19:00:00.000Z", "2026-11-25T19:00:00.000Z"
	fresh := initial.EventSource(ctx, "account", "my", start, end, false)
	if !fresh.OK || fresh.Data.Stale || !strings.Contains(fresh.Data.Body, "Test private meeting") {
		t.Fatalf("unexpected fresh event source: %+v", fresh)
	}
	cacheFiles, err := filepath.Glob(filepath.Join(directory, "calendar-cache", "*.enc"))
	if err != nil || len(cacheFiles) != 1 {
		t.Fatalf("expected one cache file: %v, %v", cacheFiles, err)
	}
	cacheBytes, err := os.ReadFile(cacheFiles[0])
	if err != nil || bytes.Contains(cacheBytes, []byte("Test private meeting")) {
		t.Fatal("event cache must contain ciphertext")
	}
	file := filepath.Join(directory, sessionFile)
	encrypted, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{user, password, cookie, token} {
		if bytes.Contains(encrypted, []byte(secret)) {
			t.Fatal("session file exposes sensitive data")
		}
	}
	offline.Store(true)
	reopened := open()
	if reply := reopened.Read(ctx); !reply.OK || reply.State.Profile == nil || reply.State.Profile.ID != "account" {
		t.Fatalf("expected offline cached identity: %+v", reply)
	}
	unchanged, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(unchanged, encrypted) {
		t.Fatal("temporary service failure changed the saved session")
	}
	if reply := reopened.EventSource(ctx, "account", "my", start, end, true); !reply.OK || !reply.Data.Stale {
		t.Fatalf("expected cached events when the session API is offline: %+v", reply)
	}
	offline.Store(false)
	if reply := reopened.Read(ctx); !reply.OK || reply.State.Profile == nil || reply.State.Profile.ID != "account" {
		t.Fatalf("expected restored session: %+v", reply)
	}
	eventsOffline.Store(true)
	stale := reopened.EventSource(ctx, "account", "my", start, end, true)
	if !stale.OK || !stale.Data.Stale || stale.Data.FetchedAt != fresh.Data.FetchedAt || stale.Data.Body != fresh.Data.Body {
		t.Fatalf("expected the intact cached event source: %+v", stale)
	}
	if reply := reopened.EventSource(ctx, "account", "my", start, end, false); reply.Kind != "network" {
		t.Fatalf("explicit refresh must report network failure: %+v", reply)
	}
	if reply := reopened.EventSource(ctx, "other", "my", start, end, true); reply.Kind != "auth" {
		t.Fatalf("expected account isolation during cache fallback: %+v", reply)
	}
	if reply := reopened.EventSource(ctx, "account", "other", start, end, true); reply.Kind != "not-found" {
		t.Fatalf("expected distinct calendar sources: %+v", reply)
	}
	expired.Store(true)
	if reply := open().Read(ctx); !reply.OK || reply.State.Reason != "expired" || reply.State.Username != user {
		t.Fatalf("expected an expired signed-out state: %+v", reply)
	}
	if reply := open().Read(ctx); !reply.OK || reply.State.Reason != "expired" {
		t.Fatalf("expected a durable expiry marker: %+v", reply)
	}
	if _, err := os.Stat(cacheFiles[0]); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("expired session must remove its cached events")
	}
	if reply := reopened.Logout(ctx); !reply.OK {
		t.Fatalf("expected successful logout: %+v", reply)
	}
	if reply := open().Read(ctx); !reply.OK || reply.State.Status != "signed-out" || reply.State.Username != user {
		t.Fatalf("expected only saved username: %+v", reply)
	}
	expired.Store(false)
	eventsOffline.Store(false)
	if login := reopened.Login(ctx, smallCredentials{Username: user, Password: password}); !login.OK {
		t.Fatalf("expected a new authenticated session: %+v", login)
	}
	if reply := reopened.EventSource(ctx, "account", "my", start, end, false); !reply.OK {
		t.Fatal("expected a cache entry before denial")
	}
	profileDenied.Store(true)
	if reply := reopened.Read(ctx); reply.Kind != "auth" {
		t.Fatalf("expected an explicit denial: %+v", reply)
	}
	offline.Store(true)
	if reply := open().Read(ctx); !reply.OK || reply.State.Status != "signed-out" {
		t.Fatalf("explicit denial must survive restart without offline access: %+v", reply)
	}
	if reply := reopened.EventSource(ctx, "account", "my", start, end, true); reply.Kind != "auth" {
		t.Fatalf("explicit denial must invalidate cached calendar data: %+v", reply)
	}
	if err := os.Remove(filepath.Join(directory, "master.key")); err != nil {
		t.Fatal(err)
	}
	if reply := open().Read(ctx); reply.Kind != "storage" {
		t.Fatalf("expected a missing-key error: %+v", reply)
	}
	if err := (sessionStore{directory: directory}).save(sessionSnapshot{}); err == nil {
		t.Fatal("missing key must not replace a saved record")
	}
}
