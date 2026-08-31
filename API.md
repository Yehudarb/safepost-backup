# 📚 SafePost API Documentation

## Base URL
- **Development:** `http://localhost:3001`
- **Production:** `https://your-domain.com`

---

## ✅ Health & Status

### GET /api/health
Check backend health.
```bash
curl http://localhost:3001/api/health
```

**Response:**
```json
{
  "status": "ok",
  "time": "2026-08-07T12:46:44.448Z",
  "supabase": true
}
```

### GET /api/system/status
Worker liveness, as seen by the dashboard's Worker panel.

`worker_status` is `ACTIVE` when a heartbeat arrived in the last 60 seconds,
otherwise `OFFLINE`. The values come from the in-memory `lastWorker*` variables
that `POST /api/worker/heartbeat` sets — **not** from the `browser_workers` table
(that table backs the paired-worker flow, `GET /api/workers`).

```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3001/api/system/status
```

**Response:**
```json
{
  "worker_status": "ACTIVE",
  "worker_message": "Worker is active",
  "last_worker_checkin": "2026-08-07T13:13:20.898Z",
  "worker_version": "9.0",
  "worker_origin": "safe_post_extension",
  "worker_extension_id": "abcdef123456",
  "worker_stopped": false,
  "server_time": "2026-08-07T13:13:21.311Z"
}
```

### POST /api/worker/heartbeat
Sent by the **unpaired** extension every ~60s from `background.js`. No auth.
Accepts both the current field names and the legacy ones.

```bash
curl -X POST http://localhost:3001/api/worker/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"extension_id":"abcdef123456","manifest_version":"9.0","origin_folder":"safe_post_extension"}'
```

**Response:**
```json
{ "success": true, "stop_signal": false }
```

> Paired extensions use `POST /api/workers/:workerId/heartbeat` instead, which
> authenticates with a device token and updates the `browser_workers` row.

---

## 👥 Groups

### GET /api/groups
List all groups (requires auth).
```bash
curl -H "Authorization: Bearer TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  http://localhost:3001/api/groups
```

**Response:**
```json
{
  "groups": [
    {
      "id": "12345",
      "name": "My Group",
      "url": "https://facebook.com/groups/12345",
      "facebook_user": "User Name"
    }
  ],
  "facebook_users": ["User Name"]
}
```

### POST /api/groups/sync
Sync groups from extension.
```bash
curl -X POST http://localhost:3001/api/groups/sync \
  -H "Content-Type: application/json" \
  -d '{
    "groups": [
      {"id": "123", "name": "Group 1", "url": "https://..."}
    ],
    "facebook_user": "Current User"
  }'
```

**Response:**
```json
{
  "success": true,
  "synced": 1,
  "message": "Synced 1 groups"
}
```

---

## 📝 Posts & Queue

### GET /api/queue
Get pending posts (requires auth).
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3001/api/queue
```

**Response:** full task rows — the dashboard's queue table renders
`group_name`, `content`, `failure_reason` and `proof_url` from these.

```json
{
  "queue": [
    {
      "id": 54,
      "group_id": "123",
      "content": "QA Campaign Test #2",
      "media_url": null,
      "media_paths": null,
      "status": "PENDING",
      "scheduled_time": "2026-08-07T13:00:00Z",
      "ended_at": null,
      "failure_reason": null,
      "proof_url": null,
      "app_source": "backup",
      "facebook_user": "Smart Choice gadgets"
    }
  ]
}
```

### POST /api/posts
Create new posts (requires auth).
```bash
curl -X POST http://localhost:3001/api/posts \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "group_ids": ["123", "456"],
    "content": "Hello World",
    "schedule": "2026-08-07T13:00:00Z",
    "ai_spin": false
  }'
```

**Response:**
```json
{
  "success": true,
  "count": 2
}
```

---

## 🔧 Workers

### GET /api/workers
List connected workers (requires auth).
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3001/api/workers
```

**Response:**
```json
{
  "workers": [
    {
      "id": "worker-1",
      "worker_name": "Chrome Extension",
      "status": "online",
      "last_seen_at": "2026-08-07T12:46:44Z"
    }
  ]
}
```

### POST /api/workers/pairing-code
Generate pairing code for extension (requires auth).
```bash
curl -X POST http://localhost:3001/api/workers/pairing-code \
  -H "Authorization: Bearer TOKEN"
```

**Response:**
```json
{
  "code": "ABC123",
  "expires_at": "2026-08-07T13:00:00Z",
  "expires_in_seconds": 600
}
```

---

## 🤖 AI Generation

### POST /api/ai/generate
Generate content with AI (requires auth, rate limited).
```bash
curl -X POST http://localhost:3001/api/ai/generate \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Write a funny post about cats",
    "history": []
  }'
```

**Response:**
```json
{
  "success": true,
  "text": "Cats are...",
  "source": "gemini"
}
```

---

## 📊 Analytics

### GET /api/analytics
Get performance analytics (requires auth).
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3001/api/analytics
```

**Response:**
```json
{
  "summary": {
    "total": 100,
    "success": 85,
    "failed": 10,
    "successRate": 89
  },
  "topGroups": [],
  "topErrors": []
}
```

---

## 🔐 Authentication

All endpoints (except /health and /groups/sync) require:

```
Authorization: Bearer <Supabase JWT Token>
```

Optional header for workspace scoping:
```
x-workspace-id: <workspace-uuid>
```

---

## ⚡ Rate Limits

- **General API:** 500 requests/minute
- **Expensive ops (upload, AI):** 20 requests/15 minutes
- **File upload:** 50MB max

---

## ❌ Error Responses

All errors return with appropriate HTTP status:

```json
{
  "error": "Error message describing what went wrong"
}
```

Common status codes:
- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (no access)
- `404` - Not Found
- `429` - Too Many Requests (rate limit)
- `500` - Server Error

---

## 🧪 Testing Endpoints

```bash
# Health check
curl http://localhost:3001/api/health

# Profile
curl http://localhost:3001/api/profile/current

# Groups (no auth required for sync)
curl -X POST http://localhost:3001/api/groups/sync \
  -H "Content-Type: application/json" \
  -d '{"groups": [], "facebook_user": null}'
```
