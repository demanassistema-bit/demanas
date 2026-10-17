-- =====================================================================
-- DEMANAS · 01 · Base: equipe, permissões e códigos de acesso
-- =====================================================================
-- Quem entra:
--   Só por convite (o cadastro aberto está desligado no Supabase).
--   Cada pessoa convidada ganha um perfil automaticamente.
--   A PRIMEIRA pessoa convidada vira administradora (proprietária) com
--   acesso a tudo. Ela promove a outra proprietária na tela Equipe.
--
-- Níveis de acesso (parte 5 do briefing):
--   1. Acesso comum → qualquer pessoa ativa logada: vende, consulta
--                     produtos e estoque.
--   2. Financeiro   → permissão dada pela admin (pode_financeiro)
--                     + desbloqueio com o código do Financeiro.
--   3. Fiscal       → permissão dada pela admin (pode_fiscal)
--                     + desbloqueio com o código próprio da Nota fiscal.
--   Desbloqueio vale 4 h. 5 erros em 15 min bloqueiam por 15 min.
--   Trocar o código derruba os desbloqueios daquela área.
--
-- Os códigos nunca ficam legíveis: são guardados com hash (bcrypt) numa
-- tabela sem nenhuma policy de leitura. A conferência acontece só dentro
-- de desbloquear_area(). As tabelas do Financeiro e do Fiscal (etapas 6
-- e 7) vão checar tem_acesso_area() no próprio banco (RLS): não adianta
-- burlar a tela, o banco recusa.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.papel_usuario as enum ('admin', 'membro');
create type public.area_protegida as enum ('financeiro', 'fiscal');

-- ---------------------------------------------------------------------
-- Função utilitária: mantém atualizado_em em dia
-- ---------------------------------------------------------------------
create or replace function public.definir_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Perfis (1 por pessoa do Supabase Auth)
-- admin = proprietária · membro = vendedora
-- ---------------------------------------------------------------------
create table public.perfis (
  id               uuid primary key references auth.users (id) on delete cascade,
  nome             text not null default '' check (length(nome) <= 80),
  email            text not null,
  papel            public.papel_usuario not null default 'membro',
  pode_financeiro  boolean not null default false,
  pode_fiscal      boolean not null default false,
  ativo            boolean not null default true,
  tema             text not null default 'claro' check (tema in ('claro', 'escuro')),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

comment on table public.perfis is 'Equipe da deManas. Papel e permissões (pode_*, ativo) só a admin altera.';

create trigger perfis_atualizado_em
  before update on public.perfis
  for each row execute function public.definir_atualizado_em();

-- ---------------------------------------------------------------------
-- Ajudantes de permissão (SECURITY DEFINER para evitar recursão de RLS)
-- ---------------------------------------------------------------------
create or replace function public.eh_membro_ativo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and ativo
  );
$$;

create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and ativo and papel = 'admin'
  );
$$;

-- ---------------------------------------------------------------------
-- Perfil criado sozinho ao convidar alguém.
-- A primeira pessoa vira admin com acesso a tudo.
-- ---------------------------------------------------------------------
create or replace function public.criar_perfil_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_primeira boolean;
begin
  select not exists (select 1 from public.perfis) into v_primeira;

  insert into public.perfis (id, email, nome, papel, pode_financeiro, pode_fiscal)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'nome', split_part(coalesce(new.email, ''), '@', 1)), 80),
    case when v_primeira then 'admin'::public.papel_usuario else 'membro'::public.papel_usuario end,
    v_primeira,
    v_primeira
  );
  return new;
end;
$$;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();

-- ---------------------------------------------------------------------
-- Uma vendedora não altera as próprias permissões.
-- A loja nunca fica sem admin ativa.
-- (Chamadas sem usuário, como o SQL Editor do Supabase, passam.)
-- ---------------------------------------------------------------------
create or replace function public.proteger_campos_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.eh_admin() then
    if new.papel           is distinct from old.papel
    or new.pode_financeiro is distinct from old.pode_financeiro
    or new.pode_fiscal     is distinct from old.pode_fiscal
    or new.ativo           is distinct from old.ativo
    or new.email           is distinct from old.email then
      raise exception 'Somente as proprietárias podem alterar permissões.'
        using errcode = '42501';
    end if;
  end if;

  -- tirar a última admin ativa deixaria a loja sem ninguém para convidar
  if old.papel = 'admin' and old.ativo and (new.papel <> 'admin' or not new.ativo)
     and not exists (
       select 1 from public.perfis
       where id <> old.id and papel = 'admin' and ativo
     ) then
    raise exception 'A loja precisa de pelo menos uma proprietária ativa.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger perfis_proteger_campos
  before update on public.perfis
  for each row execute function public.proteger_campos_perfil();

alter table public.perfis enable row level security;

create policy "Equipe ativa vê os perfis"
  on public.perfis for select to authenticated
  using ((select public.eh_membro_ativo()) or id = (select auth.uid()));

create policy "Cada uma edita o próprio perfil; admin edita todos"
  on public.perfis for update to authenticated
  using (id = (select auth.uid()) or (select public.eh_admin()))
  with check (id = (select auth.uid()) or (select public.eh_admin()));

-- Ninguém apaga perfil pela tela: quem sai da equipe é desativada
-- (o histórico de vendas continua apontando para ela).

-- ---------------------------------------------------------------------
-- Códigos de acesso (Financeiro / Fiscal)
-- Sem policies = ninguém lê pela API. Só as funções abaixo tocam aqui.
-- ---------------------------------------------------------------------
create table public.codigos_acesso (
  area            public.area_protegida primary key,
  codigo_hash     text not null,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid references public.perfis (id) on delete set null
);

alter table public.codigos_acesso enable row level security;
revoke all on public.codigos_acesso from anon, authenticated;

-- Desbloqueios temporários (quem digitou o código certo, e até quando)
create table public.desbloqueios (
  usuario_id  uuid not null references public.perfis (id) on delete cascade,
  area        public.area_protegida not null,
  expira_em   timestamptz not null,
  criado_em   timestamptz not null default now(),
  primary key (usuario_id, area)
);

alter table public.desbloqueios enable row level security;
revoke insert, update on public.desbloqueios from anon, authenticated;

create policy "Cada uma vê os próprios desbloqueios"
  on public.desbloqueios for select to authenticated
  using (usuario_id = (select auth.uid()));

create policy "Cada uma encerra os próprios desbloqueios"
  on public.desbloqueios for delete to authenticated
  using (usuario_id = (select auth.uid()));

-- Tentativas (proteção contra adivinhação e auditoria)
create table public.tentativas_codigo (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.perfis (id) on delete cascade,
  area        public.area_protegida not null,
  sucesso     boolean not null,
  criado_em   timestamptz not null default now()
);

create index tentativas_codigo_usuario_idx
  on public.tentativas_codigo (usuario_id, area, criado_em desc);

alter table public.tentativas_codigo enable row level security;
revoke insert, update, delete on public.tentativas_codigo from anon, authenticated;

create policy "Admin audita tentativas"
  on public.tentativas_codigo for select to authenticated
  using ((select public.eh_admin()));

-- ---------------------------------------------------------------------
-- tem_acesso_area(): usada pelas policies do Financeiro e do Fiscal.
-- Exige: pessoa ativa + permissão dada + desbloqueio válido.
-- ---------------------------------------------------------------------
create or replace function public.tem_acesso_area(p_area public.area_protegida)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.perfis p
    join public.desbloqueios d
      on d.usuario_id = p.id and d.area = p_area and d.expira_em > now()
    where p.id = auth.uid()
      and p.ativo
      and case p_area
            when 'financeiro' then p.pode_financeiro
            when 'fiscal'     then p.pode_fiscal
          end
  );
$$;

-- ---------------------------------------------------------------------
-- desbloquear_area(): a pessoa digita o código na tela.
-- Devolve {ok, expira_em} ou {ok:false, erro}.
-- ---------------------------------------------------------------------
create or replace function public.desbloquear_area(
  p_area   public.area_protegida,
  p_codigo text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_permitido boolean;
  v_hash      text;
  v_falhas    int;
  v_expira    timestamptz := now() + interval '4 hours';
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'erro', 'Entre no sistema para continuar.');
  end if;

  select p.ativo and case p_area
                       when 'financeiro' then p.pode_financeiro
                       when 'fiscal'     then p.pode_fiscal
                     end
    into v_permitido
  from public.perfis p
  where p.id = v_uid;

  if not coalesce(v_permitido, false) then
    return jsonb_build_object('ok', false, 'erro', 'Você não tem permissão para esta área.');
  end if;

  select count(*) into v_falhas
  from public.tentativas_codigo t
  where t.usuario_id = v_uid
    and t.area = p_area
    and not t.sucesso
    and t.criado_em > now() - interval '15 minutes';

  if v_falhas >= 5 then
    return jsonb_build_object('ok', false,
      'erro', 'Muitas tentativas erradas. Espere 15 minutos e tente de novo.');
  end if;

  select c.codigo_hash into v_hash
  from public.codigos_acesso c
  where c.area = p_area;

  if v_hash is null then
    return jsonb_build_object('ok', false,
      'erro', 'O código desta área ainda não foi criado. Uma proprietária cria em Equipe.');
  end if;

  if extensions.crypt(coalesce(p_codigo, ''), v_hash) <> v_hash then
    insert into public.tentativas_codigo (usuario_id, area, sucesso)
    values (v_uid, p_area, false);
    return jsonb_build_object('ok', false, 'erro', 'Código incorreto.');
  end if;

  insert into public.tentativas_codigo (usuario_id, area, sucesso)
  values (v_uid, p_area, true);

  insert into public.desbloqueios (usuario_id, area, expira_em)
  values (v_uid, p_area, v_expira)
  on conflict (usuario_id, area)
  do update set expira_em = excluded.expira_em, criado_em = now();

  return jsonb_build_object('ok', true, 'expira_em', v_expira);
end;
$$;

-- Tranca a área (botão "Trancar agora" e ao sair do sistema)
create or replace function public.bloquear_area(p_area public.area_protegida default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.desbloqueios
  where usuario_id = auth.uid()
    and (p_area is null or area = p_area);
$$;

-- A admin cria ou troca o código de uma área.
-- Trocar o código derruba todos os desbloqueios daquela área.
create or replace function public.definir_codigo_area(
  p_area   public.area_protegida,
  p_codigo text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.eh_admin() then
    raise exception 'Somente as proprietárias podem definir códigos.' using errcode = '42501';
  end if;

  if p_codigo is null or length(trim(p_codigo)) < 4 or length(p_codigo) > 20 then
    raise exception 'O código precisa ter de 4 a 20 caracteres.';
  end if;

  insert into public.codigos_acesso (area, codigo_hash, atualizado_em, atualizado_por)
  values (p_area, extensions.crypt(p_codigo, extensions.gen_salt('bf', 10)), now(), auth.uid())
  on conflict (area) do update
    set codigo_hash    = excluded.codigo_hash,
        atualizado_em  = now(),
        atualizado_por = excluded.atualizado_por;

  delete from public.desbloqueios where area = p_area;
end;
$$;

-- Para a tela: o que mostrar no menu
create or replace function public.minhas_permissoes()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'admin',               p.papel = 'admin',
    'pode_financeiro',     p.pode_financeiro,
    'pode_fiscal',         p.pode_fiscal,
    'financeiro_liberado', public.tem_acesso_area('financeiro'),
    'fiscal_liberado',     public.tem_acesso_area('fiscal'),
    'codigos_criados',     (select coalesce(jsonb_agg(c.area), '[]'::jsonb) from public.codigos_acesso c)
  )
  from public.perfis p
  where p.id = auth.uid() and p.ativo;
$$;

-- ---------------------------------------------------------------------
-- Execução das funções: nada para quem não entrou
-- ---------------------------------------------------------------------
revoke execute on function public.eh_membro_ativo()                                 from public, anon;
revoke execute on function public.eh_admin()                                        from public, anon;
revoke execute on function public.tem_acesso_area(public.area_protegida)           from public, anon;
revoke execute on function public.desbloquear_area(public.area_protegida, text)    from public, anon;
revoke execute on function public.bloquear_area(public.area_protegida)             from public, anon;
revoke execute on function public.definir_codigo_area(public.area_protegida, text) from public, anon;
revoke execute on function public.minhas_permissoes()                              from public, anon;
revoke execute on function public.criar_perfil_novo_usuario()                      from public, anon, authenticated;
revoke execute on function public.proteger_campos_perfil()                         from public, anon, authenticated;

grant execute on function public.eh_membro_ativo()                                 to authenticated;
grant execute on function public.eh_admin()                                        to authenticated;
grant execute on function public.tem_acesso_area(public.area_protegida)           to authenticated;
grant execute on function public.desbloquear_area(public.area_protegida, text)    to authenticated;
grant execute on function public.bloquear_area(public.area_protegida)             to authenticated;
grant execute on function public.definir_codigo_area(public.area_protegida, text) to authenticated;
grant execute on function public.minhas_permissoes()                              to authenticated;
