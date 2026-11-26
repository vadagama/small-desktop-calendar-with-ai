package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type assistantCalendarRequest struct {
	AccountID string          `json:"accountId"`
	Revision  uint64          `json:"revision"`
	Path      string          `json:"path"`
	Body      json.RawMessage `json:"body"`
}

func assistantReadAllowed(path string, body json.RawMessage) bool {
	u, err := url.ParseRequestURI(path)
	if err != nil || u.IsAbs() || u.RawPath != "" || u.Host != "" || u.Fragment != "" {
		return false
	}
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return false
	}
	for _, values := range q {
		if len(values) != 1 {
			return false
		}
	}
	parts := strings.Split(u.Path, "/")
	if len(body) != 0 {
		if len(q) != 0 {
			return false
		}
		var input struct {
			Participants []string `json:"participant_ids"`
			Timezone     string   `json:"timezone"`
			Date         string   `json:"date"`
			StartDate    string   `json:"start_date"`
			Duration     int      `json:"duration_minutes"`
			Weekends     *bool    `json:"include_weekends"`
		}
		if json.Unmarshal(body, &input) != nil || len(input.Participants) == 0 ||
			!validMeetingIDs(input.Participants, meetingParticipantLimit) || input.Timezone != "Asia/Almaty" {
			return false
		}
		switch u.Path {
		case "/gate/team/api/calendar/events/busy-intervals":
			_, err = time.Parse(time.DateOnly, input.Date)
			return err == nil && input.StartDate == "" && input.Duration == 0 && input.Weekends == nil
		case "/gate/team/api/calendar/events/find-slots":
			_, err = time.Parse(time.DateOnly, input.StartDate)
			return err == nil && input.Date == "" && input.Duration >= 1 && input.Duration <= 480 && input.Weekends != nil
		default:
			return false
		}
	}
	switch u.Path {
	case "/gate/team/api/calendars/public":
		return len(q) == 0
	case "/gate/employee/api/search/persons":
		page, err := strconv.ParseInt(q.Get("page"), 10, 64)
		return len(q) == 3 && q.Get("per_page") == "10" && len([]rune(q.Get("q"))) >= 1 && len([]rune(q.Get("q"))) <= 200 &&
			err == nil && page >= 1 && page <= 9007199254740991
	case "/gate/team/api/calendar/events/generated":
		_, err := time.Parse(time.DateOnly, q.Get("date"))
		return len(q) == 2 && smallID.MatchString(q.Get("original_event_id")) && err == nil
	}
	if len(parts) != 7 || parts[0] != "" || parts[1] != "gate" || parts[2] != "team" || parts[3] != "api" {
		return false
	}
	if parts[4] == "calendar" && parts[5] == "events" {
		return len(q) == 0 && plainEventID(parts[6])
	}
	if parts[4] == "calendars" && parts[6] == "events" && smallID.MatchString(parts[5]) && len(q) == 2 {
		start, err1 := time.Parse(time.RFC3339Nano, q.Get("start_date"))
		end, err2 := time.Parse(time.RFC3339Nano, q.Get("end_date"))
		return err1 == nil && err2 == nil && end.After(start) && end.Sub(start) <= 43*24*time.Hour
	}
	return false
}

func (a *AssistantService) serviceCall(p *assistantProcess, frame assistantFrame) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	go func() {
		select {
		case <-p.done:
			cancel()
		case <-ctx.Done():
		}
	}()
	s := a.small
	var result any = false
	switch frame.Method {
	case "auth":
		s.mu.Lock()
		reply := s.read(ctx)
		if s.token == "" {
			reply.State = nil
		}
		result = struct {
			State    *smallState `json:"state,omitempty"`
			Revision uint64      `json:"revision"`
		}{reply.State, s.revision}
		s.mu.Unlock()
	case "read-calendar":
		var request assistantCalendarRequest
		status, body := http.StatusBadRequest, ""
		if json.Unmarshal(frame.Input, &request) == nil && assistantReadAllowed(request.Path, request.Body) {
			s.mu.Lock()
			if s.revision != request.Revision || !s.canReadCalendar(request.AccountID) {
				status = http.StatusUnauthorized
			} else if s.token == "" {
				status = http.StatusServiceUnavailable
			} else if len(request.Body) == 0 {
				code, raw, err := s.get(ctx, request.Path)
				status, body = code, string(raw)
				if err != nil {
					status, body = http.StatusServiceUnavailable, ""
				}
			} else {
				code, raw, err := s.request(ctx, http.MethodPost, request.Path, request.Body)
				if err == nil && code == 401 {
					if renewed, renewErr := s.renew(ctx, request.AccountID); renewErr == nil && renewed >= 200 && renewed < 300 {
						code, raw, err = s.request(ctx, http.MethodPost, request.Path, request.Body)
					}
				}
				status, body = code, string(raw)
				if err != nil {
					status, body = http.StatusServiceUnavailable, ""
				}
			}
			s.mu.Unlock()
		}
		result = struct {
			Status int    `json:"status"`
			Body   string `json:"body"`
		}{status, body}
	case "register-draft":
		var input struct {
			Revision uint64       `json:"revision"`
			Draft    meetingDraft `json:"draft"`
		}
		if json.Unmarshal(frame.Input, &input) == nil {
			s.mu.Lock()
			d := input.Draft
			if input.Revision == s.revision && s.token != "" && s.profile.ID == d.Organizer.ID &&
				len(s.drafts) < 100 && d.Revision == 1 && len(d.ID) == 36 && d.Timezone == "Asia/Almaty" &&
				d.Visibility == "private" && len(d.Participants) > 0 && validMeetingIDs(d.Participants, meetingParticipantLimit) {
				if _, exists := s.drafts[d.ID]; !exists {
					// The original tool executor returns no manual options.
					if d.Options.Calendars == nil {
						d.Options.Calendars = []int64{}
					}
					if d.Options.Recipients == nil {
						d.Options.Recipients = []string{}
					}
					if d.Options.Attachments == nil {
						d.Options.Attachments = []string{}
					}
					s.drafts[d.ID] = d
					result = true
				}
			}
			s.mu.Unlock()
		}
	}
	data, _ := json.Marshal(result)
	_ = p.write(assistantFrame{Type: "result", ID: frame.ID, Data: data})
}
