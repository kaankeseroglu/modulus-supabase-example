# Modulus Supabase Backend Integration Demo

This is a small proof-of-work project for integrating a finished live-event run-of-show (ROS) frontend with Supabase.

It demonstrates the backend patterns needed for a production scheduling app:

- Supabase Auth for event creators and co-owners.
- Row Level Security (RLS) for per-production access.
- Three-tier access model: creator, co-owner, and unauthenticated crew.
- Token-based crew read-only view with no login required.
- ROS items and contacts stored in Postgres instead of `localStorage`.
- Private Supabase Storage bucket for show assets with signed URLs.
- Notification Edge Function skeleton for Resend email and Twilio SMS.
- Static single-page client example to show the data-layer swap without rebuilding the UI.

This is intentionally compact. The goal is not to rebuild Modulus, but to show the backend integration approach that can be applied under an existing frontend.

## Project Structure

```text
.
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
└── supabase/
    ├── functions/
    │   └── send-notification/
    │       └── index.ts
    └── migrations/
        └── 20260407000000_initial_modulus_schema.sql
```

## Run Locally

1. Create a Supabase project.
2. Apply the SQL migration from `supabase/migrations/20260407000000_initial_modulus_schema.sql`.
3. Deploy the Edge Function:

```bash
supabase functions deploy send-notification
```

4. Add Edge Function secrets:

```bash
supabase secrets set \
  SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \
  SUPABASE_ANON_KEY="YOUR_ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
  RESEND_API_KEY="re_..." \
  TWILIO_ACCOUNT_SID="AC..." \
  TWILIO_AUTH_TOKEN="..." \
  TWILIO_FROM_NUMBER="+15555555555"
```

5. Serve the static client:

```bash
cd public
python3 -m http.server 5173
```

6. Open `http://localhost:5173`, enter your Supabase URL and anon key, then sign up or sign in.

## What The Demo Proves

The schema uses RLS helper functions so logged-in creators and co-owners can manage a production, while crew users do not need accounts. Crew users only receive a time-limited token link. The `get_crew_show_snapshot()` RPC validates the token server-side and returns only a sanitized read-only payload.

## Brief-Specific Notes

The April 2026 Modulus brief calls out three frontend integration points: `hLoad()`, `hSaveCurrentProgram()`, and `hSave()`. In the real codebase, I would not rewrite the ROS builder or import logic. I would wrap those functions behind a small repository/data-access layer, then replace the `localStorage` reads and writes with Supabase fetch/upsert calls.

The brief also says tabs are still called `rooms` in the source. The Supabase schema should preserve that concept instead of forcing a rename during the backend migration. A pragmatic implementation would store program-level data, rooms/tabs, sheets/items, contacts, assets, notes, version history, and change history in tables that closely mirror the existing saved object shape.

One implementation detail needs clarification with the product owner: the brief says there is "one link per program," but also says crew users should only see the tabs assigned to their contact record. A single generic anonymous link cannot reliably identify which contact opened it. The secure approach is either:

- Include a recipient-scoped token in each notification link, while still routing to the same program-level crew URL.
- Or ask the crew member to verify email/phone before showing personalized tabs.

For production, I would recommend recipient-scoped crew tokens because they keep the no-login crew flow and allow server-side tab filtering.

The file-storage path convention is:

```text
show-assets/{production_id}/{asset_file}
```

Storage policies use the first path segment to enforce production membership. The static client uploads files, records metadata in `show_assets`, and requests short-lived signed URLs for playback/download.

The notification Edge Function validates the caller with the incoming JWT, checks whether they can edit the production, fetches contacts, sends email/SMS if provider secrets are configured, and records delivery attempts in `notification_deliveries`.

## Applying This To An Existing Single-File Frontend

For an existing app that already has working UI and local state, I would not rebuild the frontend. I would add a thin data-access layer and progressively replace local-only operations:

```js
// Before
localStorage.setItem("rosItems", JSON.stringify(items));

// After
await rosRepository.upsertItems(productionId, items);
```

That keeps UI behavior intact while moving persistence, permissions, file access, and notifications into Supabase-backed services.
