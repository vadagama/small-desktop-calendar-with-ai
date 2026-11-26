package main

import (
	"errors"
	"strings"
	"testing"
)

func TestDesktopLinksOpenAndCopy(t *testing.T) {
	var opened, copied string
	service := &SmallService{
		openExternal:   func(link string) error { opened = link; return nil },
		writeClipboard: func(link string) bool { copied = link; return true },
	}
	const conference = "https://conference.example.test/meeting?source=calendar#join"
	const event = "https://team.small.kz/calendar#event-orig-fixture-2099-10-29"
	if reply := service.OpenLink(conference); !reply.OK || opened != conference {
		t.Fatalf("open: %#v, opened %q", reply, opened)
	}
	if reply := service.CopyLink(event); !reply.OK || copied != event {
		t.Fatalf("copy: %#v, copied %q", reply, copied)
	}
}

func TestDesktopLinksRejectInvalidURLs(t *testing.T) {
	calls := 0
	service := &SmallService{
		openExternal:   func(string) error { calls++; return nil },
		writeClipboard: func(string) bool { calls++; return true },
	}
	for _, input := range []string{
		"", "//example.test/path", "http://example.test", "file:///tmp/fixture",
		"javascript:void(0)", "https://fixture:password@example.test",
		"https://", "https://example.test/a b", "https://example.test/a\nb",
		"https://example.test\\path", "https://example.test/%xy",
		"https://example.test/" + strings.Repeat("a", 4000),
	} {
		if open, copy := service.OpenLink(input), service.CopyLink(input); open.Kind != "invalid" || copy.Kind != "invalid" {
			t.Fatalf("accepted invalid URL %q", input)
		}
	}
	if calls != 0 {
		t.Fatalf("invalid URLs reached native actions %d times", calls)
	}
}

func TestDesktopLinksReportNativeFailures(t *testing.T) {
	service := &SmallService{
		openExternal:   func(string) error { return errors.New("browser unavailable") },
		writeClipboard: func(string) bool { return false },
	}
	const link = "https://example.test/"
	for _, reply := range []smallReply[struct{}]{service.OpenLink(link), service.CopyLink(link)} {
		if reply.OK || reply.Error == "" {
			t.Fatalf("native failure disappeared: %#v", reply)
		}
	}
}
