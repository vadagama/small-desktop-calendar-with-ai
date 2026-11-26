package main

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

//go:embed all:dist
var frontend embed.FS

const appName = "Ordo"

// Keep the directory used by existing Wails installations.
const profileDirectory = "Small Calendar Wails"

func main() {
	smoke := flag.Bool("smoke", false, "verify the signed-out renderer in a hidden window")
	profile := flag.String("user-data-dir", "", "Wails profile directory")
	importProfile := flag.String("import-electron-profile", "", "copy a closed Electron profile into a new -user-data-dir")
	flag.Parse()

	if *importProfile != "" {
		if *profile == "" || *smoke || flag.NArg() != 0 {
			log.Fatal("Для импорта укажите новый каталог через -user-data-dir.")
		}
		if err := importElectronProfile(*importProfile, *profile); err != nil {
			log.Fatal(err)
		}
		log.Print("Импорт профиля Electron завершён.")
		return
	}

	if *profile == "" {
		if *smoke {
			directory, err := os.MkdirTemp("", "small-wails-smoke-")
			if err != nil {
				log.Fatal(err)
			}
			*profile = directory
		} else {
			config, err := os.UserConfigDir()
			if err != nil {
				log.Fatal(err)
			}
			*profile = filepath.Join(config, profileDirectory)
		}
	}
	script := ""
	if *smoke {
		script = signedOutSmokeScript
		if os.Getenv("SMALL_WAILS_EXPECT_VOICE") == "1" {
			script = "const expectVoice = true;\n" + script
		}
	}
	runPreview(*profile, "https://team.small.kz", script)
}

func runPreview(profile, origin, smokeScript string) {
	runPreviewWithAssistant(profile, origin, smokeScript, false)
}

func runPreviewWithAssistant(profile, origin, smokeScript string, synthetic bool) {
	runDesktop(profile, smokeScript, synthetic, newSmallService(origin))
}

func runDesktop(profile, smokeScript string, synthetic bool, small *SmallService) {
	smoke := smokeScript != ""
	if err := os.MkdirAll(profile, 0700); err != nil {
		log.Fatal(err)
	}
	info, err := os.Lstat(profile)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		log.Fatal("Wails profile must be a private directory")
	}
	profile, err = filepath.EvalSymlinks(profile)
	if err != nil {
		log.Fatal("Не удалось открыть профиль Wails.")
	}
	small.store = &sessionStore{directory: profile}
	small.pendingRestore = true

	assets, err := fs.Sub(frontend, "dist")
	if err != nil {
		log.Fatal(err)
	}
	handler := application.BundledAssetFileServer(assets)
	options := application.Options{Name: appName}
	var windowRef atomic.Pointer[application.WebviewWindow]
	showWindow := func() {
		if window := windowRef.Load(); window != nil && !smoke {
			window.Show()
			window.UnMinimise()
			window.Focus()
		}
	}
	libKey := sha256.Sum256([]byte(profile))
	options.SingleInstance = &application.SingleInstanceOptions{
		UniqueID:               fmt.Sprintf("smallw-%x", libKey[:10]),
		OnSecondInstanceLaunch: func(application.SecondInstanceData) { showWindow() },
	}
	ready := make(chan struct{}, 1)
	if smoke {
		options.Mac.ActivationPolicy = application.ActivationPolicyProhibited
		mux := http.NewServeMux()
		mux.Handle("/", handler)
		mux.HandleFunc("GET /__preview_ready", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			if pending := r.URL.Query().Get("pending"); pending != "" {
				log.Printf("WKWebView scenario is still waiting at %q", pending)
				w.WriteHeader(http.StatusAccepted)
				return
			}
			if layout := r.URL.Query().Get("layout"); layout != "" {
				log.Printf("WKWebView layout: %s", layout)
			}
			select {
			case ready <- struct{}{}:
			default:
			}
			w.WriteHeader(http.StatusNoContent)
		})
		handler = mux
	}
	options.Assets.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "frame-src 'none'; object-src 'none'; base-uri 'none'")
		handler.ServeHTTP(w, r)
	})
	// Keep IDs stable across the production binary and the native Go test executable.
	// These IDs are consumed by preview.ts.
	application.RegisterBindingMethodID((*SmallService).Read, 1)
	application.RegisterBindingMethodID((*SmallService).Login, 2)
	application.RegisterBindingMethodID((*SmallService).Logout, 3)
	application.RegisterBindingMethodID((*SmallService).Calendars, 4)
	application.RegisterBindingMethodID((*SmallService).EventSource, 5)
	application.RegisterBindingMethodID((*SmallService).EventDetail, 6)
	application.RegisterBindingMethodID((*SmallService).Respond, 7)
	application.RegisterBindingMethodID((*SmallService).ApplyChange, 8)
	application.RegisterBindingMethodID((*SmallService).Reschedule, 9)
	application.RegisterBindingMethodID((*SmallService).PrepareMeeting, 10)
	application.RegisterBindingMethodID((*SmallService).ConfirmMeeting, 11)
	application.RegisterBindingMethodID((*SmallService).ReadMeeting, 12)
	application.RegisterBindingMethodID((*SmallService).EditMeeting, 13)
	application.RegisterBindingMethodID((*SmallService).People, 14)
	application.RegisterBindingMethodID((*SmallService).GateSeries, 15)
	application.RegisterBindingMethodID((*SmallService).ApplySeries, 16)
	application.RegisterBindingMethodID((*SmallService).Attach, 17)
	assistant := &AssistantService{small: small, profile: profile, synthetic: synthetic, whisper: whisperExecutable()}
	application.RegisterBindingMethodID((*AssistantService).Invoke, 18)
	native := &NotificationService{native: notifications.New(), show: showWindow}
	reminders := &ReminderService{
		path: filepath.Join(profile, "reminders.json"), source: assistant.call, now: time.Now,
		refresh: make(chan struct{}, 1), remove: native.remove, notify: native.notify,
	}
	native.join = func(id string) {
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		if err := reminders.join(ctx, id); err != nil {
			reminders.mu.Lock()
			reminders.warning = "Встреча изменилась или ссылка недоступна. Обновите напоминания."
			reminders.mu.Unlock()
		}
	}
	var secureView atomic.Bool
	voice := &VoiceService{host: assistant, secure: secureView.Load}
	nativeVoice.Store(voice)
	updates := &UpdateService{window: windowRef.Load}
	application.RegisterBindingMethodID((*ReminderService).Invoke, 19)
	application.RegisterBindingMethodID((*NotificationService).Invoke, 20)
	application.RegisterBindingMethodID((*VoiceService).Request, 21)
	application.RegisterBindingMethodID((*UpdateService).Read, 22)
	application.RegisterBindingMethodID((*UpdateService).Check, 23)
	application.RegisterBindingMethodID((*UpdateService).Install, 24)
	application.RegisterBindingMethodID((*SmallService).ImportedCalendarCache, 25)
	application.RegisterBindingMethodID((*SmallService).OpenLink, 26)
	application.RegisterBindingMethodID((*SmallService).CopyLink, 27)
	small.onAssistantReset = func() {
		assistant.reset()
		reminders.invalidate()
		reminders.schedule()
	}
	small.assistantMemoryRevision = assistant.memoryRevision
	options.Services = []application.Service{
		application.NewService(assistant),
		application.NewService(small),
		application.NewService(reminders),
		application.NewService(native),
		application.NewService(voice),
		application.NewService(updates),
	}

	app := application.New(options)
	if small.openExternal == nil {
		small.openExternal = app.Browser.OpenURL
	}
	if small.writeClipboard == nil {
		small.writeClipboard = app.Clipboard.SetText
	}
	lock, err := syscall.Open(filepath.Join(profile, ".profile.lock"),
		syscall.O_NOFOLLOW|syscall.O_CREAT|syscall.O_RDWR|syscall.O_CLOEXEC, 0600)
	if err != nil {
		log.Fatal("Не удалось открыть профиль Wails.")
	}
	defer syscall.Close(lock)
	if err := syscall.Flock(lock, syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		log.Fatal("Профиль Wails уже открыт.")
	}
	reminders.open = app.Browser.OpenURL
	background, stop := context.WithCancel(context.Background())
	defer stop()
	config, _ := os.UserConfigDir()
	defaultProfile, _ := filepath.EvalSymlinks(filepath.Join(config, profileDirectory))
	updates.configure(background, app, !smoke && profile == defaultProfile)
	if updates.Read().Status != "unsupported" {
		go updates.run()
	}
	app.OnShutdown(func() {
		stop()
		updates.shutdown()
		reminders.invalidate()
		voice.release()
		nativeVoice.Store(nil)
	})
	app.Event.OnApplicationEvent(events.Common.SystemDidWake, func(*application.ApplicationEvent) {
		reminders.invalidate()
		reminders.schedule()
	})
	app.Event.OnApplicationEvent(events.Mac.ApplicationShouldHandleReopen, func(*application.ApplicationEvent) {
		showWindow()
	})
	go reminders.run(background)
	if !smoke {
		reminders.schedule()
	}
	assistant.emit = func(name string, data json.RawMessage) { app.Event.Emit(name, data) }
	defer assistant.ServiceShutdown()
	small.chooseAttachments = func() ([]string, error) {
		return app.Dialog.OpenFile().SetTitle("Прикрепить файлы к встрече").
			CanChooseFiles(true).CanChooseDirectories(false).PromptForMultipleSelection()
	}
	window := application.WebviewWindowOptions{
		// Wails sizes the content area; Electron's 960px frame has a 928px viewport.
		Title: options.Name, Width: 1440, Height: 928, MinWidth: 900, MinHeight: 608,
		URL: "/", Hidden: smoke,
		Permissions: map[application.PermissionType]application.Permission{
			application.PermissionMicrophone: application.PermissionDeny,
			application.PermissionCamera:     application.PermissionDeny,
		},
	}
	if smoke {
		window.JS = smokeScript
		go func() {
			select {
			case <-ready:
				log.Print("WKWebView scenario passed")
				app.Quit()
			case <-time.After(20 * time.Second):
				log.Fatal("WKWebView scenario timed out")
			}
		}()
	}

	view := app.Window.NewWithOptions(window)
	windowRef.Store(view)
	view.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		voice.release()
		view.Hide()
		event.Cancel()
	})
	view.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		application.InvokeSync(func() { secureView.Store(secureWebView(view.NativeWindow())) })
	})
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

const signedOutSmokeScript = `
			let opened = false;
			const check = setInterval(() => {
				const login = document.querySelector('[aria-label="Войти в Small — открыть форму"]');
				if (login && !opened) {
					opened = true;
					login.click();
				}
				const password = document.querySelector('#small-account-password');
				const form = password?.closest('form');
				const username = form?.querySelector('[name="username"]');
				const emblem = document.querySelector('.ordo-emblem');
				if (username && !username.value && !password.value &&
					document.title === 'Ordo' && emblem?.alt === 'Ordo' && emblem.naturalWidth > 0 &&
					document.querySelector('.small-dock')) {
					clearInterval(check);
					void Promise.all([
						window.smallDesktop.smallAuth.read(),
						window.smallDesktop.profiles.read(),
						window.smallDesktop.agentSettings.read(),
						window.smallDesktop.reminders.read(),
						window.smallDesktop.notifications.read(),
						window.smallDesktop.voice.request({ action: "status" }),
						window.smallDesktop.updates.read()
					]).then(([auth, profiles, settings, reminders, notifications, voice, updates]) => {
						const voiceReady = typeof expectVoice === "undefined" ||
							(voice.ok && voice.status.runtimeAvailable && voice.status.phase === "absent" &&
							isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function");
						if (auth.ok && auth.state.status === 'signed-out' &&
							profiles.ok && profiles.state.profiles.length === 0 &&
							settings.ok && settings.state.settings.mood === 'neutral' &&
							settings.state.settings.instructions === '' &&
							reminders.ok && reminders.state.settings.enabled && reminders.state.settings.minutes === 5 &&
							reminders.state.items.length === 0 && notifications.status === 'untested' &&
							voiceReady && updates.status === 'unsupported') {
							void fetch('/__preview_ready');
						} else {
							const failed = [
								['auth', auth.ok && auth.state.status === 'signed-out'],
								['profiles', profiles.ok && profiles.state.profiles.length === 0],
								['settings', settings.ok && settings.state.settings.mood === 'neutral' && settings.state.settings.instructions === ''],
								['reminders', reminders.ok && reminders.state.settings.enabled && reminders.state.settings.minutes === 5 &&
									reminders.state.items.length === 0],
								['notifications', notifications.status === 'untested'],
								['voice', voiceReady],
								['updates', updates.status === 'unsupported']
							].filter(([, ok]) => !ok).map(([name]) => name);
							void fetch('/__preview_ready?pending=' + failed.join(','));
						}
					}).catch(() => void fetch('/__preview_ready?pending=initial-bindings'));
				}
			}, 100);
		`
