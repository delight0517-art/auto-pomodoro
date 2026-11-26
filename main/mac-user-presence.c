#include <ApplicationServices/ApplicationServices.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static double hid_idle_seconds(void) {
  return CGEventSourceSecondsSinceLastEventType(
    kCGEventSourceStateHIDSystemState, kCGAnyInputEventType);
}

static int display_is_awake(void) {
  CGDirectDisplayID displays[16];
  uint32_t count = 0;
  if (CGGetOnlineDisplayList(16, displays, &count) != kCGErrorSuccess) return 0;
  for (uint32_t i = 0; i < count; i++) {
    if (CGDisplayIsActive(displays[i]) && !CGDisplayIsAsleep(displays[i])) return 1;
  }
  return 0;
}

static int watch_hardware_input(void) {
  double last_report = 0;
  for (;;) {
    const double now = CFAbsoluteTimeGetCurrent() + kCFAbsoluteTimeIntervalSince1970;
    const double idle = hid_idle_seconds();
    // On startup/restart, recover the timestamp of recent real HID input even
    // if the watcher missed the original 2.5-second edge. The parent accepts
    // only timestamps no older than 90 seconds and anchors the lock to that
    // actual input time.
    if (isfinite(idle) && idle >= 0 && idle < 90.0 && now - last_report >= 15) {
      printf("HUMAN %.0f\n", (now - idle) * 1000.0);
      fflush(stdout);
      last_report = now;
    }
    usleep(250000);
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc > 1 && strcmp(argv[1], "--watch") == 0) return watch_hardware_input();
  CGDirectDisplayID displays[16];
  uint32_t count = 0;
  if (CGGetOnlineDisplayList(16, displays, &count) != kCGErrorSuccess) return 2;
  int awake = 0;
  for (uint32_t i = 0; i < count; i++) {
    if (CGDisplayIsActive(displays[i]) && !CGDisplayIsAsleep(displays[i])) awake = 1;
  }
  double idle = hid_idle_seconds();
  if (!isfinite(idle) || idle < 0) return 3;
  printf("{\"displayAwake\":%s,\"hidIdleSeconds\":%.3f}\n", awake ? "true" : "false", idle);
  return 0;
}
