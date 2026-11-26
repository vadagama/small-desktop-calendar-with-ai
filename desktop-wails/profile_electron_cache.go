package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

type importedCacheEntry struct {
	Value     json.RawMessage `json:"value"`
	FetchedAt int64           `json:"fetchedAt"`
}

const importedEventsDirty = "imported-events.dirty"

func (s *SmallService) importedCachePath(account, kind, key string) string {
	return filepath.Join(s.store.directory, "event-cache", electronDigest(account)[:32],
		electronDigest(kind+"\x00"+key)+".json")
}

func (s *SmallService) revokeImportedCatalog(account, key string) {
	if s.store != nil {
		path := s.importedCachePath(account, "catalog", key)
		err := os.Remove(path)
		if err == nil {
			err = syncProfileDirectory(filepath.Dir(path))
		}
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			s.importedCacheUnavailable = true
		}
	}
}

func (s *SmallService) invalidateImportedEvents() error {
	if _, err := os.Lstat(filepath.Join(s.store.directory, "event-cache")); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	path := filepath.Join(s.store.directory, importedEventsDirty)
	if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
		return atomicFile(path, []byte{1}, false)
	} else {
		return err
	}
}

func (s *SmallService) denyImportedEvents() {
	if s.store != nil && s.invalidateImportedEvents() != nil {
		s.importedCacheUnavailable = true
	}
}

func (s *SmallService) ImportedCalendarCache(ctx context.Context, account, kind, key string) *importedCacheEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ctx.Err() != nil || !s.canReadCalendar(account) {
		return nil
	}
	return s.importedCalendarCache(account, kind, key)
}

// Caller holds the session lock. The account and range inside the authenticated
// envelope must agree with the requested partition and filename.
func (s *SmallService) importedCalendarCache(account, kind, key string) *importedCacheEntry {
	if s.store == nil || s.importedCacheUnavailable || key == "" || len(key) > 65536 {
		return nil
	}
	age := 24 * time.Hour
	switch kind {
	case "events":
		age = 7 * 24 * time.Hour
		if _, err := os.Lstat(filepath.Join(s.store.directory, importedEventsDirty)); !errors.Is(err, os.ErrNotExist) {
			return nil
		}
	case "catalog":
	default:
		return nil
	}
	if _, err := os.Lstat(filepath.Join(s.store.directory, "event-cache.dirty")); !errors.Is(err, os.ErrNotExist) {
		return nil
	}
	raw, err := privateFile(s.importedCachePath(account, kind, key), electronTextLimit)
	if err != nil {
		return nil
	}
	var envelope struct {
		Version int    `json:"v"`
		Data    []byte `json:"data"`
	}
	if json.Unmarshal(raw, &envelope) != nil || envelope.Version != 1 || len(envelope.Data) > cacheMaxSize+32 {
		return nil
	}
	vaultKey, err := privateFile(filepath.Join(s.store.directory, "local-vault", "master.key"), 32)
	if err != nil {
		return nil
	}
	plain, err := openElectronRecord(vaultKey, envelope.Data, "calendar-cache")
	if err != nil {
		return nil
	}
	var payload struct {
		importedCacheEntry
		Version   int    `json:"version"`
		Kind      string `json:"kind"`
		AccountID string `json:"accountId"`
		Key       string `json:"key"`
	}
	if json.Unmarshal(plain, &payload) != nil || payload.Version != 1 || payload.Kind != kind ||
		payload.AccountID != account || payload.Key != key || len(payload.Value) == 0 {
		return nil
	}
	elapsed := time.Since(time.UnixMilli(payload.FetchedAt))
	if elapsed < 0 || elapsed > age {
		return nil
	}
	return &payload.importedCacheEntry
}
