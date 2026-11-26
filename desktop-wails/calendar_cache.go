package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const cacheMaxSize = 4 << 20

type calendarCache struct {
	store *sessionStore
	key   string
}

type cacheEntry struct {
	Body      json.RawMessage `json:"body"`
	FetchedAt int64           `json:"fetchedAt"`
}

func (s *SmallService) calendarCache(account, resource string) calendarCache {
	key := sha256.Sum256([]byte(s.csrf + "\x00" + account + "\x00" + resource))
	return calendarCache{s.store, hex.EncodeToString(key[:])}
}

func (s *SmallService) invalidateCalendarForWrite() error {
	if s.store == nil {
		return nil
	}
	if err := s.invalidateImportedEvents(); err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(s.store.directory, "calendar-cache"))
}

func (s *SmallService) dropCalendarCache() {
	if s.store != nil {
		_ = os.RemoveAll(filepath.Join(s.store.directory, "calendar-cache"))
		if err := os.RemoveAll(filepath.Join(s.store.directory, "event-cache")); err != nil {
			s.importedCacheUnavailable = true
		}
	}
}

func (c calendarCache) directory() string {
	return filepath.Join(c.store.directory, "calendar-cache")
}

func (c calendarCache) read(maxAge time.Duration) (cacheEntry, bool) {
	var entry cacheEntry
	if c.store == nil {
		return entry, false
	}
	directory := c.directory()
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return entry, false
	}
	data, err := privateFile(filepath.Join(directory, c.key+".enc"), cacheMaxSize+28)
	if err != nil {
		return entry, false
	}
	aead, err := c.store.cipher(false)
	if err != nil {
		return entry, false
	}
	plain, err := aead.Open(nil, nil, data, []byte("small-calendar:wails:cache:1:"+c.key))
	if err != nil || json.Unmarshal(plain, &entry) != nil {
		return cacheEntry{}, false
	}
	age := time.Since(time.UnixMilli(entry.FetchedAt))
	return entry, age >= 0 && age <= maxAge
}

func (c calendarCache) remove() {
	if c.store == nil {
		return
	}
	info, err := os.Lstat(c.directory())
	if err == nil && info.IsDir() && info.Mode().Perm()&0077 == 0 {
		_ = os.Remove(filepath.Join(c.directory(), c.key+".enc"))
	}
}

func (c calendarCache) write(entry cacheEntry) {
	if c.store == nil || len(entry.Body) > cacheMaxSize {
		return
	}
	data, err := json.Marshal(entry)
	if err != nil || len(data) > cacheMaxSize {
		return
	}
	directory := c.directory()
	if err := os.Mkdir(directory, 0700); err != nil && !os.IsExist(err) {
		return
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return
	}
	aead, err := c.store.cipher(false)
	if err != nil {
		return
	}
	sealed := aead.Seal(nil, nil, data, []byte("small-calendar:wails:cache:1:"+c.key))
	if atomicFile(filepath.Join(directory, c.key+".enc"), sealed, false) != nil {
		return
	}

	entries, err := os.ReadDir(directory)
	if err != nil {
		return
	}
	var files []os.FileInfo
	for _, entry := range entries {
		if info, err := entry.Info(); err == nil && info.Mode().IsRegular() && strings.HasSuffix(entry.Name(), ".enc") {
			files = append(files, info)
		}
	}
	const maxEntries = 40
	if len(files) <= maxEntries {
		return
	}
	sort.Slice(files, func(i, j int) bool { return files[i].ModTime().After(files[j].ModTime()) })
	for _, file := range files[maxEntries:] {
		_ = os.Remove(filepath.Join(directory, file.Name()))
	}
}

func cacheableEventBody(body []byte) bool {
	var envelope struct {
		Data       json.RawMessage `json:"data"`
		Pagination json.RawMessage `json:"pagination"`
		Meta       json.RawMessage `json:"meta"`
	}
	if json.Unmarshal(body, &envelope) != nil || len(envelope.Data) == 0 ||
		(len(envelope.Pagination) != 0 && string(envelope.Pagination) != "null") ||
		(len(envelope.Meta) != 0 && string(envelope.Meta) != "null") {
		return false
	}
	var items []json.RawMessage
	switch envelope.Data[0] {
	case '[':
		if json.Unmarshal(envelope.Data, &items) != nil || len(items) > 5000 {
			return false
		}
	case '{':
		var indexed map[string]json.RawMessage
		if json.Unmarshal(envelope.Data, &indexed) != nil || len(indexed) > 5000 {
			return false
		}
		items = make([]json.RawMessage, 0, len(indexed))
		for _, item := range indexed {
			items = append(items, item)
		}
	default:
		return false
	}
	for _, item := range items {
		var event struct {
			ID       json.RawMessage `json:"id"`
			SeriesID json.RawMessage `json:"original_event_id"`
			Start    time.Time       `json:"starts_at"`
			End      time.Time       `json:"ends_at"`
		}
		if json.Unmarshal(item, &event) != nil || event.Start.IsZero() || !event.End.After(event.Start) ||
			(!cacheEventID(event.ID) && !cacheEventID(event.SeriesID)) {
			return false
		}
	}
	return true
}

func cacheEventID(id json.RawMessage) bool {
	if len(id) == 0 || string(id) == "null" {
		return false
	}
	var value string
	return (json.Unmarshal(id, &value) == nil && smallID.MatchString(value)) || id[0] >= '0' && id[0] <= '9'
}
