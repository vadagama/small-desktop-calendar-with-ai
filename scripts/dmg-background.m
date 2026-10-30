#import <AppKit/AppKit.h>

static void label(NSString *text, CGFloat y, CGFloat size, NSColor *color, BOOL bold) {
  NSMutableParagraphStyle *paragraph = [NSMutableParagraphStyle new];
  paragraph.alignment = NSTextAlignmentCenter;
  [text drawInRect:NSMakeRect(24, y, 592, 32) withAttributes:@{
    NSFontAttributeName: bold ? [NSFont boldSystemFontOfSize:size] : [NSFont systemFontOfSize:size],
    NSForegroundColorAttributeName: color,
    NSParagraphStyleAttributeName: paragraph
  }];
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 1;
    // Finder uses points; the bitmap is rendered at 2x for Retina.
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc]
      initWithBitmapDataPlanes:NULL pixelsWide:1280 pixelsHigh:800
      bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO
      colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
    bitmap.size = NSMakeSize(640, 400);
    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap]];
    [[NSColor colorWithCalibratedWhite:0.97 alpha:1] setFill];
    NSRectFill(NSMakeRect(0, 0, 640, 400));
    label(@"Small Calendar", 328, 18, NSColor.blackColor, YES);
    label(@"Перетащите приложение в папку «Программы»", 296, 14, NSColor.darkGrayColor, NO);
    label(@"→", 177, 30, [NSColor colorWithCalibratedWhite:0.6 alpha:1], NO);
    label(@"Затем откройте Small Calendar из «Программ»", 58, 13, NSColor.darkGrayColor, NO);
    label(@"Календарь команды · AI-ассистент", 26, 11, NSColor.grayColor, NO);
    [NSGraphicsContext restoreGraphicsState];
    NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    return [png writeToFile:[NSString stringWithUTF8String:argv[1]] atomically:YES] ? 0 : 1;
  }
}
