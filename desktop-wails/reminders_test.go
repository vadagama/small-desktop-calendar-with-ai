package main

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

func TestRemindersPersistDeliveryAndRevalidateJoin(t *testing.T) {
	now := time.Date(2026, 11, 26, 9, 0, 0, 0, smallZone)
	event := reminderEvent{
		Key: "event:fixture", Title: "Synthetic meeting",
		Lookup: json.RawMessage(`{"id":"fixture"}`), StartsAt: now.Add(5 * time.Minute),
		EndsAt: now.Add(time.Hour), Location: "https://example.invalid/meeting",
	}
	var deliveries int
	var opened string
	account := "fixture-account"
	broken := false
	source := func(_ context.Context, method string, _ json.RawMessage) (json.RawMessage, error) {
		if method == "reminders.detail" {
			return json.Marshal(event)
		}
		if broken {
			return json.RawMessage(`{"ok":false,"error":"Calendar unavailable"}`), nil
		}
		raw, _ := json.Marshal(event)
		return json.Marshal(reminderCalendar{Account: account, Events: []json.RawMessage{raw}})
	}
	file := filepath.Join(t.TempDir(), "reminders.json")
	makeService := func() *ReminderService {
		return &ReminderService{
			path: file, source: source, now: func() time.Time { return now },
			refresh: make(chan struct{}, 1), notify: func(string, reminderEvent) error { deliveries++; return nil },
			open: func(link string) error { opened = link; return nil },
		}
	}
	ctx := context.Background()
	r := makeService()
	r.tick(ctx)
	state := r.Invoke(ctx, "read", nil)
	if !state.OK || len(state.State.Items) != 1 || deliveries != 1 {
		t.Fatalf("initial delivery was not claimed: %+v, deliveries %d", state, deliveries)
	}
	input, _ := json.Marshal(state.State.Items[0].ID)
	event.Location = "https://updated.example.invalid/meeting"
	if reply := r.Invoke(ctx, "join", input); !reply.OK || opened != event.Location {
		t.Fatal("join did not use fresh meeting details")
	}
	event.StartsAt = event.StartsAt.Add(time.Minute)
	if reply := r.Invoke(ctx, "join", input); reply.OK {
		t.Fatal("join accepted an outdated meeting time")
	}
	now = now.Add(time.Minute)
	r = makeService()
	r.tick(ctx)
	if got := r.Invoke(ctx, "read", nil); !got.OK || len(got.State.Items) != 1 || deliveries != 1 {
		t.Fatal("a moved meeting was re-delivered on restart")
	}
	broken = true
	r.tick(ctx)
	if got := r.Invoke(ctx, "read", nil); !got.OK || len(got.State.Items) != 0 || got.State.Warning == "" {
		t.Fatal("the reminder survived an incomplete calendar or the warning was lost")
	}
	broken = false
	if got := r.Invoke(ctx, "save", json.RawMessage(`{"enabled":false,"minutes":20}`)); !got.OK ||
		got.State.Settings.Enabled || got.State.Settings.Minutes != 20 || len(got.State.Items) != 0 {
		t.Fatal("saving preferences did not update the reminder view")
	}
}

func TestRemindersDoNotClaimUnattemptedDeliveries(t *testing.T) {
	now := time.Date(2026, 11, 26, 9, 0, 0, 0, smallZone)
	const account = "fixture-owner"
	events := make([]json.RawMessage, 0, 2)
	for _, key := range []string{"first", "second"} {
		raw, _ := json.Marshal(reminderEvent{
			Key: key, Title: "Synthetic meeting", StartsAt: now, EndsAt: now.Add(time.Hour),
		})
		events = append(events, raw)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var delivered []string
	r := &ReminderService{
		path: filepath.Join(t.TempDir(), "reminders.json"),
		now:  func() time.Time { return now },
		source: func(context.Context, string, json.RawMessage) (json.RawMessage, error) {
			return json.Marshal(reminderCalendar{Account: account, Events: events})
		},
		notify: func(_ string, event reminderEvent) error {
			delivered = append(delivered, event.Key)
			cancel()
			return nil
		},
	}
	r.tick(ctx)
	r.tick(context.Background())
	if len(delivered) != 2 || delivered[0] != "first" || delivered[1] != "second" {
		t.Fatalf("cancellation lost an unattempted delivery: %q", delivered)
	}
}
