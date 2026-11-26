package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"
)

type reminderSettings struct {
	Enabled bool `json:"enabled"`
	Minutes int  `json:"minutes"`
}

type reminderFile struct {
	Settings reminderSettings `json:"settings"`
	Sent     map[string]int64 `json:"sent"`
}

type reminderEvent struct {
	Key       string          `json:"key"`
	Aliases   []string        `json:"aliases"`
	Lookup    json.RawMessage `json:"lookup"`
	Title     string          `json:"title"`
	StartsAt  time.Time       `json:"startsAt"`
	EndsAt    time.Time       `json:"endsAt"`
	Location  string          `json:"location"`
	Organizer string          `json:"organizer"`
}

type reminderItem struct {
	ID      string          `json:"id"`
	Event   json.RawMessage `json:"event"`
	CanJoin bool            `json:"canJoin"`
}

type reminderState struct {
	Settings reminderSettings `json:"settings"`
	Items    []reminderItem   `json:"items"`
	Warning  string           `json:"warning"`
}

type reminderReply struct {
	OK    bool           `json:"ok"`
	State *reminderState `json:"state,omitempty"`
	Error string         `json:"error,omitempty"`
}

type reminderCalendar struct {
	Account string            `json:"account"`
	Events  []json.RawMessage `json:"events"`
}

type ReminderService struct {
	path   string
	source func(context.Context, string, json.RawMessage) (json.RawMessage, error)
	now    func() time.Time
	notify func(string, reminderEvent) error
	remove func(string)
	open   func(string) error

	mu            sync.Mutex
	poll          sync.Mutex
	account       string
	items         []reminderItem
	epoch         uint64
	warning       string
	nativeWarning string
	refresh       chan struct{}
}

func reminderKey(account, key string) string {
	return electronDigest(electronJSON([]any{account, key}))
}

func meetingURL(raw string) string {
	if len(raw) > 2048 || strings.ContainsAny(raw, "\\") || strings.ContainsFunc(raw, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsControl(r)
	}) {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return ""
	}
	return u.String()
}

func (r *ReminderService) load() (reminderFile, error) {
	data, err := privateFile(r.path, 4<<20)
	if errors.Is(err, os.ErrNotExist) {
		return reminderFile{Settings: reminderSettings{true, 5}, Sent: make(map[string]int64)}, nil
	}
	var file reminderFile
	var envelope struct {
		Settings json.RawMessage  `json:"settings"`
		Sent     map[string]int64 `json:"sent"`
	}
	if err != nil || json.Unmarshal(data, &envelope) != nil || envelope.Sent == nil {
		return file, errors.New("не удалось прочитать настройки напоминаний")
	}
	settings, valid := parseReminderSettings(envelope.Settings)
	if !valid {
		return file, errors.New("некорректные настройки напоминаний")
	}
	return reminderFile{Settings: settings, Sent: envelope.Sent}, nil
}

func parseReminderSettings(data json.RawMessage) (reminderSettings, bool) {
	var input struct {
		Enabled *bool `json:"enabled"`
		Minutes *int  `json:"minutes"`
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || d.Decode(new(any)) != io.EOF ||
		input.Enabled == nil || input.Minutes == nil || *input.Minutes < 0 || *input.Minutes > 60 {
		return reminderSettings{}, false
	}
	return reminderSettings{*input.Enabled, *input.Minutes}, true
}

func (r *ReminderService) save(file reminderFile) error {
	raw, err := json.Marshal(file)
	if err != nil {
		return err
	}
	return atomicFile(r.path, raw, false)
}

func (r *ReminderService) invalidateLocked() {
	r.epoch++
	if r.remove != nil {
		for _, item := range r.items {
			go r.remove(item.ID)
		}
	}
	r.items = nil
	r.account = ""
	r.warning = ""
}

func (r *ReminderService) invalidate() {
	r.mu.Lock()
	r.invalidateLocked()
	r.mu.Unlock()
}

func (r *ReminderService) schedule() {
	select {
	case r.refresh <- struct{}{}:
	default:
	}
}

func (r *ReminderService) run(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
		case <-r.refresh:
		case <-ctx.Done():
			return
		}
		timeout, cancel := context.WithTimeout(ctx, 25*time.Second)
		r.tick(timeout)
		cancel()
	}
}

func (r *ReminderService) tick(ctx context.Context) {
	r.poll.Lock()
	defer r.poll.Unlock()
	if ctx.Err() != nil {
		return
	}
	r.mu.Lock()
	epoch := r.epoch
	file, err := r.load()
	r.mu.Unlock()
	if err != nil || !file.Settings.Enabled {
		return
	}
	day := r.now().In(smallZone).Format(time.DateOnly)
	input, _ := json.Marshal(day)
	data, err := r.source(ctx, "reminders.events", input)
	var source reminderCalendar
	if err == nil {
		err = json.Unmarshal(data, &source)
		if err == nil && source.Events == nil {
			err = errors.New("неполный календарь")
		}
	}
	r.mu.Lock()
	if epoch != r.epoch || ctx.Err() != nil {
		r.mu.Unlock()
		return
	}
	if err != nil || (r.account != "" && r.account != source.Account) {
		r.invalidateLocked()
		if err != nil {
			r.warning = "Не удалось обновить напоминания. Проверьте вход в Small и подключение к сети."
		}
		r.mu.Unlock()
		return
	}
	r.account = source.Account
	r.warning = ""
	now := r.now()
	for key, end := range file.Sent {
		if end < now.AddDate(0, 0, -30).UnixMilli() {
			delete(file.Sent, key)
		}
	}
	next := make([]reminderItem, 0)
	var deliveries []struct {
		id    string
		event reminderEvent
	}
	seen := make(map[string]bool)
	for _, raw := range source.Events {
		var event reminderEvent
		if json.Unmarshal(raw, &event) != nil || event.Key == "" || event.Title == "" ||
			event.EndsAt.IsZero() || !event.EndsAt.After(now) ||
			event.StartsAt.Add(-time.Duration(file.Settings.Minutes)*time.Minute).After(now) {
			continue
		}
		id := reminderKey(source.Account, event.Key)
		if seen[id] {
			continue
		}
		seen[id] = true
		next = append(next, reminderItem{id, raw, meetingURL(event.Location) != ""})
		deliveries = append(deliveries, struct {
			id    string
			event reminderEvent
		}{id, event})
	}
	for _, item := range r.items {
		current := slices.IndexFunc(next, func(other reminderItem) bool { return other.ID == item.ID && bytes.Equal(other.Event, item.Event) })
		if current < 0 && r.remove != nil {
			go r.remove(item.ID)
		}
	}
	r.items = next
	r.mu.Unlock()
	for _, delivery := range deliveries {
		r.mu.Lock()
		if epoch != r.epoch || ctx.Err() != nil {
			r.mu.Unlock()
			return
		}
		fresh := claimReminder(file.Sent, source.Account, delivery.id, delivery.event)
		if r.save(file) != nil {
			r.warning = "Не удалось сохранить журнал напоминаний."
			r.mu.Unlock()
			return
		}
		r.mu.Unlock()
		if !fresh || r.notify == nil {
			continue
		}
		err := r.notify(delivery.id, delivery.event)
		r.mu.Lock()
		current := epoch == r.epoch
		if current && err != nil {
			r.nativeWarning = "Системное уведомление не показано. Проверьте разрешения macOS. Напоминание доступно в этом окне."
		}
		r.mu.Unlock()
		if !current && r.remove != nil {
			r.remove(delivery.id)
		}
	}
}

func claimReminder(sent map[string]int64, account, id string, event reminderEvent) bool {
	_, delivered := sent[id]
	var lookup struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(event.Lookup, &lookup)
	end := event.EndsAt.UnixMilli()
	for _, alias := range event.Aliases {
		hash := reminderKey(account, alias)
		previous, recorded := sent[hash]
		delivered = delivered || recorded
		if recorded || lookup.ID == "" {
			sent[hash] = max(previous, end)
		}
	}
	sent[id] = max(sent[id], end)
	return !delivered
}

func (r *ReminderService) join(ctx context.Context, id string) error {
	r.mu.Lock()
	current := slices.IndexFunc(r.items, func(item reminderItem) bool { return item.ID == id })
	if current < 0 {
		r.mu.Unlock()
		return errors.New("напоминание недоступно")
	}
	item, account, epoch := r.items[current], r.account, r.epoch
	r.mu.Unlock()
	var old reminderEvent
	if json.Unmarshal(item.Event, &old) != nil {
		return errors.New("напоминание недоступно")
	}
	input, _ := json.Marshal(map[string]any{"account": account, "lookup": old.Lookup})
	reply, err := r.source(ctx, "reminders.detail", input)
	var event reminderEvent
	if err != nil || json.Unmarshal(reply, &event) != nil {
		return errors.New("встреча недоступна")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	link := meetingURL(event.Location)
	if epoch != r.epoch || !event.StartsAt.Equal(old.StartsAt) || !event.EndsAt.After(r.now()) || link == "" {
		return errors.New("встреча изменилась или ссылка отсутствует")
	}
	return r.open(link)
}

func (r *ReminderService) Invoke(ctx context.Context, method string, input json.RawMessage) reminderReply {
	failed := reminderReply{Error: "Не удалось выполнить действие. Проверьте настройки, вход в Small и актуальность встречи."}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	switch method {
	case "read":
		r.schedule()
	case "save":
		settings, valid := parseReminderSettings(input)
		if !valid {
			return failed
		}
		r.mu.Lock()
		file, err := r.load()
		if err == nil {
			file.Settings = settings
			err = r.save(file)
		}
		if err == nil {
			r.invalidateLocked()
		}
		r.mu.Unlock()
		if err != nil {
			return failed
		}
		r.tick(ctx)
	case "join":
		var id string
		if len(input) != 66 || json.Unmarshal(input, &id) != nil || r.join(ctx, id) != nil {
			return failed
		}
	default:
		return failed
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	file, err := r.load()
	if err != nil {
		return failed
	}
	warning := r.warning
	if warning == "" {
		warning = r.nativeWarning
	}
	return reminderReply{true, &reminderState{file.Settings, append([]reminderItem{}, r.items...), warning}, ""}
}
