package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
)

func TestMeetingAttachmentUpload(t *testing.T) {
	var uploads atomic.Int32
	claims := base64.RawURLEncoding.EncodeToString([]byte(`{"uid":"account","name":"Fixture","preferred_username":"fixture"}`))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/gate/auth/login":
			fmt.Fprintf(w, `{"data":{"access_token":"header.%s.signature"}}`, claims)
		case "/gate/team/api/user/info":
			fmt.Fprint(w, `{"data":{}}`)
		case "/gate/team/api/attachments":
			uploads.Add(1)
			if err := r.ParseMultipartForm(attachmentLimit + 1024); err != nil {
				t.Error("attachment is not multipart")
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			defer r.MultipartForm.RemoveAll()
			file, header, err := r.FormFile("file")
			if err != nil {
				t.Error(err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			defer file.Close()
			data, _ := io.ReadAll(file)
			if header.Filename != "fixture.txt" || string(data) != "synthetic" || r.FormValue("is_public") != "true" {
				t.Error("unexpected attachment request")
			}
			fmt.Fprint(w, `{"data":{"id":12}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	s := newSmallService(server.URL)
	ctx := context.Background()
	if r := s.Login(ctx, smallCredentials{"fixture", "synthetic"}); !r.OK {
		t.Fatalf("login: %+v", r)
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "fixture.txt")
	if err := os.WriteFile(path, []byte("synthetic"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link.txt")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	s.chooseAttachments = func() ([]string, error) { return []string{link}, nil }
	if r := s.Attach(ctx, 1); r.OK || uploads.Load() != 0 {
		t.Fatalf("symlink must not upload: %+v", r)
	}
	s.chooseAttachments = func() ([]string, error) { return []string{path}, nil }
	if r := s.Attach(ctx, 1); !r.OK || len(r.Files) != 1 || r.Files[0].ID != "12" || !s.uploadedAttachments["12"] {
		t.Fatalf("upload: %+v", r)
	}
}
