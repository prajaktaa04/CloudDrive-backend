create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  image_url text,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references users(id) on delete cascade,
  parent_id uuid references folders(id) on delete set null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists folders_owner_parent_name_active
  on folders(owner_id, parent_id, name) where is_deleted = false;
create index if not exists folders_owner_idx on folders(owner_id);
create index if not exists folders_parent_idx on folders(parent_id);

create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  storage_key text unique not null,
  owner_id uuid not null references users(id) on delete cascade,
  folder_id uuid references folders(id) on delete set null,
  version_id uuid,
  checksum text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists files_owner_idx on files(owner_id);
create index if not exists files_folder_idx on files(folder_id);
create index if not exists files_name_trgm_idx on files using gin(name gin_trgm_ops);

create table if not exists file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id) on delete cascade,
  version_number integer not null,
  storage_key text not null,
  size_bytes bigint not null default 0,
  checksum text,
  created_at timestamptz not null default now(),
  unique(file_id, version_number)
);

alter table files
  drop constraint if exists files_version_id_fkey;
alter table files
  add constraint files_version_id_fkey foreign key(version_id) references file_versions(id) on delete set null;

create table if not exists shares (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check(resource_type in ('file','folder')),
  resource_id uuid not null,
  grantee_user_id uuid not null references users(id) on delete cascade,
  role text not null check(role in ('viewer','editor')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(resource_type, resource_id, grantee_user_id)
);
create index if not exists shares_resource_idx on shares(resource_type, resource_id);
create index if not exists shares_grantee_idx on shares(grantee_user_id);
create index if not exists shares_created_by_idx on shares(created_by);

create table if not exists link_shares (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check(resource_type in ('file','folder')),
  resource_id uuid not null,
  token text unique not null,
  role text not null default 'viewer' check(role = 'viewer'),
  password_hash text,
  expires_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists link_shares_token_idx on link_shares(token);

create table if not exists stars (
  user_id uuid not null references users(id) on delete cascade,
  resource_type text not null check(resource_type in ('file','folder')),
  resource_id uuid not null,
  primary key(user_id, resource_type, resource_id)
);

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references users(id) on delete set null,
  action text not null check(action in ('upload','rename','delete','restore','move','share','download','create_folder')),
  resource_type text not null check(resource_type in ('file','folder')),
  resource_id uuid not null,
  context jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activities_created_idx on activities(created_at desc);

-- Private storage bucket. The backend signs URLs using the service role.
insert into storage.buckets (id, name, public)
values ('drive', 'drive', false)
on conflict (id) do update set public = false;

