# Dependency lifecycle safety

M-Oasis task `pomodoro-install-lifecycle-safety-20261103` adopts the existing
2026-10-01 removal of automatic Electron re-signing. The old `postinstall`
hook and `scripts/fix-electron-gatekeeper.sh` must remain absent: installing
dependencies is not authorization to force-sign or launch a blocked runtime.

The focused check, `node --test test/installLifecycleSafety.test.js`, invokes
npm's actual postinstall event in a temporary fixture using the candidate
package scripts. An inert control writes a marker and exits 77, proving
that npm would execute a restored hook; the candidate exits successfully
without invoking that control. The fixture, npm cache and logs are removed
in `finally`, including on assertion failure. No dependency installation,
network service, codesign, Gatekeeper change or app launch occurs.

This source change does not re-sign, repair, install or validate the current
Electron bundle or installed Auto Pomodoro. The supported verified startup
and signed build paths keep their separate verification requirements.
The mixed working package's independent version, dependency, feature and
signing changes remain outside this integration.
