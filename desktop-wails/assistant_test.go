package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func assistantInvoke(a *AssistantService, ctx context.Context, method string, input any) json.RawMessage {
	raw, _ := json.Marshal(input)
	return a.Invoke(ctx, method, raw)
}
func assistantOK(t *testing.T, raw json.RawMessage) {
	t.Helper()
	var result struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if json.Unmarshal(raw, &result) != nil || !result.OK {
		t.Fatalf("assistant operation failed: %s", result.Error)
	}
}

func TestAssistantRuntimeToolsAndPersistence(t *testing.T) {
	if _, err := nodeExecutable(); err != nil {
		t.Fatal("Node.js required for the Wails assistant test")
	}
	account := "fixture-account"
	const proposalText = "Use a short synthetic agenda."
	const meetingTitle = "Synthetic planning meeting"
	const meetingStart = "2099-10-29T14:00:00+05:00"
	guests := make([]string, 20)
	roster := []map[string]string{{"id": "organizer", "name": "Fixture"}}
	for i := range guests {
		guests[i] = fmt.Sprintf("fixture-guest-%d", i)
		roster = append(roster, map[string]string{"id": guests[i], "name": guests[i]})
	}
	participants := append(slices.Clone(guests), "organizer")
	day := time.Now().In(smallZone).Format(time.DateOnly)
	claims := base64.RawURLEncoding.EncodeToString([]byte(`{"uid":"fixture-account","name":"Fixture","preferred_username":"fixture","guidfl":"organizer"}`))
	var providerCalls, calendarCalls, calendarWrites atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/gate/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "fixture", Value: "yes", Path: "/"})
			fmt.Fprintf(w, `{"data":{"access_token":"header.%s.signature"}}`, claims)
		case "/gate/team/api/user/info":
			fmt.Fprint(w, `{"data":{}}`)
		case "/gate/team/api/calendars/my/events":
			calendarCalls.Add(1)
			fmt.Fprintf(w, `{"data":[{"id":"fixture-event","title":"Synthetic shift","starts_at":%q,"ends_at":%q}]}`, day+"T09:00:00+05:00", day+"T10:00:00+05:00")
		case "/gate/team/api/calendar/events/fixture-event":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
				"id": "fixture-event", "creator_id": "organizer", "title": "Synthetic shift",
				"starts_at": day + "T09:00:00+05:00", "ends_at": day + "T10:00:00+05:00",
				"participants": roster,
			}})
		case "/gate/employee/api/search/persons":
			id := r.URL.Query().Get("q")
			if !slices.Contains(guests, id) {
				http.NotFound(w, r)
				return
			}
			fmt.Fprintf(w, `{"data":{"items":[{"person_guid":%q,"person_full_fio":%q,"position_name":"Fixture"}],"pagination":{"current_page":1,"last_page":1}}}`, id, id)
		case "/gate/team/api/calendar/events/busy-intervals":
			var query struct {
				Participants []string `json:"participant_ids"`
			}
			if json.NewDecoder(r.Body).Decode(&query) != nil || !slices.Equal(query.Participants, participants) {
				t.Error("assistant omitted participants from availability check")
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			records := make([]map[string]any, 0, len(participants))
			for _, id := range participants {
				records = append(records, map[string]any{"type": "participant", "id": id, "busy_slots": []any{}})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": records})
		case "/gate/team/api/calendar/events":
			var body eventBody
			if r.Method != http.MethodPost || json.NewDecoder(r.Body).Decode(&body) != nil ||
				!slices.Equal(body.Participants, participants) {
				t.Error("assistant omitted participants from confirmed event")
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			calendarWrites.Add(1)
			fmt.Fprint(w, `{"data":{"id":42}}`)
		case "/gate/team/api/calendar/events/42":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
				"id": 42, "creator_id": "organizer", "title": meetingTitle, "description": "", "location": "",
				"starts_at": meetingStart, "ends_at": "2099-10-29T14:30:00+05:00", "is_public": false, "is_recurring": false, "participants": roster,
			}})
		case "/v1/chat/completions":
			if r.Header.Get("Authorization") != "Bearer fixture-model-key" {
				t.Error("provider key was not forwarded")
			}
			request, _ := io.ReadAll(r.Body)
			step := providerCalls.Add(1)
			delta := map[string]any{"content": "Fixture response"}
			finish := "stop"
			var tool string
			var input any
			change := map[string]string{"action": "entry", "text": proposalText}
			switch step {
			case 1:
				tool, input = "showEventList", map[string]string{"from": day, "to": day, "scope": "my"}
			case 4:
				tool, input = "assistantMemory", map[string]string{"action": "recall"}
			case 5:
				tool, input = "assistantMemory", map[string]any{"action": "review", "change": change, "questions": []string{}}
			case 6:
				tool, input = "assistantMemory", map[string]any{"action": "propose", "change": change}
			case 8:
				tool, input = "listMeetings", map[string]any{"period": "custom", "from": day, "to": day, "includeDetails": true}
			case 9:
				tool, input = "selectParticipants", map[string]any{"participantIds": []string{}, "sourceEventKey": "event:fixture-event"}
			case 10:
				tool, input = "prepareMeetingDraft", map[string]any{
					"title": meetingTitle, "agenda": "", "location": "", "startsAt": meetingStart,
					"participantIds": guests, "durationMinutes": 30, "conference": map[string]string{"mode": "none"},
				}
			}
			if tool != "" {
				arguments, _ := json.Marshal(input)
				delta = map[string]any{"tool_calls": []any{map[string]any{
					"index": 0, "id": fmt.Sprintf("tool-%d", step), "type": "function",
					"function": map[string]string{"name": tool, "arguments": string(arguments)},
				}}}
				finish = "tool_calls"
			} else if !bytes.Contains(request, []byte("Fixture prompt")) {
				t.Error("conversation history was lost")
			}
			payload, _ := json.Marshal(map[string]any{"id": "synthetic", "choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}})
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", payload)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	dir := t.TempDir()
	small := newSmallService(server.URL)
	small.store = &sessionStore{directory: dir}
	ctx, cancel := context.WithTimeout(context.Background(), 16*time.Second)
	defer cancel()
	if login := small.Login(ctx, smallCredentials{"fixture", "test-password"}); !login.OK {
		t.Fatal("synthetic Small login failed")
	}
	type message struct {
		Name string
		Data json.RawMessage
	}
	events := make(chan message, 128)
	newService := func() *AssistantService {
		return &AssistantService{small: small, profile: dir, emit: func(name string, data json.RawMessage) { events <- message{name, data} }}
	}
	service := newService()
	small.onAssistantReset = func() { service.reset() }
	small.assistantMemoryRevision = func(ctx context.Context, account string) (int, error) {
		return service.memoryRevision(ctx, account)
	}
	defer func() { _ = service.ServiceShutdown() }()
	initial := assistantInvoke(service, ctx, "profiles.read", nil)
	assistantOK(t, initial)
	if !bytes.Contains(initial, []byte(`"profiles":[]`)) {
		t.Fatal("clean profile is not empty")
	}
	assistantOK(t, assistantInvoke(service, ctx, "profiles.save", map[string]string{
		"id": "personal", "modelId": "fixture", "baseURL": server.URL + "/v1", "apiKey": "fixture-model-key",
	}))
	assistantOK(t, assistantInvoke(service, ctx, "profiles.activate", "personal"))
	if profile := assistantInvoke(service, ctx, "profiles.read", nil); bytes.Contains(profile, []byte("fixture-model-key")) {
		t.Fatal("full model key escaped into renderer reply")
	}
	empty := assistantInvoke(service, ctx, "memory.read", nil)
	assistantOK(t, empty)
	for _, field := range []string{`"preferences":{}`, `"entries":[]`, `"groups":[]`, `"presets":[]`} {
		if !bytes.Contains(empty, []byte(field)) {
			t.Errorf("fresh account memory does not contain %s", field)
		}
	}
	memory := assistantInvoke(service, ctx, "memory.write", map[string]any{
		"revision": 0, "requestId": "00000000-0000-4000-8000-000000000003",
		"change": map[string]string{"action": "entry", "text": "Synthetic priority"},
	})
	assistantOK(t, memory)
	if !bytes.Contains(memory, []byte(account)) {
		t.Fatal("memory returned the wrong owner")
	}
	start := func(id, prompt string) {
		assistantOK(t, assistantInvoke(service, ctx, "assistant.start", map[string]string{
			"requestId": id, "conversationId": "fixture-chat", "prompt": prompt,
		}))
	}
	wait := func(wantList bool, cardKind string) string {
		t.Helper()
		foundText, foundList := false, false
		cardID := ""
		for {
			select {
			case event := <-events:
				switch event.Name {
				case "small:event-list":
					foundList = bytes.Contains(event.Data, []byte("Synthetic shift"))
				case "small:assistant":
					if bytes.Contains(event.Data, []byte("Fixture response")) {
						foundText = true
					}
					var message struct {
						Type  string `json:"type"`
						Chunk struct {
							Type      string `json:"type"`
							ErrorText string `json:"errorText"`
							Output    struct {
								OK   bool `json:"ok"`
								Data struct {
									Kind string `json:"kind"`
									ID   string `json:"id"`
								} `json:"data"`
							} `json:"output"`
						} `json:"chunk"`
					}
					_ = json.Unmarshal(event.Data, &message)
					if message.Chunk.Type == "error" {
						t.Fatalf("unexpected streaming error: %s", message.Chunk.ErrorText)
					}
					if cardKind != "" && message.Chunk.Output.OK && message.Chunk.Output.Data.Kind == cardKind {
						cardID = message.Chunk.Output.Data.ID
					}
					if message.Type == "end" {
						if !foundText || wantList != foundList {
							t.Fatalf("missing assistant output: text=%t list=%t", foundText, foundList)
						}
						return cardID
					}
				}
			case <-ctx.Done():
				t.Fatal("assistant never completed")
			}
		}
	}
	start("00000000-0000-4000-8000-000000000001", "Fixture prompt")
	wait(true, "")
	if calendarCalls.Load() == 0 || providerCalls.Load() != 2 {
		t.Fatal("tool result was not delivered back to the provider")
	}
	start("00000000-0000-4000-8000-000000000002", "Follow-up")
	wait(false, "")
	start("00000000-0000-4000-8000-000000000004", "Remember: "+proposalText)
	proposalID := wait(false, "memory-proposal")
	if proposalID == "" {
		t.Fatal("missing memory confirmation card")
	}
	before := assistantInvoke(service, ctx, "memory.read", nil)
	assistantOK(t, before)
	if bytes.Contains(before, []byte(proposalText)) {
		t.Fatal("assistant wrote to memory before confirmation")
	}
	confirmation := map[string]string{"id": proposalID}
	after := assistantInvoke(service, ctx, "memory.confirm", confirmation)
	assistantOK(t, after)
	if !bytes.Contains(after, []byte(proposalText)) {
		t.Fatal("confirmed change was not saved")
	}
	start("00000000-0000-4000-8000-000000000005", "Copy Synthetic shift into a planning meeting.")
	draftID := wait(false, "meeting-draft")
	if draftID == "" || calendarWrites.Load() != 0 {
		t.Fatal("assistant did not produce a draft without writing to the calendar")
	}
	created := small.ConfirmMeeting(ctx, meetingReference{ID: draftID, Revision: 1})
	if !created.OK || created.Data.Phase != "succeeded" || calendarWrites.Load() != 1 {
		t.Fatalf("Go did not create exactly one meeting after confirmation: %+v", created)
	}
	if err := service.ServiceShutdown(); err != nil {
		t.Fatal(err)
	}
	service = newService()
	if reply := assistantInvoke(service, ctx, "memory.read", nil); !bytes.Contains(reply, []byte("Synthetic priority")) ||
		!bytes.Contains(reply, []byte(proposalText)) {
		t.Fatal("memory did not persist through the companion restart")
	}
	if profile := assistantInvoke(service, ctx, "profiles.read", nil); !bytes.Contains(profile, []byte(`"active":"personal"`)) {
		t.Fatal("model selection did not persist through the companion restart")
	}
	service.mu.Lock()
	process := service.process
	service.mu.Unlock()
	if process == nil {
		t.Fatal("assistant companion is missing")
	}
	if err := process.cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-process.done:
	case <-ctx.Done():
		t.Fatal("assistant did not observe a stopped companion")
	}
	if reply := assistantInvoke(service, ctx, "memory.read", nil); !bytes.Contains(reply, []byte(proposalText)) {
		t.Fatal("assistant did not recover from a companion failure")
	}
	small.Logout(ctx)
	if reply := assistantInvoke(service, ctx, "memory.confirm", confirmation); !bytes.Contains(reply, []byte(`"ok":false`)) {
		t.Fatal("signed-out caller could replay a confirmation")
	}
}

func TestAssistantCalendarBridgeAllowsOnlyReadOperations(t *testing.T) {
	body := json.RawMessage(`{"participant_ids":["fixture-person"],"timezone":"Asia/Almaty","date":"2026-11-26"}`)
	for _, check := range []struct {
		path string
		body json.RawMessage
		want bool
	}{
		{"/gate/team/api/calendar/events/busy-intervals", body, true},
		{"/gate/team/api/calendar/events/fixture-event", nil, true},
		{"/gate/team/api/calendar/events/fixture-event", body, false},
		{"/gate/team/api/calendar/events", body, false},
		{"/gate/auth/logout", nil, false},
		{"https://example.invalid/gate/team/api/calendars/public", nil, false},
	} {
		if got := assistantReadAllowed(check.path, check.body); got != check.want {
			t.Errorf("assistantReadAllowed(%q) = %t, want %t", check.path, got, check.want)
		}
	}
}

func TestWKWebViewAssistant(t *testing.T) {
	if os.Getenv("SMALL_WAILS_WEBVIEW_TEST") != "1" {
		t.Skip("set SMALL_WAILS_WEBVIEW_TEST=1")
	}
	profile := t.TempDir()
	if err := os.Chmod(profile, 0700); err != nil {
		t.Fatal(err)
	}
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary)
	command.Env = append(os.Environ(), "SMALL_WAILS_TEST_SCENARIO=assistant", "SMALL_WAILS_TEST_PROFILE="+profile)
	output, err := command.CombinedOutput()
	if err != nil || !strings.Contains(string(output), "WKWebView scenario passed") {
		t.Fatalf("assistant failed: %v\n%s", err, output)
	}
}

const assistantSmokeScript = `
	let stage = 'initial';
	const action = (label) => document.querySelector('[aria-label="' + label + '"]');
	const submit = (prompt) => {
		const input = action('Сообщение ассистенту');
		if (!input) return;
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,prompt);
		input.dispatchEvent(new Event('input',{bubbles:true}));
	};
	const next = () => action('Отправить сообщение');
	const timer = setInterval(() => {
		const region = action('AI-ассистент');
		if (stage === 'initial' && region) { submit('Сложи 2 и 3'); stage = 'ready'; }
		else if (stage === 'ready' && next() && !next().disabled) { next().click(); stage = 'stream'; }
		else if (stage === 'stream' && region.querySelector('[role="log"]')?.textContent.includes('Результат: 5') &&
			!action('Остановить ответ')) { submit('Сложи 100 и 200'); stage = 'cancel-ready'; }
		else if (stage === 'cancel-ready' && next() && !next().disabled) { next().click(); stage = 'cancel'; }
		else if (stage === 'cancel' && action('Остановить ответ')) { action('Остановить ответ').click(); stage='stopped'; }
		else if (stage === 'stopped' && action('Состояние ответа ассистента')?.textContent.includes('Запрос остановлен')) {
			submit('Ошибка модели'); stage='error-ready';
		} else if (stage === 'error-ready' && next() && !next().disabled) { next().click(); stage = 'error'; }
		else if (stage === 'error' && region.querySelector('[role="alert"]')?.textContent.includes('Не удалось обработать ответ модели')) {
			clearInterval(timer);
			void fetch('/__preview_ready');
		}
	},100);
	setTimeout(() => { void fetch('/__preview_ready?pending=' + encodeURIComponent(stage)); }, 10_000);
`
