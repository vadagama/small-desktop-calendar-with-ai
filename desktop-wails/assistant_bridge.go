package main

import (
	"bufio"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

//go:embed all:assistant-dist
var assistantAssets embed.FS

const assistantFrameLimit = 16 << 20

var errAssistantSessionChanged = errors.New("assistant request invalidated")

type assistantFrame struct {
	Type   string          `json:"type"`
	ID     uint64          `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Name   string          `json:"name,omitempty"`
	Input  json.RawMessage `json:"input,omitempty"`
	Data   json.RawMessage `json:"data,omitempty"`
}

type assistantProcess struct {
	cmd     *exec.Cmd
	input   io.WriteCloser
	dir     string
	done    chan struct{}
	writeMu sync.Mutex
	mu      sync.Mutex
	pending map[uint64]chan json.RawMessage
}

func (p *assistantProcess) kill() {
	_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL)
}

func (p *assistantProcess) write(frame assistantFrame) error {
	raw, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	if len(raw) > assistantFrameLimit {
		return errors.New("assistant message too large")
	}
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if pipe, ok := p.input.(*os.File); ok {
		if err := pipe.SetWriteDeadline(time.Now().Add(3 * time.Second)); err != nil {
			p.kill()
			return err
		}
	}
	_, err = p.input.Write(append(raw, '\n'))
	if err != nil {
		// A partially written frame cannot be safely reused.
		p.kill()
	}
	return err
}

type AssistantService struct {
	small     *SmallService
	profile   string
	synthetic bool
	whisper   string
	emit      func(string, json.RawMessage)

	mu         sync.Mutex
	process    *assistantProcess
	stopped    bool
	active     string
	nextID     atomic.Uint64
	generation uint64
}

func nodeExecutable() (string, error) {
	bin, err := os.Executable()
	if err == nil {
		node := filepath.Join(filepath.Dir(bin), "..", "Resources", "node")
		if info, statErr := os.Stat(node); statErr == nil && info.Mode().IsRegular() && info.Mode()&0111 != 0 {
			return node, nil
		}
	}
	return exec.LookPath("node")
}

func (a *AssistantService) startProcess() (*assistantProcess, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.stopped {
		return nil, errors.New("assistant closed")
	}
	if a.process != nil {
		return a.process, nil
	}
	node, err := nodeExecutable()
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "small-wails-assistant-")
	if err != nil {
		return nil, err
	}
	assets, err := fs.Sub(assistantAssets, "assistant-dist")
	if err == nil {
		err = os.CopyFS(dir, assets)
	}
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, err
	}
	cmd := exec.Command(node, filepath.Join(dir, "assistant-host.mjs"), a.profile, a.whisper)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Env = []string{"LANG=en_US.UTF-8"}
	if a.synthetic {
		cmd.Env = append(cmd.Env, "SMALL_WAILS_TEST_SYNTHETIC=1")
	}
	cmd.Stderr = io.Discard
	input, err := cmd.StdinPipe()
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		_ = input.Close()
		_ = os.RemoveAll(dir)
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		_ = input.Close()
		_ = output.Close()
		_ = os.RemoveAll(dir)
		return nil, err
	}
	p := &assistantProcess{cmd: cmd, input: input, dir: dir, done: make(chan struct{}), pending: make(map[uint64]chan json.RawMessage)}
	a.process = p
	go a.receive(p, output)
	return p, nil
}

func (a *AssistantService) receive(p *assistantProcess, output io.Reader) {
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 64<<10), assistantFrameLimit)
	for scanner.Scan() {
		var frame assistantFrame
		if json.Unmarshal(scanner.Bytes(), &frame) != nil {
			continue
		}
		switch frame.Type {
		case "reply":
			p.mu.Lock()
			if pending := p.pending[frame.ID]; pending != nil {
				delete(p.pending, frame.ID)
				pending <- frame.Data
			}
			p.mu.Unlock()
		case "event":
			a.forwardEvent(p, frame)
		case "call":
			go a.serviceCall(p, frame)
		}
	}
	_ = p.input.Close()
	p.kill()
	_ = p.cmd.Wait()
	_ = os.RemoveAll(p.dir)
	a.mu.Lock()
	active := ""
	if a.process == p {
		a.process = nil
		active, a.active = a.active, ""
	}
	a.mu.Unlock()
	close(p.done)
	if active != "" {
		a.emitAssistantError(active, "Ассистент остановился. Попробуйте ещё раз.")
	}
}

func (a *AssistantService) forwardEvent(p *assistantProcess, frame assistantFrame) {
	a.mu.Lock()
	if a.process != p || a.stopped {
		a.mu.Unlock()
		return
	}
	switch frame.Name {
	case "small:assistant":
		var event struct {
			RequestID string `json:"requestId"`
			Type      string `json:"type"`
		}
		if json.Unmarshal(frame.Data, &event) != nil || event.RequestID == "" || event.RequestID != a.active ||
			(event.Type != "chunk" && event.Type != "end") {
			a.mu.Unlock()
			return
		}
		if event.Type == "end" {
			a.active = ""
		}
	case "small:event-list", "small:availability":
		if a.active == "" {
			a.mu.Unlock()
			return
		}
	default:
		a.mu.Unlock()
		return
	}
	a.mu.Unlock()
	if a.emit != nil {
		a.emit(frame.Name, frame.Data)
	}
}

func (a *AssistantService) emitAssistantError(id, message string) {
	if a.emit == nil {
		return
	}
	chunk, _ := json.Marshal(map[string]any{"requestId": id, "type": "chunk", "chunk": map[string]string{"type": "error", "errorText": message}})
	end, _ := json.Marshal(map[string]string{"requestId": id, "type": "end"})
	a.emit("small:assistant", chunk)
	a.emit("small:assistant", end)
}

func (a *AssistantService) call(ctx context.Context, method string, input json.RawMessage) (json.RawMessage, error) {
	p, err := a.startProcess()
	if err != nil {
		return nil, err
	}
	return a.callProcess(ctx, p, method, input, nil)
}
func (a *AssistantService) callProcess(ctx context.Context, p *assistantProcess, method string, input json.RawMessage, generation *uint64) (json.RawMessage, error) {
	id := a.nextID.Add(1)
	result := make(chan json.RawMessage, 1)
	p.mu.Lock()
	if len(p.pending) >= 64 {
		p.mu.Unlock()
		return nil, errors.New("assistant queue full")
	}
	p.pending[id] = result
	p.mu.Unlock()
	defer func() { p.mu.Lock(); delete(p.pending, id); p.mu.Unlock() }()
	frame := assistantFrame{Type: "request", ID: id, Method: method, Input: input}
	var sendErr error
	if generation != nil {
		a.mu.Lock()
		if *generation != a.generation || p != a.process {
			sendErr = errAssistantSessionChanged
		} else {
			sendErr = p.write(frame)
		}
		a.mu.Unlock()
	} else {
		sendErr = p.write(frame)
	}
	if sendErr != nil {
		return nil, sendErr
	}
	select {
	case data := <-result:
		return data, nil
	case <-p.done:
		select {
		case data := <-result:
			return data, nil
		default:
			return nil, errors.New("assistant closed")
		}
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Invoke is the only renderer entry point. Worker-only calendar requests and
// memory revisions use the separate, private side of the subprocess protocol.
func (a *AssistantService) Invoke(ctx context.Context, method string, input json.RawMessage) json.RawMessage {
	switch method {
	case "assistant.start", "assistant.cancel", "availability.context", "availability.read", "availability.slots",
		"profiles.read", "profiles.save", "profiles.activate", "profiles.remove",
		"settings.read", "settings.save", "settings.reset",
		"memory.read", "memory.write", "memory.confirm", "memory.reset", "topics.read", "topics.save":
	default:
		return json.RawMessage(`{"ok":false,"error":"Операция ассистента недоступна"}`)
	}
	if len(input) > 512<<10 {
		return json.RawMessage(`{"ok":false,"error":"Запрос ассистенту слишком большой"}`)
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	startID := ""
	var generation uint64
	accountBound := strings.HasPrefix(method, "memory.") || strings.HasPrefix(method, "availability.")
	if accountBound {
		a.mu.Lock()
		generation = a.generation
		a.mu.Unlock()
	}
	if method == "assistant.start" {
		var q struct {
			RequestID string `json:"requestId"`
		}
		if json.Unmarshal(input, &q) != nil || len(q.RequestID) != 36 {
			return json.RawMessage(`{"ok":false,"error":"Некорректный запрос ассистенту"}`)
		}
		a.mu.Lock()
		if a.active != "" {
			a.mu.Unlock()
			return json.RawMessage(`{"ok":false,"error":"Дождитесь ответа или остановите запрос"}`)
		}
		startID, a.active, generation = q.RequestID, q.RequestID, a.generation
		a.mu.Unlock()
	}
	var data json.RawMessage
	var err error
	if startID == "" && !accountBound {
		data, err = a.call(ctx, method, input)
	} else if process, processErr := a.startProcess(); processErr == nil {
		data, err = a.callProcess(ctx, process, method, input, &generation)
	} else {
		err = processErr
	}
	if startID != "" {
		var reply struct {
			OK bool `json:"ok"`
		}
		if err != nil || json.Unmarshal(data, &reply) != nil || !reply.OK {
			a.mu.Lock()
			if a.active == startID {
				a.active = ""
			}
			a.mu.Unlock()
		}
	}
	if errors.Is(err, errAssistantSessionChanged) {
		kind := "unavailable"
		if strings.HasPrefix(method, "availability.") {
			kind = "auth"
		}
		response, _ := json.Marshal(map[string]any{"ok": false, "kind": kind, "error": "Аккаунт Small изменился. Повторите запрос."})
		return response
	}
	if err != nil {
		return json.RawMessage(`{"ok":false,"kind":"unavailable","error":"Локальный рантайм ассистента недоступен. Повторите запрос или проверьте Node.js."}`)
	}
	return data
}

func (a *AssistantService) reset() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.generation++
	p := a.process
	if p != nil {
		// Enqueue before the new account becomes visible. The host handles reset synchronously.
		_ = p.write(assistantFrame{Type: "request", ID: a.nextID.Add(1), Method: "session.reset"})
	}
}

func (a *AssistantService) memoryRevision(ctx context.Context, account string) (int, error) {
	raw, _ := json.Marshal(account)
	data, err := a.call(ctx, "memory.revision", raw)
	if err != nil {
		return 0, err
	}
	var revision *int
	if json.Unmarshal(data, &revision) != nil || revision == nil {
		return 0, errors.New("memory unavailable")
	}
	return *revision, nil
}

func (a *AssistantService) ServiceShutdown() error {
	a.mu.Lock()
	a.stopped = true
	p := a.process
	a.mu.Unlock()
	if p == nil {
		return nil
	}
	_ = p.input.Close()
	select {
	case <-p.done:
	case <-time.After(250 * time.Millisecond):
		p.kill()
		<-p.done
	}
	return nil
}
