package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWKWebViewRemindersAfterWindowClose(t *testing.T) {
	if os.Getenv("SMALL_WAILS_WEBVIEW_TEST") != "1" {
		t.Skip("set SMALL_WAILS_WEBVIEW_TEST=1")
	}
	claims := base64.RawURLEncoding.EncodeToString([]byte(`{"uid":"fixture","name":"Fixture","preferred_username":"fixture","guidfl":"organizer"}`))
	now := time.Now().In(smallZone)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/gate/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "fixture", Value: "yes", Path: "/"})
			fmt.Fprintf(w, `{"data":{"access_token":"header.%s.signature"}}`, claims)
		case "/gate/team/api/user/info":
			fmt.Fprint(w, `{"data":{}}`)
		case "/gate/team/api/calendars/my/events":
			fmt.Fprintf(w, `{"data":[{"id":"fixture-reminder","title":"Background fixture","starts_at":%q,"ends_at":%q}]}`,
				now.Add(-time.Minute).Format(time.RFC3339), now.Add(time.Hour).Format(time.RFC3339))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	profile := t.TempDir()
	if err := os.Chmod(profile, 0700); err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(ctx, binary)
	command.Env = append(os.Environ(), "SMALL_WAILS_TEST_SCENARIO=native",
		"SMALL_WAILS_TEST_PROFILE="+profile, "SMALL_WAILS_TEST_ORIGIN="+server.URL)
	output, err := command.CombinedOutput()
	if err != nil || !strings.Contains(string(output), "WKWebView scenario passed") {
		t.Fatalf("reminder after close: %v\n%s", err, output)
	}
}

const nativeSmokeScript = `
(async () => {
	let steps = "runtime";
	try {
		const { Window } = await import("/wails/runtime.js");
		for (let attempt = 0; attempt < 60 && !window.smallDesktop; attempt++)
			await new Promise(resolve => setTimeout(resolve, 100));
		const bridge = window.smallDesktop;
		if (!bridge || !isSecureContext || typeof navigator.mediaDevices?.getUserMedia !== "function")
			throw new Error("runtime");
		steps = "close";
		await Window.Close();
		steps = "login";
		const login = await bridge.smallAuth.login({ username: "fixture", password: "synthetic" });
		if (!login.ok) throw new Error("login");
		steps = "reminder";
		for (let attempt = 0; attempt < 60; attempt++) {
			const reply = await bridge.reminders.read();
			if (reply.ok && reply.state.items.some(item => item.event.title === "Background fixture")) {
				await fetch("/__preview_ready");
				return;
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	} finally {
		await fetch("/__preview_ready?pending=" + steps);
	}
})();
`

func TestWailsTranscribesSyntheticSpeech(t *testing.T) {
	model, pcm := os.Getenv("SMALL_WAILS_VOICE_MODEL"), os.Getenv("SMALL_WAILS_VOICE_PCM")
	if model == "" || pcm == "" {
		t.Skip("set SMALL_WAILS_VOICE_MODEL and SMALL_WAILS_VOICE_PCM for the real Whisper test")
	}
	profile := t.TempDir()
	voiceDir := filepath.Join(profile, "voice")
	if err := os.Mkdir(voiceDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(model, filepath.Join(voiceDir, "ggml-large-v3-turbo.bin")); err != nil {
		t.Fatal(err)
	}
	executable, err := filepath.Abs("../native/voice/whisper-cli")
	if err != nil {
		t.Fatal(err)
	}
	host := &AssistantService{profile: profile, whisper: executable}
	t.Cleanup(func() { _ = host.ServiceShutdown() })
	service := &VoiceService{host: host, secure: func() bool { return true }}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	request := func(input map[string]string) json.RawMessage {
		raw, _ := json.Marshal(input)
		return service.Request(ctx, raw)
	}
	status := request(map[string]string{"action": "status"})
	if !bytes.Contains(status, []byte(`"phase":"ready"`)) {
		t.Fatalf("model did not verify: %s", status)
	}
	audio, err := os.ReadFile(pcm)
	if err != nil {
		t.Fatal(err)
	}
	id := "00000000-0000-4000-8000-000000000001"
	input := map[string]string{"action": "transcribe", "sessionId": id, "pcm": base64.StdEncoding.EncodeToString(audio)}
	if result := request(input); bytes.Contains(result, []byte(`"ok":true`)) {
		t.Fatal("received transcription without starting a session")
	}
	assistantOK(t, request(map[string]string{"action": "begin", "sessionId": id}))
	result := request(input)
	assistantOK(t, result)
	if !strings.Contains(strings.ToLower(string(result)), "календар") {
		t.Fatal("Whisper did not recognize the calendar phrase")
	}
}
