package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestEventMutationJournalAcrossRestart(t *testing.T) {
	var mu sync.Mutex
	var puts, deletes int
	var deny, conceal, conflict bool
	target := time.Now().In(smallZone).AddDate(0, 0, 2).Truncate(time.Hour)
	record := map[string]any{
		"id": 42, "creator_id": "participant", "title": "Fixture", "description": "", "location": "",
		"starts_at": target.Format(time.RFC3339), "ends_at": target.Add(time.Hour).Format(time.RFC3339),
		"timezone": "Asia/Almaty", "is_public": false, "is_recurring": false,
		"calendar_ids": []int{7}, "participants": []eventPerson{{ID: json.RawMessage(`"participant"`)}},
		"notification_recipients": []eventPerson{}, "attachments": []eventPerson{},
	}
	token := "header." + base64.RawURLEncoding.EncodeToString([]byte(`{"uid":"account","name":"Fixture","preferred_username":"fixture","guidfl":"participant"}`)) + ".signature"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.URL.Path {
		case "/gate/auth/login", "/gate/auth/refresh":
			http.SetCookie(w, &http.Cookie{Name: "fixture", Value: "yes", Path: "/"})
			fmt.Fprintf(w, `{"data":{"access_token":%q}}`, token)
		case "/gate/team/api/user/info":
			fmt.Fprint(w, `{"data":{}}`)
		case "/gate/team/api/calendar/events/42":
			if r.Method == http.MethodPut {
				puts++
				if conflict && r.URL.Query().Get("force") != "true" {
					w.WriteHeader(http.StatusConflict)
					fmt.Fprint(w, `{"errors":{"participant_ids":["participant"]}}`)
					return
				}
				var next eventBody
				if err := json.NewDecoder(r.Body).Decode(&next); err != nil {
					t.Error("failed to decode update")
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				record["title"], record["starts_at"], record["ends_at"] = next.Title, next.Start, next.End
				if puts == 1 {
					conceal = true
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
			}
			if r.Method == http.MethodDelete {
				deletes++
				record["status"] = "cancelled"
				w.WriteHeader(http.StatusNoContent)
				return
			}
			if conceal {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			copy := make(map[string]any, len(record))
			for key, value := range record {
				copy[key] = value
			}
			if deny {
				copy["creator_id"] = "other"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": copy})
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
	if reply := s.Login(ctx, smallCredentials{"fixture", "synthetic"}); !reply.OK {
		t.Fatalf("login: %+v", reply)
	}
	move := eventMove{"account", "42", target.Format(time.RFC3339), target.Add(time.Hour).Format(time.RFC3339),
		target.Add(time.Hour).Format(time.RFC3339), target.Add(2 * time.Hour).Format(time.RFC3339)}
	mu.Lock()
	deny = true
	mu.Unlock()
	if reply := s.Reschedule(ctx, move); reply.Kind != "denied" {
		t.Fatalf("expected organizer check: %+v", reply)
	}
	mu.Lock()
	deny = false
	mu.Unlock()
	if reply := s.Reschedule(ctx, move); !reply.UnknownOutcome {
		t.Fatalf("expected uncertain result: %+v", reply)
	}
	s = open()
	if reply := s.Read(ctx); !reply.OK {
		t.Fatalf("restart: %+v", reply)
	}
	if reply := s.Reschedule(ctx, move); !reply.UnknownOutcome {
		t.Fatalf("expected retry to stay blocked: %+v", reply)
	}
	mu.Lock()
	conceal = false
	mu.Unlock()
	if reply := s.Reschedule(ctx, move); !reply.OK {
		t.Fatalf("expected confirmed readback: %+v", reply)
	}
	mu.Lock()
	if puts != 1 {
		t.Errorf("sent %d moves, want 1", puts)
	}
	mu.Unlock()

	var edit eventMutation
	edit.AccountID, edit.EventID, edit.Change.Kind = "account", "42", "edit"
	fields := eventFields{Title: "Fixture", Start: move.Start, End: move.End, Calendars: []int64{7},
		Participants: []string{"participant"}, Recipients: []string{}, Attachments: []string{}}
	after := fields
	after.Title = "Edited"
	edit.Change.Before, edit.Change.After = &fields, &after
	mu.Lock()
	conflict = true
	mu.Unlock()
	if reply := s.ApplyChange(ctx, edit); len(reply.ConflictingParticipantIDs) != 1 {
		t.Fatalf("expected verified participant conflict: %+v", reply)
	}
	edit.Change.AllowConflicts = true
	if reply := s.ApplyChange(ctx, edit); !reply.OK {
		t.Fatalf("confirmed edit: %+v", reply)
	}

	var remove eventMutation
	remove.AccountID, remove.EventID, remove.Change.Kind = "account", "42", "cancel"
	if reply := s.ApplyChange(ctx, remove); !reply.OK {
		t.Fatalf("delete: %+v", reply)
	}
	mu.Lock()
	if deletes != 1 {
		t.Errorf("sent %d deletions, want 1", deletes)
	}
	mu.Unlock()
}
