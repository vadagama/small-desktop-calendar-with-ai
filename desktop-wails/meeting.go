package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

const meetingParticipantLimit = 100

type weeklyRule struct {
	Freq  string   `json:"FREQ"`
	Days  []string `json:"BYDAY"`
	Until string   `json:"UNTIL"`
}
type meetingOptions struct {
	Calendars   []int64     `json:"calendarIds"`
	Recipients  []string    `json:"notificationRecipientIds"`
	Attachments []string    `json:"attachmentIds"`
	Rule        *weeklyRule `json:"recurrence"`
}
type manualMeeting struct {
	Title        string   `json:"title"`
	Agenda       string   `json:"agenda"`
	Participants []string `json:"participantIds"`
	Start        string   `json:"startsAt"`
	Duration     int      `json:"durationMinutes"`
	Location     string   `json:"location"`
	Conference   struct {
		Mode string `json:"mode"`
		URL  string `json:"url"`
	} `json:"conference"`
	Options meetingOptions `json:"options"`
}
type meetingDraft struct {
	Kind               string             `json:"kind"`
	Status             string             `json:"status"`
	ID                 string             `json:"id"`
	Revision           int                `json:"revision"`
	Title              string             `json:"title"`
	Agenda             string             `json:"agenda"`
	Participants       []string           `json:"participantIds"`
	Organizer          smallProfile       `json:"organizer"`
	Start              string             `json:"startsAt"`
	End                string             `json:"endsAt"`
	Duration           int                `json:"durationMinutes"`
	Timezone           string             `json:"timezone"`
	Location           string             `json:"location"`
	ConferenceURL      *string            `json:"conferenceUrl"`
	Recurrence         string             `json:"recurrence"`
	Options            meetingOptions     `json:"options"`
	Visibility         string             `json:"visibility"`
	CheckedAt          string             `json:"availabilityCheckedAt"`
	Unconfirmed        bool               `json:"availabilityUnconfirmed,omitempty"`
	ParticipantDetails json.RawMessage    `json:"participants,omitempty"`
	MemoryPolicy       *draftMemoryPolicy `json:"memoryPolicy,omitempty"`
}
type draftMemoryPolicy struct {
	Revision      int    `json:"revision"`
	BufferMinutes int    `json:"bufferMinutes"`
	Organizer     string `json:"organizerParticipantId"`
	TimeFrom      string `json:"timeFrom,omitempty"`
	TimeTo        string `json:"timeTo,omitempty"`
	Summary       string `json:"summary"`
}
type meetingView struct {
	Draft   meetingDraft `json:"draft"`
	Phase   string       `json:"phase"`
	Message string       `json:"message"`
	EventID string       `json:"eventId,omitempty"`
}
type meetingReference struct {
	ID               string `json:"id"`
	Revision         int    `json:"revision"`
	AllowUnconfirmed bool   `json:"allowUnconfirmed,omitempty"`
	Title            string `json:"title,omitempty"`
	Agenda           string `json:"agenda,omitempty"`
}
type createReceipt struct {
	PayloadHash string
	EventID     string
	Succeeded   bool
}

func meetingDates(d meetingDraft) ([]time.Time, bool) {
	start, err := time.Parse(time.RFC3339Nano, d.Start)
	if err != nil {
		return nil, false
	}
	start = start.In(smallZone)
	if d.Options.Rule == nil {
		return []time.Time{start}, true
	}
	rule := d.Options.Rule
	until, err := time.ParseInLocation(time.DateOnly, rule.Until, smallZone)
	lastDay := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, smallZone)
	if err != nil || rule.Freq != "WEEKLY" || len(rule.Days) < 1 || len(rule.Days) > 7 ||
		until.Before(lastDay) || until.After(lastDay.AddDate(0, 0, 90)) {
		return nil, false
	}
	codes := []string{"SU", "MO", "TU", "WE", "TH", "FR", "SA"}
	days := map[string]bool{}
	for _, day := range rule.Days {
		if !slices.Contains(codes, day) || days[day] {
			return nil, false
		}
		days[day] = true
	}
	if !days[codes[start.Weekday()]] {
		return nil, false
	}
	var dates []time.Time
	for cursor := start; cursor.Format(time.DateOnly) <= rule.Until; cursor = cursor.AddDate(0, 0, 1) {
		if days[codes[cursor.Weekday()]] {
			dates = append(dates, cursor)
		}
	}
	return dates, len(dates) <= 32
}
func validMeetingIDs(ids []string, max int) bool {
	if ids == nil || len(ids) > max {
		return false
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if !smallID.MatchString(id) || seen[id] {
			return false
		}
		seen[id] = true
	}
	return true
}

func (s *SmallService) PrepareMeeting(ctx context.Context, input manualMeeting) smallReply[meetingDraft] {
	s.mu.Lock()
	defer s.mu.Unlock()
	auth := s.read(ctx)
	if !auth.OK || auth.State.Profile == nil || s.token == "" {
		return failure[meetingDraft]("auth", "Войдите в Small.")
	}
	title, agenda, location := strings.TrimSpace(input.Title), strings.TrimSpace(input.Agenda), strings.TrimSpace(input.Location)
	start, err := time.Parse(time.RFC3339Nano, input.Start)
	if err != nil || start.Before(time.Now()) || input.Duration < 1 || input.Duration > 480 ||
		!fitsMeetingDay(start, start.Add(time.Duration(input.Duration)*time.Minute)) ||
		title == "" || len([]rune(title)) > 200 || len([]rune(agenda)) > 5000 || len([]rune(location)) > 500 ||
		len(input.Participants) == 0 || !validMeetingIDs(input.Participants, meetingParticipantLimit) ||
		!validMeetingIDs(input.Options.Recipients, 20) || !validMeetingIDs(input.Options.Attachments, 5) || slices.ContainsFunc(input.Options.Attachments, func(id string) bool { return !s.uploadedAttachments[id] }) ||
		input.Options.Calendars == nil || len(input.Options.Calendars) > 1 {
		return failure[meetingDraft]("invalid", "Проверьте параметры встречи.")
	}
	if len(input.Options.Calendars) == 1 && (input.Options.Calendars[0] < 1 || input.Options.Calendars[0] > 9007199254740991) {
		return failure[meetingDraft]("invalid", "Некорректная переговорная.")
	}
	var link *string
	switch input.Conference.Mode {
	case "custom":
		u, err := url.Parse(input.Conference.URL)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || len(input.Conference.URL) > 2000 {
			return failure[meetingDraft]("invalid", "Нужна HTTPS-ссылка встречи.")
		}
		link = &input.Conference.URL
	case "none":
	default:
		return failure[meetingDraft]("invalid", "Этот способ создания ссылки пока недоступен.")
	}
	if len(s.drafts) >= 100 {
		return failure[meetingDraft]("invalid", "Слишком много черновиков. Перезапустите приложение.")
	}
	var id [16]byte
	rand.Read(id[:])
	id[6] = (id[6] & 15) | 64
	id[8] = (id[8] & 63) | 128
	if organizer := auth.State.Profile.ParticipantID; organizer != "" && !slices.Contains(input.Participants, organizer) {
		input.Participants = append(input.Participants, organizer)
	}
	if len(input.Participants) > meetingParticipantLimit {
		return failure[meetingDraft]("invalid", "Слишком много участников вместе с организатором.")
	}
	d := meetingDraft{Kind: "meeting-draft", Status: "preview", ID: formatUUID(id), Revision: 1, Title: title, Agenda: agenda,
		Participants: input.Participants, Organizer: *auth.State.Profile, Start: start.Format(time.RFC3339Nano),
		End: start.Add(time.Duration(input.Duration) * time.Minute).Format(time.RFC3339Nano), Duration: input.Duration,
		Timezone: "Asia/Almaty", Location: location, ConferenceURL: link, Recurrence: "none", Options: input.Options,
		Visibility: "private", CheckedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if input.Options.Rule != nil {
		d.Recurrence = "weekly"
	}
	if _, ok := meetingDates(d); !ok {
		return failure[meetingDraft]("invalid", "Проверьте дни повторения, срок до 90 дней и число повторений до 32.")
	}
	conflict, err := s.checkMeetingParticipants(ctx, d, start, start.Add(time.Duration(d.Duration)*time.Minute))
	if err != nil {
		return failure[meetingDraft]("network", err.Error())
	}
	d.Unconfirmed = conflict
	s.drafts[d.ID] = d
	return smallReply[meetingDraft]{OK: true, Data: &d}
}

type busyInterval struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

func clockLimit(midnight time.Time, value string) (time.Time, error) {
	clock, err := time.Parse("15:04", value)
	if err != nil {
		return time.Time{}, errors.New("Некорректное окно времени в предпочтениях.")
	}
	return midnight.Add(time.Duration(clock.Hour()*60+clock.Minute()) * time.Minute), nil
}

func fitsMeetingDay(start, end time.Time) bool {
	local := start.In(smallZone)
	midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, smallZone)
	return end.After(start) && !end.After(midnight.AddDate(0, 0, 1))
}

func (s *SmallService) checkMeetingParticipants(ctx context.Context, d meetingDraft, start, end time.Time) (bool, error) {
	payload, _ := json.Marshal(map[string]any{"participant_ids": d.Participants, "date": start.In(smallZone).Format(time.DateOnly), "timezone": d.Timezone})
	status, raw, err := s.request(ctx, http.MethodPost, "/gate/team/api/calendar/events/busy-intervals", payload)
	if status == 401 && err == nil {
		if renewed, renewErr := s.renew(ctx, d.Organizer.ID); renewErr == nil && renewed >= 200 && renewed < 300 {
			status, raw, err = s.request(ctx, http.MethodPost, "/gate/team/api/calendar/events/busy-intervals", payload)
		}
	}
	if err != nil || status < 200 || status >= 300 {
		return false, errors.New("Не удалось проверить занятость участников.")
	}
	var reply struct {
		Data []struct {
			ID            string         `json:"id"`
			ParticipantID string         `json:"participant_id"`
			Type          string         `json:"type"`
			Slots         []busyInterval `json:"busy_slots"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &reply) != nil || len(reply.Data) != len(d.Participants) {
		return false, errors.New("Small вернул неполную занятость участников.")
	}
	seen := map[string]bool{}
	local := start.In(smallZone)
	midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, smallZone)
	conflict := !((!start.Before(midnight.Add(9*time.Hour)) && !end.After(midnight.Add(13*time.Hour))) ||
		(!start.Before(midnight.Add(14*time.Hour)) && !end.After(midnight.Add(18*time.Hour))))
	if policy := d.MemoryPolicy; policy != nil {
		if policy.TimeFrom != "" {
			from, err := clockLimit(midnight, policy.TimeFrom)
			if err != nil {
				return false, err
			}
			conflict = conflict || start.Before(from)
		}
		if policy.TimeTo != "" {
			to, err := clockLimit(midnight, policy.TimeTo)
			if err != nil {
				return false, err
			}
			conflict = conflict || end.After(to)
		}
	}
	for _, record := range reply.Data {
		id := record.ID
		if id == "" {
			id = record.ParticipantID
		}
		if (record.ParticipantID != "" && record.ParticipantID != id) || record.Type != "participant" ||
			seen[id] || !slices.Contains(d.Participants, id) || record.Slots == nil || len(record.Slots) > 5000 {
			return false, errors.New("Small вернул неполную занятость участников.")
		}
		seen[id] = true
		from, to := start, end
		if policy := d.MemoryPolicy; policy != nil && id == policy.Organizer {
			buffer := time.Duration(policy.BufferMinutes) * time.Minute
			from, to = start.Add(-buffer), end.Add(buffer)
			if !fitsMeetingDay(from, to) {
				return false, errors.New("Не удалось проверить перерыв на границе дней.")
			}
		}
		for _, slot := range record.Slots {
			if slot.Start.IsZero() || !slot.End.After(slot.Start) {
				return false, errors.New("Некорректный формат занятости.")
			}
			conflict = conflict || (slot.Start.Before(to) && slot.End.After(from))
		}
	}
	return conflict, nil
}

func (s *SmallService) checkMeetingCalendar(ctx context.Context, d meetingDraft, source string, start, end time.Time) error {
	first := start.In(smallZone)
	day := time.Date(first.Year(), first.Month(), first.Day(), 0, 0, 0, 0, smallZone)
	query := url.Values{"start_date": {day.UTC().Format(time.RFC3339)}, "end_date": {day.AddDate(0, 0, 1).UTC().Format(time.RFC3339)}}
	status, raw, err := s.get(ctx, "/gate/team/api/calendars/"+source+"/events?"+query.Encode())
	if err != nil || status < 200 || status >= 300 || !cacheableEventBody(raw) {
		return errors.New("Неполный календарь: нельзя проверить доступность и дубликаты.")
	}
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	_ = json.Unmarshal(raw, &envelope)
	var items []json.RawMessage
	if json.Unmarshal(envelope.Data, &items) != nil {
		var indexed map[string]json.RawMessage
		_ = json.Unmarshal(envelope.Data, &indexed)
		for _, item := range indexed {
			items = append(items, item)
		}
	}
	for _, item := range items {
		var e eventRecord
		if json.Unmarshal(item, &e) != nil {
			return errors.New("Small вернул некорректную карточку. Нельзя проверить дубликаты.")
		}
		if e.Status == "cancelled" {
			continue
		}
		from, _ := time.Parse(time.RFC3339Nano, e.Start)
		to, _ := time.Parse(time.RFC3339Nano, e.End)
		if source != "my" && from.Before(end) && to.After(start) {
			return errors.New("Переговорная занята.")
		}
		if source == "my" && e.Title == d.Title && from.Equal(start) && to.Equal(end) {
			return errors.New("Похожая встреча уже существует. Проверьте календарь.")
		}
	}
	return nil
}

func (s *SmallService) meetingEntry(ctx context.Context, input meetingReference) (meetingDraft, bool) {
	d, ok := s.drafts[input.ID]
	if !ok || d.Revision != input.Revision || !s.canReadCalendar(d.Organizer.ID) {
		return meetingDraft{}, false
	}
	reply := s.read(ctx)
	return d, reply.OK && reply.State.Profile != nil && reply.State.Profile.ID == d.Organizer.ID && s.token != ""
}
func (s *SmallService) receiptPath(ctx context.Context, d meetingDraft) (string, error) {
	if path := s.draftReceipts[d.ID]; path != "" {
		return path, nil
	}
	if s.hasElectronMeeting(ctx, d) {
		return "", errElectronPendingOperation
	}
	key := eventHash([]any{d.Organizer.ID, canonicalInstant(d.Start), canonicalInstant(d.End), sorted(d.Participants)})
	for generation := 0; generation < 100; generation++ {
		path := filepath.Join(s.store.directory, "meeting-create-"+key+".json")
		data, err := privateFile(path, 2048)
		if err == nil {
			var prior createReceipt
			if json.Unmarshal(data, &prior) != nil {
				return "", errors.New("Журнал создания повреждён.")
			}
			if prior.Succeeded && plainEventID(prior.EventID) {
				status, raw, readErr := s.get(ctx, "/gate/team/api/calendar/events/"+prior.EventID)
				event, ok := readEvent(raw)
				if readErr == nil && status == 200 && ok && invitationID(event.ID) == prior.EventID && event.Status == "cancelled" {
					key = eventHash([]string{key, prior.EventID})
					continue
				}
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		s.draftReceipts[d.ID] = path
		return path, nil
	}
	return "", errors.New("Слишком много прежних операций на это время.")
}
func meetingBody(d meetingDraft) eventBody {
	location := d.Location
	if d.ConferenceURL != nil {
		location = *d.ConferenceURL
	}
	body := eventBody{Timezone: d.Timezone, eventFields: eventFields{Title: d.Title, Description: d.Agenda, Location: location,
		Start: d.Start, End: d.End, Calendars: d.Options.Calendars, Participants: d.Participants, Recipients: d.Options.Recipients,
		Attachments: d.Options.Attachments}}
	if d.Options.Rule != nil {
		body.Recurring = true
		body.Rule = d.Options.Rule
		body.RecurrenceType = "custom"
	}
	return body
}

// Small serializes empty optional event fields as null.
func matchesEventText(value *string, want string) bool {
	if value == nil {
		return want == ""
	}
	return *value == want
}

func matchesCreatedMeeting(e eventRecord, want eventBody) bool {
	if e.Public == nil || *e.Public || e.Recurring == nil || *e.Recurring != want.Recurring ||
		e.Status == "cancelled" || e.Title != want.Title || canonicalInstant(e.Start) != canonicalInstant(want.Start) ||
		canonicalInstant(e.End) != canonicalInstant(want.End) || e.Participants == nil {
		return false
	}
	if !matchesEventText(e.Description, want.Description) || !matchesEventText(e.Location, want.Location) {
		return false
	}
	if want.Recurring {
		var actual, expected weeklyRule
		raw, _ := json.Marshal(e.Rule)
		planned, _ := json.Marshal(want.Rule)
		if json.Unmarshal(raw, &actual) != nil || json.Unmarshal(planned, &expected) != nil ||
			actual.Freq != expected.Freq || actual.Until != expected.Until || !slices.Equal(sorted(actual.Days), sorted(expected.Days)) {
			return false
		}
	}
	for _, room := range want.Calendars {
		value, _ := json.Marshal(room)
		if !slices.ContainsFunc(e.Calendars, func(raw json.RawMessage) bool { return invitationID(raw) == string(value) }) {
			return false
		}
	}
	return slices.Equal(sorted(eventIDs(e.Participants)), sorted(want.Participants)) &&
		slices.Equal(sorted(eventIDs(e.Recipients)), sorted(want.Recipients)) &&
		slices.Equal(sorted(eventIDs(e.Attachments)), sorted(want.Attachments))
}

func (s *SmallService) meetingReceipt(ctx context.Context, v meetingView, path string, receipt createReceipt) smallReply[meetingView] {
	body := meetingBody(v.Draft)
	v.Phase, v.Message = "unknown", "Исход неизвестен. Повторная запись заблокирована."
	if receipt.PayloadHash != eventFingerprint(body) {
		v.Phase, v.Message = "blocked", "На это время уже отправлен другой черновик."
	} else if receipt.EventID != "" {
		v.EventID = receipt.EventID
		if !receipt.Succeeded {
			status, raw, err := s.get(ctx, "/gate/team/api/calendar/events/"+receipt.EventID)
			e, ok := readEvent(raw)
			if err == nil && status == 200 && ok && invitationID(e.ID) == receipt.EventID &&
				invitationID(e.Creator) == s.organizerID() && matchesCreatedMeeting(e, body) {
				receipt.Succeeded = true
				data, _ := json.Marshal(receipt)
				if atomicFile(path, data, false) != nil {
					receipt.Succeeded = false
				}
			}
		}
		if receipt.Succeeded {
			v.Phase, v.Message = "succeeded", "Встреча создана и проверена."
		}
	}
	return smallReply[meetingView]{OK: true, Data: &v}
}
func (s *SmallService) checkDraftMemory(ctx context.Context, d meetingDraft) bool {
	if d.MemoryPolicy == nil {
		return true
	}
	if s.assistantMemoryRevision == nil {
		return false
	}
	revision, err := s.assistantMemoryRevision(ctx, d.Organizer.ID)
	return err == nil && revision == d.MemoryPolicy.Revision
}
func (s *SmallService) ConfirmMeeting(ctx context.Context, input meetingReference) smallReply[meetingView] {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, ok := s.meetingEntry(ctx, input)
	if !ok || s.store == nil {
		return failure[meetingView]("invalid", "Черновик или журнал недоступен.")
	}
	v := meetingView{Draft: d, Phase: "preview"}
	path, pathErr := s.receiptPath(ctx, d)
	if pathErr != nil {
		return meetingJournalFailure(pathErr)
	}
	if raw, err := privateFile(path, 2048); !errors.Is(err, os.ErrNotExist) {
		var receipt createReceipt
		if err != nil || json.Unmarshal(raw, &receipt) != nil {
			return failure[meetingView]("network", "Журнал создания недоступен.")
		}
		return s.meetingReceipt(ctx, v, path, receipt)
	}
	if !s.checkDraftMemory(ctx, d) {
		return failure[meetingView]("invalid", "Память изменилась. Подготовьте новый черновик.")
	}
	dates, _ := meetingDates(d)
	if len(dates) == 0 || dates[0].Before(time.Now()) {
		return failure[meetingView]("invalid", "Время встречи уже прошло.")
	}
	force := d.Unconfirmed && input.AllowUnconfirmed
	if d.Unconfirmed && !force {
		v.Message = "У участников есть пересечения. Подтвердите создание."
		return smallReply[meetingView]{OK: true, Data: &v}
	}
	for _, start := range dates {
		end := start.Add(time.Duration(d.Duration) * time.Minute)
		conflict, err := s.checkMeetingParticipants(ctx, d, start, end)
		if err != nil {
			return failure[meetingView]("network", err.Error())
		}
		if conflict && !force {
			d.Unconfirmed = true
			s.drafts[d.ID] = d
			v.Draft = d
			v.Message = "У участников есть пересечения. Подтвердите создание."
			return smallReply[meetingView]{OK: true, Data: &v}
		}
		if len(d.Options.Calendars) > 0 {
			id, _ := json.Marshal(d.Options.Calendars[0])
			if err := s.checkMeetingCalendar(ctx, d, string(id), start, end); err != nil {
				return failure[meetingView]("invalid", err.Error())
			}
		}
		if err := s.checkMeetingCalendar(ctx, d, "my", start, end); err != nil {
			return failure[meetingView]("invalid", err.Error())
		}
	}
	if !s.checkDraftMemory(ctx, d) {
		return failure[meetingView]("invalid", "Память изменилась. Подготовьте новый черновик.")
	}
	body := meetingBody(d)
	receipt := createReceipt{PayloadHash: eventFingerprint(body)}
	raw, _ := json.Marshal(receipt)
	if atomicFile(path, raw, true) != nil {
		return failure[meetingView]("network", "Не удалось сохранить журнал создания.")
	}
	if s.invalidateCalendarForWrite() != nil {
		_ = os.Remove(path)
		return failure[meetingView]("network", "Не удалось очистить кеш перед созданием.")
	}
	payload, _ := json.Marshal(body)
	if len(body.Calendars) == 0 {
		var creation map[string]json.RawMessage
		_ = json.Unmarshal(payload, &creation)
		delete(creation, "calendar_ids")
		payload, _ = json.Marshal(creation)
	}
	query := "false"
	if force {
		query = "true"
	}
	status, response, err := s.request(ctx, http.MethodPost, "/gate/team/api/calendar/events?force="+query, payload)
	if err == nil {
		switch status {
		case 400, 401, 403, 404, 409, 422:
			if os.Remove(path) != nil {
				return s.meetingReceipt(ctx, v, path, receipt)
			}
			if status == 401 {
				_, _ = s.renew(ctx, d.Organizer.ID)
			}
			if len(mutationConflicts(response, d.Participants)) > 0 {
				d.Unconfirmed = true
				s.drafts[d.ID] = d
				v.Draft = d
				v.Message = "У участников есть пересечения. Подтвердите создание."
				return smallReply[meetingView]{OK: true, Data: &v}
			}
			return failure[meetingView]("invalid", "Small отклонил создание встречи.")
		}
		if status >= 200 && status < 300 {
			e, _ := readEvent(response)
			if id := invitationID(e.ID); plainEventID(id) {
				receipt.EventID = id
				raw, _ = json.Marshal(receipt)
				if atomicFile(path, raw, false) != nil {
					receipt.EventID = ""
				}
			}
		}
	}
	return s.meetingReceipt(ctx, v, path, receipt)
}
func (s *SmallService) ReadMeeting(ctx context.Context, input meetingReference) smallReply[meetingView] {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, ok := s.meetingEntry(ctx, input)
	if !ok || s.store == nil {
		return failure[meetingView]("invalid", "Черновик недоступен.")
	}
	v := meetingView{Draft: d, Phase: "preview"}
	path, pathErr := s.receiptPath(ctx, d)
	if pathErr != nil {
		return meetingJournalFailure(pathErr)
	}
	data, err := privateFile(path, 2048)
	if errors.Is(err, os.ErrNotExist) {
		return smallReply[meetingView]{OK: true, Data: &v}
	}
	var receipt createReceipt
	if err != nil || json.Unmarshal(data, &receipt) != nil {
		return failure[meetingView]("network", "Журнал создания недоступен.")
	}
	return s.meetingReceipt(ctx, v, path, receipt)
}
func (s *SmallService) EditMeeting(ctx context.Context, input meetingReference) smallReply[meetingView] {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, ok := s.meetingEntry(ctx, input)
	if !ok || s.store == nil {
		return failure[meetingView]("invalid", "Черновик недоступен.")
	}
	path, pathErr := s.receiptPath(ctx, d)
	if pathErr != nil {
		return meetingJournalFailure(pathErr)
	}
	if _, err := privateFile(path, 2048); !errors.Is(err, os.ErrNotExist) {
		return failure[meetingView]("invalid", "Черновик уже отправлялся.")
	}
	title, agenda := strings.TrimSpace(input.Title), strings.TrimSpace(input.Agenda)
	if title == "" || len([]rune(title)) > 200 || len([]rune(agenda)) > 5000 {
		return failure[meetingView]("invalid", "Проверьте название и повестку.")
	}
	d.Title, d.Agenda, d.Revision = title, agenda, d.Revision+1
	s.drafts[d.ID] = d
	v := meetingView{Draft: d, Phase: "preview"}
	return smallReply[meetingView]{OK: true, Data: &v}
}

func (s *SmallService) People(ctx context.Context, accountID, query string, page int64) smallReply[string] {
	s.mu.Lock()
	defer s.mu.Unlock()
	query = strings.TrimSpace(query)
	if query == "" || len([]rune(query)) > 200 || page < 1 || page > 9007199254740991 {
		return failure[string]("invalid", "Проверьте запрос поиска участников.")
	}
	if !s.canReadCalendar(accountID) {
		return failure[string]("auth", "Войдите в нужный аккаунт Small.")
	}
	pageJSON, _ := json.Marshal(page)
	params := url.Values{"q": {query}, "per_page": {"10"}, "page": {string(pageJSON)}}
	status, response, err := s.readCalendarResponse(ctx, accountID, "/gate/employee/api/search/persons?"+params.Encode())
	if err == nil && status >= 200 && status < 300 {
		body := string(response)
		return smallReply[string]{OK: true, Data: &body}
	}
	if status == 401 {
		return failure[string]("auth", "Войдите в Small заново.")
	}
	if status == 403 || status == 404 {
		s.revokeImportedCatalog(accountID, electronJSON([]any{"people", query, page}))
		return failure[string]("denied", "Нет доступа к каталогу участников.")
	}
	if status > 0 && status < 500 {
		return failure[string]("invalid", "Small отклонил запрос к каталогу участников.")
	}
	return failure[string]("network", "Не удалось прочитать каталог участников.")
}
