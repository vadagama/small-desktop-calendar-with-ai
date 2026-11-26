package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"
	"time"
)

func TestManualMeetingConfirmationAndDuplicatePrevention(t *testing.T) {
	var mu sync.Mutex
	var writes int
	var dropCreateResponse bool
	var saved eventBody
	guests := []string{"guest"}
	for i := 1; i < 99; i++ {
		guests = append(guests, fmt.Sprintf("guest-%d", i))
	}
	participants := append(slices.Clone(guests), "organizer")
	start := time.Now().In(smallZone).AddDate(0, 0, 1).Truncate(time.Hour)
	token := "header." + base64.RawURLEncoding.EncodeToString([]byte(`{"uid":"account","name":"Fixture","preferred_username":"fixture","guidfl":"organizer"}`)) + ".signature"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.URL.Path {
		case "/gate/auth/login", "/gate/auth/refresh":
			http.SetCookie(w, &http.Cookie{Name: "fixture", Value: "yes", Path: "/"})
			fmt.Fprintf(w, `{"data":{"access_token":%q}}`, token)
		case "/gate/team/api/user/info":
			fmt.Fprint(w, `{"data":{}}`)
		case "/gate/team/api/calendar/events/busy-intervals":
			var query struct {
				Participants []string `json:"participant_ids"`
			}
			if json.NewDecoder(r.Body).Decode(&query) != nil || !slices.Equal(query.Participants, participants) {
				t.Error("availability request did not include the complete meeting roster")
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			records := make([]map[string]any, 0, len(participants))
			for _, id := range participants {
				slots := []busyInterval{}
				if id == "guest" {
					slots = append(slots, busyInterval{Start: start, End: start.Add(time.Hour)})
				}
				records = append(records, map[string]any{"type": "participant", "id": id, "busy_slots": slots})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": records})
		case "/gate/team/api/calendars/my/events":
			fmt.Fprint(w, `{"data":[]}`)
		case "/gate/team/api/calendar/events":
			if r.Method != http.MethodPost || json.NewDecoder(r.Body).Decode(&saved) != nil ||
				!slices.Equal(saved.Participants, participants) ||
				(!dropCreateResponse && r.URL.Query().Get("force") != "true") {
				t.Error("invalid confirmed create")
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			writes++
			if dropCreateResponse {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			fmt.Fprint(w, `{"data":{"id":42}}`)
		case "/gate/team/api/calendar/events/42":
			roster := make([]map[string]string, 0, len(participants))
			for _, id := range participants {
				roster = append(roster, map[string]string{"id": id})
			}
			var description *string
			if saved.Description != "" {
				description = &saved.Description
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
				"id": 42, "creator_id": "organizer", "title": saved.Title, "description": description, "location": saved.Location,
				"starts_at": saved.Start, "ends_at": saved.End, "is_public": false, "is_recurring": false,
				"participants": roster,
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	dir := t.TempDir()
	open := func() *SmallService {
		s := newSmallService(server.URL)
		s.store = &sessionStore{directory: dir}
		s.pendingRestore = true
		return s
	}
	ctx := context.Background()
	s := open()
	if r := s.Login(ctx, smallCredentials{"fixture", "synthetic"}); !r.OK {
		t.Fatalf("login: %+v", r)
	}
	input := manualMeeting{Title: "Fixture", Participants: guests, Start: start.Format(time.RFC3339), Duration: 30,
		Options: meetingOptions{Calendars: []int64{}, Recipients: []string{}, Attachments: []string{}}}
	input.Conference.Mode = "custom"
	input.Conference.URL = "https://conference.example.test/room"
	overflow := input
	overflow.Participants = append(slices.Clone(guests), "extra-guest")
	if r := s.PrepareMeeting(ctx, overflow); r.OK || r.Kind != "invalid" {
		t.Fatalf("expected 101 people with organizer to be rejected: %+v", r)
	}
	draft := s.PrepareMeeting(ctx, input)
	if !draft.OK {
		t.Fatalf("prepare: %+v", draft)
	}
	ref := meetingReference{ID: draft.Data.ID, Revision: 1}
	pending := s.ConfirmMeeting(ctx, ref)
	if !pending.OK || pending.Data.Phase != "preview" || !pending.Data.Draft.Unconfirmed {
		t.Fatalf("expected conflict before dispatch: %+v", pending)
	}
	mu.Lock()
	if writes != 0 {
		t.Error("sent before conflict was shown")
	}
	mu.Unlock()
	ref.AllowUnconfirmed = true
	if r := s.ConfirmMeeting(ctx, ref); !r.OK || r.Data.Phase != "succeeded" || r.Data.EventID != "42" {
		t.Fatalf("confirmed create: %+v", r)
	}
	s = open()
	draft = s.PrepareMeeting(ctx, input)
	if !draft.OK {
		t.Fatalf("restart prepare: %+v", draft)
	}
	if r := s.ConfirmMeeting(ctx, meetingReference{ID: draft.Data.ID, Revision: 1}); !r.OK || r.Data.Phase != "succeeded" {
		t.Fatalf("existing receipt: %+v", r)
	}
	mu.Lock()
	if writes != 1 {
		mu.Unlock()
		t.Fatalf("sent %d create requests", writes)
	}
	dropCreateResponse = true
	mu.Unlock()
	input.Title = "Fixture with lost response"
	input.Start = start.AddDate(0, 0, 1).Format(time.RFC3339)
	draft = s.PrepareMeeting(ctx, input)
	if !draft.OK {
		t.Fatalf("prepare second draft: %+v", draft)
	}
	ref = meetingReference{ID: draft.Data.ID, Revision: 1, AllowUnconfirmed: draft.Data.Unconfirmed}
	if r := s.ConfirmMeeting(ctx, ref); !r.OK || r.Data.Phase != "unknown" {
		t.Fatalf("expected unknown without a returned event ID: %+v", r)
	}
	s = open()
	draft = s.PrepareMeeting(ctx, input)
	if !draft.OK {
		t.Fatalf("prepare after restart: %+v", draft)
	}
	if r := s.ConfirmMeeting(ctx, meetingReference{ID: draft.Data.ID, Revision: 1, AllowUnconfirmed: true}); !r.OK || r.Data.Phase != "unknown" {
		t.Fatalf("unknown must survive restart: %+v", r)
	}
	mu.Lock()
	defer mu.Unlock()
	if writes != 2 {
		t.Fatalf("sent %d create requests, expected one per operation", writes)
	}
}
