package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

type migratedProfileTransport struct{ fixture string }

func (tr migratedProfileTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme != "https" || req.URL.Host != "team.small.kz" {
		return nil, fmt.Errorf("unexpected fixture request")
	}
	routed := req.Clone(req.Context())
	u, err := url.Parse(tr.fixture + req.URL.RequestURI())
	if err != nil {
		return nil, err
	}
	routed.URL = u
	return http.DefaultTransport.RoundTrip(routed)
}

func migratedProfileSmall(fixture string) *SmallService {
	small := newSmallService("https://team.small.kz")
	small.client.Transport = migratedProfileTransport{fixture}
	return small
}

func TestElectronProfileMigrationAcrossRuntimes(t *testing.T) {
	node, err := nodeExecutable()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	source, target := filepath.Join(dir, "Electron"), filepath.Join(dir, "Wails")
	date := time.Now().In(smallZone).Format(time.DateOnly)
	runFixture := func(mode, path string) {
		t.Helper()
		command := exec.Command(node, "--import", "tsx", "../tests/fixtures/electron-profile.ts", mode, path, date)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("Electron store fixture %s: %v\n%s", mode, err, output)
		}
	}
	runFixture("write", source)
	if err := importElectronProfile(source, target); err != nil {
		t.Fatal(err)
	}
	runFixture("target", target)
	runFixture("source", source)
	readVoice := func(dir, name string) []byte {
		t.Helper()
		value, err := os.ReadFile(filepath.Join(dir, "voice", name))
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	for _, name := range []string{"source.json", "ggml-large-v3-turbo.bin.part"} {
		if !bytes.Equal(readVoice(source, name), readVoice(target, name)) {
			t.Fatal("voice data was changed")
		}
	}

	var refreshed, writes atomic.Int32
	var networkStatus atomic.Int32
	networkStatus.Store(http.StatusServiceUnavailable)
	const account = "fixture-import-a"
	const other = "fixture-import-b"
	token := func(sub string) string {
		encoded := base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(
			`{"uid":%q,"name":"Fixture","preferred_username":"fixture-a","guidfl":"fixture-person"}`, sub)))
		return "header." + encoded + ".signature"
	}
	var refreshedAccount atomic.Value
	refreshedAccount.Store(account)
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/gate/auth/refresh":
			cookie, err := r.Cookie("fixture-cookie")
			if err != nil || cookie.Value != "synthetic-session" ||
				r.Header.Get("X-K-Csrf") != "00000000-0000-4000-8000-000000000025" {
				t.Error("missing migrated session fields on refresh")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			refreshed.Add(1)
			fmt.Fprintf(w, `{"data":{"access_token":%q}}`, token(refreshedAccount.Load().(string)))
		case "/gate/team/api/user/info":
			fmt.Fprint(w, `{"data":{}}`)
		case "/gate/team/api/calendars/my/events", "/gate/team/api/calendars/public", "/gate/employee/api/search/persons":
			w.WriteHeader(int(networkStatus.Load()))
		case "/gate/auth/logout":
			w.WriteHeader(http.StatusNoContent)
		default:
			if r.Method != http.MethodGet {
				writes.Add(1)
			}
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(fixture.Close)

	if os.Getenv("SMALL_WAILS_WEBVIEW_TEST") == "1" {
		testBin, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		ctx, stop := context.WithTimeout(context.Background(), 30*time.Second)
		defer stop()
		cmd := exec.CommandContext(ctx, testBin)
		cmd.Env = append(os.Environ(), "SMALL_WAILS_TEST_SCENARIO=imported-profile",
			"SMALL_WAILS_TEST_PROFILE="+target, "SMALL_WAILS_TEST_ORIGIN="+fixture.URL)
		if output, err := cmd.CombinedOutput(); err != nil || !bytes.Contains(output, []byte("WKWebView scenario passed")) {
			t.Fatalf("hidden imported profile: %v\n%s", err, output)
		}
	}

	small := migratedProfileSmall(fixture.URL)
	small.store = &sessionStore{target}
	small.pendingRestore = true
	ctx := context.Background()
	if reply := small.Read(ctx); !reply.OK || reply.State.Profile == nil || reply.State.Profile.ID != account || refreshed.Load() == 0 {
		t.Fatal("restored Small session did not refresh to the expected account")
	}
	catalog := small.Calendars(ctx, calendarAccount{AccountID: account})
	if !catalog.OK || len(*catalog.Data) != 1 || (*catalog.Data)[0].Name != "Imported room" {
		t.Fatal("imported catalog unavailable")
	}
	if hit := small.ImportedCalendarCache(ctx, other, "catalog", "calendars"); hit != nil {
		t.Fatal("cache was visible to another account")
	}
	if !small.hasElectronMutation("event-mutations", "fixture&<\u2028>\\u2029", "fixture-special") {
		t.Fatal("journal key differs from JavaScript")
	}
	if result := small.Reschedule(ctx, eventMove{AccountID: account, EventID: "fixture-event"}); result.OK || !result.UnknownOutcome || writes.Load() != 0 {
		t.Fatal("a prior Electron journal failed to block a repeat write")
	}
	series := seriesRequest{AccountID: account, SeriesID: "fixture-series", Operation: "delete",
		Scope: "occurrence", OriginalDate: "2099-01-15", BeforeStart: "2099-01-15T09:00:00+05:00",
		BeforeEnd: "2099-01-15T09:30:00+05:00"}
	if result := small.ApplySeries(ctx, series); result.OK || !result.UnknownOutcome || writes.Load() != 0 {
		t.Fatal("a prior Electron series journal failed to block a repeat write")
	}
	draft := meetingDraft{ID: "test-draft", Revision: 1, Organizer: small.profile, Participants: []string{"fixture-person"},
		Start: series.BeforeStart, End: series.BeforeEnd}
	small.drafts[draft.ID] = draft
	if result := small.ConfirmMeeting(ctx, meetingReference{ID: draft.ID, Revision: draft.Revision}); result.OK ||
		!result.UnknownOutcome || writes.Load() != 0 {
		t.Fatal("a prior Electron meeting journal failed to block a repeat write")
	}

	networkStatus.Store(http.StatusForbidden)
	day, err := time.ParseInLocation(time.DateOnly, date, smallZone)
	if err != nil {
		t.Fatal(err)
	}
	key := electronJSON([]any{day.UTC().Format("2006-01-02T15:04:05.000Z"),
		day.AddDate(0, 0, 1).UTC().Format("2006-01-02T15:04:05.000Z"), true, []string{}})
	if hit := small.ImportedCalendarCache(ctx, account, "events", key); hit == nil {
		t.Fatal("imported range cache unavailable")
	}
	if reply := small.Calendars(ctx, calendarAccount{AccountID: account}); reply.OK || reply.Kind != "denied" {
		t.Fatal("access denial did not supersede imported cache")
	}
	start, end := date+"T00:00:00+05:00", date+"T20:00:00+05:00"
	if reply := small.EventSource(ctx, account, "my", start, end, true); reply.OK || reply.Kind != "denied" {
		t.Fatal("access denial did not supersede event cache")
	}
	if reply := small.People(ctx, account, "fixture", 1); reply.OK || reply.Kind != "denied" {
		t.Fatal("access denial did not supersede people cache")
	}
	networkStatus.Store(http.StatusServiceUnavailable)
	if reply := small.Calendars(ctx, calendarAccount{AccountID: account}); reply.OK {
		t.Fatal("denied calendar catalog was served from the stale cache")
	}
	if hit := small.ImportedCalendarCache(ctx, account, "events", key); hit != nil {
		t.Fatal("denied events served from the stale cache")
	}
	if hit := small.ImportedCalendarCache(ctx, account, "catalog", `["people","fixture",1]`); hit != nil {
		t.Fatal("denied people served from the stale cache")
	}
	if reply := small.Logout(ctx); !reply.OK {
		t.Fatal("failed to log out of imported session")
	}
	flags := refreshed.Load()
	afterLogout := migratedProfileSmall(fixture.URL)
	afterLogout.store, afterLogout.pendingRestore = small.store, true
	if reply := afterLogout.Read(ctx); !reply.OK || reply.State.Status != "signed-out" || refreshed.Load() != flags {
		t.Fatal("app restored a stale copy of the Electron session after logout")
	}

	separate := filepath.Join(dir, "Mismatch")
	if err := importElectronProfile(source, separate); err != nil {
		t.Fatal(err)
	}
	refreshedAccount.Store(other)
	mismatch := migratedProfileSmall(fixture.URL)
	mismatch.store, mismatch.pendingRestore = &sessionStore{separate}, true
	if reply := mismatch.Read(ctx); !reply.OK || reply.State.Status != "signed-out" || reply.State.Reason != "expired" {
		t.Fatal("imported session authenticated to a different account")
	}
	runFixture("source", source)
}

const migratedProfileSmokeScript = `
(async () => {
	let stage = 'bridge';
	try {
		for (let i = 0; i < 60 && !window.smallDesktop; i++)
			await new Promise(resolve => setTimeout(resolve, 100));
		const bridge = window.smallDesktop;
		stage = 'small';
		const login = await bridge.smallAuth.read();
		if (!login.ok || login.state.profile?.id !== 'fixture-import-a') return;
		stage = 'settings';
		const settings = await bridge.agentSettings.read();
		const memory = await bridge.memory.read();
		const profiles = await bridge.profiles.read();
		const reminders = await bridge.reminders.read();
		if (!settings.ok || settings.state.settings.mood !== 'strict' ||
			settings.state.settings.instructions !== 'Imported instructions' ||
			!memory.ok || memory.state.groups[0]?.name !== 'Imported group' ||
			memory.state.presets[0]?.name !== 'Imported format' ||
			!profiles.ok || profiles.state.profiles[0]?.keySuffix !== '1379' ||
			!reminders.ok || reminders.state.settings.minutes !== 17) return;
		stage = 'cache';
		const common = { accountId: login.state.profile.id };
		const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty',
			year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
		const snapshot = await bridge.calendar.events({ ...common, date, view: 'day',
			myCalendar: true, calendarIds: [], allowStale: true });
		const people = await bridge.calendar.people({ ...common, query: 'fixture', page: 1 });
		if (!snapshot.ok || snapshot.data.freshness !== 'stale' ||
			snapshot.data.events[0]?.title !== 'Imported calendar snapshot' ||
			!people.ok || people.data.people[0]?.participantId !== 'fixture-person') return;
		await fetch('/__preview_ready');
	} finally {
		await fetch('/__preview_ready?pending=' + stage);
	}
})();
`
