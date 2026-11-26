package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type VoiceService struct {
	host       *AssistantService
	secure     func() bool
	mu         sync.Mutex
	id         string
	processing bool
	generation uint64
	timer      *time.Timer
}

func whisperExecutable() string {
	if bin, err := os.Executable(); err == nil {
		path := filepath.Join(filepath.Dir(bin), "..", "Resources", "voice", "whisper-cli")
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() && info.Mode()&0111 != 0 {
			return path
		}
	}
	return ""
}

func (v *VoiceService) releaseLocked() {
	v.generation++
	v.id = ""
	v.processing = false
	if v.timer != nil {
		v.timer.Stop()
		v.timer = nil
	}
	setCaptureEnabled(false)
}

func (v *VoiceService) release() {
	v.mu.Lock()
	id := v.id
	v.releaseLocked()
	v.mu.Unlock()
	if id != "" {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			input, _ := json.Marshal(map[string]string{"action": "cancel", "sessionId": id})
			_, _ = v.host.call(ctx, "voice.request", input)
		}()
	}
}

func (v *VoiceService) Request(ctx context.Context, input json.RawMessage) json.RawMessage {
	const maxPCM = 10_240_000
	unavailable := json.RawMessage(`{"ok":false,"error":"Голосовой ввод недоступен. Повторите запрос."}`)
	invalid := json.RawMessage(`{"ok":false,"error":"Некорректный запрос голосового ввода"}`)
	var q struct {
		Action string `json:"action"`
		ID     string `json:"sessionId"`
	}
	if len(input) > maxPCM+256 || json.Unmarshal(input, &q) != nil ||
		(q.Action != "transcribe" && len(input) > 8<<10) {
		return invalid
	}
	ctx, cancel := context.WithTimeout(ctx, 70*time.Second)
	defer cancel()
	v.mu.Lock()
	if q.Action == "transcribe" && (q.ID == "" || q.ID != v.id || v.processing) {
		v.mu.Unlock()
		return invalid
	}
	generation := v.generation
	if q.Action == "begin" {
		if len(q.ID) != 36 || v.id != "" || !v.secure() {
			v.mu.Unlock()
			return unavailable
		}
		v.id = q.ID
	} else if q.ID == v.id && v.id != "" {
		if q.Action == "cancel" {
			v.releaseLocked()
		} else if q.Action == "transcribe" {
			v.processing = true
			setCaptureEnabled(false)
		}
	}
	v.mu.Unlock()
	result, err := v.host.call(ctx, "voice.request", input)
	if q.Action == "begin" {
		var reply struct {
			OK bool `json:"ok"`
		}
		v.mu.Lock()
		if v.generation != generation || v.id != q.ID {
			v.mu.Unlock()
			cancelInput, _ := json.Marshal(map[string]string{"action": "cancel", "sessionId": q.ID})
			_, _ = v.host.call(ctx, "voice.request", cancelInput)
			return unavailable
		}
		if err == nil && json.Unmarshal(result, &reply) == nil && reply.OK {
			setCaptureEnabled(true)
			v.timer = time.AfterFunc(190*time.Second, func() {
				v.mu.Lock()
				defer v.mu.Unlock()
				if v.generation == generation {
					v.releaseLocked()
				}
			})
		} else {
			v.releaseLocked()
		}
		v.mu.Unlock()
	}
	if q.Action == "transcribe" {
		v.mu.Lock()
		if v.generation == generation && q.ID == v.id && v.id != "" {
			v.releaseLocked()
		}
		v.mu.Unlock()
	}
	if err != nil {
		return unavailable
	}
	return result
}
