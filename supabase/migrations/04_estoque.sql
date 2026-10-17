-- =====================================================================
-- DEMANAS · 04 · Estoque: lotes, movimentações, entradas e inventário
-- =====================================================================
-- Regra de ouro: o estoque é um LIVRO. Cada entrada e saída é uma linha
-- em movimentacoes_estoque, que nunca é editada nem apagada (nem pelo
-- banco: um gatilho recusa). O saldo é a soma das linhas. Corrigir é
-- lançar uma linha nova.
--
-- Ninguém escreve direto nas tabelas: tudo passa pelas funções abaixo,
-- que conferem a permissão, travam a peça (duas pessoas ao mesmo tempo
-- não bagunçam o saldo) e registram quem fez, quando e por quê.
--
-- Acesso (parte 5 do briefing):
--   · Toda a equipe ativa vê o estoque e as movimentações.
--   · Só as proprietárias lançam entrada, saída, correção e inventário.
--   · Custo de cada movimentação: só quem tem pode_ver_custos.
--
-- Lote e validade são opcionais (decisão da Bruna, 17/10/2026). A peça
-- sem lote fica num "balde" sem lote. A saída sem lote escolhido pega
-- primeiro a validade mais próxima.
--
-- Kit não tem estoque próprio: o saldo dele é o das peças que o formam.
-- A venda (Etapa 4) é que vai dar a baixa nessas peças.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Lotes
-- ---------------------------------------------------------------------
create table public.lotes (
  id           uuid primary key default gen_random_uuid(),
  variacao_id  uuid not null references public.variacoes (id) on delete cascade,
  numero_lote  text check (length(numero_lote) between 1 and 30),
  validade     date check (validade between date '2000-01-01' and date '2100-12-31'),
  criado_em    timestamptz not null default now(),
  check (numero_lote is not null or validade is not null)
);
create unique index lotes_unico on public.lotes (
  variacao_id, lower(coalesce(numero_lote, '')), coalesce(validade, date '2100-12-31')
);

-- ---------------------------------------------------------------------
-- Entradas de mercadoria (o "cabeçalho": fornecedor e nota)
-- ---------------------------------------------------------------------
create table public.entradas (
  id             uuid primary key default gen_random_uuid(),
  fornecedor_id  uuid references public.fornecedores (id) on delete set null,
  numero_nota    text not null default '' check (length(numero_nota) <= 40),
  observacao     text not null default '' check (length(observacao) <= 200),
  usuario_id     uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- O livro do estoque
-- ---------------------------------------------------------------------
create table public.movimentacoes_estoque (
  id            bigint generated always as identity primary key,
  variacao_id   uuid not null references public.variacoes (id) on delete restrict,
  lote_id       uuid references public.lotes (id) on delete restrict,
  tipo          text not null check (tipo in (
                  'estoque_inicial', 'entrada_compra', 'saida_venda', 'cancelamento_venda',
                  'devolucao_cliente', 'devolucao_fornecedor', 'ajuste_inventario',
                  'perda', 'brinde', 'uso_interno')),
  quantidade    int not null check (quantidade <> 0 and quantidade between -99999 and 99999),
  motivo        text not null default '' check (length(motivo) <= 160),
  -- sem chave estrangeira de propósito: o livro não pode mudar quando
  -- alguém sai da equipe, então guarda o id e o nome daquele momento
  usuario_id    uuid,
  usuario_nome  text not null default '',
  origem_tipo   text check (origem_tipo in ('cadastro', 'entrada', 'saida', 'correcao', 'inventario', 'venda')),
  origem_id     uuid,
  criado_em     timestamptz not null default now(),
  -- entrada só soma, saída só tira; o ajuste pode ir para os dois lados
  check (case
    when tipo in ('estoque_inicial', 'entrada_compra', 'cancelamento_venda', 'devolucao_cliente') then quantidade > 0
    when tipo = 'ajuste_inventario' then true
    else quantidade < 0
  end)
);
create index movimentacoes_variacao_idx on public.movimentacoes_estoque (variacao_id, lote_id);
create index movimentacoes_data_idx on public.movimentacoes_estoque (criado_em desc);
create index movimentacoes_origem_idx on public.movimentacoes_estoque (origem_tipo, origem_id);

-- Custo de cada movimentação: à parte, só para quem pode ver custos
create table public.custos_movimentacao (
  movimentacao_id  bigint primary key references public.movimentacoes_estoque (id) on delete restrict,
  custo_unitario   numeric(12,2) not null check (custo_unitario between 0 and 99999.99)
);

create or replace function public.impedir_alteracao_livro()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O estoque é um livro: movimentação não se edita nem se apaga. Para corrigir, lance uma nova.'
    using errcode = '42501';
end;
$$;

create trigger movimentacoes_imutaveis before update or delete on public.movimentacoes_estoque
  for each row execute function public.impedir_alteracao_livro();
create trigger custos_movimentacao_imutaveis before update or delete on public.custos_movimentacao
  for each row execute function public.impedir_alteracao_livro();

-- ---------------------------------------------------------------------
-- Saldos (sempre calculados do livro)
-- ---------------------------------------------------------------------
create view public.estoque_atual with (security_invoker = true) as
  select variacao_id, sum(quantidade)::int as saldo
  from public.movimentacoes_estoque
  group by variacao_id;

create view public.estoque_por_lote with (security_invoker = true) as
  select m.variacao_id, m.lote_id, l.numero_lote, l.validade, sum(m.quantidade)::int as saldo
  from public.movimentacoes_estoque m
  left join public.lotes l on l.id = m.lote_id
  group by m.variacao_id, m.lote_id, l.numero_lote, l.validade;

-- ---------------------------------------------------------------------
-- Inventário (contagem física)
-- ---------------------------------------------------------------------
create table public.inventarios (
  id             uuid primary key default gen_random_uuid(),
  escopo         text not null check (escopo in ('tudo', 'categoria', 'cnpj')),
  categoria_id   uuid references public.categorias (id) on delete set null,
  empresa_id     text references public.empresas (id),
  observacao     text not null default '' check (length(observacao) <= 120),
  status         text not null default 'aberto' check (status in ('aberto', 'concluido', 'cancelado')),
  aberto_por     uuid references public.perfis (id) on delete set null default auth.uid(),
  aberto_em      timestamptz not null default now(),
  concluido_por  uuid references public.perfis (id) on delete set null,
  concluido_em   timestamptz,
  resumo         jsonb,
  check (escopo <> 'categoria' or categoria_id is not null or status <> 'aberto'),
  check (escopo <> 'cnpj' or empresa_id is not null)
);
-- uma contagem aberta por vez, para ninguém contar em duas listas
create unique index inventarios_um_aberto on public.inventarios ((true)) where status = 'aberto';

create table public.inventario_itens (
  id             uuid primary key default gen_random_uuid(),
  inventario_id  uuid not null references public.inventarios (id) on delete cascade,
  variacao_id    uuid not null references public.variacoes (id) on delete cascade,
  lote_id        uuid references public.lotes (id) on delete cascade,
  contado        int not null check (contado between 0 and 99999),
  -- saldo deste lote (ou da parte sem lote) no momento da contagem: se
  -- vender durante a contagem, a diferença continua certa
  saldo_sistema  int not null,
  contado_por    uuid references public.perfis (id) on delete set null default auth.uid(),
  atualizado_em  timestamptz not null default now()
);
create unique index inventario_itens_unico on public.inventario_itens (
  inventario_id, variacao_id, coalesce(lote_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- ---------------------------------------------------------------------
-- Acesso
-- ---------------------------------------------------------------------
alter table public.lotes enable row level security;
alter table public.entradas enable row level security;
alter table public.movimentacoes_estoque enable row level security;
alter table public.custos_movimentacao enable row level security;
alter table public.inventarios enable row level security;
alter table public.inventario_itens enable row level security;

revoke insert, update, delete, truncate on public.lotes, public.entradas, public.movimentacoes_estoque,
  public.custos_movimentacao, public.inventarios, public.inventario_itens from anon, authenticated;
revoke all on public.estoque_atual, public.estoque_por_lote from anon;
grant select on public.estoque_atual, public.estoque_por_lote to authenticated;

create policy "Equipe vê os lotes" on public.lotes for select to authenticated using ((select public.eh_membro_ativo()));
create policy "Equipe vê as entradas" on public.entradas for select to authenticated using ((select public.eh_membro_ativo()));
create policy "Equipe vê o livro do estoque" on public.movimentacoes_estoque for select to authenticated using ((select public.eh_membro_ativo()));
create policy "Só quem pode ver custos" on public.custos_movimentacao for select to authenticated using ((select public.pode_ver_custos()));
create policy "Admin vê os inventários" on public.inventarios for select to authenticated using ((select public.eh_admin()));
create policy "Admin vê as contagens" on public.inventario_itens for select to authenticated using ((select public.eh_admin()));

-- ---------------------------------------------------------------------
-- Peças internas (só as funções daqui chamam)
-- ---------------------------------------------------------------------

-- Trava a peça até o fim da operação e confere se ela pode ter estoque
create or replace function public._travar_variacao(p_variacao uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo text;
begin
  select p.tipo into v_tipo
  from public.variacoes v join public.produtos p on p.id = v.produto_id
  where v.id = p_variacao
  for update of v;
  if not found then
    raise exception 'Peça não encontrada. Atualize a página e tente de novo.';
  end if;
  if v_tipo = 'kit' then
    raise exception 'Kit não tem estoque próprio: lance a entrada nas peças que formam o kit.';
  end if;
end;
$$;

-- Acha ou cria o lote. Sem número e sem validade → sem lote (null).
create or replace function public._lote(p_variacao uuid, p_numero text, p_validade date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numero text := nullif(trim(p_numero), '');
  v_id uuid;
begin
  if v_numero is null and p_validade is null then
    return null;
  end if;
  if length(v_numero) > 30 then
    raise exception 'O número do lote passa de 30 caracteres.';
  end if;
  select id into v_id from public.lotes
  where variacao_id = p_variacao
    and lower(coalesce(numero_lote, '')) = lower(coalesce(v_numero, ''))
    and coalesce(validade, date '2100-12-31') = coalesce(p_validade, date '2100-12-31');
  if v_id is null then
    insert into public.lotes (variacao_id, numero_lote, validade) values (p_variacao, v_numero, p_validade)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Escreve uma linha no livro (e o custo dela, quando houver)
create or replace function public._lancar(
  p_variacao uuid, p_lote uuid, p_tipo text, p_quantidade int, p_custo numeric,
  p_motivo text, p_origem_tipo text, p_origem_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.movimentacoes_estoque (variacao_id, lote_id, tipo, quantidade, motivo, usuario_id, usuario_nome, origem_tipo, origem_id)
  values (
    p_variacao, p_lote, p_tipo, p_quantidade, left(coalesce(p_motivo, ''), 160), auth.uid(),
    coalesce((select nome from public.perfis where id = auth.uid()), ''), p_origem_tipo, p_origem_id
  )
  returning id into v_id;
  if p_custo is not null then
    insert into public.custos_movimentacao (movimentacao_id, custo_unitario) values (v_id, p_custo);
  end if;
  return v_id;
end;
$$;

create or replace function public._saldo(p_variacao uuid, p_lote uuid default null, p_so_lote boolean default false)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(quantidade), 0)::int from public.movimentacoes_estoque
  where variacao_id = p_variacao and (not p_so_lote or lote_id is not distinct from p_lote);
$$;

-- Tira do estoque pela validade mais próxima (ou só do lote pedido).
-- Quem chama já conferiu se tem saldo.
create or replace function public._baixar(
  p_variacao uuid, p_quantidade int, p_tipo text, p_motivo text,
  p_origem_tipo text, p_origem_id uuid, p_lote uuid default null, p_so_lote boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_custo numeric := (select custo_medio from public.custos_variacao where variacao_id = p_variacao);
  v_falta int := p_quantidade;
  v_usa int;
  r record;
begin
  if p_so_lote then
    perform public._lancar(p_variacao, p_lote, p_tipo, -p_quantidade, v_custo, p_motivo, p_origem_tipo, p_origem_id);
    return;
  end if;
  for r in
    select m.lote_id, sum(m.quantidade)::int as saldo
    from public.movimentacoes_estoque m
    left join public.lotes l on l.id = m.lote_id
    where m.variacao_id = p_variacao
    group by m.lote_id, l.validade
    having sum(m.quantidade) > 0
    order by l.validade asc nulls last, (m.lote_id is null) asc
  loop
    exit when v_falta <= 0;
    v_usa := least(v_falta, r.saldo);
    perform public._lancar(p_variacao, r.lote_id, p_tipo, -v_usa, v_custo, p_motivo, p_origem_tipo, p_origem_id);
    v_falta := v_falta - v_usa;
  end loop;
  if v_falta > 0 then
    perform public._lancar(p_variacao, null, p_tipo, -v_falta, v_custo, p_motivo, p_origem_tipo, p_origem_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Entrada de mercadoria
-- Entrada: { fornecedor_id, numero_nota, observacao,
--            itens: [{ variacao_id, quantidade, custo, numero_lote, validade }] }
-- O custo é opcional: com ele, o custo médio é recalculado; sem ele,
-- fica como estava.
-- ---------------------------------------------------------------------
create or replace function public.registrar_entrada(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entrada    uuid;
  v_fornecedor text;
  v_motivo     text;
  i            jsonb;
  v_variacao   uuid;
  v_qtd        int;
  v_custo      numeric;
  v_atual      numeric;
  v_saldo      int;
begin
  if not public.eh_admin() then
    raise exception 'Somente as proprietárias lançam entrada de mercadoria.' using errcode = '42501';
  end if;
  if jsonb_typeof(p -> 'itens') <> 'array' or jsonb_array_length(p -> 'itens') = 0 then
    raise exception 'A entrada está sem nenhuma peça.';
  end if;
  if jsonb_array_length(p -> 'itens') > 200 then
    raise exception 'São muitas peças de uma vez: divida em entradas de até 200 linhas.';
  end if;

  insert into public.entradas (fornecedor_id, numero_nota, observacao)
  values (nullif(p ->> 'fornecedor_id', '')::uuid, trim(coalesce(p ->> 'numero_nota', '')), trim(coalesce(p ->> 'observacao', '')))
  returning id into v_entrada;

  select nome into v_fornecedor from public.fornecedores where id = nullif(p ->> 'fornecedor_id', '')::uuid;
  v_motivo := case when v_fornecedor is not null then 'Compra de ' || v_fornecedor else 'Entrada de mercadoria' end
    || case when trim(coalesce(p ->> 'numero_nota', '')) <> '' then ' · nota ' || trim(p ->> 'numero_nota') else '' end;

  -- sempre na mesma ordem, para duas entradas ao mesmo tempo não se travarem
  for i in select value from jsonb_array_elements(p -> 'itens') order by value ->> 'variacao_id' loop
    v_variacao := (i ->> 'variacao_id')::uuid;
    v_qtd := (i ->> 'quantidade')::int;
    v_custo := nullif(i ->> 'custo', '')::numeric;
    if v_qtd is null or v_qtd < 1 or v_qtd > 9999 then
      raise exception 'A quantidade de cada peça vai de 1 a 9.999.';
    end if;
    if v_custo is not null and (v_custo < 0 or v_custo > 99999.99) then
      raise exception 'O custo de cada peça vai de R$ 0,00 a R$ 99.999,99.';
    end if;
    perform public._travar_variacao(v_variacao);

    select custo_medio into v_atual from public.custos_variacao where variacao_id = v_variacao for update;
    v_saldo := greatest(public._saldo(v_variacao), 0);

    perform public._lancar(
      v_variacao, public._lote(v_variacao, i ->> 'numero_lote', nullif(i ->> 'validade', '')::date),
      'entrada_compra', v_qtd, coalesce(v_custo, v_atual), v_motivo, 'entrada', v_entrada
    );

    if v_custo is not null then
      insert into public.custos_variacao (variacao_id, custo_medio)
      values (v_variacao, round(((v_saldo * coalesce(v_atual, 0)) + (v_qtd * v_custo)) / (v_saldo + v_qtd), 2))
      on conflict (variacao_id) do update set custo_medio = excluded.custo_medio, atualizado_em = now();
    end if;
  end loop;

  return v_entrada;
end;
$$;

-- ---------------------------------------------------------------------
-- Saída sem venda: perda, brinde, uso interno, devolução ao fornecedor
-- ---------------------------------------------------------------------
create or replace function public.registrar_saida(
  p_variacao uuid, p_tipo text, p_quantidade int, p_motivo text, p_lote uuid default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tem int;
  v_motivo text := trim(coalesce(p_motivo, ''));
begin
  if not public.eh_admin() then
    raise exception 'Somente as proprietárias lançam perdas e saídas.' using errcode = '42501';
  end if;
  if p_tipo not in ('perda', 'brinde', 'uso_interno', 'devolucao_fornecedor') then
    raise exception 'Tipo de saída desconhecido.';
  end if;
  if p_quantidade is null or p_quantidade < 1 or p_quantidade > 9999 then
    raise exception 'A quantidade vai de 1 a 9.999.';
  end if;
  if length(v_motivo) < 3 or length(v_motivo) > 120 then
    raise exception 'O motivo é obrigatório (de 3 a 120 letras): fica registrado no histórico.';
  end if;
  perform public._travar_variacao(p_variacao);
  v_tem := public._saldo(p_variacao, p_lote, p_lote is not null);
  if p_quantidade > greatest(v_tem, 0) then
    raise exception 'O sistema tem só % desta peça%. Se o número real é outro, corrija o saldo antes.',
      greatest(v_tem, 0), case when p_lote is not null then ' neste lote' else '' end;
  end if;
  perform public._baixar(p_variacao, p_quantidade, p_tipo, v_motivo, 'saida', null, p_lote, p_lote is not null);
  return public._saldo(p_variacao);
end;
$$;

-- ---------------------------------------------------------------------
-- Correção rápida: "contei X desta peça". Lança só a diferença.
-- Faltou → sai pela validade mais próxima. Sobrou → entra sem lote.
-- ---------------------------------------------------------------------
create or replace function public.corrigir_saldo(p_variacao uuid, p_contado int, p_motivo text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dif int;
  v_motivo text := trim(coalesce(p_motivo, ''));
begin
  if not public.eh_admin() then
    raise exception 'Somente as proprietárias corrigem o estoque.' using errcode = '42501';
  end if;
  if p_contado is null or p_contado < 0 or p_contado > 99999 then
    raise exception 'A contagem vai de 0 a 99.999.';
  end if;
  if length(v_motivo) < 3 or length(v_motivo) > 120 then
    raise exception 'O motivo é obrigatório (de 3 a 120 letras): fica registrado no histórico.';
  end if;
  perform public._travar_variacao(p_variacao);
  v_dif := p_contado - public._saldo(p_variacao);
  if v_dif < 0 then
    perform public._baixar(p_variacao, -v_dif, 'ajuste_inventario', v_motivo, 'correcao', null);
  elsif v_dif > 0 then
    perform public._lancar(p_variacao, null, 'ajuste_inventario', v_dif,
      (select custo_medio from public.custos_variacao where variacao_id = p_variacao), v_motivo, 'correcao', null);
  end if;
  return v_dif;
end;
$$;

-- ---------------------------------------------------------------------
-- Inventário
-- ---------------------------------------------------------------------
create or replace function public._no_escopo(p_inventario public.inventarios, p_variacao uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.variacoes v join public.produtos p on p.id = v.produto_id
    where v.id = p_variacao and p.tipo <> 'kit'
      and (p_inventario.escopo = 'tudo'
        or (p_inventario.escopo = 'categoria' and p.categoria_id = p_inventario.categoria_id)
        or (p_inventario.escopo = 'cnpj' and p.empresa_id = p_inventario.empresa_id))
  );
$$;

create or replace function public.abrir_inventario(
  p_escopo text, p_categoria uuid default null, p_empresa text default null, p_observacao text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.eh_admin() then
    raise exception 'Somente as proprietárias abrem uma contagem.' using errcode = '42501';
  end if;
  if exists (select 1 from public.inventarios where status = 'aberto') then
    raise exception 'Já existe uma contagem aberta. Conclua ou cancele aquela antes de abrir outra.';
  end if;
  insert into public.inventarios (escopo, categoria_id, empresa_id, observacao)
  values (
    p_escopo,
    case when p_escopo = 'categoria' then p_categoria end,
    case when p_escopo = 'cnpj' then p_empresa end,
    left(trim(coalesce(p_observacao, '')), 120)
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Conta uma peça (ou um lote dela). p_somar: soma ao que já foi contado
-- (ex.: a mesma peça em duas prateleiras); senão, troca o número.
create or replace function public.contar_item(
  p_inventario uuid, p_variacao uuid, p_quantidade int, p_somar boolean default true,
  p_numero_lote text default null, p_validade date default null, p_lote uuid default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.inventarios;
  v_lote uuid;
  v_contado int;
begin
  if not public.eh_admin() then
    raise exception 'Somente as proprietárias contam o estoque.' using errcode = '42501';
  end if;
  select * into v_inv from public.inventarios where id = p_inventario;
  if v_inv.id is null or v_inv.status <> 'aberto' then
    raise exception 'Esta contagem já foi fechada. Atualize a página.';
  end if;
  if not public._no_escopo(v_inv, p_variacao) then
    raise exception 'Esta peça não faz parte desta contagem (outra categoria, outro CNPJ ou é um kit).';
  end if;
  if p_quantidade is null or p_quantidade < 0 or p_quantidade > 9999 then
    raise exception 'A quantidade vai de 0 a 9.999.';
  end if;
  perform public._travar_variacao(p_variacao);

  if p_lote is not null then
    if not exists (select 1 from public.lotes where id = p_lote and variacao_id = p_variacao) then
      raise exception 'Este lote não é desta peça.';
    end if;
    v_lote := p_lote;
  else
    v_lote := public._lote(p_variacao, p_numero_lote, p_validade);
  end if;

  insert into public.inventario_itens (inventario_id, variacao_id, lote_id, contado, saldo_sistema)
  values (p_inventario, p_variacao, v_lote, p_quantidade, public._saldo(p_variacao, v_lote, true))
  on conflict (inventario_id, variacao_id, coalesce(lote_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    contado = case when p_somar then public.inventario_itens.contado + excluded.contado else excluded.contado end,
    contado_por = auth.uid(),
    atualizado_em = now()
  returning contado into v_contado;

  if v_contado > 99999 then
    raise exception 'A contagem desta peça passou de 99.999.';
  end if;
  return v_contado;
end;
$$;

create or replace function public.remover_contagem(p_item uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Somente as proprietárias mexem na contagem.' using errcode = '42501';
  end if;
  delete from public.inventario_itens i
  using public.inventarios v
  where i.id = p_item and v.id = i.inventario_id and v.status = 'aberto';
end;
$$;

create or replace function public.cancelar_inventario(p_inventario uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Somente as proprietárias cancelam uma contagem.' using errcode = '42501';
  end if;
  update public.inventarios
  set status = 'cancelado', concluido_por = auth.uid(), concluido_em = now()
  where id = p_inventario and status = 'aberto';
end;
$$;

-- Fecha a contagem e lança os acertos.
--   · Peça contada: cada lote contado fica com o número contado (pela
--     diferença do momento em que foi contado); lote com saldo que não
--     foi contado vai a zero.
--   · Peça do escopo que ninguém contou: fica como está, ou vai a zero
--     se p_zerar_nao_contadas (menos a cadastrada durante a contagem).
create or replace function public.concluir_inventario(p_inventario uuid, p_zerar_nao_contadas boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.inventarios;
  v_motivo text;
  v_custo numeric;
  v_sobra int := 0;
  v_falta int := 0;
  v_pecas int := 0;
  v_contadas int := 0;
  v_zeradas int := 0;
  v_dif int;
  r record;
  b record;
  it record;
  v_resumo jsonb;
begin
  if not public.eh_admin() then
    raise exception 'Somente as proprietárias concluem uma contagem.' using errcode = '42501';
  end if;
  select * into v_inv from public.inventarios where id = p_inventario for update;
  if v_inv.id is null or v_inv.status <> 'aberto' then
    raise exception 'Esta contagem já foi fechada. Atualize a página.';
  end if;
  v_motivo := 'Inventário de ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
    || case when v_inv.observacao <> '' then ' · ' || v_inv.observacao else '' end;

  -- peças contadas
  for r in select distinct variacao_id from public.inventario_itens where inventario_id = p_inventario order by variacao_id loop
    perform public._travar_variacao(r.variacao_id);
    v_contadas := v_contadas + 1;
    v_custo := (select custo_medio from public.custos_variacao where variacao_id = r.variacao_id);

    for it in select * from public.inventario_itens where inventario_id = p_inventario and variacao_id = r.variacao_id loop
      v_pecas := v_pecas + it.contado;
      v_dif := it.contado - it.saldo_sistema;
      if v_dif <> 0 then
        perform public._lancar(r.variacao_id, it.lote_id, 'ajuste_inventario', v_dif, v_custo, v_motivo, 'inventario', p_inventario);
        if v_dif > 0 then v_sobra := v_sobra + v_dif; else v_falta := v_falta - v_dif; end if;
      end if;
    end loop;

    -- lotes com saldo que não apareceram na contagem
    for b in
      select m.lote_id, sum(m.quantidade)::int as saldo from public.movimentacoes_estoque m
      where m.variacao_id = r.variacao_id
        and not exists (select 1 from public.inventario_itens i
                        where i.inventario_id = p_inventario and i.variacao_id = r.variacao_id
                          and i.lote_id is not distinct from m.lote_id)
      group by m.lote_id having sum(m.quantidade) <> 0
    loop
      perform public._lancar(r.variacao_id, b.lote_id, 'ajuste_inventario', -b.saldo, v_custo, v_motivo, 'inventario', p_inventario);
      if b.saldo > 0 then v_falta := v_falta + b.saldo; else v_sobra := v_sobra - b.saldo; end if;
    end loop;
  end loop;

  -- peças do escopo que ninguém contou
  if p_zerar_nao_contadas then
    for r in
      select v.id from public.variacoes v
      where public._no_escopo(v_inv, v.id)
        and not exists (select 1 from public.inventario_itens i where i.inventario_id = p_inventario and i.variacao_id = v.id)
        -- peça cadastrada durante a contagem já entrou com o número certo
        and v.criado_em < v_inv.aberto_em
        and public._saldo(v.id) <> 0
      order by v.id
    loop
      perform public._travar_variacao(r.id);
      v_zeradas := v_zeradas + 1;
      v_custo := (select custo_medio from public.custos_variacao where variacao_id = r.id);
      for b in
        select m.lote_id, sum(m.quantidade)::int as saldo from public.movimentacoes_estoque m
        where m.variacao_id = r.id group by m.lote_id having sum(m.quantidade) <> 0
      loop
        perform public._lancar(r.id, b.lote_id, 'ajuste_inventario', -b.saldo, v_custo, v_motivo, 'inventario', p_inventario);
        if b.saldo > 0 then v_falta := v_falta + b.saldo; else v_sobra := v_sobra - b.saldo; end if;
      end loop;
    end loop;
  end if;

  v_resumo := jsonb_build_object('pecas_contadas', v_pecas, 'variacoes_contadas', v_contadas,
    'sobras', v_sobra, 'faltas', v_falta, 'zeradas', v_zeradas);
  update public.inventarios
  set status = 'concluido', concluido_por = auth.uid(), concluido_em = now(), resumo = v_resumo
  where id = p_inventario;
  return v_resumo;
end;
$$;

-- ---------------------------------------------------------------------
-- Cadastro com estoque inicial: salvar_produtos passa a aceitar, em cada
-- variação, quantidade, numero_lote e validade.
-- Passa a ser security definer para poder escrever no livro; a
-- permissão continua conferida logo no começo.
-- ---------------------------------------------------------------------
create or replace function public.salvar_produtos(p_produtos jsonb)
returns jsonb
language plpgsql
volatile
security definer
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
  v_qtd        int;
  v_custo      numeric;
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
      -- quem não pode ver custo também não grava custo
      v_custo := case when public.pode_ver_custos() then coalesce((v ->> 'custo')::numeric, 0) else 0 end;
      insert into public.custos_variacao (variacao_id, custo_medio) values (v_variacao, v_custo);

      v_qtd := coalesce(nullif(v ->> 'quantidade', '')::int, 0);
      if v_qtd < 0 or v_qtd > 9999 then
        raise exception 'No produto "%": a quantidade em estoque vai de 0 a 9.999.', trim(p ->> 'nome');
      end if;
      if v_qtd > 0 then
        if p ->> 'tipo' = 'kit' then
          raise exception 'Kit não tem estoque próprio: o estoque é o das peças que formam o kit.';
        end if;
        perform public._lancar(
          v_variacao, public._lote(v_variacao, v ->> 'numero_lote', nullif(v ->> 'validade', '')::date),
          'estoque_inicial', v_qtd, v_custo, 'Estoque inicial, no cadastro', 'cadastro', v_produto
        );
      end if;
    end loop;

    v_ids := v_ids || to_jsonb(v_produto);
  end loop;

  return v_ids;
end;
$$;

-- ---------------------------------------------------------------------
-- Quem pode chamar o quê
-- ---------------------------------------------------------------------
revoke execute on function public.impedir_alteracao_livro() from public, anon, authenticated;
revoke execute on function public._travar_variacao(uuid) from public, anon, authenticated;
revoke execute on function public._lote(uuid, text, date) from public, anon, authenticated;
revoke execute on function public._lancar(uuid, uuid, text, int, numeric, text, text, uuid) from public, anon, authenticated;
revoke execute on function public._saldo(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public._baixar(uuid, int, text, text, text, uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public._no_escopo(public.inventarios, uuid) from public, anon, authenticated;

revoke execute on function public.registrar_entrada(jsonb) from public, anon;
revoke execute on function public.registrar_saida(uuid, text, int, text, uuid) from public, anon;
revoke execute on function public.corrigir_saldo(uuid, int, text) from public, anon;
revoke execute on function public.abrir_inventario(text, uuid, text, text) from public, anon;
revoke execute on function public.contar_item(uuid, uuid, int, boolean, text, date, uuid) from public, anon;
revoke execute on function public.remover_contagem(uuid) from public, anon;
revoke execute on function public.cancelar_inventario(uuid) from public, anon;
revoke execute on function public.concluir_inventario(uuid, boolean) from public, anon;
revoke execute on function public.salvar_produtos(jsonb) from public, anon;

grant execute on function public.registrar_entrada(jsonb) to authenticated;
grant execute on function public.registrar_saida(uuid, text, int, text, uuid) to authenticated;
grant execute on function public.corrigir_saldo(uuid, int, text) to authenticated;
grant execute on function public.abrir_inventario(text, uuid, text, text) to authenticated;
grant execute on function public.contar_item(uuid, uuid, int, boolean, text, date, uuid) to authenticated;
grant execute on function public.remover_contagem(uuid) to authenticated;
grant execute on function public.cancelar_inventario(uuid) to authenticated;
grant execute on function public.concluir_inventario(uuid, boolean) to authenticated;
grant execute on function public.salvar_produtos(jsonb) to authenticated;
