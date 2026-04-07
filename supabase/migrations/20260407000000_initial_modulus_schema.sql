create extension if not exists pgcrypto;

create type public.production_member_role as enum ('creator', 'co_owner');
create type public.asset_visibility as enum ('members_only', 'crew_read');
create type public.notification_channel as enum ('email', 'sms');
create type public.notification_delivery_status as enum ('queued', 'sent', 'skipped', 'failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  company text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.productions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  event_date date,
  timezone text not null default 'UTC',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.production_members (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.production_member_role not null default 'co_owner',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (production_id, user_id)
);

create table public.ros_items (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  sort_order integer not null default 0,
  timecode text,
  segment text,
  cue text not null,
  department text,
  owner text,
  notes text,
  is_private boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  name text not null,
  role text,
  department_tags text[] not null default array[]::text[],
  tab_assignments text[] not null default array[]::text[],
  email text,
  phone text,
  is_private boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.asset_folders (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  name text not null,
  visibility public.asset_visibility not null default 'members_only',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.show_assets (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  folder_id uuid references public.asset_folders(id) on delete set null,
  storage_bucket text not null default 'show-assets',
  storage_path text not null,
  original_name text not null,
  mime_type text,
  size_bytes bigint,
  visibility public.asset_visibility not null default 'members_only',
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create table public.crew_share_tokens (
  token text primary key default encode(gen_random_bytes(32), 'hex'),
  production_id uuid not null references public.productions(id) on delete cascade,
  label text not null default 'Crew link',
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  subject text,
  body text not null,
  channels public.notification_channel[] not null default array[]::public.notification_channel[],
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  channel public.notification_channel not null,
  destination text,
  provider_message_id text,
  status public.notification_delivery_status not null default 'queued',
  error text,
  created_at timestamptz not null default now()
);

create index idx_production_members_lookup on public.production_members(production_id, user_id);
create index idx_ros_items_production_order on public.ros_items(production_id, sort_order);
create index idx_contacts_production on public.contacts(production_id);
create index idx_show_assets_production on public.show_assets(production_id);
create index idx_crew_share_tokens_production on public.crew_share_tokens(production_id);
create index idx_notifications_production on public.notifications(production_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger productions_touch_updated_at
before update on public.productions
for each row execute function public.touch_updated_at();

create trigger ros_items_touch_updated_at
before update on public.ros_items
for each row execute function public.touch_updated_at();

create trigger contacts_touch_updated_at
before update on public.contacts
for each row execute function public.touch_updated_at();

create trigger asset_folders_touch_updated_at
before update on public.asset_folders
for each row execute function public.touch_updated_at();

create trigger show_assets_touch_updated_at
before update on public.show_assets
for each row execute function public.touch_updated_at();

create or replace function public.is_production_member(production uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.productions p
    where p.id = production
      and p.creator_id = auth.uid()
  )
  or exists (
    select 1
    from public.production_members pm
    where pm.production_id = production
      and pm.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_production(production uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.productions p
    where p.id = production
      and p.creator_id = auth.uid()
  )
  or exists (
    select 1
    from public.production_members pm
    where pm.production_id = production
      and pm.user_id = auth.uid()
      and pm.role in ('creator', 'co_owner')
  );
$$;

create or replace function public.add_creator_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.production_members (production_id, user_id, role)
  values (new.id, new.creator_id, 'creator')
  on conflict (production_id, user_id) do nothing;

  return new;
end;
$$;

create trigger productions_add_creator_membership
after insert on public.productions
for each row execute function public.add_creator_membership();

create or replace function public.get_crew_show_snapshot(share_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  token_record public.crew_share_tokens%rowtype;
  payload jsonb;
begin
  select *
  into token_record
  from public.crew_share_tokens
  where token = share_token
    and revoked_at is null
    and (expires_at is null or expires_at > now());

  if not found then
    raise exception 'Invalid or expired crew link';
  end if;

  select jsonb_build_object(
    'production', jsonb_build_object(
      'id', p.id,
      'title', p.title,
      'event_date', p.event_date,
      'timezone', p.timezone
    ),
    'ros_items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'sort_order', r.sort_order,
          'timecode', r.timecode,
          'segment', r.segment,
          'cue', r.cue,
          'department', r.department,
          'owner', r.owner,
          'notes', r.notes
        )
        order by r.sort_order, r.created_at
      )
      from public.ros_items r
      where r.production_id = p.id
        and r.is_private = false
    ), '[]'::jsonb),
    'contacts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'role', c.role,
          'department_tags', c.department_tags,
          'tab_assignments', c.tab_assignments,
          'email', c.email,
          'phone', c.phone
        )
        order by c.name
      )
      from public.contacts c
      where c.production_id = p.id
        and c.is_private = false
    ), '[]'::jsonb),
    'assets', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'original_name', a.original_name,
          'mime_type', a.mime_type,
          'size_bytes', a.size_bytes,
          'visibility', a.visibility
        )
        order by a.created_at desc
      )
      from public.show_assets a
      where a.production_id = p.id
        and a.visibility = 'crew_read'
    ), '[]'::jsonb)
  )
  into payload
  from public.productions p
  where p.id = token_record.production_id;

  return payload;
end;
$$;

alter table public.profiles enable row level security;
alter table public.productions enable row level security;
alter table public.production_members enable row level security;
alter table public.ros_items enable row level security;
alter table public.contacts enable row level security;
alter table public.asset_folders enable row level security;
alter table public.show_assets enable row level security;
alter table public.crew_share_tokens enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;

create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy "profiles_upsert_own"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "productions_select_members"
on public.productions for select
to authenticated
using (public.is_production_member(id));

create policy "productions_insert_creator"
on public.productions for insert
to authenticated
with check (creator_id = auth.uid());

create policy "productions_update_editors"
on public.productions for update
to authenticated
using (public.can_edit_production(id))
with check (public.can_edit_production(id));

create policy "productions_delete_creator"
on public.productions for delete
to authenticated
using (creator_id = auth.uid());

create policy "production_members_select_members"
on public.production_members for select
to authenticated
using (public.is_production_member(production_id));

create policy "production_members_insert_editors"
on public.production_members for insert
to authenticated
with check (public.can_edit_production(production_id));

create policy "production_members_update_editors"
on public.production_members for update
to authenticated
using (public.can_edit_production(production_id))
with check (public.can_edit_production(production_id));

create policy "production_members_delete_creator"
on public.production_members for delete
to authenticated
using (
  exists (
    select 1
    from public.productions p
    where p.id = production_members.production_id
      and p.creator_id = auth.uid()
  )
);

create policy "ros_items_select_members"
on public.ros_items for select
to authenticated
using (public.is_production_member(production_id));

create policy "ros_items_insert_editors"
on public.ros_items for insert
to authenticated
with check (public.can_edit_production(production_id));

create policy "ros_items_update_editors"
on public.ros_items for update
to authenticated
using (public.can_edit_production(production_id))
with check (public.can_edit_production(production_id));

create policy "ros_items_delete_editors"
on public.ros_items for delete
to authenticated
using (public.can_edit_production(production_id));

create policy "contacts_select_members"
on public.contacts for select
to authenticated
using (public.is_production_member(production_id));

create policy "contacts_insert_editors"
on public.contacts for insert
to authenticated
with check (public.can_edit_production(production_id));

create policy "contacts_update_editors"
on public.contacts for update
to authenticated
using (public.can_edit_production(production_id))
with check (public.can_edit_production(production_id));

create policy "contacts_delete_editors"
on public.contacts for delete
to authenticated
using (public.can_edit_production(production_id));

create policy "asset_folders_select_members"
on public.asset_folders for select
to authenticated
using (public.is_production_member(production_id));

create policy "asset_folders_write_editors"
on public.asset_folders for all
to authenticated
using (public.can_edit_production(production_id))
with check (public.can_edit_production(production_id));

create policy "show_assets_select_members"
on public.show_assets for select
to authenticated
using (public.is_production_member(production_id));

create policy "show_assets_write_editors"
on public.show_assets for all
to authenticated
using (public.can_edit_production(production_id))
with check (public.can_edit_production(production_id));

create policy "crew_tokens_select_editors"
on public.crew_share_tokens for select
to authenticated
using (public.can_edit_production(production_id));

create policy "crew_tokens_insert_editors"
on public.crew_share_tokens for insert
to authenticated
with check (public.can_edit_production(production_id));

create policy "crew_tokens_update_editors"
on public.crew_share_tokens for update
to authenticated
using (public.can_edit_production(production_id))
with check (public.can_edit_production(production_id));

create policy "crew_tokens_delete_editors"
on public.crew_share_tokens for delete
to authenticated
using (public.can_edit_production(production_id));

create policy "notifications_select_members"
on public.notifications for select
to authenticated
using (public.is_production_member(production_id));

create policy "notifications_insert_editors"
on public.notifications for insert
to authenticated
with check (public.can_edit_production(production_id));

create policy "deliveries_select_members"
on public.notification_deliveries for select
to authenticated
using (
  exists (
    select 1
    from public.notifications n
    where n.id = notification_deliveries.notification_id
      and public.is_production_member(n.production_id)
  )
);

insert into storage.buckets (id, name, public)
values ('show-assets', 'show-assets', false)
on conflict (id) do nothing;

create policy "show_assets_storage_select_members"
on storage.objects for select
to authenticated
using (
  bucket_id = 'show-assets'
  and public.is_production_member((storage.foldername(name))[1]::uuid)
);

create policy "show_assets_storage_insert_editors"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'show-assets'
  and public.can_edit_production((storage.foldername(name))[1]::uuid)
);

create policy "show_assets_storage_update_editors"
on storage.objects for update
to authenticated
using (
  bucket_id = 'show-assets'
  and public.can_edit_production((storage.foldername(name))[1]::uuid)
)
with check (
  bucket_id = 'show-assets'
  and public.can_edit_production((storage.foldername(name))[1]::uuid)
);

create policy "show_assets_storage_delete_editors"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'show-assets'
  and public.can_edit_production((storage.foldername(name))[1]::uuid)
);

grant execute on function public.get_crew_show_snapshot(text) to anon, authenticated;
grant execute on function public.is_production_member(uuid) to authenticated;
grant execute on function public.can_edit_production(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.ros_items;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
