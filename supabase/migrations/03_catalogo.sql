-- =====================================================================
-- DEMANAS · 03 · Catálogo: CNPJs, categorias, marcas, fornecedores,
--                produtos, variações, kits, custos, preços e auditoria
-- =====================================================================
-- Produto é o item genérico ("Sutiã renda Aurora"). Variação é o que
-- existe fisicamente (modelo, cor, tamanho, tonalidade, volume). Preço,
-- código de barras e estoque mínimo vivem na variação.
--
-- Decisões (Bruna, 17/10/2026):
--   · Código de barras é o do fabricante. Quando não houver (kit,
--     "pague um e leve dois"), o sistema cria um próprio: EAN-13 com
--     prefixo 200, faixa reservada para uso interno da loja.
--   · Lote e validade existem nos cosméticos, mas não são obrigatórios
--     (controla_validade é só um padrão do produto).
--   · Lingerie tem modelo, além de cor e tamanho.
--   · Sem foto: o produto fica só com o nome.
--   · Kit (ou promoção) é um produto cujo item é feito de outras
--     variações (kit_itens). A baixa dos componentes chega na Etapa 4.
--
-- Acesso:
--   · Toda a equipe ativa vê o catálogo (para vender e consultar).
--   · Só as proprietárias cadastram, editam, arquivam e apagam.
--   · CUSTO fica numa tabela separada (custos_variacao) que só quem tem
--     pode_ver_custos enxerga. A vendedora não vê custo nem margem,
--     nem tentando pela API: o banco não entrega.
--   · Toda mudança de preço vai para historico_precos (quem, quando,
--     de quanto para quanto). Toda alteração do catálogo vai para
--     auditoria.
--
-- Esta migration também traz o que faltou na 01 (parte 7 do briefing):
-- pode_ver_custos no perfil, a tabela parametros e a auditoria.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Perfil: pode_ver_custos (as proprietárias já ganham)
-- ---------------------------------------------------------------------
alter table public.perfis add column pode_ver_custos boolean not null default false;
update public.perfis set pode_ver_custos = true where papel = 'admin';

create or replace function public.pode_ver_custos()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and ativo and (pode_ver_custos or papel = 'admin')
  );
$$;

-- a primeira pessoa (admin) também vê custos
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

  insert into public.perfis (id, email, nome, papel, pode_financeiro, pode_fiscal, pode_ver_custos)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'nome', split_part(coalesce(new.email, ''), '@', 1)), 80),
    case when v_primeira then 'admin'::public.papel_usuario else 'membro'::public.papel_usuario end,
    v_primeira, v_primeira, v_primeira
  );
  return new;
end;
$$;

-- pode_ver_custos também é permissão: só admin muda
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
    or new.pode_ver_custos is distinct from old.pode_ver_custos
    or new.ativo           is distinct from old.ativo
    or new.email           is distinct from old.email then
      raise exception 'Somente as proprietárias podem alterar permissões.'
        using errcode = '42501';
    end if;
  end if;

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
    'pode_ver_custos',     p.pode_ver_custos or p.papel = 'admin',
    'financeiro_liberado', public.tem_acesso_area('financeiro'),
    'fiscal_liberado',     public.tem_acesso_area('fiscal'),
    'codigos_criados',     (select coalesce(jsonb_agg(c.area), '[]'::jsonb) from public.codigos_acesso c)
  )
  from public.perfis p
  where p.id = auth.uid() and p.ativo;
$$;

-- ---------------------------------------------------------------------
-- Parâmetros da loja (chave → valor). Ex.: limite de desconto.
-- ---------------------------------------------------------------------
create table public.parametros (
  chave          text primary key check (chave ~ '^[a-z_]{2,60}$'),
  valor          jsonb not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references public.perfis (id) on delete set null
);

create trigger parametros_atualizado_em
  before update on public.parametros
  for each row execute function public.definir_atualizado_em();

alter table public.parametros enable row level security;
create policy "Equipe vê os parâmetros" on public.parametros for select to authenticated using ((select public.eh_membro_ativo()));
create policy "Admin cria parâmetros" on public.parametros for insert to authenticated with check ((select public.eh_admin()));
create policy "Admin altera parâmetros" on public.parametros for update to authenticated using ((select public.eh_admin())) with check ((select public.eh_admin()));

-- ---------------------------------------------------------------------
-- Auditoria: quem fez o quê, com o antes e o depois.
-- Só os gatilhos escrevem aqui; ninguém edita nem apaga.
-- ---------------------------------------------------------------------
create table public.auditoria (
  id          bigint generated always as identity primary key,
  usuario_id  uuid references public.perfis (id) on delete set null,
  acao        text not null check (acao in ('criou', 'alterou', 'apagou')),
  entidade    text not null,
  entidade_id text,
  antes       jsonb,
  depois      jsonb,
  criado_em   timestamptz not null default now()
);

create index auditoria_entidade_idx on public.auditoria (entidade, entidade_id, criado_em desc);

alter table public.auditoria enable row level security;
revoke insert, update, delete on public.auditoria from anon, authenticated;
create policy "Admin consulta a auditoria" on public.auditoria for select to authenticated using ((select public.eh_admin()));

create or replace function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes  jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_depois jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  -- não registra update que não mudou nada além de atualizado_em
  if tg_op = 'UPDATE' and (v_antes - 'atualizado_em') = (v_depois - 'atualizado_em') then
    return new;
  end if;
  insert into public.auditoria (usuario_id, acao, entidade, entidade_id, antes, depois)
  values (
    auth.uid(),
    case tg_op when 'INSERT' then 'criou' when 'UPDATE' then 'alterou' else 'apagou' end,
    tg_table_name,
    coalesce(v_depois ->> 'id', v_antes ->> 'id', v_depois ->> 'variacao_id', v_antes ->> 'variacao_id',
             v_depois ->> 'categoria_id', v_antes ->> 'categoria_id', v_depois ->> 'kit_variacao_id', v_antes ->> 'kit_variacao_id'),
    v_antes,
    v_depois
  );
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------
-- Os dois CNPJs da loja. No dia a dia aparece só o apelido.
-- ---------------------------------------------------------------------
create table public.empresas (
  id                  text primary key check (id ~ '^[a-z]{2,20}$'),
  apelido             text not null check (length(trim(apelido)) between 1 and 20),
  dona                text not null default '' check (length(dona) <= 40),
  tipo                text not null check (tipo in ('me', 'mei')),
  razao_social        text not null default '' check (length(razao_social) <= 120),
  cnpj                text not null default '' check (cnpj ~ '^[0-9A-Z./-]{0,18}$'),
  inscricao_estadual  text not null default '' check (length(inscricao_estadual) <= 20),
  regime              text not null default '' check (regime in ('', 'mei', 'simples', 'presumido', 'real')),
  endereco            text not null default '' check (length(endereco) <= 150),
  municipio           text not null default '' check (length(municipio) <= 60),
  uf                  text not null default '' check (uf ~ '^([A-Z]{2})?$'),
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

comment on table public.empresas is 'CNPJ Day = ME (Simples, emite nota). CNPJ Fê = MEI (só consumidor final, sem nota). Decidido em 16/10/2026.';

insert into public.empresas (id, apelido, dona, tipo, regime) values
  ('day', 'CNPJ Day', 'Day', 'me', 'simples'),
  ('fe',  'CNPJ Fê',  'Fê',  'mei', 'mei');

create trigger empresas_atualizado_em before update on public.empresas
  for each row execute function public.definir_atualizado_em();
create trigger empresas_auditoria after insert or update or delete on public.empresas
  for each row execute function public.registrar_auditoria();

alter table public.empresas enable row level security;
create policy "Equipe vê os CNPJs" on public.empresas for select to authenticated using ((select public.eh_membro_ativo()));
create policy "Admin altera os CNPJs" on public.empresas for update to authenticated using ((select public.eh_admin())) with check ((select public.eh_admin()));

-- ---------------------------------------------------------------------
-- Categorias, marcas e fornecedores
-- ---------------------------------------------------------------------
create table public.categorias (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (length(trim(nome)) between 1 and 40),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create unique index categorias_nome_unico on public.categorias (lower(trim(nome)));

create table public.marcas (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (length(trim(nome)) between 1 and 40),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create unique index marcas_nome_unico on public.marcas (lower(trim(nome)));

create table public.fornecedores (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (length(trim(nome)) between 2 and 60),
  documento      text not null default '' check (length(documento) <= 18),
  whatsapp       text not null default '' check (length(whatsapp) <= 20),
  email          text not null default '' check (length(email) <= 120),
  prazo_dias     int check (prazo_dias between 0 and 365),
  observacao     text not null default '' check (length(observacao) <= 200),
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create unique index fornecedores_nome_unico on public.fornecedores (lower(trim(nome)));

-- Dados fiscais por categoria: quem preenche é a contadora. Nada é inventado.
create table public.perfis_fiscais (
  categoria_id   uuid primary key references public.categorias (id) on delete cascade,
  ncm            text not null default '' check (ncm ~ '^(\d{8})?$'),
  cest           text not null default '' check (cest ~ '^(\d{7})?$'),
  origem         text not null default '' check (origem ~ '^([0-8])?$'),
  unidade        text not null default 'UN' check (unidade ~ '^[A-Z]{1,6}$'),
  cfop           text not null default '' check (cfop ~ '^(\d{4})?$'),
  csosn_ou_cst   text not null default '' check (csosn_ou_cst ~ '^(\d{2,3})?$'),
  validado       boolean not null default false,
  observacao     text not null default '' check (length(observacao) <= 200),
  atualizado_em  timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['categorias', 'marcas', 'fornecedores', 'perfis_fiscais'] loop
    execute format('create trigger %1$s_atualizado_em before update on public.%1$s for each row execute function public.definir_atualizado_em()', t);
    execute format('create trigger %1$s_auditoria after insert or update or delete on public.%1$s for each row execute function public.registrar_auditoria()', t);
    execute format('alter table public.%s enable row level security', t);
    execute format('create policy "Equipe vê" on public.%s for select to authenticated using ((select public.eh_membro_ativo()))', t);
    execute format('create policy "Admin cria" on public.%s for insert to authenticated with check ((select public.eh_admin()))', t);
    execute format('create policy "Admin altera" on public.%s for update to authenticated using ((select public.eh_admin())) with check ((select public.eh_admin()))', t);
    execute format('create policy "Admin apaga" on public.%s for delete to authenticated using ((select public.eh_admin()))', t);
  end loop;
end $$;

-- quem tem a Nota fiscal liberada também mexe nos dados fiscais (a contadora pode ter acesso só a isso)
create policy "Fiscal cria" on public.perfis_fiscais for insert to authenticated with check ((select public.tem_acesso_area('fiscal')));
create policy "Fiscal altera" on public.perfis_fiscais for update to authenticated using ((select public.tem_acesso_area('fiscal'))) with check ((select public.tem_acesso_area('fiscal')));

-- ---------------------------------------------------------------------
-- Produtos e variações
-- ---------------------------------------------------------------------
create table public.produtos (
  id                 uuid primary key default gen_random_uuid(),
  nome               text not null check (length(trim(nome)) between 2 and 80),
  descricao          text not null default '' check (length(descricao) <= 300),
  tipo               text not null check (tipo in ('lingerie', 'cosmetico', 'outro', 'kit')),
  categoria_id       uuid references public.categorias (id) on delete set null,
  marca_id           uuid references public.marcas (id) on delete set null,
  fornecedor_id      uuid references public.fornecedores (id) on delete set null,
  empresa_id         text not null references public.empresas (id),
  controla_validade  boolean not null default false,
  ativo              boolean not null default true,
  arquivado_em       timestamptz,
  criado_por         uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
-- dois produtos ativos com o mesmo nome confundem a venda
create unique index produtos_nome_ativo_unico on public.produtos (lower(trim(nome))) where ativo;
create index produtos_categoria_idx on public.produtos (categoria_id);

-- Código interno (nunca aparece como "SKU" na tela)
create sequence public.seq_codigo_interno start 1001;
-- Código de barras próprio: 200 + 9 dígitos + verificador (EAN-13)
create sequence public.seq_codigo_barras_proprio start 1;

create or replace function public.digito_ean(p_codigo text)
returns int
language sql
immutable
set search_path = ''
as $$
  -- peso 3 nas posições pares a partir da direita (padrão EAN/UPC)
  select (10 - (sum(substr(p_codigo, i, 1)::int * case when (length(p_codigo) - i) % 2 = 0 then 3 else 1 end) % 10)) % 10
  from generate_series(1, length(p_codigo)) as i;
$$;

create table public.variacoes (
  id               uuid primary key default gen_random_uuid(),
  produto_id       uuid not null references public.produtos (id) on delete cascade,
  modelo           text check (length(modelo) <= 20),
  cor              text check (length(cor) <= 20),
  tamanho          text check (length(tamanho) <= 20),
  tonalidade       text check (length(tonalidade) <= 20),
  volume           text check (length(volume) <= 20),
  codigo_interno   text not null default ('D' || nextval('public.seq_codigo_interno')),
  codigo_barras    text check (codigo_barras ~ '^[0-9A-Za-z-]{4,30}$'),
  codigo_proprio   boolean not null default false,
  preco_venda      numeric(12,2) not null check (preco_venda between 0 and 99999.99),
  estoque_minimo   int not null default 0 check (estoque_minimo between 0 and 999),
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create unique index variacoes_codigo_interno_unico on public.variacoes (codigo_interno);
create unique index variacoes_codigo_barras_unico on public.variacoes (codigo_barras) where codigo_barras is not null;
-- a mesma combinação não se repete dentro de um produto
create unique index variacoes_combinacao_unica on public.variacoes (
  produto_id, lower(coalesce(modelo, '')), lower(coalesce(cor, '')), lower(coalesce(tamanho, '')),
  lower(coalesce(tonalidade, '')), lower(coalesce(volume, ''))
);
create index variacoes_produto_idx on public.variacoes (produto_id);

-- Sem código do fabricante e pedido de código próprio → o sistema cria
create or replace function public.preparar_variacao()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_base text;
begin
  new.modelo     := nullif(trim(new.modelo), '');
  new.cor        := nullif(trim(new.cor), '');
  new.tamanho    := nullif(trim(new.tamanho), '');
  new.tonalidade := nullif(trim(new.tonalidade), '');
  new.volume     := nullif(trim(new.volume), '');
  new.codigo_barras := nullif(trim(new.codigo_barras), '');
  if new.codigo_barras is null and new.codigo_proprio then
    v_base := '200' || lpad(nextval('public.seq_codigo_barras_proprio')::text, 9, '0');
    new.codigo_barras := v_base || public.digito_ean(v_base)::text;
  end if;
  if new.codigo_barras is not null and not new.codigo_proprio and new.codigo_barras ~ '^200\d{10}$' and tg_op = 'INSERT' then
    -- quem digitou um código da faixa interna está usando um código próprio
    new.codigo_proprio := true;
  end if;
  return new;
end;
$$;

create trigger variacoes_preparar before insert or update on public.variacoes
  for each row execute function public.preparar_variacao();

-- Custo: tabela à parte, só para quem pode ver custos
create table public.custos_variacao (
  variacao_id    uuid primary key references public.variacoes (id) on delete cascade,
  custo_medio    numeric(12,2) not null default 0 check (custo_medio between 0 and 99999.99),
  atualizado_em  timestamptz not null default now()
);

-- Histórico de preço: gravado pelo banco a cada mudança
create table public.historico_precos (
  id              bigint generated always as identity primary key,
  variacao_id     uuid not null references public.variacoes (id) on delete cascade,
  preco_anterior  numeric(12,2),
  preco_novo      numeric(12,2) not null,
  usuario_id      uuid references public.perfis (id) on delete set null,
  criado_em       timestamptz not null default now()
);
create index historico_precos_variacao_idx on public.historico_precos (variacao_id, criado_em desc);

create or replace function public.registrar_preco()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.preco_venda is distinct from old.preco_venda then
    insert into public.historico_precos (variacao_id, preco_anterior, preco_novo, usuario_id)
    values (new.id, case when tg_op = 'UPDATE' then old.preco_venda end, new.preco_venda, auth.uid());
  end if;
  return new;
end;
$$;

create trigger variacoes_historico_preco after insert or update of preco_venda on public.variacoes
  for each row execute function public.registrar_preco();

-- Kit ou promoção: um item que é feito de outras variações
create table public.kit_itens (
  kit_variacao_id         uuid not null references public.variacoes (id) on delete cascade,
  componente_variacao_id  uuid not null references public.variacoes (id) on delete restrict,
  quantidade              int not null check (quantidade between 1 and 99),
  primary key (kit_variacao_id, componente_variacao_id),
  check (kit_variacao_id <> componente_variacao_id)
);

do $$
declare t text;
begin
  foreach t in array array['produtos', 'variacoes', 'custos_variacao'] loop
    execute format('create trigger %1$s_atualizado_em before update on public.%1$s for each row execute function public.definir_atualizado_em()', t);
  end loop;
  foreach t in array array['produtos', 'variacoes', 'custos_variacao', 'kit_itens'] loop
    execute format('create trigger %1$s_auditoria after insert or update or delete on public.%1$s for each row execute function public.registrar_auditoria()', t);
    execute format('alter table public.%s enable row level security', t);
    execute format('create policy "Admin cria" on public.%s for insert to authenticated with check ((select public.eh_admin()))', t);
    execute format('create policy "Admin altera" on public.%s for update to authenticated using ((select public.eh_admin())) with check ((select public.eh_admin()))', t);
    execute format('create policy "Admin apaga" on public.%s for delete to authenticated using ((select public.eh_admin()))', t);
  end loop;
end $$;

create policy "Equipe vê os produtos" on public.produtos for select to authenticated using ((select public.eh_membro_ativo()));
create policy "Equipe vê as variações" on public.variacoes for select to authenticated using ((select public.eh_membro_ativo()));
create policy "Equipe vê os kits" on public.kit_itens for select to authenticated using ((select public.eh_membro_ativo()));
create policy "Só quem pode ver custos" on public.custos_variacao for select to authenticated using ((select public.pode_ver_custos()));

alter table public.historico_precos enable row level security;
revoke insert, update, delete on public.historico_precos from anon, authenticated;
create policy "Equipe vê o histórico de preço" on public.historico_precos for select to authenticated using ((select public.eh_membro_ativo()));

-- ---------------------------------------------------------------------
-- salvar_produtos(): cria produtos com as variações e o custo, numa
-- transação só (o cadastro da tela e a importação da planilha usam).
-- Categoria e marca são criadas pelo nome, se ainda não existirem.
-- Roda com as permissões de quem chamou (RLS vale): só admin consegue.
-- Entrada: [{nome, tipo, categoria, marca, empresa_id, controla_validade,
--            variacoes: [{modelo, cor, tamanho, tonalidade, volume,
--                         codigo_barras, codigo_proprio, preco_venda,
--                         custo, estoque_minimo}]}]
-- Saída: lista com os ids dos produtos criados.
-- ---------------------------------------------------------------------
create or replace function public.salvar_produtos(p_produtos jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  p            jsonb;
  v            jsonb;
  v_categoria  uuid;
  v_marca      uuid;
  v_produto    uuid;
  v_variacao   uuid;
  v_ids        jsonb := '[]'::jsonb;
  v_nome       text;
begin
  if not public.eh_admin() then
    raise exception 'Somente as proprietárias cadastram produtos.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_produtos) <> 'array' or jsonb_array_length(p_produtos) = 0 then
    raise exception 'Nenhum produto para salvar.';
  end if;
  if jsonb_array_length(p_produtos) > 2000 then
    raise exception 'São muitos produtos de uma vez: divida a planilha em partes de até 2.000.';
  end if;

  for p in select * from jsonb_array_elements(p_produtos) loop
    v_categoria := null;
    v_marca := null;

    v_nome := nullif(trim(p ->> 'categoria'), '');
    if v_nome is not null then
      select id into v_categoria from public.categorias where lower(trim(nome)) = lower(v_nome);
      if v_categoria is null then
        insert into public.categorias (nome) values (v_nome) returning id into v_categoria;
      end if;
    end if;

    v_nome := nullif(trim(p ->> 'marca'), '');
    if v_nome is not null then
      select id into v_marca from public.marcas where lower(trim(nome)) = lower(v_nome);
      if v_marca is null then
        insert into public.marcas (nome) values (v_nome) returning id into v_marca;
      end if;
    end if;

    if jsonb_array_length(coalesce(p -> 'variacoes', '[]'::jsonb)) = 0 then
      raise exception 'O produto "%" está sem variação.', p ->> 'nome';
    end if;
    if jsonb_array_length(p -> 'variacoes') > 100 then
      raise exception 'O produto "%" passa de 100 variações.', p ->> 'nome';
    end if;

    begin
      insert into public.produtos (nome, tipo, categoria_id, marca_id, empresa_id, controla_validade)
      values (
        trim(p ->> 'nome'), p ->> 'tipo', v_categoria, v_marca,
        coalesce(p ->> 'empresa_id', 'day'), coalesce((p ->> 'controla_validade')::boolean, false)
      )
      returning id into v_produto;
    exception when unique_violation then
      raise exception 'Já existe um produto ativo chamado "%".', trim(p ->> 'nome');
    end;

    for v in select * from jsonb_array_elements(p -> 'variacoes') loop
      begin
        insert into public.variacoes (produto_id, modelo, cor, tamanho, tonalidade, volume, codigo_barras, codigo_proprio, preco_venda, estoque_minimo)
        values (
          v_produto, v ->> 'modelo', v ->> 'cor', v ->> 'tamanho', v ->> 'tonalidade', v ->> 'volume',
          v ->> 'codigo_barras', coalesce((v ->> 'codigo_proprio')::boolean, false),
          (v ->> 'preco_venda')::numeric, coalesce((v ->> 'estoque_minimo')::int, 0)
        )
        returning id into v_variacao;
      exception when unique_violation then
        raise exception 'No produto "%": código de barras % já está em uso, ou a mesma variação aparece duas vezes.',
          trim(p ->> 'nome'), coalesce(v ->> 'codigo_barras', '(sem código)');
      end;
      insert into public.custos_variacao (variacao_id, custo_medio)
      values (v_variacao, coalesce((v ->> 'custo')::numeric, 0));
    end loop;

    v_ids := v_ids || to_jsonb(v_produto);
  end loop;

  return v_ids;
end;
$$;

revoke execute on function public.salvar_produtos(jsonb) from public, anon;
grant execute on function public.salvar_produtos(jsonb) to authenticated;
revoke execute on function public.pode_ver_custos() from public, anon;
grant execute on function public.pode_ver_custos() to authenticated;
revoke execute on function public.registrar_auditoria() from public, anon, authenticated;
revoke execute on function public.registrar_preco() from public, anon, authenticated;
