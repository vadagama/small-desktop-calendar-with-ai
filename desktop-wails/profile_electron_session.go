package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var electronCSRF = regexp.MustCompile(`(?i)^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)

func electronDigest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func electronSecretPath(key string) string {
	return filepath.Join("local-vault", "secrets", electronDigest(key)+".enc")
}

func openElectronRecord(key, data []byte, purpose string) ([]byte, error) {
	invalid := errors.New("не удалось расшифровать локальные данные Electron")
	if len(key) != 32 || len(data) < 32 || string(data[:4]) != "SCV1" {
		return nil, invalid
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, invalid
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, invalid
	}
	// Electron stores GCM's tag before the ciphertext. Go expects it at the end.
	sealed := append(append(make([]byte, 0, len(data)-16), data[32:]...), data[16:32]...)
	result, err := aead.Open(nil, data[4:16], sealed, []byte("small-calendar:1:"+purpose))
	if err != nil {
		return nil, invalid
	}
	return result, nil
}

func importElectronSession(source *os.Root, stage string) error {
	key, keyErr := privateFile(filepath.Join(stage, "local-vault", "master.key"), 32)
	entries, entriesErr := os.ReadDir(filepath.Join(stage, "local-vault", "secrets"))
	file, _, err := openElectronProfileFile(source, electronSecretPath(electronSession), cacheMaxSize+32)
	if entriesErr != nil && !errors.Is(entriesErr, os.ErrNotExist) {
		return errors.New("не удалось проверить локальное хранилище Electron")
	}
	if errors.Is(err, os.ErrNotExist) && len(entries) == 0 && errors.Is(keyErr, os.ErrNotExist) {
		return nil
	}
	if keyErr != nil || len(key) != 32 {
		return errors.New("отсутствует или повреждён ключ локального хранилища Electron")
	}
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return errors.New("недоступен файл сохранённой сессии Small")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, cacheMaxSize+33))
	if err != nil || len(data) > cacheMaxSize+32 {
		return errors.New("не удалось прочитать сохранённую сессию Small")
	}
	plain, err := openElectronRecord(key, data, "secret:"+electronSession)
	if err != nil {
		return err
	}
	snapshot, err := decodeElectronSession(plain)
	if err != nil {
		return err
	}
	store := sessionStore{directory: stage}
	if err := store.save(snapshot); err != nil {
		return errors.New("не удалось сохранить сессию в профиле Wails")
	}
	if _, err := store.load(); err != nil {
		return errors.New("не удалось проверить сессию в профиле Wails")
	}
	return nil
}

func decodeElectronSession(data []byte) (sessionSnapshot, error) {
	invalid := errors.New("неизвестный формат сохранённой сессии Electron")
	var wrapper struct {
		Version   *int
		Session   json.RawMessage
		Username  *string
		AccountID json.RawMessage
		Expired   *bool
		Login     *struct{ Username, AccountID string }
	}
	snapshot := sessionSnapshot{}
	if json.Unmarshal(data, &wrapper) != nil {
		return snapshot, invalid
	}
	if wrapper.Version != nil {
		var active *string
		if len(wrapper.Session) == 0 || json.Unmarshal(wrapper.Session, &active) != nil {
			return snapshot, invalid
		}
		switch *wrapper.Version {
		case 2:
			if active == nil {
				return snapshot, invalid
			}
			if wrapper.Login != nil {
				snapshot.Username, snapshot.Account = wrapper.Login.Username, wrapper.Login.AccountID
			}
		case 3:
			if wrapper.Username == nil || wrapper.Expired == nil || len(wrapper.AccountID) == 0 ||
				json.Unmarshal(wrapper.AccountID, &snapshot.Account) != nil {
				return snapshot, invalid
			}
			snapshot.Username, snapshot.Expired = *wrapper.Username, *wrapper.Expired
		default:
			return snapshot, invalid
		}
		if len(snapshot.Username) > 800 || len(snapshot.Account) > 800 {
			return snapshot, invalid
		}
		if active == nil {
			snapshot.Account = ""
			return snapshot, nil
		}
		data = []byte(*active)
	}
	var session struct {
		CSRF    string
		Cookies []struct {
			Name, Value, Domain, Path, SameSite string
			Secure, HTTPOnly                    bool
			ExpirationDate                      *float64
		}
	}
	if json.Unmarshal(data, &session) != nil || !electronCSRF.MatchString(session.CSRF) ||
		len(session.Cookies) == 0 || len(session.Cookies) > 50 {
		return snapshot, invalid
	}
	snapshot.CSRF = session.CSRF
	for _, cookie := range session.Cookies {
		domain := strings.TrimPrefix(cookie.Domain, ".")
		if (domain != "team.small.kz" && domain != "small.kz") || !cookie.Secure ||
			!strings.HasPrefix(cookie.Path, "/") || len(cookie.Name) > 256 || len(cookie.Value) > 32000 {
			return sessionSnapshot{}, invalid
		}
		saved := http.Cookie{Name: cookie.Name, Value: cookie.Value, Domain: cookie.Domain,
			Path: cookie.Path, Secure: true, HttpOnly: cookie.HTTPOnly}
		switch cookie.SameSite {
		case "unspecified":
			saved.SameSite = http.SameSiteDefaultMode
		case "no_restriction":
			saved.SameSite = http.SameSiteNoneMode
		case "strict":
			saved.SameSite = http.SameSiteStrictMode
		case "lax":
			saved.SameSite = http.SameSiteLaxMode
		default:
			return sessionSnapshot{}, invalid
		}
		if cookie.ExpirationDate != nil {
			seconds, fraction := math.Modf(*cookie.ExpirationDate)
			if seconds < -62135596800 || seconds > 253402300799 {
				return sessionSnapshot{}, invalid
			}
			saved.Expires = time.Unix(int64(seconds), int64(math.Round(fraction*1e9))).UTC()
		}
		if saved.Valid() != nil {
			return sessionSnapshot{}, invalid
		}
		snapshot.Cookies = append(snapshot.Cookies, saved)
	}
	snapshot.Unbound = snapshot.Account == ""
	return snapshot, nil
}
