# Modulus Backend Brief Notes

Source: `/Users/kaankeseroglu/Downloads/Modulus_Backend_Brief.docx`

## Key Takeaways

- This is explicitly a backend/data-layer integration, not a rebuild.
- Existing frontend is a single HTML file of about 7,500 lines and 215 functions.
- Current persistence uses `localStorage` keys prefixed with `modulus_prog_`.
- Recommended first step is splitting the frontend into `index.html`, `modulus.css`, and `modulus.js`.
- Recommended stack: Supabase, Vercel, Twilio, Resend.
- Existing source uses `rooms` to mean tabs.

## Required Backend Work

- Replace `hLoad()` with Supabase fetch.
- Replace `hSaveCurrentProgram()` with Supabase upsert; this is called frequently and needs care.
- Replace `hSave()` with Supabase batch upsert.
- Add Supabase Auth for Creator and Co-owner.
- Keep Crew no-login via token link.
- Enforce Creator-only Notes tab.
- Hide Notes from Co-owners and Crew.
- Send notifications through Twilio and Resend from the existing Send button.
- Move base64 localStorage show assets into Supabase Storage with signed URLs.
- Build crew read-only view from existing lock-mode UI with filtering.

## Data To Persist

- Program metadata.
- Rooms/tabs.
- Sheets and ROS items.
- Contacts.
- Show assets and folder permissions.
- Program notes.
- Version number.
- Change history.

## Access Tiers

- Creator: full access, including private Notes.
- Co-owner: full edit access, Notes hidden.
- Crew: read-only, no login, sees ROS, Contacts, crew-visible Show Assets, and only assigned tabs.

## Clarification To Raise

The brief says "one link per program" and also says crew should see only tabs assigned to their contact record. A single generic anonymous link cannot know which contact opened it.

Recommended implementation: keep the same crew route, but include a recipient-scoped token in each notification link so the backend can identify the contact and filter tabs securely.
