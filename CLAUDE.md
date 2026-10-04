# PetraVoice — Shared Project Contract

> Reference file for team PromptRiders. Any change to this contract must be agreed by both sides.

## Team & Ownership

| Part | Stack | Owner |
|---|---|---|
| Frontend | React (Vite) + TypeScript | — |
| Backend  | Node.js 24 + TypeScript (Express) | — |

Folders: `/frontend` and `/backend` — each person runs a separate Claude Code session in their own folder.

---

## API Contract (single source of truth)

### 1. Parse a voice request

```
POST /api/parse-ride
Content-Type: multipart/form-data
```

**Request**

| Field | Type | Required | Notes |
|---|---|---|---|
| `audio` | file (webm/wav) | no* | Recording from the browser |
| `text`  | string | no* | Skips STT — used during development and testing |

\* At least one must be sent. If `text` is present, the STT stage is skipped.

**Response — 200**

```json
{
  "success": true,
  "transcript": "وصلني من دوار الواحة لمستشفى الاستقلال",
  "pickup": {
    "name": "دوار الواحة",
    "lat": 31.9871,
    "lng": 35.8712,
    "confidence": 0.94
  },
  "dropoff": {
    "name": "مستشفى الاستقلال",
    "lat": 31.9945,
    "lng": 35.9102,
    "confidence": 0.91
  },
  "rideType": "economy",
  "fareEstimate": { "min": 2.5, "max": 3.8, "currency": "JOD" },
  "route": {
    "distanceKm": 5.4,
    "durationMinutes": 12,
    "geometry": "encoded polyline string (OSRM, precision 5)"
  },
  "needsDisambiguation": false,
  "options": []
}
```

`route` is **nullable**. If OSRM is unreachable or times out, the backend returns `route: null` and the frontend falls back to a straight line between the two markers. The demo must never break because a routing call failed.

**Response — ambiguous case (low confidence)**

`needsDisambiguation: true` with **two to five** entries in `options`: two when a name matches two similar places,
up to five for a generic category («وصلني ع المستشفى» → the best-known hospitals). All options are for the same
`field`. The frontend renders a choice screen; tapping an option fills that side and re-requests the route.

```json
{
  "success": true,
  "transcript": "وصلني على الجامعة",
  "pickup": { "name": "...", "lat": 0, "lng": 0, "confidence": 0.9 },
  "dropoff": null,
  "rideType": "economy",
  "fareEstimate": null,
  "needsDisambiguation": true,
  "options": [
    { "field": "dropoff", "name": "الجامعة الأردنية - البوابة الشمالية", "lat": 32.0141, "lng": 35.8701 },
    { "field": "dropoff", "name": "جامعة العلوم التطبيقية", "lat": 32.0318, "lng": 35.8794 }
  ]
}
```

**Response — error**

```json
{
  "success": false,
  "error": { "code": "STT_FAILED", "message": "تعذر فهم الصوت، حاول مرة أخرى" }
}
```

Error codes: `STT_FAILED` · `NO_LOCATION_FOUND` · `INVALID_AUDIO` · `SERVER_ERROR`

### 2. Confirm the booking

```
POST /api/confirm-ride
Content-Type: application/json
```

```json
{
  "pickup":  { "name": "...", "lat": 0, "lng": 0 },
  "dropoff": { "name": "...", "lat": 0, "lng": 0 },
  "rideType": "economy"
}
```

**Response**

```json
{ "success": true, "bookingId": "PV-2026-00123", "status": "dispatched", "etaMinutes": 4 }
```

---

## Fixed Rules

- All JSON fields are **camelCase**. Coordinates are always `lat` / `lng` — never `lon` or `longitude`.
- `rideType` accepts only: `economy` · `comfort` · `xl`.
- `confidence` is a float between 0 and 1. Below **0.75** the backend must return `needsDisambiguation: true`.
- Currency is always `JOD`.
- `route.geometry` is an OSRM **encoded polyline, precision 5**. The frontend decodes it with `@mapbox/polyline`. Both sides must agree on precision or the line renders in the wrong place.
- Only the backend calls OSRM. The frontend never calls a routing service directly.
- **No automatic booking, ever.** `/api/parse-ride` never books anything. Booking happens only through `/api/confirm-ride`, after the user has visually confirmed the details.
- User-facing messages are in Arabic; error codes are in English.

## Demo Priorities

1. Mic button + live waveform
2. Auto-filled confirmation screen
3. Ambiguity resolution (two choices)

Anything else — login, ride history, settings — is last priority or faked.

## CORS

The backend must allow `http://localhost:5173` (Vite's default port) during development.
