# Pomodoro Cage iOS App Scaffold

This folder contains the iOS app source for the Pomodoro companion that:

- syncs shared timer state from the Pomodoro API
- reads `cage`-compatible Screen Time selection payloads
- applies Screen Time shields during break periods
- shows break notifications
- offers a one-tap `현재 와이파이 사용하기` flow that auto-discovers the API server on the local network and saves the URL for reuse

This is the source scaffold only. To make it downloadable on an iPhone, open it in Xcode, add the app target and Screen Time extensions, then sign and archive it.

## Core API contract

- `GET /state`
- `GET /selection`
- `POST /selection`
- `POST /device/register`
- `POST /device/ping`
