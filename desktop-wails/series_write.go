package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"time"
)

type seriesRequest struct {
	AccountID    string `json:"accountId"`
	Operation    string `json:"operation"`
	Scope        string `json:"scope"`
	SeriesID     string `json:"seriesId"`
	OriginalDate string `json:"originalDate"`
	EventID      string `json:"eventId,omitempty"`
	BeforeStart  string `json:"beforeStart"`
	BeforeEnd    string `json:"beforeEnd"`
}
type seriesGate struct {
	Open    bool   `json:"open"`
	Reason  string `json:"reason,omitempty"`
	Message string `json:"message"`
	Summary string `json:"summary"`
}
type seriesResult struct {
	Status       string `json:"status"`
	Materialized bool   `json:"materialized"`
}
type seriesMember struct {
	ID      string
	Title   string
	Start   string
	End     string
	Creator string
}

func seriesIdentity(e eventRecord) string {
	if original := invitationID(e.Original); original != "" {
		return original
	}
	if e.Recurring != nil && *e.Recurring {
		return invitationID(e.ID)
	}
	return ""
}
func seriesDate(at string) string {
	t, err := time.Parse(time.RFC3339Nano, at)
	if err != nil {
		return ""
	}
	return t.In(smallZone).Format(time.DateOnly)
}
func validSeries(request seriesRequest) bool {
	begin, err1 := time.Parse(time.RFC3339Nano, request.BeforeStart)
	end, err2 := time.Parse(time.RFC3339Nano, request.BeforeEnd)
	_, err3 := time.Parse(time.DateOnly, request.OriginalDate)
	return err1 == nil && err2 == nil && err3 == nil && end.After(begin) && plainEventID(request.SeriesID) &&
		(request.EventID == "" || plainEventID(request.EventID)) &&
		(request.Scope == "occurrence" || request.Scope == "following") && editableDay(request.BeforeStart) &&
		request.OriginalDate >= time.Now().In(smallZone).Format(time.DateOnly)
}
func seriesSummary(q seriesRequest) string {
	if q.Scope == "occurrence" {
		return "Только это вхождение: " + q.OriginalDate + ". Остальные встречи серии не изменятся."
	}
	return "Это и последующие: с " + q.OriginalDate + ". Прошедшие встречи не изменятся."
}
func (s *SmallService) currentSeries(ctx context.Context, q seriesRequest) (eventRecord, smallReply[struct{}]) {
	path := "/gate/team/api/calendar/events/" + q.EventID
	if q.EventID == "" {
		params := url.Values{"original_event_id": {q.SeriesID}, "date": {q.OriginalDate}}
		path = "/gate/team/api/calendar/events/generated?" + params.Encode()
	}
	status, raw, err := s.get(ctx, path)
	if err != nil || status < 200 || status >= 300 {
		return eventRecord{}, invitationFailure(status, err)
	}
	e, ok := readEvent(raw)
	if !ok || seriesIdentity(e) != q.SeriesID || seriesDate(e.Start) != q.OriginalDate ||
		invitationID(e.Creator) != s.organizerID() || (q.EventID != "" && invitationID(e.ID) != q.EventID) {
		return eventRecord{}, failure[struct{}]("denied", "Удалять встречи серии может только её организатор.")
	}
	if canonicalInstant(e.Start) != canonicalInstant(q.BeforeStart) || canonicalInstant(e.End) != canonicalInstant(q.BeforeEnd) {
		return eventRecord{}, failure[struct{}]("invalid", "Встреча изменилась. Обновите карточку.")
	}
	return e, smallReply[struct{}]{OK: true}
}
func (s *SmallService) GateSeries(ctx context.Context, q seriesRequest) smallReply[seriesGate] {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !validSeries(q) {
		return failure[seriesGate]("invalid", "Проверьте дату и область изменения серии.")
	}
	if auth := s.eventWriteAuth(ctx, q.AccountID, q.SeriesID); !auth.OK {
		return failure[seriesGate](auth.Kind, auth.Error)
	}
	if q.Operation != "delete" {
		gate := seriesGate{Reason: "contract-unverified", Message: "Контракт изменения серии пока не подтверждён.", Summary: seriesSummary(q)}
		return smallReply[seriesGate]{OK: true, Data: &gate}
	}
	if _, reply := s.currentSeries(ctx, q); !reply.OK {
		return failure[seriesGate](reply.Kind, reply.Error)
	}
	gate := seriesGate{Open: true, Message: "Подтвердите удаление выбранных встреч.", Summary: seriesSummary(q)}
	return smallReply[seriesGate]{OK: true, Data: &gate}
}
func (s *SmallService) seriesWindow(ctx context.Context, q seriesRequest) (map[string]seriesMember, error) {
	anchor, _ := time.ParseInLocation(time.DateOnly, q.OriginalDate, smallZone)
	from, until := anchor.AddDate(0, 0, -14), anchor.AddDate(0, 0, 85)
	members := make(map[string]seriesMember)
	for start := from; start.Before(until); start = start.AddDate(0, 0, 7) {
		end := start.AddDate(0, 0, 7)
		if end.After(until) {
			end = until
		}
		params := url.Values{"start_date": {start.UTC().Format(time.RFC3339)}, "end_date": {end.UTC().Format(time.RFC3339)}}
		status, body, err := s.get(ctx, "/gate/team/api/calendars/my/events?"+params.Encode())
		if err != nil || status < 200 || status >= 300 || !cacheableEventBody(body) {
			return nil, errors.New("Неполный календарь серии.")
		}
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		_ = json.Unmarshal(body, &envelope)
		var list []eventRecord
		if json.Unmarshal(envelope.Data, &list) != nil {
			var indexed map[string]eventRecord
			if json.Unmarshal(envelope.Data, &indexed) != nil {
				return nil, errors.New("Неполные данные серии.")
			}
			for _, e := range indexed {
				list = append(list, e)
			}
		}
		for _, e := range list {
			if e.Status == "cancelled" || seriesIdentity(e) != q.SeriesID {
				continue
			}
			date := seriesDate(e.Start)
			if date < start.Format(time.DateOnly) || date >= end.Format(time.DateOnly) {
				continue
			}
			member := seriesMember{ID: invitationID(e.ID), Title: e.Title, Start: canonicalInstant(e.Start), End: canonicalInstant(e.End), Creator: invitationID(e.Creator)}
			if existing, ok := members[date]; ok && existing != member {
				if existing.Start != member.Start || existing.End != member.End || existing.Title != member.Title ||
					(existing.ID != "" && member.ID != "") || existing.Creator != member.Creator {
					return nil, errors.New("Несколько несовместимых вхождений серии на одну дату.")
				}
				if existing.ID != "" {
					continue
				}
			}
			members[date] = member
		}
	}
	return members, nil
}

func seriesUnknown() smallReply[seriesResult] {
	reply := failure[seriesResult]("network", "Исход удаления серии неизвестен. Повторное действие только проверит календарь.")
	reply.UnknownOutcome = true
	return reply
}

type seriesMutationEntry struct {
	eventMutationEntry
	OriginalDate string
}

func storeSeriesMutation(path string, entry seriesMutationEntry, claim bool) error {
	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	return atomicFile(path, data, claim)
}

func (s *SmallService) ApplySeries(ctx context.Context, q seriesRequest) smallReply[seriesResult] {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !validSeries(q) || q.Operation != "delete" {
		return failure[seriesResult]("invalid", "Эта запись серии недоступна.")
	}
	if auth := s.eventWriteAuth(ctx, q.AccountID, q.SeriesID); !auth.OK {
		return failure[seriesResult](auth.Kind, auth.Error)
	}
	if s.hasElectronMutation("series-mutations", q.AccountID, "series:"+q.SeriesID) {
		reply := seriesUnknown()
		reply.Error = electronPendingOperation
		return reply
	}
	path := s.journalPath(q.AccountID, "series:"+q.SeriesID)
	requestHash := eventHash(q)
	entry := seriesMutationEntry{eventMutationEntry: eventMutationEntry{Request: requestHash}, OriginalDate: q.OriginalDate}
	if raw, err := privateFile(path, 2048); !errors.Is(err, os.ErrNotExist) {
		var prior seriesMutationEntry
		if err != nil || json.Unmarshal(raw, &prior) != nil || !prior.Acknowledged {
			return seriesUnknown()
		}
		previous := q
		previous.OriginalDate = prior.OriginalDate
		if _, err := time.Parse(time.DateOnly, previous.OriginalDate); err != nil {
			return seriesUnknown()
		}
		actual, err := s.seriesWindow(ctx, previous)
		if err != nil || eventHash(actual) != prior.Result {
			return seriesUnknown()
		}
		if prior.Request == requestHash {
			done := seriesResult{Status: "already-applied"}
			return smallReply[seriesResult]{OK: true, Data: &done}
		}
		if os.Remove(path) != nil {
			return seriesUnknown()
		}
	}
	selected, reply := s.currentSeries(ctx, q)
	if !reply.OK {
		return failure[seriesResult](reply.Kind, reply.Error)
	}
	snapshot, err := s.seriesWindow(ctx, q)
	if err != nil {
		return failure[seriesResult]("invalid", err.Error())
	}
	visible, ok := snapshot[q.OriginalDate]
	if !ok || visible.Start != canonicalInstant(selected.Start) || visible.End != canonicalInstant(selected.End) {
		return failure[seriesResult]("not-found", "Вхождение не найдено в календаре.")
	}
	for date := range snapshot {
		if date == q.OriginalDate || (q.Scope == "following" && date > q.OriginalDate) {
			delete(snapshot, date)
		}
	}
	entry.Result = eventHash(snapshot)
	if storeSeriesMutation(path, entry, true) != nil {
		return seriesUnknown()
	}
	if s.invalidateCalendarForWrite() != nil {
		_ = os.Remove(path)
		return failure[seriesResult]("network", "Не удалось очистить кеш перед записью.")
	}
	id := invitationID(selected.ID)
	materialized := false
	if id == "" {
		payload, _ := json.Marshal(map[string]string{"original_event_id": q.SeriesID, "date": q.OriginalDate})
		status, raw, err := s.request(ctx, http.MethodPost, "/gate/team/api/calendar/events/from-template", payload)
		if err != nil || status < 200 || status >= 300 {
			if err == nil && status >= 400 && status < 500 {
				_ = os.Remove(path)
				return failure[seriesResult]("denied", "Small отклонил подготовку вхождения.")
			}
			return seriesUnknown()
		}
		made, _ := readEvent(raw)
		id = invitationID(made.ID)
		if !plainEventID(id) {
			return seriesUnknown()
		}
		copy := q
		copy.EventID = id
		if _, current := s.currentSeries(ctx, copy); !current.OK {
			return seriesUnknown()
		}
		materialized = true
	}
	if !plainEventID(id) {
		return seriesUnknown()
	}
	target := "/gate/team/api/calendar/events/" + id
	method := http.MethodDelete
	var payload []byte
	if q.Scope == "occurrence" {
		method, target = http.MethodPost, target+"/cancel"
		payload = []byte(`{"reason":"Отменено пользователем в Ordo"}`)
	}
	status, _, err := s.request(ctx, method, target, payload)
	if err != nil || status < 200 || status >= 300 {
		if err == nil && status >= 400 && status < 500 && !materialized {
			_ = os.Remove(path)
			if status == 401 {
				_, _ = s.renew(ctx, q.AccountID)
				return failure[seriesResult]("auth", "Войдите в Small заново.")
			}
			return failure[seriesResult]("denied", "Small отклонил удаление серии.")
		}
		return seriesUnknown()
	}
	entry.Acknowledged = true
	if storeSeriesMutation(path, entry, false) != nil {
		return seriesUnknown()
	}
	actual, err := s.seriesWindow(ctx, q)
	if err != nil || eventHash(actual) != entry.Result {
		return seriesUnknown()
	}
	done := seriesResult{Status: "applied", Materialized: materialized}
	return smallReply[seriesResult]{OK: true, Data: &done}
}
