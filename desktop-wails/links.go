package main

import (
	"net/url"
	"strings"
	"unicode"
)

func httpsLink(raw string) string {
	if len(raw) > 4000 || strings.ContainsRune(raw, '\\') ||
		strings.ContainsFunc(raw, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) {
		return ""
	}
	link, err := url.Parse(raw)
	if err != nil || link.Scheme != "https" || link.Hostname() == "" || link.User != nil {
		return ""
	}
	return link.String()
}

func (s *SmallService) OpenLink(raw string) smallReply[struct{}] {
	link := httpsLink(raw)
	if link == "" {
		return failure[struct{}]("invalid", "Доступны только корректные HTTPS-ссылки.")
	}
	if s.openExternal == nil || s.openExternal(link) != nil {
		return failure[struct{}]("network", "Не удалось открыть ссылку в браузере.")
	}
	return smallReply[struct{}]{OK: true}
}

func (s *SmallService) CopyLink(raw string) smallReply[struct{}] {
	link := httpsLink(raw)
	if link == "" {
		return failure[struct{}]("invalid", "Доступны только корректные HTTPS-ссылки.")
	}
	if s.writeClipboard == nil || !s.writeClipboard(link) {
		return failure[struct{}]("network", "Не удалось записать ссылку в буфер обмена.")
	}
	return smallReply[struct{}]{OK: true}
}
