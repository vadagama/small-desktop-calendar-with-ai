package main

import (
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
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Start each Cocoa application on its subprocess's initial OS thread.
func TestMain(m *testing.M) {
	switch os.Getenv("SMALL_WAILS_TEST_SCENARIO") {
	case "imported-profile":
		runDesktop(os.Getenv("SMALL_WAILS_TEST_PROFILE"), migratedProfileSmokeScript, true,
			migratedProfileSmall(os.Getenv("SMALL_WAILS_TEST_ORIGIN")))
		return
	case "assistant":
		runPreviewWithAssistant(os.Getenv("SMALL_WAILS_TEST_PROFILE"), "https://team.small.kz", assistantSmokeScript, true)
		return
	case "native":
		runPreview(os.Getenv("SMALL_WAILS_TEST_PROFILE"), os.Getenv("SMALL_WAILS_TEST_ORIGIN"), nativeSmokeScript)
		return
	case "login", "offline", "cache", "meeting-controls", "meeting-links":
		scenario := os.Getenv("SMALL_WAILS_TEST_SCENARIO")
		script := fmt.Sprintf("const scenario = %q;\n", scenario)
		small := newSmallService(os.Getenv("SMALL_WAILS_TEST_ORIGIN"))
		if scenario == "meeting-links" {
			small.openExternal = func(link string) error {
				fmt.Printf("opened fixture: %s\n", link)
				return nil
			}
			small.writeClipboard = func(link string) bool {
				fmt.Printf("copied fixture: %s\n", link)
				return true
			}
		}
		runDesktop(os.Getenv("SMALL_WAILS_TEST_PROFILE"), script+calendarSmokeScript, false, small)
		return
	}
	os.Exit(m.Run())
}

func TestWKWebViewCalendarAfterRestart(t *testing.T) {
	exerciseWKWebViewCalendar(t, "")
}

func TestWKWebViewMeetingControls(t *testing.T) {
	exerciseWKWebViewCalendar(t, "meeting-controls")
}

func TestWKWebViewMeetingLinks(t *testing.T) {
	exerciseWKWebViewCalendar(t, "meeting-links")
}

func exerciseWKWebViewCalendar(t *testing.T, onlyScenario string) {
	t.Helper()
	if os.Getenv("SMALL_WAILS_WEBVIEW_TEST") != "1" {
		t.Skip("set SMALL_WAILS_WEBVIEW_TEST=1 to run the hidden macOS app")
	}

	var eventOffline, sessionOffline atomic.Bool
	var recoveryAt atomic.Int64
	var logins, refreshes, unavailableReads, logouts atomic.Int32
	var response atomic.Value
	response.Store("pending")
	var writes atomic.Int32
	var writeMu sync.Mutex
	var created eventBody
	var cancelled bool
	var createRequests, updateRequests, deleteRequests atomic.Int32
	location := time.FixedZone("Almaty", 5*60*60)
	date := time.Now().In(location).Format(time.DateOnly)
	claims := `{"uid":"employee-a","name":"Synthetic A","preferred_username":"employee-a","guidfl":"synthetic-organizer"}`
	token := "header." + base64.RawURLEncoding.EncodeToString([]byte(claims)) + ".signature"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/gate/team/api/calendar/events/busy-intervals":
			fmt.Fprint(w, `{"data":[{"id":"synthetic-organizer","type":"participant","busy_slots":[]}]}`)
		case "/gate/team/api/calendar/events":
			writeMu.Lock()
			defer writeMu.Unlock()
			if r.Method != http.MethodPost || r.URL.Query().Get("force") != "false" ||
				json.NewDecoder(r.Body).Decode(&created) != nil || created.Title != "Wails write fixture" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			createRequests.Add(1)
			fmt.Fprint(w, `{"data":{"id":"created-fixture"}}`)
		case "/gate/team/api/calendar/events/created-fixture":
			writeMu.Lock()
			defer writeMu.Unlock()
			switch r.Method {
			case http.MethodPut:
				if json.NewDecoder(r.Body).Decode(&created) != nil {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				updateRequests.Add(1)
			case http.MethodDelete:
				cancelled = true
				deleteRequests.Add(1)
				w.WriteHeader(http.StatusNoContent)
				return
			}
			status := "confirmed"
			if cancelled {
				status = "cancelled"
			}
			var description, location *string
			if created.Description != "" {
				description = &created.Description
			}
			if created.Location != "" {
				location = &created.Location
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
				"id": "created-fixture", "creator_id": "synthetic-organizer", "title": created.Title,
				"description": description, "location": location, "starts_at": created.Start, "ends_at": created.End,
				"status": status, "is_public": false, "is_recurring": false, "timezone": "Asia/Almaty",
				"calendar_ids": []int{}, "notification_recipients": []int{}, "attachments": []int{},
				"participants": []map[string]string{{"id": "synthetic-organizer"}},
			}})
		case "/gate/auth/login":
			var input smallCredentials
			if r.Method != http.MethodPost || json.NewDecoder(r.Body).Decode(&input) != nil ||
				input.Username != "employee-a" || input.Password != "synthetic-password" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			logins.Add(1)
			http.SetCookie(w, &http.Cookie{Name: "test-session", Value: "fixture", Path: "/"})
			fmt.Fprintf(w, `{"data":{"access_token":%q}}`, token)
		case "/gate/auth/logout":
			logouts.Add(1)
			w.WriteHeader(http.StatusNoContent)
		case "/gate/auth/refresh":
			if sessionOffline.Load() {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			cookie, err := r.Cookie("test-session")
			if err != nil || cookie.Value != "fixture" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			refreshes.Add(1)
			fmt.Fprintf(w, `{"data":{"access_token":%q}}`, token)
		case "/gate/team/api/calendar/events/synthetic-event-a/participant-status":
			var input struct {
				Status string `json:"status"`
			}
			if r.Method != http.MethodPatch || r.Header.Get("Authorization") != "Bearer "+token ||
				json.NewDecoder(r.Body).Decode(&input) != nil ||
				(input.Status != "accepted" && input.Status != "declined") {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			response.Store(input.Status)
			writes.Add(1)
			fmt.Fprint(w, `{}`)
		case "/gate/team/api/calendar/events/synthetic-event-a":
			if r.Header.Get("Authorization") != "Bearer "+token {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			extra := ""
			if onlyScenario == "meeting-links" {
				extra = `,"location":"https://conference.example.test/room?source=calendar#join","attachments":[{"id":1,"path":"calendar/synthetic/notes.pdf"}]`
			}
			fmt.Fprintf(w, `{"data":{"id":"synthetic-event-a","title":"Синтетическая встреча A","description":"Синтетические детали встречи","starts_at":%q,"ends_at":%q,"participants":[{"id":"synthetic-organizer","status":%q}]%s}}`,
				date+"T09:00:00+05:00", date+"T10:00:00+05:00", response.Load(), extra)
		case "/gate/employee/api/search/persons":
			if r.Header.Get("Authorization") != "Bearer "+token || r.URL.Query().Get("q") != "Тест" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			fmt.Fprint(w, `{"data":{"items":[{"person_guid":"synthetic-person","person_full_fio":"Тестовый сотрудник","position_name":"Тестовый отдел"}],"pagination":{"current_page":1,"last_page":1}}}`)
		case "/gate/team/api/user/info", "/gate/team/api/calendars/public", "/gate/team/api/calendars/my/events":
			if r.Header.Get("Authorization") != "Bearer "+token {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			switch r.URL.Path {
			case "/gate/team/api/user/info":
				fmt.Fprint(w, `{"data":{}}`)
			case "/gate/team/api/calendars/public":
				fmt.Fprint(w, `{"data":[{"id":7,"name":"Синтетическая переговорная"}]}`)
			default:
				title := "Синтетическая встреча A"
				if eventOffline.Load() {
					if time.Now().UnixMilli() < recoveryAt.Load() {
						unavailableReads.Add(1)
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					title = "Синтетическая встреча B"
				}
				fmt.Fprintf(w, `{"data":[{"id":"synthetic-event-a","title":%q,"starts_at":%q,"ends_at":%q,"participants":[{"id":"synthetic-organizer","status":%q}]}]}`,
					title, date+"T09:00:00+05:00", date+"T10:00:00+05:00", response.Load())
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)

	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	profile := t.TempDir()
	if err := os.Chmod(profile, 0700); err != nil {
		t.Fatal(err)
	}
	run := func(scenario string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, binary)
		command.Env = append(os.Environ(),
			"SMALL_WAILS_TEST_SCENARIO="+scenario,
			"SMALL_WAILS_TEST_PROFILE="+profile,
			"SMALL_WAILS_TEST_ORIGIN="+server.URL)
		output, err := command.CombinedOutput()
		if err != nil || !strings.Contains(string(output), "WKWebView scenario passed") {
			t.Fatalf("%s failed: %v\n%s", scenario, err, output)
		}
		if scenario == "meeting-links" {
			for _, entry := range []string{
				"opened fixture: https://conference.example.test/room?source=calendar#join",
				"opened fixture: https://minio.skiftrade.kz:9000/team/calendar/synthetic/notes.pdf",
				"copied fixture: https://conference.example.test/room?source=calendar#join",
				"copied fixture: https://team.small.kz/calendar#event-synthetic-event-a-" + date,
			} {
				if !strings.Contains(string(output), entry+"\n") {
					t.Fatalf("missing action %q\n%s", entry, output)
				}
			}
		}
		t.Logf("%s: scenario passed", scenario)
		for _, line := range strings.Split(string(output), "\n") {
			if strings.Contains(line, "WKWebView layout:") {
				t.Log(line)
			}
		}
	}
	if onlyScenario != "" {
		run(onlyScenario)
		return
	}
	run("login")
	if createRequests.Load() != 1 || updateRequests.Load() != 2 || deleteRequests.Load() != 1 {
		t.Fatalf("expected the write cycle via Wails: create=%d update=%d delete=%d", createRequests.Load(), updateRequests.Load(), deleteRequests.Load())
	}
	if writes.Load() != 2 || response.Load() != "accepted" {
		t.Fatalf("expected two invitation responses; got %d", writes.Load())
	}
	if logins.Load() != 1 {
		t.Fatalf("expected one login, got %d", logins.Load())
	}
	sessionOffline.Store(true)
	run("offline")
	sessionOffline.Store(false)
	eventOffline.Store(true)
	recoveryAt.Store(time.Now().Add(4 * time.Second).UnixMilli())
	run("cache")
	if logins.Load() != 1 || refreshes.Load() == 0 || unavailableReads.Load() == 0 {
		t.Fatalf("expected cookie restore and an attempted fetch: logins=%d refreshes=%d failed reads=%d",
			logins.Load(), refreshes.Load(), unavailableReads.Load())
	}
	snapshot, err := (sessionStore{directory: profile}).load()
	if err != nil || logouts.Load() != 1 || snapshot.Account != "" || len(snapshot.Cookies) != 0 || snapshot.Username != "employee-a" {
		t.Fatalf("expected one logout and a username-only profile: logouts=%d, error=%v", logouts.Load(), err)
	}
	if _, err := os.Stat(filepath.Join(profile, "calendar-cache")); !os.IsNotExist(err) {
		t.Fatalf("expected logout to remove the cache: %v", err)
	}
}

const calendarSmokeScript = `
	let opened = false;
	let submitted = false;
	let stage = 'start';
	let signOutClicked = false;
	let layout = null;
	const setInput = (input, value) => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	};
	const button = (label) => document.querySelector('[aria-label="' + label + '"]');
	const report = (query) => fetch('/__preview_ready?' + query, {cache:'no-store'});
	const pending = (reason) => report('pending=' + encodeURIComponent(reason));
	void pending(scenario + '/script started');
	window.addEventListener('error', (event) => void pending(event.message));
	const done = () => {
		clearInterval(timer);
		void report(layout ? 'layout=' + encodeURIComponent(JSON.stringify(layout)) : '');
	};
	setTimeout(() => {
		void pending(scenario + '/' + stage);
	}, 12_000);
	const waitFor = async (find, name) => {
		void pending(scenario + '/' + name);
		for (let attempt = 0; attempt < 40; attempt++) {
			const result = find();
			if (result) return result;
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		throw Error(name);
	};
	const exerciseMeetingLinks = async () => {
		const modal = await waitFor(() => document.querySelector('dialog.small-event-details[open] .event-link-text')?.closest('dialog'), 'event card');
		const copyText = 'Ссылка скопирована';
		const status = () => [...modal.querySelectorAll('[role=status]')].map(el => el.textContent).join(' ');
		modal.querySelector('[aria-label="Скопировать ссылку подключения"]').click();
		await waitFor(() => status().includes(copyText) || status().includes('Не удалось скопировать'), 'conference copy');
		if (!status().includes(copyText)) throw Error('conference copy: ' + status());
		modal.querySelector('[aria-label="Действия со встречей"]').click();
		const copyEvent = await waitFor(() => [...modal.querySelectorAll('.event-menu-items:popover-open button')]
			.find(el => el.textContent.includes('Скопировать ссылку на встречу')), 'event copy button');
		copyEvent.click();
		await waitFor(() => !modal.querySelector('.event-menu-items:popover-open') && status().includes(copyText), 'event copy');
		const calendar = window.smallDesktop.calendar;
		const openLink = calendar.openLink;
		const initialLocation = window.location.href;
		let opens = 0;
		calendar.openLink = async (url) => {
			const reply = await openLink(url);
			if (reply.ok) opens++;
			return reply;
		};
		modal.querySelector('.event-link-text').click();
		modal.querySelector('.event-attachments a').click();
		await waitFor(() => opens === 2, 'conference and attachment open');
		if (window.location.href !== initialLocation) throw Error('external link navigated the application');
	};
	const exerciseMeetingControls = async () => {
		const press = (element, key) => element.dispatchEvent(
			new KeyboardEvent('keydown', {key, bubbles:true, cancelable:true}));
		button('Создать событие').click();
		const modal = await waitFor(() => document.querySelector('dialog.new-meeting[open]'), 'meeting form');
		const personInput = modal.querySelector('[aria-label="Поиск участников"]');
		personInput.scrollIntoView({block:'center'});
		personInput.focus();
		setInput(personInput, 'Тест');
		const loading = await waitFor(() => modal.querySelector('.meeting-people-status'), 'people loading');
		if (loading.textContent.trim() !== 'Загрузка' || getComputedStyle(loading).fontSize !== '14px' ||
			!loading.querySelector('.loading-icon')) throw Error('people loading style');
		const person = await waitFor(() => modal.querySelector('.meeting-person-option'), 'people results');
		const peoplePopup = person.closest('.meeting-people-results');
		const peopleField = personInput.closest('.meeting-people-input');
		await waitFor(() => {
			const box = peoplePopup.getBoundingClientRect();
			return box.top >= modal.getBoundingClientRect().top && box.bottom <= peopleField.getBoundingClientRect().top;
		}, 'people popup position');
		person.click();
		await waitFor(() => !personInput.value && peopleField.textContent.includes('Тестовый сотрудник'), 'people selection');
		const room = modal.querySelector('#meeting-room');
		room.scrollIntoView({block:'center'});
		press(room, 'Enter');
		const option = await waitFor(() => [...modal.querySelectorAll('[role=option]')]
			.find(item => item.textContent === 'Синтетическая переговорная' && item.getBoundingClientRect().height), 'room option');
		if (getComputedStyle(room).fontSize !== '14px' || getComputedStyle(option).fontSize !== '12px')
			throw Error('room typography');
		press(option, 'Enter');
		await waitFor(() => room.textContent.includes('Синтетическая переговорная'), 'room selection');
		modal.querySelector('[role=switch]').click();
		const monday = await waitFor(() => modal.querySelector('[role=checkbox]'), 'weekday checkbox');
		if (monday.getAttribute('aria-checked') !== 'true') throw Error('weekday initial state');
		monday.click();
		await waitFor(() => monday.getAttribute('aria-checked') === 'false', 'weekday checkbox state');
		const date = modal.querySelector('#meeting-until');
		date.scrollIntoView({block:'center'});
		date.click();
		const day = await waitFor(() => modal.querySelector('[data-slot=calendar] [data-selected=true] button'), 'recurrence calendar');
		const popup = day.closest('[data-slot=popover-content]');
		const rect = day.getBoundingClientRect();
		if (!popup.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)))
			throw Error('calendar is clipped');
		if (getComputedStyle(day).fontSize !== '13px' || !day.getBoundingClientRect().height) throw Error('calendar typography');
		await waitFor(() => !day.disabled && popup.getAttribute('data-state') === 'open', 'calendar ready');
		// Hidden WKWebView throttles timer polling; observe the actual DOM state.
		await new Promise((resolve) => {
			const observer = new MutationObserver(() => {
				if (modal.querySelector('#meeting-until')?.getAttribute('aria-expanded') === 'false') {
					observer.disconnect();
					resolve();
				}
			});
			observer.observe(modal, {subtree:true, attributes:true, attributeFilter:['aria-expanded']});
			day.click();
		});
		await waitFor(() => modal.querySelector('#meeting-until')?.getAttribute('aria-expanded') === 'false', 'calendar dismiss');

	};
	const exerciseWrites = async () => {
		const day = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'})
			.format(new Date(Date.now() + 24 * 60 * 60 * 1000));
		const start = new Date(day + 'T09:00:00+05:00');
		const at = (minutes) => new Date(start.getTime() + minutes * 60_000).toISOString();
		const api = window.smallDesktop;
		const accountId = 'employee-a';
		const prepared = await api.meetings.prepare({
			title:'Wails write fixture', agenda:'', participantIds:['synthetic-organizer'], startsAt:at(0),
			durationMinutes:30, location:'', conference:{mode:'none'},
			options:{calendarIds:[],notificationRecipientIds:[],attachmentIds:[],recurrence:null}
		});
		if (!prepared.ok) throw Error('prepare');
		const {id,revision} = prepared.data;
		const confirmed = await api.meetings.confirm({id,revision});
		if (!confirmed.ok || confirmed.data.phase !== 'succeeded') throw Error('confirm');
		const eventId = confirmed.data.eventId;
		const moved = await api.calendar.reschedule({accountId,eventId,beforeStart:at(0),beforeEnd:at(30),startsAt:at(60),endsAt:at(90)});
		if (!moved.ok) throw Error('reschedule');
		const before = {title:'Wails write fixture',description:'',location:'',starts_at:at(60),ends_at:at(90),
			calendar_ids:[],participant_ids:['synthetic-organizer'],notification_recipient_ids:[],attachments:[]};
		const edited = await api.calendar.updateEvent({accountId,eventId,before,after:{...before,title:'Edited Wails fixture'}});
		if (!edited.ok) throw Error('edit');
		const removed = await api.calendar.applyChange({accountId,eventId,change:{kind:'cancel'}});
		if (!removed.ok) throw Error('delete');
	};
	const timer = setInterval(() => {
		const card = [...document.querySelectorAll('.calendar-event')]
			.find((element) => element.getBoundingClientRect().height > 0);
		if (stage === 'sign-out') {
			const signOut = [...document.querySelectorAll('button')]
				.find((item) => item.textContent.trim() === 'Выйти из Small');
			if (signOut && !signOutClicked) {
				signOutClicked = true;
				signOut.click();
			}
			if (signOutClicked && !card && document.querySelector('#small-account-password')) done();
			return;
		}

		if (scenario === 'offline' && card?.textContent.includes('Синтетическая встреча A') &&
			document.querySelector('.calendar-freshness-warning')?.textContent.includes('Нет связи')) done();
		if (scenario === 'cache') {
			if (stage === 'start' && card?.textContent.includes('Синтетическая встреча A') &&
				document.querySelector('.calendar-freshness-warning')) {
				stage = 'refresh';
				window.dispatchEvent(new Event('focus'));
			} else if (stage === 'refresh' && card?.textContent.includes('Синтетическая встреча B')) {
				stage = 'sign-out';
				button('Профиль Small')?.click();
			} else if (stage === 'refresh') {
				window.dispatchEvent(new Event('focus'));
			}
			return;
		}
		if (scenario !== 'login' && scenario !== 'meeting-controls' && scenario !== 'meeting-links') return;

		if (stage === 'start') {
			const settings = button('Настройки AI-помощника');
			if (settings) {
				settings.click();
				stage = 'settings';
			}
			return;
		}
		if (stage === 'settings') {
			const dialog = document.querySelector('dialog.agent-settings[open]');
			const mood = dialog?.querySelector('select');
			const instructions = [...(dialog?.querySelectorAll('label') ?? [])]
				.find((label) => label.textContent.includes('Ваши инструкции'))?.querySelector('textarea');
			if (mood?.selectedOptions[0]?.textContent.trim() === 'Нейтральный' && instructions?.value === '' &&
				getComputedStyle(dialog.querySelector('h2')).fontSize === '20px' &&
				innerWidth === 1440 && innerHeight === 928 &&
				document.querySelectorAll('.dock-tab-label').length === 2 &&
				getComputedStyle(document.querySelector('.small-auth-notice')).fontSize === '13px') {
				layout = {
					viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
					dockPanels: document.querySelectorAll('.dock-tab-label').length,
					authNotice: getComputedStyle(document.querySelector('.small-auth-notice')).fontSize,
					settings: getComputedStyle(dialog.querySelector('h2')).fontSize
				};
				dialog.dispatchEvent(new Event('cancel', {cancelable: true}));
				stage = 'login';
			}
			return;
		}
		if (stage === 'filters' || stage === 'hidden') {
			const filter = [...document.querySelectorAll('.calendar-filters label')]
				.find((label) => label.textContent.trim() === 'Я участник')?.querySelector('input');
			if (stage === 'filters' && filter?.checked) {
				filter.click();
				stage = 'hidden';
			} else if (stage === 'hidden' && !card && filter && !filter.checked) {
				filter.click();
				stage = 'restored';
			}
			return;
		}
		if (stage === 'restored' && card) {
			button('Закрыть список календарей')?.click();
			button('Память ассистента')?.click();
			stage = 'memory';
			return;
		}
		if (stage === 'write-cycle' || stage === 'meeting-controls' || stage === 'meeting-links') return;
		if (stage === 'memory') {
			const labels = ['Предпочтения встреч', 'Группы участников', 'Форматы встреч'];
			if (labels.every((label) => button(label))) {
				void Promise.all([window.smallDesktop.memory.read(), window.smallDesktop.profiles.read()]).then(([memory, profiles]) => {
					if (memory.ok && profiles.ok && !Object.keys(memory.state.preferences).length &&
						!memory.state.entries.length && !memory.state.groups.length && !memory.state.presets.length &&
						profiles.state.profiles.every((profile) => !profile.hasKey) && stage === 'memory') {
						stage = 'write-cycle';
						void exerciseWrites().then(async () => {
							// Mutations clear the cache. Refill it for the subsequent restart assertions.
							const day = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
							await window.smallDesktop.calendar.events({accountId:'employee-a',date:day,view:'week',myCalendar:true,calendarIds:[]});
							done();
						}).catch((error) => fetch('/__preview_ready?pending=' + encodeURIComponent('write-cycle/' + error.message)));
					}
				});
			}
			return;
		}
		if (['details', 'declined', 'accepted'].includes(stage)) {
			const closeDetails = button('Закрыть событие');
			const dialog = closeDetails?.closest('dialog');
			const answers = [...(dialog?.querySelectorAll('.event-rsvp button') ?? [])];
			const no = answers.find((answer) => answer.textContent.trim() === 'Нет');
			const yes = answers.find((answer) => answer.textContent.trim() === 'Да');
			if (stage === 'details' && dialog?.textContent.includes('Синтетические детали встречи') && no) {
				no.click();
				stage = 'declined';
			} else if (stage === 'declined' && no?.getAttribute('aria-pressed') === 'true' && yes && !yes.disabled) {
				yes.click();
				stage = 'accepted';
			} else if (stage === 'accepted' && yes?.getAttribute('aria-pressed') === 'true' && !yes.disabled) {
				closeDetails.click();
				button('Показать календари')?.click();
				stage = 'filters';
			}
			return;
		}
		if (card?.textContent.includes('Синтетическая встреча A')) {
			if (scenario === 'meeting-controls') {
				stage = 'meeting-controls';
				void exerciseMeetingControls().then(done).catch((error) => pending('meeting controls/' + error.message));
			} else if (scenario === 'meeting-links') {
				stage = 'meeting-links';
				card.click();
				void exerciseMeetingLinks().then(done).catch((error) => pending('meeting links/' + error.message));
			} else {
				card.click();
				stage = 'details';
			}
			return;
		}
		const login = button('Войти в Small — открыть форму');
		if (login && !opened) {
			opened = true;
			login.click();
		}
		const password = document.querySelector('#small-account-password');
		const form = password?.closest('form');
		const username = form?.querySelector('[name="username"]');
		if (!submitted && username && password && !username.disabled && !password.disabled && !username.value && !password.value &&
			document.querySelector('.small-dock') && getComputedStyle(form.closest('dialog').querySelector('h2')).fontSize === '18px') {
			password.focus();
			if (document.activeElement !== password) return;
			layout.login = getComputedStyle(form.closest('dialog').querySelector('h2')).fontSize;
			submitted = true;
			setInput(username, 'employee-a');
			setInput(password, 'synthetic-password');
			form.requestSubmit();
		}
		const close = button('Закрыть профиль Small');
		if (submitted && close && [...document.querySelectorAll('button')]
			.some((item) => item.textContent.trim() === 'Выйти из Small')) close.click();
	}, 100);
`
