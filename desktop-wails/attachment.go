package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"syscall"
)

const attachmentLimit = 10 << 20

type selectedAttachment struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type attachmentReply struct {
	OK    bool                 `json:"ok"`
	Files []selectedAttachment `json:"files"`
	Error string               `json:"error,omitempty"`
}

func attachmentFailure(message string) attachmentReply {
	return attachmentReply{Error: message}
}

func (s *SmallService) Attach(ctx context.Context, remaining int) attachmentReply {
	if remaining < 1 || remaining > 5 || s.chooseAttachments == nil {
		return attachmentFailure("Достигнут лимит файлов или выбор файлов недоступен.")
	}
	s.mu.Lock()
	auth := s.read(ctx)
	session := s.csrf
	s.mu.Unlock()
	if !auth.OK || auth.State.Profile == nil {
		return attachmentFailure("Войдите в Small.")
	}
	paths, err := s.chooseAttachments()
	if err != nil || len(paths) > remaining {
		return attachmentFailure("Не удалось выбрать файлы или превышен лимит.")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.csrf != session || s.profile.ID != auth.State.Profile.ID || s.token == "" {
		return attachmentFailure("Аккаунт Small изменился.")
	}
	for _, path := range paths {
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > attachmentLimit {
			return attachmentFailure("Каждый файл должен быть от 1 байта до 10 МБ.")
		}
	}
	files := make([]selectedAttachment, 0, len(paths))
	for _, path := range paths {
		fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
		if err != nil {
			return attachmentFailure("Не удалось прочитать выбранный файл.")
		}
		file := os.NewFile(uintptr(fd), path)
		info, statErr := file.Stat()
		var data []byte
		if statErr == nil && info.Mode().IsRegular() && info.Size() <= attachmentLimit {
			data, err = io.ReadAll(io.LimitReader(file, attachmentLimit+1))
		}
		_ = file.Close()
		if err != nil || len(data) == 0 || len(data) > attachmentLimit {
			return attachmentFailure("Каждый файл должен быть от 1 байта до 10 МБ.")
		}
		name := filepath.Base(path)
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		part, err := form.CreateFormFile("file", name)
		if err != nil {
			return attachmentFailure("Не удалось подготовить файл.")
		}
		_, _ = part.Write(data)
		_ = form.WriteField("is_public", "true")
		_ = form.Close()
		status, raw, err := s.requestWithContentType(ctx, http.MethodPost, "/gate/team/api/attachments", body.Bytes(), form.FormDataContentType())
		var reply struct {
			Data struct {
				ID json.RawMessage `json:"id"`
			} `json:"data"`
		}
		if err != nil || status < 200 || status >= 300 || json.Unmarshal(raw, &reply) != nil {
			return attachmentFailure("Не удалось загрузить файл. Автоматический повтор не выполнялся.")
		}
		id := invitationID(reply.Data.ID)
		if !smallID.MatchString(id) {
			return attachmentFailure("Small вернул неизвестный формат файла.")
		}
		s.uploadedAttachments[id] = true
		files = append(files, selectedAttachment{ID: id, Name: name})
	}
	return attachmentReply{OK: true, Files: files}
}
