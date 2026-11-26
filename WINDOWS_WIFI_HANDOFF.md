# Windows Desktop: One-Tap Wi-Fi Setup Handoff

## Goal

Windows desktop should support the same one-tap setup flow as Mac and iPhone:

- user clicks `현재 와이파이 사용하기`
- app discovers the local Pomodoro API server automatically
- app saves the discovered API base URL
- app reuses the saved URL on next launch

This removes manual copy/paste of server addresses.

## Assumed API

The local server is expected to expose:

- `GET /health`
- `GET /state`
- `GET /selection`

The discovery button should find a host on the current Wi-Fi subnet that responds to `GET /health` with a 2xx status.

## Recommended UX

- Keep the button in the sync/settings area.
- Show a short in-progress label while scanning.
- Show the discovered URL after success.
- Persist the URL in local app settings.
- If discovery fails, show a plain error like `같은 와이파이에서 서버를 찾지 못했어요.`

## Implementation Notes

### 1. Add a discovery action

Implement one main-process or native helper that:

- gets the local IPv4 address on Wi-Fi/Ethernet
- derives the `/24` subnet prefix
- probes `http://<prefix>.1:8787/health` through `http://<prefix>.254:8787/health`
- returns the first URL that responds with success

### 2. Store the result

Persist the discovered URL in the same settings store already used for sync config.

Suggested key:

- `sync.apiBaseUrl`

### 3. Wire the UI

Add a button labeled:

- `현재 와이파이 사용하기`

Recommended UI behavior:

- button disables while scanning
- sync mode flips to API when discovery succeeds
- saved URL populates the API server address field automatically

### 4. Reuse the same sync flow

After discovery, the desktop app should keep using the existing API sync path:

- push local snapshot to `POST /event`
- pull remote snapshot from `GET /state`

## Validation Checklist

- Button appears in Windows sync settings
- Clicking it finds the local API without manual typing
- The discovered URL survives app restart
- `GET /health` and `GET /state` both succeed from the same Wi-Fi network

## Copy to Preserve

Use these exact user-facing strings unless product wants a new tone:

- `현재 와이파이 사용하기`
- `현재 와이파이에서 서버 찾는 중...`
- `같은 와이파이에서 서버를 찾지 못했어요.`

