package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestSeriesDeletionScopes(t *testing.T) {
	for _, scope := range []string{"occurrence", "following"} {
		t.Run(scope, func(t *testing.T) {
			var made, removed atomic.Int32
			anchor := time.Now().In(smallZone).AddDate(0, 0, 2).Truncate(time.Hour)
			token := "header." + base64.RawURLEncoding.EncodeToString([]byte(`{"uid":"account","name":"Fixture","preferred_username":"fixture","guidfl":"organizer"}`)) + ".signature"
			item := func(id string, offset int) map[string]any {
				start := anchor.AddDate(0, 0, offset)
				return map[string]any{"id": id, "original_event_id": "series", "is_recurring": true, "creator_id": "organizer", "title": "Fixture",
					"starts_at": start.Format(time.RFC3339), "ends_at": start.Add(time.Hour).Format(time.RFC3339)}
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/gate/auth/login":
					http.SetCookie(w, &http.Cookie{Name: "test", Value: "yes", Path: "/"})
					fmt.Fprintf(w, `{"data":{"access_token":%q}}`, token)
				case "/gate/team/api/user/info":
					fmt.Fprint(w, `{"data":{}}`)
				case "/gate/team/api/calendars/my/events":
					items := []map[string]any{item("past", -7)}
					if removed.Load() == 0 {
						items = append(items, item("", 0))
					}
					if removed.Load() == 0 || scope == "occurrence" {
						items = append(items, item("next", 7))
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"data": items})
				case "/gate/team/api/calendar/events/generated":
					_ = json.NewEncoder(w).Encode(map[string]any{"data": item("", 0)})
				case "/gate/team/api/calendar/events/from-template":
					made.Add(1)
					fmt.Fprint(w, `{"data":{"id":"materialized"}}`)
				case "/gate/team/api/calendar/events/materialized":
					if r.Method == http.MethodDelete {
						if scope != "following" {
							t.Error("unexpected scope")
						}
						removed.Add(1)
						w.WriteHeader(http.StatusNoContent)
					} else {
						_ = json.NewEncoder(w).Encode(map[string]any{"data": item("materialized", 0)})
					}
				case "/gate/team/api/calendar/events/materialized/cancel":
					if r.Method != http.MethodPost || scope != "occurrence" {
						t.Error("unexpected cancellation")
					}
					removed.Add(1)
					fmt.Fprint(w, `{}`)
				default:
					http.NotFound(w, r)
				}
			}))
			t.Cleanup(server.Close)
			s := newSmallService(server.URL)
			s.store = &sessionStore{directory: t.TempDir()}
			ctx := context.Background()
			if r := s.Login(ctx, smallCredentials{"fixture", "synthetic"}); !r.OK {
				t.Fatalf("login: %+v", r)
			}
			q := seriesRequest{AccountID: "account", Operation: "delete", Scope: scope, SeriesID: "series", OriginalDate: anchor.Format(time.DateOnly),
				BeforeStart: anchor.Format(time.RFC3339), BeforeEnd: anchor.Add(time.Hour).Format(time.RFC3339)}
			if r := s.GateSeries(ctx, q); !r.OK || !r.Data.Open {
				t.Fatalf("gate: %+v", r)
			}
			if r := s.ApplySeries(ctx, q); !r.OK || !r.Data.Materialized || r.Data.Status != "applied" {
				t.Fatalf("apply: %+v", r)
			}
			if r := s.ApplySeries(ctx, q); !r.OK || r.Data.Status != "already-applied" {
				t.Fatalf("retry: %+v", r)
			}
			if made.Load() != 1 || removed.Load() != 1 {
				t.Fatalf("unexpected writes: materialize=%d remove=%d", made.Load(), removed.Load())
			}
		})
	}
}
