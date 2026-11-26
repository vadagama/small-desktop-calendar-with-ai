package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

type notificationState struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

type NotificationService struct {
	native *notifications.NotificationService
	show   func()
	join   func(string)
	once   sync.Once
	ready  atomic.Bool
	err    error
	mu     sync.Mutex
	last   notificationState
	testID string
}

func (n *NotificationService) initialize() error {
	n.once.Do(func() {
		n.err = n.native.ServiceStartup(context.Background(), application.ServiceOptions{})
		if n.err != nil {
			return
		}
		for _, category := range []notifications.NotificationCategory{
			{ID: "small-reminder", Actions: []notifications.NotificationAction{{ID: "join", Title: "Подключиться"}}},
			{ID: "small-test", Actions: []notifications.NotificationAction{{ID: "show", Title: "Открыть календарь"}}},
		} {
			if n.err = n.native.RegisterNotificationCategory(category); n.err != nil {
				return
			}
		}
		n.native.OnNotificationResponse(func(result notifications.NotificationResult) {
			if result.Error != nil {
				return
			}
			response := result.Response
			switch response.ActionIdentifier {
			case "join":
				if response.CategoryID == "small-reminder" {
					go n.join(response.ID)
				}
			case "show", notifications.DefaultActionIdentifier:
				go n.show()
				n.mu.Lock()
				if response.ID != "" && response.ID == n.testID {
					n.last = notificationState{"opened", "Действие уведомления выполнено: открыт локальный календарь Small."}
				}
				n.mu.Unlock()
			}
		})
		n.ready.Store(true)
	})
	return n.err
}

func (n *NotificationService) remove(id string) {
	if !n.ready.Load() {
		return
	}
	// The Wails RemoveNotification method is a no-op on Darwin.
	_ = n.native.RemovePendingNotification(id)
	_ = n.native.RemoveDeliveredNotification(id)
}

func (n *NotificationService) notify(id string, event reminderEvent) error {
	if err := n.initialize(); err != nil {
		return err
	}
	if allowed, err := n.native.CheckNotificationAuthorization(); err != nil || !allowed {
		return errors.New("notification authorization is unavailable")
	}
	format := func(at time.Time) string { return at.In(smallZone).Format("02.01.06, 15:04") }
	organizer := event.Organizer
	if organizer == "" {
		organizer = "не указан"
	}
	options := notifications.NotificationOptions{
		ID: id, Title: event.Title, Subtitle: format(event.StartsAt) + " — " + format(event.EndsAt) + " · Asia/Almaty",
		Body: "Организатор: " + organizer,
	}
	if meetingURL(event.Location) != "" {
		options.CategoryID = "small-reminder"
	} else {
		options.Body += "\nСсылка на встречу отсутствует"
	}
	return n.native.SendNotificationWithActions(options)
}

func (n *NotificationService) Invoke(action string) notificationState {
	failed := notificationState{"failed", "Системные уведомления недоступны. Проверьте разрешения macOS и запустите установленную сборку " + appName + "."}
	switch action {
	case "settings":
		if application.Get().Browser.OpenFile("/System/Applications/System Settings.app") != nil {
			return failed
		}
	case "test":
		n.mu.Lock()
		if n.last.Status == "waiting" {
			n.mu.Unlock()
			return n.state()
		}
		var random [16]byte
		if _, err := rand.Read(random[:]); err != nil {
			n.mu.Unlock()
			return failed
		}
		id, previous := hex.EncodeToString(random[:]), n.testID
		n.testID = id
		n.last = notificationState{"waiting", "Ожидаем подтверждения macOS. Если уведомления нет, разрешите уведомления для " + appName + " в настройках системы."}
		n.mu.Unlock()
		if n.initialize() != nil {
			n.fail(id, failed)
		} else if allowed, err := n.native.RequestNotificationAuthorization(); err != nil || !allowed {
			n.fail(id, failed)
		} else {
			if previous != "" {
				n.remove(previous)
			}
			if n.native.SendNotificationWithActions(notifications.NotificationOptions{
				ID: id, Title: appName + " — проверка", Body: "Тест доставки. Кнопка откроет приложение " + appName + ".", CategoryID: "small-test",
			}) != nil {
				n.fail(id, failed)
			} else {
				time.AfterFunc(12*time.Second, func() {
					if !notificationDelivered(id) {
						n.fail(id, failed)
					}
				})
			}
		}
	case "read":
	default:
		return failed
	}
	return n.state()
}

func (n *NotificationService) fail(id string, message notificationState) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if id == n.testID && n.last.Status == "waiting" {
		n.last = message
	}
}

func (n *NotificationService) state() notificationState {
	n.mu.Lock()
	id, state := n.testID, n.last
	n.mu.Unlock()
	if id != "" && state.Status == "waiting" && notificationDelivered(id) {
		n.mu.Lock()
		if n.testID == id && n.last.Status == "waiting" {
			n.last = notificationState{"delivered", "macOS подтвердила уведомление в Центре уведомлений. Баннер может быть скрыт режимом фокусирования."}
		}
		state = n.last
		n.mu.Unlock()
	}
	if state.Status == "" {
		return notificationState{"untested", "Проверка доставки ещё не выполнялась."}
	}
	return state
}
