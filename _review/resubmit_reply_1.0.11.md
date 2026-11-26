# App Review 답변 초안 — Auto Pomodoro macOS 1.0, Submission b6275b94
(App Store Connect → Resolution Center 에 붙여넣기. 빌드 1.0.11 처리 완료 후 attach → 이 답변과 함께 재제출)

---

Hello,

Thank you for the detailed crash logs. We have identified and fixed both issues in build **1.0.11**.

**Guideline 2.1(a) — Crash on launch**
The crash (`FATAL:mach_port_rendezvous.cc — bootstrap_check_in ... Permission denied`) was
caused by a missing `com.apple.security.application-groups` entitlement. Our app is built on
Electron, whose internal inter-process communication registers a Mach service that the macOS
App Sandbox only permits when the app declares an application group. This entitlement had been
removed in a previous update while we were trimming unused entitlements, which is why the
sandboxed Mac App Store build failed to launch even though our development build ran normally.

Build 1.0.11 restores the `com.apple.security.application-groups` entitlement (and the matching
App Group in our provisioning profile). We verified the fix by running the signed, sandboxed
build directly on macOS — it now launches without the crash.

**Guideline 1.5 — Support URL**
The Support URL is now live and functional:
https://delight0517.github.io/releasepilot-reports/support/
It provides a contact email, FAQ, and refund guidance.

We appreciate your patience. Please let us know if anything else is needed.
