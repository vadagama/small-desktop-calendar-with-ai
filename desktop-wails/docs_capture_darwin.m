//go:build docs_capture && darwin

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static WKWebView *docsWebView(NSView *view) {
    if ([view isKindOfClass:WKWebView.class]) return (WKWebView *)view;
    for (NSView *child in view.subviews) {
        WKWebView *found = docsWebView(child);
        if (found) return found;
    }
    return nil;
}

void ordoStartDocsCapture(const char *directory) {
    NSString *output = [NSString stringWithUTF8String:directory];
    dispatch_async(dispatch_get_main_queue(), ^{
        __block BOOL busy = NO;
        __block NSString *previous = @"";
        [NSTimer scheduledTimerWithTimeInterval:0.2 repeats:YES block:^(NSTimer *timer) {
            if (busy) return;
            WKWebView *view = nil;
            for (NSWindow *window in NSApp.windows) {
                view = docsWebView(window.contentView);
                if (view) break;
            }
            if (!view) return;
            busy = YES;
            [view evaluateJavaScript:@"(()=>{const d=document.querySelector('dialog[open]');const r=d?.getBoundingClientRect();return {name:window.__ordoCaptureName||'',rect:r?{x:r.x,y:r.y,w:r.width,h:r.height}:null}})()" completionHandler:^(id result, NSError *error) {
                NSString *name = [result isKindOfClass:NSDictionary.class] ? result[@"name"] : nil;
                if (error || ![name isKindOfClass:NSString.class] || [name length] == 0 || [name isEqual:previous]) {
                    busy = NO;
                    return;
                }
                WKSnapshotConfiguration *config = [WKSnapshotConfiguration new];
                config.rect = view.bounds;
                NSDictionary *rect = result[@"rect"];
                if ([rect isKindOfClass:NSDictionary.class]) config.rect = NSMakeRect([rect[@"x"] doubleValue], [rect[@"y"] doubleValue], [rect[@"w"] doubleValue], [rect[@"h"] doubleValue]);
                [view takeSnapshotWithConfiguration:config completionHandler:^(NSImage *image, NSError *snapshotError) {
                    if (image && !snapshotError) {
                        NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithData:image.TIFFRepresentation];
                        NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
                        [png writeToFile:[output stringByAppendingPathComponent:[name stringByAppendingString:@".png"]] atomically:YES];
                        previous = name;
                        NSData *encoded = [NSJSONSerialization dataWithJSONObject:name options:NSJSONWritingFragmentsAllowed error:nil];
                        NSString *json = [[NSString alloc] initWithData:encoded encoding:NSUTF8StringEncoding];
                        [view evaluateJavaScript:[@"window.__ordoCaptureDone=" stringByAppendingString:json] completionHandler:nil];
                    }
                    busy = NO;
                }];
            }];
        }];
    });
}
