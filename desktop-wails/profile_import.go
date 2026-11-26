package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

var electronHashName = regexp.MustCompile(`^[a-f0-9]{64}$`)
var electronCachePartition = regexp.MustCompile(`^[a-f0-9]{32}$`)

const electronSession = "small-auth-session-v1"
const electronTextLimit = 8 << 20

// Keep the allowlist independent of Chromium's userData layout. In particular,
// no browser storage, recordings, crash dumps or arbitrary files are imported.
func importProfileFile(name string) int64 {
	if !strings.ContainsRune(name, filepath.Separator) {
		switch name {
		case "agent-settings.json", "topic-rules.json", "llm-profiles.json", "reminders.json", "event-cache.dirty":
			return electronTextLimit
		}
		return 0
	}
	parent, base := filepath.Dir(name), filepath.Base(name)
	stem, ext := strings.TrimSuffix(base, filepath.Ext(base)), filepath.Ext(base)
	switch parent {
	case "assistant-templates":
		switch base {
		case "welcome.md", "people.md", "slots.md", "draft.md", "suggestions.md":
			return electronTextLimit
		}
	case "local-vault":
		if base == "master.key" {
			return 32
		}
	case "local-vault/secrets":
		if ext == ".enc" && electronHashName.MatchString(stem) {
			return cacheMaxSize + 32
		}
	case "participant-memory", "event-mutations", "series-mutations":
		if ext == ".json" && electronHashName.MatchString(stem) {
			return electronTextLimit
		}
	case "meeting-operations":
		if (ext == ".intent" || ext == ".result") && electronHashName.MatchString(stem) {
			return electronTextLimit
		}
	case "voice":
		switch base {
		case "source.json":
			return electronTextLimit
		case "ggml-large-v3-turbo.bin", "ggml-large-v3-turbo.bin.part":
			return 1624555275
		}
	default:
		if filepath.Dir(parent) == "event-cache" && electronCachePartition.MatchString(filepath.Base(parent)) &&
			ext == ".json" && electronHashName.MatchString(stem) {
			return electronTextLimit
		}
	}
	return 0
}

func importProfileDirectory(name string) bool {
	switch name {
	case "assistant-templates", "local-vault", "local-vault/secrets", "participant-memory", "event-mutations", "series-mutations", "meeting-operations", "voice", "event-cache":
		return true
	}
	return filepath.Dir(name) == "event-cache" && electronCachePartition.MatchString(filepath.Base(name))
}

func profileOwned(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && stat.Uid == uint32(os.Getuid())
}

func importElectronProfile(source, target string) error {
	source, err := filepath.Abs(source)
	if err != nil {
		return err
	}
	target, err = filepath.Abs(target)
	if err != nil {
		return err
	}
	source, err = filepath.EvalSymlinks(source)
	if err != nil {
		return errors.New("не удалось открыть профиль Electron")
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(target))
	if err != nil {
		return errors.New("родительский каталог профиля Wails должен существовать")
	}
	target = filepath.Join(parent, filepath.Base(target))
	if rel, err := filepath.Rel(source, target); err != nil || rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))) {
		return errors.New("выберите каталог Wails вне профиля Electron")
	}
	if _, err := os.Lstat(target); !errors.Is(err, os.ErrNotExist) {
		return errors.New("профиль Wails уже существует или недоступен")
	}
	root, err := os.OpenRoot(source)
	if err != nil {
		return errors.New("не удалось открыть профиль Electron")
	}
	defer root.Close()
	info, err := root.Stat(".")
	if err != nil || !profileOwned(info) {
		return errors.New("профиль Electron должен принадлежать текущему пользователю")
	}
	for ancestor := parent; ; ancestor = filepath.Dir(ancestor) {
		directory, err := os.Stat(ancestor)
		if err != nil {
			return errors.New("не удалось проверить путь назначения")
		}
		if os.SameFile(info, directory) {
			return errors.New("выберите каталог Wails вне профиля Electron")
		}
		if ancestor == filepath.Dir(ancestor) {
			break
		}
	}
	stage, err := os.MkdirTemp(parent, ".small-calendar-import-")
	if err != nil {
		return errors.New("не удалось создать временный каталог Wails")
	}
	defer os.RemoveAll(stage)

	count, err := copyElectronProfile(root, stage, ".")
	if err != nil {
		return err
	}
	if count == 0 {
		return errors.New("в каталоге нет сохранённых данных Small Calendar")
	}
	if err := importElectronSession(root, stage); err != nil {
		return err
	}
	if err := syncProfileDirectory(stage); err != nil {
		return errors.New("не удалось сохранить данные профиля Wails")
	}
	if err := unix.RenamexNp(stage, target, unix.RENAME_EXCL); err != nil {
		return errors.New("не удалось опубликовать новый профиль Wails")
	}
	if err := syncProfileDirectory(parent); err != nil {
		return errors.New("профиль создан, но системное подтверждение записи каталога не получено")
	}
	return nil
}

func syncProfileDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func copyElectronProfile(source *os.Root, stage, directory string) (int, error) {
	listed, err := source.Lstat(directory)
	if err != nil || !listed.IsDir() {
		return 0, errors.New("недопустимый каталог профиля Electron")
	}
	current, err := source.OpenFile(directory, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_DIRECTORY, 0)
	if err != nil {
		return 0, err
	}
	defer current.Close()
	info, err := current.Stat()
	if err != nil || !profileOwned(info) || !os.SameFile(listed, info) {
		return 0, errors.New("недоступен каталог профиля Electron")
	}
	entries, err := current.ReadDir(-1)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, item := range entries {
		name := filepath.Join(directory, item.Name())
		switch {
		case importProfileDirectory(name):
			destination := filepath.Join(stage, name)
			if err := os.Mkdir(destination, 0700); err != nil {
				return 0, err
			}
			nested, err := copyElectronProfile(source, stage, name)
			if err != nil {
				return 0, err
			}
			if err := syncProfileDirectory(destination); err != nil {
				return 0, err
			}
			count += nested
		case importProfileFile(name) > 0:
			if name != electronSecretPath(electronSession) {
				if err := copyElectronFile(source, stage, name, importProfileFile(name)); err != nil {
					return 0, fmt.Errorf("не удалось перенести файл профиля: %w", err)
				}
			}
			count++
		}
	}
	after, err := current.Stat()
	if err != nil || !after.ModTime().Equal(info.ModTime()) {
		return 0, errors.New("профиль Electron изменился во время импорта")
	}
	return count, nil
}

func openElectronProfileFile(source *os.Root, name string, limit int64) (*os.File, os.FileInfo, error) {
	listed, err := source.Lstat(name)
	if err != nil {
		return nil, nil, err
	}
	if !listed.Mode().IsRegular() {
		return nil, nil, errors.New("недопустимый файл профиля Electron")
	}
	file, err := source.OpenFile(name, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > limit || !profileOwned(info) || !os.SameFile(listed, info) {
		file.Close()
		return nil, nil, errors.New("недопустимый файл профиля Electron")
	}
	return file, info, nil
}

func copyElectronFile(source *os.Root, stage, name string, limit int64) error {
	input, info, err := openElectronProfileFile(source, name, limit)
	if err != nil {
		return errors.New("источник недоступен или имеет неподдерживаемый тип")
	}
	defer input.Close()
	path := filepath.Join(stage, name)
	output, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return errors.New("не удалось записать копию")
	}
	n, copyErr := io.Copy(output, io.LimitReader(input, limit+1))
	err = errors.Join(copyErr, output.Sync(), output.Close())
	after, statErr := input.Stat()
	if err != nil {
		return errors.New("не удалось сохранить копию")
	}
	if statErr != nil || n != info.Size() || !after.ModTime().Equal(info.ModTime()) || after.Size() != info.Size() {
		return errors.New("файл Electron изменился во время импорта")
	}
	return os.Chtimes(path, info.ModTime(), info.ModTime())
}
