package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"time"
)

type eventFields struct {
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	Location     string   `json:"location"`
	Start        string   `json:"starts_at"`
	End          string   `json:"ends_at"`
	Calendars    []int64  `json:"calendar_ids"`
	Participants []string `json:"participant_ids"`
	Recipients   []string `json:"notification_recipient_ids"`
	Attachments  []string `json:"attachments"`
}
type eventBody struct {
	eventFields
	Timezone          string `json:"timezone"`
	Public            bool   `json:"is_public"`
	Recurring         bool   `json:"is_recurring"`
	Rule              any    `json:"recurrence_rule,omitempty"`
	RecurrenceType    string `json:"recurrence_type,omitempty"`
	RecurringEditType string `json:"recurring_edit_type,omitempty"`
}
type eventMutation struct {
	AccountID string `json:"accountId"`
	EventID   string `json:"eventId"`
	Change    struct {
		Kind           string       `json:"kind"`
		Title          string       `json:"title,omitempty"`
		Before         *eventFields `json:"before,omitempty"`
		After          *eventFields `json:"after,omitempty"`
		AllowConflicts bool         `json:"allowConflicts,omitempty"`
	} `json:"change"`
}
type eventMove struct {
	AccountID   string `json:"accountId"`
	EventID     string `json:"eventId"`
	BeforeStart string `json:"beforeStart"`
	BeforeEnd   string `json:"beforeEnd"`
	Start       string `json:"startsAt"`
	End         string `json:"endsAt"`
}
type eventPerson struct {
	ID json.RawMessage `json:"id"`
}
type eventRecord struct {
	ID           json.RawMessage   `json:"id"`
	Creator      json.RawMessage   `json:"creator_id"`
	Original     json.RawMessage   `json:"original_event_id"`
	Status       string            `json:"status"`
	Title        string            `json:"title"`
	Description  *string           `json:"description"`
	Location     *string           `json:"location"`
	Start        string            `json:"starts_at"`
	End          string            `json:"ends_at"`
	Timezone     string            `json:"timezone"`
	Public       *bool             `json:"is_public"`
	Recurring    *bool             `json:"is_recurring"`
	Rule         any               `json:"recurrence_rule"`
	Calendars    []json.RawMessage `json:"calendar_ids"`
	Participants []eventPerson     `json:"participants"`
	Recipients   []eventPerson     `json:"notification_recipients"`
	Attachments  []eventPerson     `json:"attachments"`
}

func readEvent(body []byte) (eventRecord, bool) {
	var reply struct {
		Data eventRecord `json:"data"`
	}
	err := json.Unmarshal(body, &reply)
	return reply.Data, err == nil
}
func eventIDs(values []eventPerson) []string {
	ids := make([]string, len(values))
	for i, value := range values {
		ids[i] = invitationID(value.ID)
	}
	return ids
}
func (e eventRecord) updateBody() (eventBody, bool) {
	if e.Recurring == nil || e.Public == nil || e.Calendars == nil || e.Participants == nil ||
		e.Recipients == nil || e.Attachments == nil || e.Timezone == "" || len(e.Timezone) > 100 {
		return eventBody{}, false
	}
	b := eventBody{Timezone: e.Timezone, Public: *e.Public, Recurring: *e.Recurring,
		eventFields: eventFields{Title: e.Title, Start: e.Start, End: e.End,
			Calendars: make([]int64, 0, len(e.Calendars)), Participants: eventIDs(e.Participants),
			Recipients: eventIDs(e.Recipients), Attachments: eventIDs(e.Attachments)}}
	if e.Description != nil {
		b.Description = *e.Description
	}
	if e.Location != nil {
		b.Location = *e.Location
	}
	for _, raw := range e.Calendars {
		id, err := strconv.ParseInt(invitationID(raw), 10, 53)
		if err != nil || id < 1 {
			return eventBody{}, false
		}
		b.Calendars = append(b.Calendars, id)
	}
	if b.Recurring {
		if _, ok := e.Rule.(map[string]any); !ok {
			return eventBody{}, false
		}
		b.Rule, b.RecurrenceType, b.RecurringEditType = e.Rule, "custom", "single"
	} else if e.Rule != nil {
		return eventBody{}, false
	}
	return b, validEventFields(b.eventFields)
}
func validEventFields(f eventFields) bool {
	start, e1 := time.Parse(time.RFC3339Nano, f.Start)
	end, e2 := time.Parse(time.RFC3339Nano, f.End)
	if e1 != nil || e2 != nil || !end.After(start) || strings.TrimSpace(f.Title) == "" ||
		len([]rune(f.Title)) > 200 || len([]rune(f.Description)) > 20000 || len([]rune(f.Location)) > 20000 ||
		f.Calendars == nil || len(f.Calendars) > 100 {
		return false
	}
	for _, id := range f.Calendars {
		if id < 1 || id > 9007199254740991 {
			return false
		}
	}
	for _, ids := range [][]string{f.Participants, f.Recipients, f.Attachments} {
		if ids == nil || len(ids) > 100 {
			return false
		}
		for _, id := range ids {
			if !smallID.MatchString(id) {
				return false
			}
		}
	}
	return true
}

var smallZone = time.FixedZone("Asia/Almaty", 5*60*60)

func editableDay(value string) bool {
	t, err := time.Parse(time.RFC3339Nano, value)
	return err == nil && t.In(smallZone).Format(time.DateOnly) >= time.Now().In(smallZone).Format(time.DateOnly)
}
func eventHash(value any) string {
	data, _ := json.Marshal(value)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
func eventFingerprint(body eventBody) string {
	body.Start = canonicalInstant(body.Start)
	body.End = canonicalInstant(body.End)
	body.Calendars = slices.Clone(body.Calendars)
	body.Participants = slices.Clone(body.Participants)
	body.Recipients = slices.Clone(body.Recipients)
	body.Attachments = slices.Clone(body.Attachments)
	slices.Sort(body.Calendars)
	slices.Sort(body.Participants)
	slices.Sort(body.Recipients)
	slices.Sort(body.Attachments)
	return eventHash(body)
}
func canonicalInstant(value string) string {
	t, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return value
	}
	return t.UTC().Format(time.RFC3339Nano)
}

type eventMutationEntry struct {
	Request      string
	Result       string
	Delete       bool
	Acknowledged bool
}

func (s *SmallService) journalPath(account, event string) string {
	return filepath.Join(s.store.directory, "event-mutation-"+eventHash([]string{account, event})+".json")
}
func (s *SmallService) recordEventMutation(path string, entry eventMutationEntry, claim bool) error {
	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	return atomicFile(path, data, claim)
}
func mutationUnknown() smallReply[struct{}] {
	r := failure[struct{}]("network", "Результат изменения неизвестен. Повторное действие только проверит состояние встречи.")
	r.UnknownOutcome = true
	return r
}
func (s *SmallService) mutationVerified(ctx context.Context, path, id string, entry eventMutationEntry) bool {
	status, raw, err := s.get(ctx, path)
	if err != nil {
		return false
	}
	if entry.Delete && entry.Acknowledged && status == http.StatusNotFound {
		return true
	}
	if status < 200 || status >= 300 {
		return false
	}
	event, ok := readEvent(raw)
	if !ok || invitationID(event.ID) != id {
		return false
	}
	if entry.Delete {
		return entry.Acknowledged && event.Status == "cancelled"
	}
	body, valid := event.updateBody()
	return valid && invitationID(event.Creator) == s.organizerID() && eventFingerprint(body) == entry.Result
}
func (s *SmallService) organizerID() string {
	if s.profile.ParticipantID != "" {
		return s.profile.ParticipantID
	}
	return s.profile.ID
}
func (s *SmallService) eventWriteAuth(ctx context.Context, account, id string) smallReply[struct{}] {
	if !plainEventID(id) {
		return failure[struct{}]("invalid", "Некорректная встреча.")
	}
	if !s.canReadCalendar(account) {
		return failure[struct{}]("auth", "Войдите в нужный аккаунт Small.")
	}
	if reply := s.read(ctx); !reply.OK {
		switch reply.Kind {
		case "auth", "denied", "invalid":
			return failure[struct{}](reply.Kind, reply.Error)
		default:
			return failure[struct{}]("network", reply.Error)
		}
	}
	if s.profile.ID != account || s.token == "" {
		return failure[struct{}]("auth", "Не удалось подтвердить аккаунт Small.")
	}
	if s.store == nil {
		return failure[struct{}]("network", "Журнал изменений недоступен.")
	}
	return smallReply[struct{}]{OK: true}
}
func (s *SmallService) runEventMutation(ctx context.Context, account, id string, request any, force, deleting bool, prepare func(eventRecord) (*eventBody, smallReply[struct{}])) smallReply[struct{}] {
	s.mu.Lock()
	defer s.mu.Unlock()
	if reply := s.eventWriteAuth(ctx, account, id); !reply.OK {
		return reply
	}
	if s.hasElectronMutation("event-mutations", account, id) {
		reply := failure[struct{}]("network", electronPendingOperation)
		reply.UnknownOutcome = true
		return reply
	}

	path := "/gate/team/api/calendar/events/" + id
	journal := s.journalPath(account, id)
	hash := eventHash(request)
	entry := eventMutationEntry{Request: hash}
	saved, err := privateFile(journal, 2048)
	if err == nil {
		if json.Unmarshal(saved, &entry) != nil || !s.mutationVerified(ctx, path, id, entry) || os.Remove(journal) != nil {
			return mutationUnknown()
		}
		if entry.Request != hash {
			return failure[struct{}]("invalid", "Предыдущее изменение подтверждено. Обновите календарь.")
		}
		return smallReply[struct{}]{OK: true}
	}
	if !errors.Is(err, os.ErrNotExist) {
		return mutationUnknown()
	}
	status, raw, err := s.get(ctx, path)
	if err != nil || status < 200 || status >= 300 {
		return invitationFailure(status, err)
	}
	event, ok := readEvent(raw)
	if !ok || invitationID(event.ID) != id || invitationID(event.Creator) != s.organizerID() {
		return failure[struct{}]("denied", "Изменить встречу может только её организатор.")
	}
	if event.Status == "cancelled" || !editableDay(event.Start) {
		return failure[struct{}]("denied", "Встреча недоступна для изменения.")
	}
	body, reply := prepare(event)
	if !reply.OK || (body == nil && !deleting) {
		return reply
	}
	method, target := http.MethodDelete, path
	var payload []byte
	entry.Delete = body == nil
	if body != nil {
		method, target = http.MethodPut, path+"?force="+strconv.FormatBool(force)
		payload, _ = json.Marshal(body)
		entry.Result = eventFingerprint(*body)
	}
	if s.recordEventMutation(journal, entry, true) != nil {
		return failure[struct{}]("network", "Не удалось сохранить журнал изменения.")
	}
	if err := s.invalidateCalendarForWrite(); err != nil {
		_ = os.Remove(journal)
		return failure[struct{}]("network", "Не удалось очистить кеш перед записью.")
	}
	status, response, err := s.request(ctx, method, target, payload)
	if err == nil {
		switch status {
		case 400, 401, 403, 404, 409, 422:
			if os.Remove(journal) != nil {
				return mutationUnknown()
			}
			if status == 401 {
				_, _ = s.renew(ctx, account)
			}
			if body != nil && (status == 409 || status == 422) {
				if ids := mutationConflicts(response, body.Participants); len(ids) > 0 {
					r := failure[struct{}]("invalid", "У участников есть пересечения с выбранным временем.")
					r.ConflictingParticipantIDs = ids
					return r
				}
			}
			return invitationFailure(status, nil)
		}
		if status >= 200 && status < 300 {
			entry.Acknowledged = true
			if s.recordEventMutation(journal, entry, false) != nil {
				return mutationUnknown()
			}
		}
	}
	if !s.mutationVerified(ctx, path, id, entry) || os.Remove(journal) != nil {
		return mutationUnknown()
	}
	return smallReply[struct{}]{OK: true}
}

func (s *SmallService) ApplyChange(ctx context.Context, input eventMutation) smallReply[struct{}] {
	change := input.Change
	if change.Kind != "cancel" && change.Kind != "rename" && change.Kind != "edit" {
		return failure[struct{}]("invalid", "Некорректное изменение встречи.")
	}
	return s.runEventMutation(ctx, input.AccountID, input.EventID, input, change.Kind == "edit" && change.AllowConflicts, change.Kind == "cancel", func(e eventRecord) (*eventBody, smallReply[struct{}]) {
		if e.Recurring == nil || *e.Recurring || invitationID(e.Original) != "" || e.Rule != nil {
			return nil, failure[struct{}]("denied", "Для серии выберите область изменения.")
		}
		body, ok := e.updateBody()
		if !ok {
			return nil, failure[struct{}]("invalid", "Small не вернул полную карточку встречи.")
		}
		if change.Kind == "cancel" {
			return nil, smallReply[struct{}]{OK: true}
		}
		if change.Kind == "rename" {
			title := strings.TrimSpace(change.Title)
			if body.Title == title {
				return nil, smallReply[struct{}]{OK: true}
			}
			body.Title = title
		} else {
			if change.Before == nil || change.After == nil || !validEventFields(*change.Before) ||
				!validEventFields(*change.After) || len(change.After.Participants) == 0 {
				return nil, failure[struct{}]("invalid", "Проверьте поля встречи.")
			}
			modified, merged := mergeEventFields(&body.eventFields, *change.Before, *change.After)
			if !merged {
				return nil, failure[struct{}]("invalid", "Событие изменено другим пользователем. Откройте редактирование заново.")
			}
			if !modified {
				return nil, smallReply[struct{}]{OK: true}
			}
			for _, id := range body.Attachments {
				if !slices.Contains(eventIDs(e.Attachments), id) && !s.uploadedAttachments[id] {
					return nil, failure[struct{}]("denied", "Прикрепите новые файлы заново.")
				}
			}
		}
		if !validEventFields(body.eventFields) || !editableDay(body.Start) {
			return nil, failure[struct{}]("invalid", "Проверьте поля и дату встречи.")
		}
		return &body, smallReply[struct{}]{OK: true}
	})
}

func mergeEventFields(current *eventFields, before, after eventFields) (bool, bool) {
	changed, valid := false, true
	mergeField(&current.Title, before.Title, after.Title, identity[string], &changed, &valid)
	mergeField(&current.Description, before.Description, after.Description, identity[string], &changed, &valid)
	mergeField(&current.Location, before.Location, after.Location, identity[string], &changed, &valid)
	mergeField(&current.Start, before.Start, after.Start, canonicalInstant, &changed, &valid)
	mergeField(&current.End, before.End, after.End, canonicalInstant, &changed, &valid)
	mergeField(&current.Calendars, before.Calendars, after.Calendars, sorted[int64], &changed, &valid)
	mergeField(&current.Participants, before.Participants, after.Participants, sorted[string], &changed, &valid)
	mergeField(&current.Recipients, before.Recipients, after.Recipients, sorted[string], &changed, &valid)
	mergeField(&current.Attachments, before.Attachments, after.Attachments, sorted[string], &changed, &valid)
	return changed, valid
}
func identity[T any](v T) T { return v }
func sorted[T ~string | ~int64](v []T) []T {
	result := slices.Clone(v)
	slices.Sort(result)
	return result
}
func mergeField[T any](current *T, before, after T, normalize func(T) T, changed, valid *bool) {
	if reflect.DeepEqual(normalize(before), normalize(after)) {
		return
	}
	*changed = true
	if !reflect.DeepEqual(normalize(*current), normalize(before)) {
		*valid = false
		return
	}
	*current = after
}
func (s *SmallService) Reschedule(ctx context.Context, input eventMove) smallReply[struct{}] {
	return s.runEventMutation(ctx, input.AccountID, input.EventID, input, false, false, func(e eventRecord) (*eventBody, smallReply[struct{}]) {
		body, ok := e.updateBody()
		if !ok || invitationID(e.Original) != "" {
			return nil, failure[struct{}]("denied", "Перенос этого события недоступен.")
		}
		if canonicalInstant(body.Start) != canonicalInstant(input.BeforeStart) || canonicalInstant(body.End) != canonicalInstant(input.BeforeEnd) {
			return nil, failure[struct{}]("invalid", "Время встречи уже изменилось. Обновите календарь.")
		}
		body.Start, body.End = input.Start, input.End
		if !validEventFields(body.eventFields) || !editableDay(body.Start) {
			return nil, failure[struct{}]("invalid", "Некорректное время встречи.")
		}
		return &body, smallReply[struct{}]{OK: true}
	})
}

func mutationConflicts(raw []byte, requested []string) []string {
	var reply struct {
		Errors map[string]json.RawMessage `json:"errors"`
	}
	if json.Unmarshal(raw, &reply) != nil || len(reply.Errors) != 1 {
		return nil
	}
	var ids []string
	if json.Unmarshal(reply.Errors["participant_ids"], &ids) != nil || len(ids) == 0 || len(ids) > 100 {
		return nil
	}
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		if !slices.Contains(requested, id) {
			return nil
		}
		if !slices.Contains(result, id) {
			result = append(result, id)
		}
	}
	return result
}
