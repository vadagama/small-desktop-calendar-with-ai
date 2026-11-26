package main

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa -framework WebKit -framework UserNotifications
#include <stdbool.h>
#include <stdlib.h>

bool smallSecureWebView(void *window);
void smallSetCaptureEnabled(bool enabled);
bool smallNotificationDelivered(const char *identifier);
*/
import "C"

import (
	"sync/atomic"
	"unsafe"
)

var nativeVoice atomic.Pointer[VoiceService]

//export smallVoiceNavigationStarted
func smallVoiceNavigationStarted() {
	if service := nativeVoice.Load(); service != nil {
		service.release()
	}
}

func secureWebView(window unsafe.Pointer) bool { return bool(C.smallSecureWebView(window)) }
func setCaptureEnabled(enabled bool)           { C.smallSetCaptureEnabled(C.bool(enabled)) }
func notificationDelivered(id string) bool {
	value := C.CString(id)
	defer C.free(unsafe.Pointer(value))
	return bool(C.smallNotificationDelivered(value))
}
