package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type smallReply[T any] struct {
	OK                        bool     `json:"ok"`
	State                     *T       `json:"state,omitempty"`
	Data                      *T       `json:"data,omitempty"`
	Kind                      string   `json:"kind,omitempty"`
	Error                     string   `json:"error,omitempty"`
	UnknownOutcome            bool     `json:"unknownOutcome,omitempty"`
	ConflictingParticipantIDs []string `json:"conflictingParticipantIds,omitempty"`
}

func failure[T any](kind, message string) smallReply[T] {
	return smallReply[T]{Kind: kind, Error: message}
}

type smallProfile struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Username      string `json:"username"`
	ParticipantID string `json:"participantId,omitempty"`
}

type smallState struct {
	Status   string        `json:"status"`
	Profile  *smallProfile `json:"profile,omitempty"`
	Username string        `json:"username,omitempty"`
	Reason   string        `json:"reason,omitempty"`
	Warning  string        `json:"warning,omitempty"`
}

type smallCredentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type calendarAccount struct {
	AccountID string `json:"accountId"`
	Refresh   bool   `json:"refresh,omitempty"`
}

type smallCalendar struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type SmallService struct {
	importedCacheUnavailable bool
	mu                       sync.Mutex
	origin                   string
	client                   *http.Client
	token                    string
	csrf                     string
	username                 string
	profile                  smallProfile
	expired                  bool
	store                    *sessionStore
	pendingRestore           bool
	verifiedProfile          *smallProfile
	drafts                   map[string]meetingDraft
	chooseAttachments        func() ([]string, error)
	openExternal             func(string) error
	writeClipboard           func(string) bool
	uploadedAttachments      map[string]bool
	draftReceipts            map[string]string
	revision                 uint64
	onAssistantReset         func()
	assistantMemoryRevision  func(context.Context, string) (int, error)
}

func newSmallService(origin string) *SmallService {
	s := &SmallService{origin: origin, drafts: make(map[string]meetingDraft), draftReceipts: make(map[string]string), uploadedAttachments: make(map[string]bool), client: &http.Client{
		Timeout:       15 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
	s.clear(false)
	return s
}

func (s *SmallService) clear(expired bool) {
	s.revision++
	if expired && s.onAssistantReset != nil {
		s.onAssistantReset()
	}
	clear(s.drafts)
	clear(s.draftReceipts)
	clear(s.uploadedAttachments)
	jar, _ := cookiejar.New(nil)
	origin, _ := url.Parse(s.origin)
	s.client.Jar = &recordJar{Jar: jar, origin: origin, records: make(map[string]http.Cookie)}
	// Small expects a UUID in the CSRF header.
	var uuid [16]byte
	_, _ = rand.Read(uuid[:])
	uuid[6] = (uuid[6] & 0x0f) | 0x40
	uuid[8] = (uuid[8] & 0x3f) | 0x80
	s.csrf = formatUUID(uuid)
	s.token = ""
	s.profile = smallProfile{}
	s.verifiedProfile = nil
	s.expired = expired
}

func formatUUID(u [16]byte) string {
	const hex = "0123456789abcdef"
	var result strings.Builder
	for i, b := range u {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			result.WriteByte('-')
		}
		result.WriteByte(hex[b>>4])
		result.WriteByte(hex[b&15])
	}
	return result.String()
}

func (s *SmallService) request(ctx context.Context, method, path string, body []byte) (int, []byte, error) {
	return s.requestWithContentType(ctx, method, path, body, "application/json")
}

func (s *SmallService) requestWithContentType(ctx context.Context, method, path string, body []byte, contentType string) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, s.origin+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Origin", s.origin)
	req.Header.Set("X-K-Csrf", s.csrf)
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	const maxBody = 8 << 20
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if len(data) > maxBody {
		return 0, nil, errors.New("Small response exceeds size limit")
	}
	return resp.StatusCode, data, err
}

var smallID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func decodeProfile(data []byte) (string, smallProfile, bool) {
	var reply struct {
		Data struct {
			Token string `json:"access_token"`
		} `json:"data"`
	}
	if json.Unmarshal(data, &reply) != nil || len(reply.Data.Token) > 32000 {
		return "", smallProfile{}, false
	}
	parts := strings.Split(reply.Data.Token, ".")
	if len(parts) != 3 {
		return "", smallProfile{}, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", smallProfile{}, false
	}
	var claims struct {
		ID            json.RawMessage `json:"uid"`
		Name          string          `json:"name"`
		Username      string          `json:"preferred_username"`
		ParticipantID string          `json:"guidfl"`
	}
	if json.Unmarshal(payload, &claims) != nil || claims.Name == "" || len([]rune(claims.Name)) > 500 ||
		claims.Username == "" || len([]rune(claims.Username)) > 200 ||
		(claims.ParticipantID != "" && !smallID.MatchString(claims.ParticipantID)) {
		return "", smallProfile{}, false
	}
	var id string
	if json.Unmarshal(claims.ID, &id) != nil {
		var number json.Number
		if json.Unmarshal(claims.ID, &number) != nil {
			return "", smallProfile{}, false
		}
		id = number.String()
	}
	return reply.Data.Token, smallProfile{id, claims.Name, claims.Username, claims.ParticipantID}, id != ""
}

func (s *SmallService) signedOut() smallReply[smallState] {
	state := smallState{Status: "signed-out", Username: s.username}
	if s.expired {
		state.Reason = "expired"
	}
	return smallReply[smallState]{OK: true, State: &state}
}

var errSessionStorage = errors.New("session storage unavailable")

func (s *SmallService) persist() error {
	if s.store == nil {
		return nil
	}
	jar := s.client.Jar.(*recordJar)
	return s.store.save(sessionSnapshot{
		Username: s.username, Account: s.profile.ID, CSRF: s.csrf,
		Cookies: jar.snapshot(), Expired: s.expired, Profile: s.verifiedProfile,
	})
}

func (s *SmallService) loadSaved() (string, bool, error) {
	saved, err := s.store.load()
	if err != nil {
		return "", false, errSessionStorage
	}
	s.clear(saved.Expired)
	s.username = saved.Username
	if saved.Account == "" && !saved.Unbound {
		return "", false, nil
	}
	if saved.CSRF == "" || len(saved.Cookies) == 0 {
		return "", false, errSessionStorage
	}
	s.csrf = saved.CSRF
	if saved.Profile != nil && saved.Profile.ID == saved.Account && saved.Profile.Username != "" && saved.Profile.Name != "" {
		s.verifiedProfile = saved.Profile
	}
	jar := s.client.Jar.(*recordJar)
	for i := range saved.Cookies {
		jar.SetCookies(jar.origin, []*http.Cookie{&saved.Cookies[i]})
	}
	refreshURL := jar.origin.ResolveReference(&url.URL{Path: "/gate/auth/refresh"})
	if len(jar.Cookies(refreshURL)) == 0 {
		s.clear(true)
		s.dropCalendarCache()
		if err := s.persist(); err != nil {
			return "", false, errSessionStorage
		}
		return "", false, nil
	}
	return saved.Account, true, nil
}

func (s *SmallService) renew(ctx context.Context, account string) (int, error) {
	return s.renewSession(ctx, account, false)
}

func (s *SmallService) renewSession(ctx context.Context, account string, bindLegacy bool) (int, error) {
	status, data, err := s.request(ctx, http.MethodPost, "/gate/auth/refresh", []byte("{}"))
	if err != nil {
		return 0, err
	}
	if status == 401 || status == 403 {
		s.clear(true)
		s.dropCalendarCache()
		return 401, s.persist()
	}
	if status < 200 || status >= 300 {
		return status, nil
	}
	token, profile, ok := decodeProfile(data)
	if !ok {
		return 502, nil
	}
	if profile.ID != account && !bindLegacy {
		s.clear(true)
		s.dropCalendarCache()
		return 401, s.persist()
	}
	s.token, s.profile = token, profile
	if err := s.persist(); err != nil {
		return 0, errSessionStorage
	}
	return status, nil
}

func (s *SmallService) get(ctx context.Context, path string) (int, []byte, error) {
	status, data, err := s.request(ctx, http.MethodGet, path, nil)
	if err != nil || status != http.StatusUnauthorized {
		return status, data, err
	}
	status, err = s.renew(ctx, s.profile.ID)
	if err != nil || status < 200 || status >= 300 {
		return status, nil, err
	}
	status, data, err = s.request(ctx, http.MethodGet, path, nil)
	if status == 401 {
		s.clear(true)
		s.dropCalendarCache()
		if saveErr := s.persist(); saveErr != nil {
			return 0, nil, errSessionStorage
		}
	}
	return status, data, err
}

func storageFailure() smallReply[smallState] {
	return failure[smallState]("storage", "Не удалось получить доступ к локальному хранилищу сессии.")
}

func (s *SmallService) offlineProfile(ctx context.Context) (smallReply[smallState], bool) {
	if s.verifiedProfile == nil || ctx.Err() != nil {
		return smallReply[smallState]{}, false
	}
	state := smallState{Status: "signed-in", Profile: s.verifiedProfile}
	return smallReply[smallState]{OK: true, State: &state}, true
}

func (s *SmallService) readCalendarResponse(ctx context.Context, account, path string) (int, []byte, error) {
	if s.token == "" && s.verifiedProfile != nil && s.verifiedProfile.ID == account {
		return http.StatusServiceUnavailable, nil, nil
	}
	return s.get(ctx, path)
}

func (s *SmallService) canReadCalendar(account string) bool {
	return account != "" && ((s.token != "" && account == s.profile.ID) ||
		(s.token == "" && s.verifiedProfile != nil && account == s.verifiedProfile.ID))
}

func (s *SmallService) read(ctx context.Context) smallReply[smallState] {
	if s.pendingRestore {
		account, active, err := s.loadSaved()
		if err != nil {
			return storageFailure()
		}
		if active {
			status, err := s.renewSession(ctx, account, account == "")
			if errors.Is(err, errSessionStorage) {
				return storageFailure()
			}
			if err != nil || status >= 500 {
				if offline, ok := s.offlineProfile(ctx); ok {
					return offline
				}
			}
			if err != nil {
				return failure[smallState]("network", "Не удалось связаться со Small.")
			}
			if status != 401 && (status < 200 || status >= 300) {
				return failure[smallState]("service", "Small временно недоступен.")
			}
		}
		s.pendingRestore = false
	}
	if s.token == "" {
		return s.signedOut()
	}
	status, body, err := s.get(ctx, "/gate/team/api/user/info")
	if errors.Is(err, errSessionStorage) {
		return storageFailure()
	}
	if err != nil || status >= 500 {
		if offline, ok := s.offlineProfile(ctx); ok {
			return offline
		}
	}
	if err != nil {
		return failure[smallState]("network", "Не удалось связаться со Small.")
	}
	switch status {
	case 401:
		return s.signedOut()
	case 403:
		s.clear(true)
		s.dropCalendarCache()
		if err := s.persist(); err != nil {
			return storageFailure()
		}
		return failure[smallState]("auth", "Нет доступа к профилю Small.")
	}
	if status < 200 || status >= 300 {
		return failure[smallState]("service", "Small временно недоступен.")
	}
	var response struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if json.Unmarshal(body, &response) != nil || response.Data == nil {
		return failure[smallState]("invalid", "Small вернул неизвестный формат профиля.")
	}
	profile := s.profile
	if s.verifiedProfile == nil || *s.verifiedProfile != profile {
		s.verifiedProfile = &profile
		if s.store != nil && len(s.client.Jar.(*recordJar).snapshot()) != 0 {
			if err := s.persist(); err != nil {
				s.verifiedProfile = nil
				return storageFailure()
			}
		}
	}
	return smallReply[smallState]{OK: true, State: &smallState{Status: "signed-in", Profile: &profile}}
}

func (s *SmallService) Read(ctx context.Context) smallReply[smallState] {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read(ctx)
}

func (s *SmallService) Login(ctx context.Context, input smallCredentials) smallReply[smallState] {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.onAssistantReset != nil {
		s.onAssistantReset()
	}
	username := strings.TrimSpace(input.Username)
	if username == "" || len([]rune(username)) > 200 || input.Password == "" || len([]rune(input.Password)) > 1024 {
		return failure[smallState]("invalid", "Проверьте логин и пароль.")
	}
	s.clear(false)
	signedIn := false
	defer func() {
		if !signedIn {
			s.clear(false)
		}
	}()
	s.username = strings.ToLower(strings.Join(strings.Fields(username), ""))
	if err := s.persist(); err != nil {
		return storageFailure()
	}
	s.pendingRestore = false
	s.dropCalendarCache()
	body, _ := json.Marshal(struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Remember bool   `json:"remember_me"`
	}{s.username, input.Password, true})
	status, data, err := s.request(ctx, http.MethodPost, "/gate/auth/login", body)
	if err != nil {
		return failure[smallState]("network", "Не удалось связаться со Small.")
	}
	if status == 401 || status == 403 {
		return failure[smallState]("auth", "Логин или пароль не подошли.")
	}
	if status < 200 || status >= 300 {
		return failure[smallState]("service", "Small временно недоступен.")
	}
	token, profile, valid := decodeProfile(data)
	if !valid {
		return failure[smallState]("invalid", "Small вернул неизвестный формат сессии.")
	}
	s.token, s.profile = token, profile
	reply := s.read(ctx)
	if reply.OK && reply.State.Status == "signed-in" {
		if s.store != nil && len(s.client.Jar.(*recordJar).snapshot()) == 0 {
			return failure[smallState]("invalid", "Small не вернул cookie сессии. Вход не сохранён.")
		}
		if err := s.persist(); err != nil {
			return storageFailure()
		}
		signedIn = true
	}
	return reply
}

func (s *SmallService) Logout(ctx context.Context) smallReply[smallState] {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.onAssistantReset != nil {
		s.onAssistantReset()
	}
	if s.pendingRestore {
		if _, _, err := s.loadSaved(); err != nil {
			return storageFailure()
		}
	}
	if s.store != nil {
		if err := s.store.save(sessionSnapshot{Username: s.username}); err != nil {
			return storageFailure()
		}
	}
	status, _, err := s.request(ctx, http.MethodPost, "/gate/auth/logout", []byte("{}"))
	s.pendingRestore = false
	s.clear(false)
	s.dropCalendarCache()
	reply := s.signedOut()
	if err != nil || status < 200 || status >= 300 {
		reply.State.Warning = "Локальный выход выполнен. Сервер не подтвердил отзыв сессии."
	}
	return reply
}

func (s *SmallService) Calendars(ctx context.Context, input calendarAccount) smallReply[[]smallCalendar] {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.canReadCalendar(input.AccountID) {
		return failure[[]smallCalendar]("auth", "Войдите в нужный аккаунт Small.")
	}
	const path = "/gate/team/api/calendars/public"
	cache := s.calendarCache(input.AccountID, path)
	status, body, err := s.readCalendarResponse(ctx, input.AccountID, path)
	if !input.Refresh && ctx.Err() == nil && (err != nil || status >= 500) {
		var saved []smallCalendar
		if entry, ok := cache.read(24 * time.Hour); ok && s.canReadCalendar(input.AccountID) &&
			json.Unmarshal(entry.Body, &saved) == nil {
			return smallReply[[]smallCalendar]{OK: true, Data: &saved}
		}
		if entry := s.importedCalendarCache(input.AccountID, "catalog", "calendars"); entry != nil &&
			json.Unmarshal(entry.Value, &saved) == nil && saved != nil {
			return smallReply[[]smallCalendar]{OK: true, Data: &saved}
		}
	}
	if err != nil {
		return failure[[]smallCalendar]("network", "Не удалось загрузить список календарей Small.")
	}
	switch status {
	case 401:
		return failure[[]smallCalendar]("auth", "Войдите в Small заново.")
	case 403:
		cache.remove()
		s.revokeImportedCatalog(input.AccountID, "calendars")
		return failure[[]smallCalendar]("denied", "Нет доступа к календарям Small.")
	case 404:
		cache.remove()
		s.revokeImportedCatalog(input.AccountID, "calendars")
		return failure[[]smallCalendar]("not-found", "Список календарей Small недоступен.")
	}
	if status < 200 || status >= 300 {
		return failure[[]smallCalendar]("network", "Small временно недоступен.")
	}
	var result struct {
		Data []struct {
			ID   json.RawMessage `json:"id"`
			Name string          `json:"name"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &result) != nil || result.Data == nil || len(result.Data) > 1000 {
		return failure[[]smallCalendar]("invalid", "Small вернул неизвестный формат календарей.")
	}
	calendars := make([]smallCalendar, 0, len(result.Data))
	for _, calendar := range result.Data {
		var id string
		if json.Unmarshal(calendar.ID, &id) != nil {
			value, err := strconv.ParseFloat(string(calendar.ID), 64)
			if err == nil && value >= 0 && value <= 9007199254740991 && value == float64(uint64(value)) {
				id = strconv.FormatUint(uint64(value), 10)
			}
		}
		if !smallID.MatchString(id) || calendar.Name == "" || len([]rune(calendar.Name)) > 500 {
			return failure[[]smallCalendar]("invalid", "Small вернул неизвестный формат календарей.")
		}
		calendars = append(calendars, smallCalendar{ID: id, Name: calendar.Name})
	}
	if body, err := json.Marshal(calendars); err == nil {
		cache.write(cacheEntry{Body: body, FetchedAt: time.Now().UnixMilli()})
	}
	return smallReply[[]smallCalendar]{OK: true, Data: &calendars}
}

// EventSource transports exactly one calendar range. The existing TypeScript
// normalizer remains shared until occurrence handling is ported and compared.
func (s *SmallService) EventSource(ctx context.Context, accountID, source, start, end string, allowStale bool) smallReply[eventSource] {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.canReadCalendar(accountID) {
		return failure[eventSource]("auth", "Войдите в нужный аккаунт Small.")
	}
	first, firstErr := time.Parse(time.RFC3339, start)
	last, lastErr := time.Parse(time.RFC3339, end)
	if !smallID.MatchString(source) || firstErr != nil || lastErr != nil || !last.After(first) ||
		last.Sub(first) > 43*24*time.Hour || len(start) > 40 || len(end) > 40 {
		return failure[eventSource]("invalid", "Проверьте параметры чтения календаря.")
	}
	params := url.Values{"start_date": {start}, "end_date": {end}}
	path := "/gate/team/api/calendars/" + source + "/events?" + params.Encode()
	cache := s.calendarCache(accountID, path)
	status, body, err := s.readCalendarResponse(ctx, accountID, path)
	if allowStale && ctx.Err() == nil && (err != nil || status >= 500) {
		if entry, ok := cache.read(7 * 24 * time.Hour); ok && s.canReadCalendar(accountID) {
			data := eventSource{Body: string(entry.Body), FetchedAt: entry.FetchedAt, Stale: true}
			return smallReply[eventSource]{OK: true, Data: &data}
		}
	}
	if err != nil {
		return failure[eventSource]("network", "Не удалось загрузить календарь Small.")
	}
	switch status {
	case 401:
		return failure[eventSource]("auth", "Войдите в Small заново.")
	case 403:
		cache.remove()
		s.denyImportedEvents()
		return failure[eventSource]("denied", "Нет доступа к календарю Small.")
	case 404:
		cache.remove()
		s.denyImportedEvents()
		return failure[eventSource]("not-found", "Календарь больше недоступен.")
	}
	if status < 200 || status >= 300 {
		return failure[eventSource]("network", "Small временно недоступен.")
	}
	fetchedAt := time.Now().UnixMilli()
	if cacheableEventBody(body) {
		cache.write(cacheEntry{Body: body, FetchedAt: fetchedAt})
	}
	data := eventSource{Body: string(body), FetchedAt: fetchedAt}
	return smallReply[eventSource]{OK: true, Data: &data}
}

type eventSource struct {
	Body      string `json:"body"`
	FetchedAt int64  `json:"fetchedAt"`
	Stale     bool   `json:"stale"`
}

func (s *SmallService) EventDetail(ctx context.Context, accountID, eventID, occurrenceDate string) smallReply[string] {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.canReadCalendar(accountID) {
		return failure[string]("auth", "Войдите в нужный аккаунт Small.")
	}
	if !smallID.MatchString(eventID) || (occurrenceDate == "" && !plainEventID(eventID)) {
		return failure[string]("invalid", "Неверный идентификатор события Small.")
	}
	path := "/gate/team/api/calendar/events/" + eventID
	if occurrenceDate != "" {
		if _, err := time.Parse(time.DateOnly, occurrenceDate); err != nil {
			return failure[string]("invalid", "Неверная дата события Small.")
		}
		params := url.Values{"original_event_id": {eventID}, "date": {occurrenceDate}}
		path = "/gate/team/api/calendar/events/generated?" + params.Encode()
	}
	status, body, err := s.readCalendarResponse(ctx, accountID, path)
	if err == nil {
		switch status {
		case 401:
			return failure[string]("auth", "Войдите в Small заново.")
		case 403:
			s.denyImportedEvents()
			return failure[string]("denied", "Нет доступа к событию Small.")
		case 404:
			s.denyImportedEvents()
			return failure[string]("not-found", "Событие больше недоступно.")
		}
		if status >= 200 && status < 300 {
			data := string(body)
			return smallReply[string]{OK: true, Data: &data}
		}
	}
	return failure[string]("network", "Не удалось прочитать карточку Small.")
}
