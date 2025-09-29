# Motion Backend API Contracts

All endpoints return JSON and are deployed behind the same base URL (see the `ApiEndpoint` stack output). Unless noted otherwise, responses include the header `Content-Type: application/json` and `Access-Control-Allow-Origin: *`.

---

## Authentication

### POST `/auth/signup`
Create a Cognito user and store a corresponding profile. A verification email is sent automatically; the account remains unconfirmed until `/auth/confirm-signup` succeeds.

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

**Error Codes**
- `400` – missing email or password
- `409` – user already exists
- `500` – user pool not configured or Cognito error

---

### POST `/auth/confirm-signup`
Confirm the verification code that Cognito emailed to the user.

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

**Error Codes**
- `400` – missing email/code or invalid/expired code
- `404` – user not found
- `500` – Cognito/DynamoDB error

---

### POST `/auth/signin`
Authenticate through Cognito. Returns Cognito tokens plus the stored user profile details.

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
    "savedEvents": []
  }
}
```

**Error Codes**
- `400` – missing email or password
- `401` – invalid credentials
- `403` – account not verified (`UserNotConfirmedException`)
- `500` – Cognito error

---

### POST `/auth/forgot-password`
Kick off the password reset flow. Cognito emails a code regardless of whether the account exists.

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
- `500` – user pool not configured or Cognito error

---

### POST `/auth/confirm-forgot-password`
Finalize a password reset with the emailed code.

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
{
  "message": "Password updated successfully"
}
```

**Error Codes**
- `400` – missing fields or invalid/expired code
- `500` – user pool not configured or Cognito error

---

## Events

### POST `/events`
Create a community event and persist it to DynamoDB. A geohash is computed from either passed coordinates or a geocoded address.

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
  "photoUrls": ["https://.../market.jpg"],
  "tags": ["community", "market"]
}
```
*You must provide either `coordinates` (lat/lng) or a geocodable address/zip in `location`.*

**Success Response** `201`
```json
{
  "message": "Event created",
  "eventId": "8e8fbd9a-..."
}
```

**Error Codes**
- `400` – missing required fields or invalid/ungordable address
- `500` – DynamoDB/AWS Location error

---

### GET `/events/search`
Find stored events near a location with optional time and tag filters.

**Query Parameters**
- `lat` & `lng` (preferred) *or* `address`/`zip`
- `radiusMiles` (default 10, max 50 via query logic)
- `startTime`, `endTime` (ISO 8601)
- `tags` (comma-separated)

**Sample Request**
```
/events/search?lat=34.0736&lng=-84.2814&radiusMiles=15&startTime=2025-10-01T00:00:00Z
```

**Success Response** `200`
```json
{
  "center": { "lat": 34.0736, "lng": -84.2814 },
  "radiusMiles": 15,
  "count": 2,
  "items": [
    {
      "eventId": "...",
      "name": "City Market",
      "dateTime": 1769887200,
      "endTime": 1769905200,
      "location": { ... },
      "coordinates": { "lat": 34.0736, "lng": -84.2814 },
      "tags": ["community", "market"],
      "_distanceMeters": 0
    }
  ]
}
```

**Error Codes**
- `400` – missing center information
- `500` – DynamoDB/AWS Location error

---

### GET `/events/by-user`
Return the events created by a specific organizer, newest first.

**Query Parameters**
- `email` (required)
- `limit` (optional, default 200, max 1000)

**Success Response** `200`
```json
{
  "count": 3,
  "items": [ { "eventId": "...", ... } ]
}
```

**Errors**
- `400` – missing email
- `500` – DynamoDB error

---

### GET `/events/search-ai`
Use Gemini + AWS Location reverse geocoding to gather nearby events from local tourism/community sources.

**Required Parameters**
- Either:
  - `lat` and `lng`
  - or `city`, `state`, `country`
- `start_date` and `end_date` (YYYY-MM-DD)
- `timezone` (IANA, e.g. `America/New_York`)

**Optional Parameters**
- `radius_miles` (defaults to 5, max 100)
- `preferLocal` (`1` (default) or `0`)
- `debug` (`1` to log candidate sources)

**Sample Request**
```
/events/search-ai?lat=34.0736&lng=-84.2814&start_date=2025-10-01&end_date=2025-10-07&timezone=America/New_York&radius_miles=10
```

**Success Response** `200`
```json
{
  "count": 6,
  "items": [
    {
      "title": "Downtown Art Walk",
      "start_date": "2025-10-02",
      "start_time": "18:00",
      "location": {
        "venue": "Town Square",
        "city": "Alpharetta",
        "state": "GA",
        "country": "USA"
      },
      "tags": ["arts"],
      "source_url": "https://..."
    }
  ]
}
```

**Error Codes**
- `400` – missing required place/time parameters
- `500` – Gemini or AWS Location failure

---

## Notes
- All Lambda functions are deployed as Node.js 20.x handlers using AWS CDK. Environment variables such as `APP_NAME`, `GEMINI_API_KEY`, `PLACE_INDEX_NAME`, and Cognito IDs are configured during deployment.
- Authentication endpoints rely entirely on Amazon Cognito user pools; no passwords are stored in DynamoDB.
- `savedEvents` is reserved in the user profile for future favorites/bookmarks functionality.
