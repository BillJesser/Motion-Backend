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

**Validation Errors** `400`
```json
{
  "message": "Invalid email address",
  "reason": "Email must include an @ symbol and domain"
}
```
```json
{
  "message": "Password does not meet requirements",
  "reason": "Password must have uppercase, lowercase, number, and symbol characters"
}
```

**Other Errors**
- `400` - email and password are required
- `409` - user already exists
- `500` - Cognito or DynamoDB failure

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
- `400` - email and code are required or the code is invalid/expired
- `404` - user not found
- `500` - Cognito or DynamoDB failure

---

### POST `/auth/signin`
Authenticate against Cognito and return Cognito tokens plus the stored profile snapshot.

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
    ]
  }
}
```

**Errors**
- `400` - email and password are required
- `401` - invalid credentials
- `403` - account is not verified or Cognito returned a challenge flow
- `500` - Cognito error while initiating auth

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
- `400` - email is required
- `500` - Cognito error while initiating the reset

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
- `400` - email, code, or newPassword missing, or code is invalid/expired
- `500` - Cognito error while finalising the reset

---

## Users

### GET `/users/profile`
Retrieve a user profile without Cognito credentials. Password fields are never returned.

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
- `400` - email is required
- `404` - user not found
- `500` - DynamoDB error

---

### POST `/users/saved-events`
Save an event to the user profile. Motion events must already exist in `MotionEvents`; AI events are upserted into `MotionAiEvents` when saved.

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
  "eventId": "optional-custom-id",
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
- `400` - email or source missing
- `400` - eventId missing for motion events
- `400` - AI event missing required fields (`title`, `start_date`, `timezone`, `source_url`)
- `403` - account is not verified
- `404` - user not found or motion event not found
- `500` - DynamoDB error or failure while persisting the AI event

---

### DELETE `/users/saved-events`
Remove an event from the user saved list. If multiple sources use the same ID, pass `source` to delete the correct entry.

**Request Body**
```json
{
  "email": "user@example.com",
  "eventId": "event-uuid",
  "source": "motion"
}
```

**Success Response** `200`
```json
{
  "message": "Event removed",
  "savedEvents": []
}
```

**Event Not Present** `200`
```json
{
  "message": "Event not found in saved list",
  "savedEvents": [ ... ]
}
```

**Errors**
- `400` - email or eventId missing
- `404` - user not found
- `500` - DynamoDB error

---

### GET `/users/saved-events`
Return the user saved events with expanded details fetched from `MotionEvents` and `MotionAiEvents`.

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
      "event": { "eventId": "event-uuid", "name": "City Market" }
    },
    {
      "eventId": "9f6567d0-...",
      "source": "ai",
      "event": { "title": "Downtown Art Walk" }
    }
  ]
}
```

**Errors**
- `400` - email is required
- `404` - user not found
- `500` - DynamoDB error

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

`endDateTime` is required unless you provide a numeric `endTime` (epoch seconds). If `coordinates` are omitted, the service attempts to geocode the location values.

**Success Response** `201`
```json
{
  "message": "Event created",
  "eventId": "8e8fbd9a-..."
}
```

**Errors**
- `400` - missing required fields, invalid ISO-8601 start/end, or location could not be geocoded
- `500` - DynamoDB or AWS Location failure

---

### GET `/events/search`
Query stored events near a location and within an optional time window.

**Query Parameters**
- `lat` & `lng` (preferred) or `address`/`zip` or `city`/`state` (`country` optional)
- `radiusMiles` (default 10)
- `startTime`, `endTime` (ISO 8601) **or** `date` (`YYYY-MM-DD`) with optional `time` (`HH:mm`)
  - when using `date`/`time`, supply `windowMinutes` to adjust the search window (default 3 hours when `time` is supplied, full day otherwise)
  - optionally supply `endDate`/`endTime` (same formats) to control the range explicitly
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
- `400` - location parameters missing or time parameters invalid
- `500` - DynamoDB or AWS Location failure

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
Fetch a single stored Motion event by ID.

**Response** `200`
```json
{ "event": { "eventId": "event-uuid", ... } }
```

**Errors**
- `400` - missing eventId
- `404` - event not found

---

### GET `/ai-events/{eventId}`
Fetch a saved AI-sourced event by ID.

**Response** `200`
```json
{ "event": { "eventId": "ai-uuid", "title": "..." } }
```

**Errors**
- `400` - missing eventId
- `404` - event not found

---

### GET `/events/search-ai`
Use Gemini and AWS Location reverse geocoding to gather local events. Saved AI events can later be retrieved via `/ai-events/{eventId}`.

**Required Parameters**
- Either (`lat` and `lng`) or (`city`, `state`, `country`)
- `start_date`, `end_date` (YYYY-MM-DD)
- `timezone` (IANA)

**Optional Parameters**
- `radius_miles` (default 5). Also accepts `radiusMiles`, `radius`, or `radius_km` (converted to miles).
- `preferLocal` (`1` default, `0` to allow broader sources)
- `debug` (`1` to emit verbose logs)

When coordinates are provided, the service reverse geocodes them to fill any missing city/state/country values before calling Gemini.

**Response** `200`
```json
{
  "count": 6,
  "items": [
    {
      "title": "Downtown Art Walk",
      "start_date": "2025-10-02",
      "start_time": "18:00",
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
  ]
}
```

**Errors**
- `400` - missing location or date/time parameters
- `500` - Gemini or AWS Location failure

---

## Notes
- All Lambdas run on Node.js 20.x and are bundled via `esbuild` using AWS CDK. Environment variables (`APP_NAME`, `USER_POOL_ID`, `GEMINI_API_KEY`, etc.) are injected at deploy time.
- Cognito handles account verification, password resets, and token issuance. No passwords are stored in DynamoDB tables.
- Saved events are stored as `{ eventId, source }` pairs. When `source === "ai"`, the full event payload lives in the `MotionAiEvents` table so it can be retrieved later.

