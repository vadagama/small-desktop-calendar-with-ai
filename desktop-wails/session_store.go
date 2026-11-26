package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const sessionFile = "small-session.enc"
const sessionContext = "small-calendar:wails:session:1"
const sessionPlainLimit = 4 << 20

type sessionSnapshot struct {
	Username string        `json:"username"`
	Account  string        `json:"account"`
	Profile  *smallProfile `json:"profile,omitempty"`
	CSRF     string        `json:"csrf"`
	Cookies  []http.Cookie `json:"cookies"`
	Expired  bool          `json:"expired"`
	Unbound  bool          `json:"importUnbound,omitempty"`
}

type sessionStore struct {
	directory string
}

func privateFile(path string, limit int64) ([]byte, error) {
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), path)
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > limit {
		return nil, errors.New("invalid session file")
	}
	return io.ReadAll(io.LimitReader(file, limit))
}

func (s sessionStore) cipher(create bool) (cipher.AEAD, error) {
	path := filepath.Join(s.directory, "master.key")
	key, err := privateFile(path, 32)
	if create && errors.Is(err, os.ErrNotExist) {
		if _, statErr := os.Lstat(filepath.Join(s.directory, sessionFile)); !errors.Is(statErr, os.ErrNotExist) {
			return nil, errors.New("saved session has no key")
		}
		key = make([]byte, 32)
		rand.Read(key)
		if err = atomicFile(path, key, true); err == nil || errors.Is(err, os.ErrExist) {
			key, err = privateFile(path, 32)
		}
	}
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, errors.New("invalid session key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCMWithRandomNonce(block)
}

func atomicFile(path string, data []byte, exclusive bool) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".session-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	_, writeErr := tmp.Write(data)
	syncErr := tmp.Sync()
	closeErr := tmp.Close()
	if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
		return err
	}
	if exclusive {
		err = os.Link(tmp.Name(), path)
	} else {
		err = os.Rename(tmp.Name(), path)
	}
	if err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func (s sessionStore) save(snapshot sessionSnapshot) error {
	aead, err := s.cipher(true)
	if err != nil {
		return err
	}
	data, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	if len(data) > sessionPlainLimit {
		return errors.New("saved session exceeds storage limit")
	}
	return atomicFile(filepath.Join(s.directory, sessionFile),
		aead.Seal(nil, nil, data, []byte(sessionContext)), false)
}

func (s sessionStore) load() (sessionSnapshot, error) {
	data, err := privateFile(filepath.Join(s.directory, sessionFile), sessionPlainLimit+28)
	if errors.Is(err, os.ErrNotExist) {
		return sessionSnapshot{}, nil
	}
	if err != nil {
		return sessionSnapshot{}, err
	}
	aead, err := s.cipher(false)
	if err != nil {
		return sessionSnapshot{}, err
	}
	plain, err := aead.Open(nil, nil, data, []byte(sessionContext))
	if err != nil {
		return sessionSnapshot{}, err
	}
	var snapshot sessionSnapshot
	err = json.Unmarshal(plain, &snapshot)
	return snapshot, err
}

// recordJar retains attributes that net/http's CookieJar.Cookies omits.
type recordJar struct {
	*cookiejar.Jar
	origin  *url.URL
	records map[string]http.Cookie
}

func (j *recordJar) SetCookies(u *url.URL, cookies []*http.Cookie) {
	j.Jar.SetCookies(u, cookies)
	if u.Host != j.origin.Host {
		return
	}
	for _, incoming := range cookies {
		cookie := *incoming
		if cookie.Path == "" || !strings.HasPrefix(cookie.Path, "/") {
			cookie.Path = u.Path[:strings.LastIndex(u.Path, "/")+1]
			if len(cookie.Path) > 1 {
				cookie.Path = strings.TrimSuffix(cookie.Path, "/")
			}
		}
		domain := strings.ToLower(strings.TrimPrefix(cookie.Domain, "."))
		host := u.Hostname()
		if domain != "" && domain != host && (host != "team.small.kz" || domain != "small.kz") {
			continue
		}
		if domain == "" {
			domain = host
		}
		key := domain + "\x00" + cookie.Path + "\x00" + cookie.Name
		if cookie.MaxAge < 0 || (!cookie.Expires.IsZero() && !cookie.Expires.After(time.Now()) && cookie.MaxAge == 0) {
			delete(j.records, key)
			continue
		}
		if cookie.MaxAge > 0 {
			cookie.Expires = time.Now().Add(time.Duration(cookie.MaxAge) * time.Second)
			cookie.MaxAge = 0
		}
		cookie.Raw, cookie.RawExpires, cookie.Unparsed = "", "", nil
		j.records[key] = cookie
	}
}

func (j *recordJar) snapshot() []http.Cookie {
	result := make([]http.Cookie, 0, len(j.records))
	for key, cookie := range j.records {
		if !cookie.Expires.IsZero() && !cookie.Expires.After(time.Now()) {
			delete(j.records, key)
			continue
		}
		result = append(result, cookie)
	}
	return result
}
