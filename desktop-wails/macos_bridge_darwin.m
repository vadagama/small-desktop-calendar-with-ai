#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <UserNotifications/UserNotifications.h>
#import <objc/runtime.h>
#include <stdatomic.h>

static atomic_bool captureEnabled;
static char smallDelegateKey;
static __weak WKWebView *smallWebView;
extern void smallVoiceNavigationStarted(void);

static BOOL isLocalPage(NSURL *url) {
    return [url.scheme isEqualToString:@"wails"] &&
        [url.host isEqualToString:@"localhost"] &&
        [url.path isEqualToString:@"/"];
}

@interface SmallWebViewDelegate : NSObject <WKUIDelegate, WKNavigationDelegate>
@property (nonatomic, strong) id<WKUIDelegate> previousUI;
@property (nonatomic, strong) id<WKNavigationDelegate> previousNavigation;
@end

@implementation SmallWebViewDelegate
- (BOOL)respondsToSelector:(SEL)selector {
    return [super respondsToSelector:selector] ||
        [self.previousUI respondsToSelector:selector] ||
        [self.previousNavigation respondsToSelector:selector];
}
- (id)forwardingTargetForSelector:(SEL)selector {
    if ([self.previousUI respondsToSelector:selector]) return self.previousUI;
    if ([self.previousNavigation respondsToSelector:selector]) return self.previousNavigation;
    return [super forwardingTargetForSelector:selector];
}
- (void)webView:(WKWebView *)webView requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)origin
    initiatedByFrame:(WKFrameInfo *)frame type:(WKMediaCaptureType)type
    decisionHandler:(void (^)(WKPermissionDecision))reply API_AVAILABLE(macos(12.0)) {
    BOOL permitted = atomic_load(&captureEnabled) && frame.isMainFrame &&
        type == WKMediaCaptureTypeMicrophone && [origin.protocol isEqualToString:@"wails"] &&
        [origin.host isEqualToString:@"localhost"] && isLocalPage(frame.request.URL) &&
        isLocalPage(webView.URL);
    reply(permitted ? WKPermissionDecisionPrompt : WKPermissionDecisionDeny);
}
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action
    decisionHandler:(void (^)(WKNavigationActionPolicy))reply {
    if (!action.targetFrame || !action.targetFrame.isMainFrame || !isLocalPage(action.request.URL)) {
        reply(WKNavigationActionPolicyCancel);
        return;
    }
    if ([self.previousNavigation respondsToSelector:_cmd]) {
        [self.previousNavigation webView:webView decidePolicyForNavigationAction:action decisionHandler:reply];
        return;
    }
    reply(WKNavigationActionPolicyAllow);
}
- (void)webView:(WKWebView *)webView didStartProvisionalNavigation:(WKNavigation *)navigation {
    smallVoiceNavigationStarted();
    if ([self.previousNavigation respondsToSelector:_cmd])
        [self.previousNavigation webView:webView didStartProvisionalNavigation:navigation];
}
@end

static WKWebView *findWebView(NSView *view) {
    if ([view isKindOfClass:WKWebView.class]) return (WKWebView *)view;
    for (NSView *child in view.subviews) {
        WKWebView *found = findWebView(child);
        if (found) return found;
    }
    return nil;
}

bool smallSecureWebView(void *handle) {
    NSWindow *window = (__bridge NSWindow *)handle;
    WKWebView *webView = findWebView(window.contentView);
    if (!webView) return false;
    if (!objc_getAssociatedObject(webView, &smallDelegateKey)) {
        SmallWebViewDelegate *delegate = [SmallWebViewDelegate new];
        delegate.previousUI = webView.UIDelegate;
        delegate.previousNavigation = webView.navigationDelegate;
        objc_setAssociatedObject(webView, &smallDelegateKey, delegate, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        webView.UIDelegate = delegate;
        webView.navigationDelegate = delegate;
    }
    smallWebView = webView;
    return true;
}

void smallSetCaptureEnabled(bool enabled) {
    atomic_store(&captureEnabled, enabled);
    if (!enabled) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (@available(macOS 12.0, *)) {
                [smallWebView setMicrophoneCaptureState:WKMediaCaptureStateNone completionHandler:^{}];
            }
        });
    }
}

bool smallNotificationDelivered(const char *identifier) {
    if (!NSBundle.mainBundle.bundleIdentifier) return false;
    NSString *target = [NSString stringWithUTF8String:identifier];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block bool found = false;
    [UNUserNotificationCenter.currentNotificationCenter getDeliveredNotificationsWithCompletionHandler:^(NSArray<UNNotification *> *notifications) {
        for (UNNotification *notification in notifications) {
            if ([notification.request.identifier isEqualToString:target]) {
                found = true;
                break;
            }
        }
        dispatch_semaphore_signal(done);
    }];
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC))) return false;
    return found;
}
