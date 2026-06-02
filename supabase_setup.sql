create table if not exists public.stock_ledger_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.stock_ledger_state enable row level security;

drop policy if exists "stock ledger read" on public.stock_ledger_state;
drop policy if exists "stock ledger insert" on public.stock_ledger_state;
drop policy if exists "stock ledger update" on public.stock_ledger_state;

create policy "stock ledger read"
on public.stock_ledger_state
for select
to anon
using (id = 'main');

create policy "stock ledger insert"
on public.stock_ledger_state
for insert
to anon
with check (id = 'main');

create policy "stock ledger update"
on public.stock_ledger_state
for update
to anon
using (id = 'main')
with check (id = 'main');
