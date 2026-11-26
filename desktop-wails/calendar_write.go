package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
)

type invitationResponse struct {
	AccountID string `json:"accountId"`
	EventID   string `json:"eventId"`
	Status    string `json:"status"`
}

func (s *SmallService) Respond(ctx context.Context, input invitationResponse) smallReply[struct{}] {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !plainEventID(input.EventID) || (input.Status != "accepted" && input.Status != "declined") {
		return failure[struct{}]("invalid", "Некорректный ответ на приглашение.")
	}
	if !s.canReadCalendar(input.AccountID) {
		return failure[struct{}]("auth", "Войдите в нужный аккаунт Small.")
	}
	auth := s.read(ctx)
	if !auth.OK {
		if auth.Kind == "auth" {
			return failure[struct{}]("auth", auth.Error)
		}
		return failure[struct{}]("network", auth.Error)
	}
	if auth.State.Profile == nil || auth.State.Profile.ID != input.AccountID {
		return failure[struct{}]("auth", "Войдите в нужный аккаунт Small.")
	}
	if s.token == "" {
		return failure[struct{}]("network", "Нет связи со Small.")
	}
	path := "/gate/team/api/calendar/events/" + input.EventID
	status, body, err := s.get(ctx, path)
	if err != nil || status < 200 || status >= 300 {
		return invitationFailure(status, err)
	}
	var event struct {
		Data struct {
			ID           json.RawMessage `json:"id"`
			Participants []struct {
				ID json.RawMessage `json:"id"`
			} `json:"participants"`
		} `json:"data"`
	}
	permitted := false
	if json.Unmarshal(body, &event) == nil && invitationID(event.Data.ID) == input.EventID &&
		s.profile.ID == input.AccountID && s.profile.ParticipantID != "" {
		for _, participant := range event.Data.Participants {
			if invitationID(participant.ID) == s.profile.ParticipantID {
				permitted = true
				break
			}
		}
	}
	if !permitted {
		return failure[struct{}]("denied", "Приглашение для этого аккаунта не найдено.")
	}

	// Invalidate before dispatch. A timeout can occur after Small accepted the change.
	if s.invalidateCalendarForWrite() != nil {
		return failure[struct{}]("network", "Не удалось обновить кеш календаря.")
	}
	payload, _ := json.Marshal(struct {
		Status string `json:"status"`
	}{input.Status})
	status, body, err = s.request(ctx, http.MethodPatch, path+"/participant-status", payload)
	if err != nil || status < 200 || status >= 300 {
		if status == http.StatusUnauthorized {
			// Refresh only for subsequent requests. Never replay the mutation.
			_, _ = s.renew(ctx, input.AccountID)
		}
		return invitationFailure(status, err)
	}
	if !json.Valid(body) {
		return failure[struct{}]("invalid", "Неизвестный формат ответа календаря Small.")
	}
	return smallReply[struct{}]{OK: true}
}

func plainEventID(id string) bool {
	switch id {
	case "from-template", "busy-intervals", "find-slots", "generated":
		return false
	}
	return smallID.MatchString(id)
}

func invitationID(raw json.RawMessage) string {
	var value string
	if json.Unmarshal(raw, &value) == nil {
		return value
	}
	number, err := strconv.ParseUint(string(raw), 10, 53)
	if err != nil {
		return ""
	}
	return strconv.FormatUint(number, 10)
}

func invitationFailure(status int, err error) smallReply[struct{}] {
	if err == nil {
		switch status {
		case http.StatusUnauthorized:
			return failure[struct{}]("auth", "Войдите в Small заново.")
		case http.StatusForbidden:
			return failure[struct{}]("denied", "Нет доступа к встрече Small.")
		case http.StatusNotFound:
			return failure[struct{}]("not-found", "Событие больше недоступно.")
		}
	}
	return failure[struct{}]("network", "Не удалось сохранить ответ на приглашение.")
}
