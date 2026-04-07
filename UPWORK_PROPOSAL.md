Hi,

I read the Modulus backend brief and understand this as a backend integration job, not a frontend rebuild. I would keep the existing ROS builder, smart import, inline editing, contacts UI, asset UI, print system, and help system intact, then replace the `localStorage` data layer underneath it with Supabase-backed persistence, auth, permissions, storage, and notifications.

I noticed the key integration points in the brief: `hLoad()`, `hSaveCurrentProgram()`, `hSave()`, `openNotify()`, `hActiveProgramId`, `rooms`, and `hPrograms`. I also saw the note that tabs are called `rooms` in the existing source, so I would preserve that mapping during the migration rather than trying to rename concepts while integrating the backend.

I’m comfortable with the exact pieces in scope:

- Supabase Auth for creator/co-owner login.
- Postgres schema design and RLS policies for program-level access.
- Creator-only Notes tab access, with Notes hidden from co-owners and crew.
- Token-based unauthenticated crew read-only access.
- Crew filtering by assigned tabs/rooms and crew-visible asset folders.
- Supabase Storage with private buckets and signed URLs.
- Supabase Edge Functions or Vercel API routes for backend-only operations.
- Twilio SMS and Resend email notification delivery based on selected notification tags.

For a relevant Supabase example, I prepared a small ROS-focused proof-of-work that mirrors this project’s backend requirements: Auth + RLS, creator/co-owner access, token-based crew snapshot, asset metadata/storage pattern, and a Twilio/Resend notification function.

Demo repo: https://github.com/kaankeseroglu/modulus-supabase-example

My implementation approach would be:

1. Split the single HTML file into `index.html`, `modulus.css`, and `modulus.js` if you want that done first, as recommended in the brief.
2. Review the existing `modulus_prog_` localStorage structure and map `hLoad()`, `hSaveCurrentProgram()`, and `hSave()` to a Supabase repository layer.
3. Create the Supabase schema, indexes, RLS policies, and access-tier helper functions around programs, rooms/tabs, ROS items, contacts, assets, notes, version history, and change history.
4. Add Supabase Auth and program membership logic for Creator and Co-owner access.
5. Preserve the Notes rule exactly: visible only when logged-in `user.id` matches the program `created_by`.
6. Replace localStorage reads/writes incrementally with Supabase queries/mutations, with care around `hSaveCurrentProgram()` because it is called frequently.
7. Move base64 assets into Supabase Storage using private buckets and signed URLs, respecting folder visibility.
8. Connect the existing Send button to a backend function that filters contacts by selected tabs and notification tags, then sends via Twilio/Resend and logs delivery attempts.
9. Build the crew read-only route by reusing the existing lock-mode UI with server-side filtering for assigned tabs and crew-visible folders.
10. Test creator, co-owner, and crew flows end to end before handoff.

One clarification I would raise early: the brief says there is one link per program, but also says each crew member should only see the tabs assigned to their contact record. To do that securely without crew login, I would recommend recipient-scoped crew tokens in the notification link, or a lightweight email/phone verification step on the crew page.

I’d like to start by reviewing the current frontend source and identifying the exact save/load and notification handlers to wrap first.
