# Motion Backend API Contracts

All endpoints return JSON and share the same base URL (see the `ApiEndpoint` CDK output). Unless noted, responses include `Content-Type: application/json` and `Access-Control-Allow-Origin: *`.

---

## Authentication

### POST `/auth/signup`
Register a user with Cognito and create a profile record. A verification email is sent automatically.

**Request Body**
```json
{
  "email": "user@example.com",
  "password": "P@ssw0rd123"
}
```

**Success Response** `201`
```json
{
  "message": "Verification code sent",
  "userId": "f2f5e9c1-...",
  "email": "user@example.com"
}
```

**Errors**
- `400` – missing email or password
- `409` – user already exists
- `500` – Cognito or DynamoDB failure

---

### POST `/auth/confirm-signup`
Confirm the verification code emailed by Cognito. Marks the user profile as verified.

**Request Body**
```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**Success Response** `200`
```json
{
  "message": "Account verified successfully"
}
```

**Errors**
- `400` – missing email/code or invalid/expired code
- `404` – user not found
- `500` – Cognito/DynamoDB error

---

### POST `/auth/signin`
Authenticate via Cognito. Returns Cognito tokens and stored profile data (including saved events).

**Request Body**
```json
{
  "email": "user@example.com",
  "password": "P@ssw0rd123"
}
```

**Success Response** `200`
```json
{
  "accessToken": "...",
  "idToken": "...",
  "refreshToken": "...",
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "user": {
    "email": "user@example.com",
    "userId": "f2f5e9c1-...",
    "savedEvents": [
      { "eventId": "ev-123", "source": "motion" },
      { "eventId": "ai-456", "source": "ai" }
    ],
    "isVerified": true
  }
}
```

**Errors**
- `400` – missing credentials
- `401` – invalid credentials
- `403` – account not verified
- `500` – Cognito error

---

### POST `/auth/forgot-password`
Send a password reset code. Cognito responds identically whether the account exists.

**Request Body**
```json
{
  "email": "user@example.com"
}
```

**Response** `200`
```json
{
  "message": "If an account exists, a reset code has been sent"
}
```

**Errors**
- `400` – missing email
- `500` – Cognito error

---

### POST `/auth/confirm-forgot-password`
Complete the password reset using the emailed code.

**Request Body**
```json
{
  "email": "user@example.com",
  "code": "654321",
  "newPassword": "NewP@ss123"
}
```

**Success Response** `200`
```json
{ "message": "Password updated successfully" }
```

**Errors**
- `400` – missing or invalid fields
- `500` – Cognito error

---

## Users

### GET `/users/profile`
Retrieve a user profile (no Cognito credentials required).

**Query Parameters**
- `email` (required)

**Success Response** `200`
```json
{
  "profile": {
    "email": "user@example.com",
    "cognitoSub": "f2f5e9c1-...",
    "isVerified": true,
    "savedEvents": [
      { "eventId": "ev-123", "source": "motion" },
      { "eventId": "ai-456", "source": "ai" }
    ],
    "createdAt": "2025-09-29T18:00:00Z",
    "updatedAt": "2025-09-29T18:30:00Z"
  }
}
```

**Errors**
- `400` – missing email
- `404` – user not found
- `500` – DynamoDB error

---

### POST `/users/saved-events`
Save an event to the user’s profile. Motion events must already exist in `MotionEvents`; AI events are persisted in `MotionAiEvents` when saved.

**Request Body (motion event)**
```json
{
  "email": "user@example.com",
  "source": "motion",
  "eventId": "event-uuid"
}
```

**Request Body (AI event)**
```json
{
  "email": "user@example.com",
  "source": "ai",
  "event": {
    "title": "Downtown Art Walk",
    "description": "Gallery crawl",
    "start_date": "2025-10-02",
    "end_date": "2025-10-02",
    "start_time": "18:00",
    "end_time": "21:00",
    "timezone": "America/New_York",
    "location": {
      "venue": "Town Square",
      "city": "Alpharetta",
      "state": "GA",
      "country": "USA"
    },
    "source_url": "https://example.com/events/art-walk",
    "tags": ["arts", "community"]
  }
}
```

**Success Response** `200`
```json
{
  "message": "Event saved",
  "savedEvents": [
    { "eventId": "event-uuid", "source": "motion" },
    { "eventId": "9f6567d0-...", "source": "ai" }
  ]
}
```

**Errors**
- `400` – missing fields or invalid payload
- `403` – account not verified
- `404` – user (or motion event) not found
- `500` – DynamoDB error

---

### DELETE `/users/saved-events`
Remove an event from the user’s saved list.

**Request Body**
```json
{
  "email": "user@example.com",
  "eventId": "event-uuid",
  "source": "motion" // optional, used when both sources share an ID
}
```

**Success Response** `200`
```json
{
  "message": "Event removed",
  "savedEvents": []
}
```

**Errors**
- `400` – missing email or eventId
- `404` – user not found
- `500` – DynamoDB error

---

### GET `/users/saved-events`
Return the user’s saved events with expanded details fetched from `MotionEvents` and `MotionAiEvents`.

**Query Parameters**
- `email` (required)

**Success Response** `200`
```json
{
  "count": 2,
  "items": [
    {
      "eventId": "event-uuid",
      "source": "motion",
      "event": { "eventId": "event-uuid", "name": "City Market", ... }
    },
    {
      "eventId": "9f6567d0-...",
      "source": "ai",
      "event": { "title": "Downtown Art Walk", ... }
    }
  ]
}
```

**Errors**
- `400` – missing email
- `404` – user not found
- `500` – DynamoDB error

---

## Events

### POST `/events`
Create a community event in `MotionEvents` with geohash metadata.

**Request Body**
```json
{
  "name": "City Market",
  "description": "Local vendors and food trucks",
  "dateTime": "2025-10-01T15:00:00-04:00",
  "endDateTime": "2025-10-01T20:00:00-04:00",
  "createdByEmail": "organizer@example.com",
  "location": {
    "venue": "Town Square",
    "address": "123 Main St",
    "city": "Alpharetta",
    "state": "GA",
    "zip": "30009"
  },
  "coordinates": { "lat": 34.0736, "lng": -84.2814 },
  "photoUrls": ["https://example.com/market.jpg"],
  "tags": ["community", "market"]
}
```

**Success Response** `201`
```json
{
  "message": "Event created",
  "eventId": "8e8fbd9a-..."
}
```

**Errors**
- `400` – missing required fields or ungodable address
- `500` – DynamoDB or AWS Location failure

---

### GET `/events/search`
Query stored events near a location.

**Query Parameters**
- `lat` & `lng` (preferred) or `address`/`zip` or `city`/`state` (+ optional `country`)
- `radiusMiles` (default 10)
- `startTime`, `endTime` (ISO 8601) **or** `date` (`YYYY-MM-DD`) with optional `time` (`HH:mm`)
  - when using `date`/`time`, provide `windowMinutes` to adjust the search window (default 3 hours when `time` is supplied, full day otherwise)
  - optionally supply `endDate`/`endTime` (same formats) for an explicit range
- `tags` (comma-separated)

**Success Response** `200`
```json
{
  "center": { "lat": 34.0736, "lng": -84.2814 },
  "radiusMiles": 15,
  "timeRange": {
    "start": "2025-10-01T15:00:00.000Z",
    "end": "2025-10-01T18:00:00.000Z"
  },
  "count": 2,
  "items": [ ... ]
}
```

**Errors**
- `400` – missing center parameters
- `500` – DynamoDB or AWS Location failure

---

### GET `/events/by-user`
List events created by a specific organizer.

**Query Parameters**
- `email` (required)
- `limit` (optional, default 200, max 1000)

**Response** `200`
```json
{
  "count": 3,
  "items": [ ... ]
}
```

---

### GET `/events/{eventId}`
Fetch a single stored (Motion) event by ID.

**Response** `200`
```json
{ "event": { "eventId": "event-uuid", ... } }
```

**Errors**
- `400` – missing eventId
- `404` – event not found

---

### GET `/ai-events/{eventId}`
Fetch a saved AI-sourced event by ID.

**Response** `200`
```json
{ "event": { "eventId": "ai-uuid", "title": "...", ... } }
```

**Errors**
- `400` – missing eventId
- `404` – event not found

---

### GET `/events/search-ai`
Use Gemini and AWS Location reverse geocoding to gather local events. Saved AI events can later be retrieved via `/ai-events/{eventId}`.

**Required Parameters**
- Either `lat` & `lng`, or `city`, `state`, `country`
- `start_date`, `end_date` (YYYY-MM-DD)
- `timezone` (IANA)

**Optional Parameters**
- `radius_miles` (default 5, max 100)
- `preferLocal` (`1` default, `0` to relax)
- `debug` (`1` to log candidate sources)

**Response** `200`
```json
{
  "count": 6,
  "items": [ { "title": "Downtown Art Walk", ... } ]
}
```

**Errors**
- `400` – missing place/time parameters
- `500` – Gemini or AWS Location failure

---

## Notes
- All Lambdas run on Node.js 20.x and are bundled via `esbuild` using AWS CDK. Relevant environment variables (`APP_NAME`, `USER_POOL_ID`, `GEMINI_API_KEY`, etc.) are injected at deploy time.
- Cognito user pool handles account verification, password resets, and token issuance. No passwords are stored in DynamoDB.
- Saved events are tracked as `{ eventId, source }` pairs. When `source === "ai"`, the full event payload is persisted in the `MotionAiEvents` table to support later retrieval.
