package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const electronPendingOperation = "Операция есть в журнале Electron. Сверьте её в Electron перед повторной записью."

var errElectronPendingOperation = errors.New(electronPendingOperation)
var electronEscapedSeparators = regexp.MustCompile(`\\\\|\\u202[89]`)

// The legacy keys were produced with JSON.stringify of arrays of strings and
// integers. Match its escaping for names and account identifiers.
func electronJSON(value []any) string {
	var data bytes.Buffer
	encoder := json.NewEncoder(&data)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(value)
	return electronEscapedSeparators.ReplaceAllStringFunc(strings.TrimSuffix(data.String(), "\n"), func(escape string) string {
		switch escape {
		case `\u2028`:
			return "\u2028"
		case `\u2029`:
			return "\u2029"
		default:
			return escape
		}
	})
}

func (s *SmallService) hasElectronMutation(directory, account, event string) bool {
	if s.store == nil {
		return false
	}
	path := filepath.Join(s.store.directory, directory, electronDigest(electronJSON([]any{account, event}))+".json")
	_, err := os.Lstat(path)
	return !errors.Is(err, os.ErrNotExist)
}

func (s *SmallService) hasElectronMeeting(ctx context.Context, d meetingDraft) bool {
	start, startErr := time.Parse(time.RFC3339Nano, d.Start)
	end, endErr := time.Parse(time.RFC3339Nano, d.End)
	if startErr != nil || endErr != nil {
		return true
	}
	// Electron's Date.toISOString always emits three fractional digits.
	const jsInstant = "2006-01-02T15:04:05.000Z"
	key := electronDigest(electronJSON([]any{d.Organizer.ID, sorted(d.Participants), start.UTC().Format(jsInstant), end.UTC().Format(jsInstant)}))
	for range 100 {
		base := filepath.Join(s.store.directory, "meeting-operations", key)
		if _, err := os.Lstat(base + ".intent"); err != nil {
			return !errors.Is(err, os.ErrNotExist)
		}
		raw, err := privateFile(base+".result", 2048)
		var prior struct {
			Phase   string `json:"phase"`
			EventID string `json:"eventId"`
		}
		if err != nil || json.Unmarshal(raw, &prior) != nil ||
			prior.Phase != "succeeded" || !plainEventID(prior.EventID) {
			return true
		}
		status, body, err := s.get(ctx, "/gate/team/api/calendar/events/"+prior.EventID)
		event, ok := readEvent(body)
		if err != nil || status != 200 || !ok || invitationID(event.ID) != prior.EventID || event.Status != "cancelled" {
			return true
		}
		key = eventHash([]string{key, prior.EventID})
	}
	return true
}

func meetingJournalFailure(err error) smallReply[meetingView] {
	if errors.Is(err, errElectronPendingOperation) {
		reply := failure[meetingView]("network", electronPendingOperation)
		reply.UnknownOutcome = true
		return reply
	}
	return failure[meetingView]("network", "Журнал создания недоступен.")
}
