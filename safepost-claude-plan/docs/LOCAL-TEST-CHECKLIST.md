# SafePost Local Testing Checklist

**Status**: Phases 3–7 ready for browser + extension testing  
**Backend**: Running on http://localhost:3001 ✅  
**Frontend**: Ready (run `npm run dev` → http://localhost:5173)  
**Dev DB**: `cfluldwfbhprpkptukkm.supabase.co`  
**Demo creds**: `demo@safepost.local` / `DemoPass12345!`

---

## Browser Tests (http://localhost:5173)

### Phase 3 — Authentication & Isolation
- [ ] **Login button** → appears when not logged in
- [ ] **Register flow** → email + password + confirm → account created
- [ ] **Demo mode** → click "Try the demo" → signed in as `demo@safepost.local`
- [ ] **Forgot password** → reset flow works
- [ ] **Logout** → returns to login screen
- [ ] **Session persistence** → refresh page → still logged in

### Phase 4 — Demo Mode & Isolation
- [ ] **Demo banner** → amber bar says "Demo Mode — no real posts will be published"
- [ ] **Demo data visible** → queue shows 5 synthetic posts (with demo prefixes)
- [ ] **Groups visible** → ~3 demo groups (example.com URLs)
- [ ] **Demo reset button** → clears + re-seeds demo data
- [ ] **Upload blocked** → try to upload media → 403 + "demo: true" message
- [ ] **Multiple users isolated** → register User A, then User B → each has separate workspace + queue

### Phase 5 — Device Pairing
- [ ] **Devices button** → appears in top nav (next to Analytics)
- [ ] **Generate pairing code** → shows 8-char code + expiry countdown
- [ ] **Copy button** → code copied to clipboard
- [ ] **Code expires** → countdown reaches 0
- [ ] **Worker list** → after pairing an extension, device appears with Online/Offline status
- [ ] **Rename worker** → click pencil → rename → list updates
- [ ] **Revoke worker** → click ban icon → worker marked Revoked
- [ ] **Delete worker** → removed from list

### Phase 6 — Queue & Retries
- [ ] **Retry visibility** → if a post fails and retries, shows "Attempt N/3 · retry HH:MM"
- [ ] **Status badges** → SENT / PROCESSING / SUCCESS / FAILED / NEEDS_USER_ACTION visible
- [ ] **Proof link** → for SUCCESS posts, "view published post" link is clickable

### Phase 7 — (Visible in code; in-Chrome testing next)
- [ ] Extension popup: API URL setting works
- [ ] Extension popup: Test connection button works
- [ ] Extension popup: Pairing code entry + Pair button
- [ ] Extension background: Logs heartbeats to console (optional: check chrome://extensions logs)

---

## Extension Tests (Chrome, requires pairing)

1. **Load unpacked**:
   - `chrome://extensions` → Developer mode ON
   - Load unpacked → select `safe_post_extension/`

2. **Popup appears** → click icon → popup shows (API URL + pairing section)

3. **Configure API URL**:
   - Enter `http://localhost:3001`
   - Click "Test connection"
   - Should show "Connected (200)"

4. **Pair with dashboard**:
   - In dashboard, click Devices → Generate pairing code
   - Copy the code
   - In extension popup, paste code in the pairing field
   - Click "Pair"
   - Should show ✓ Paired status

5. **Verify in dashboard**:
   - Device appears in the workers list
   - Status shows Online/Offline
   - Version info displays

6. **Revoke from dashboard**:
   - Click Ban icon on the worker
   - Try another heartbeat from extension
   - Should fail with 403

---

## Known Limitations

- **Phase 5–6 tests passed**, but **pairing endpoint** not yet integrated with real extension DOM interaction (that's Phase 8 work).
- **Facebook posting** is not tested here; in-Chrome Facebook testing requires a real Facebook account + live groupneed separate session.
- **Media upload** is mocked (Supabase storage would need credentials).

---

## Rollback

If anything breaks:

```bash
# Backend logs
tail -f /tmp/dev-backend.log

# Reset dev database to fresh
# → delete entire project + recreate via Supabase, OR
# → run migrations again (idempotent)

# Reset code to main
git checkout main -- .env.local
```

---

## Done Checklist

Once you've tested the above, mark this complete:

- [ ] Demo mode works end-to-end
- [ ] Multiple users are isolated
- [ ] Pairing flow works (dashboard + popup)
- [ ] Queue shows retry status + badges
- [ ] All 5 phases (3–7) are working locally
- Ready for production cutover planning
