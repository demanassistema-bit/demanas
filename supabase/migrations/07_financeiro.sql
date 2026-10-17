-- =====================================================================
-- DEMANAS · 07 · Financeiro: caixa do dia, a receber do cartão,
--                contas a pagar, custos fixos, resultado do mês
-- =====================================================================
-- Tudo aqui só abre para quem tem a permissão do Financeiro E digitou o
-- código (tem_acesso_area('financeiro')). A vendedora não lê nada.
--
--   · Cada CNPJ tem o prazo da sua maquininha (débito em X dias, crédito
--     em Y dias por parcela) e o imposto como custo variável (% sobre as
--     vendas). Prazo começa em 1 e 30 dias; imposto em 0%. As irmãs
--     ajustam quando tiverem certeza (Configurações).
--   · A receber: cada pagamento no cartão gera as parcelas sozinho
--     (gatilho), com a data em que cai e já sem a taxa copiada na venda.
--     Venda cancelada estorna o que não caiu; o que já caiu vira um
--     desconto no próximo repasse. Devolução "estorno no cartão" também.
--   · Caixa do dia: abertura, suprimento, sangria e fechamento. O banco
--     calcula quanto deveria ter na gaveta: abertura + vendas em
--     dinheiro + sinais de encomenda em dinheiro − devoluções em dinheiro
--     + suprimentos − sangrias. Diferença no fechamento exige explicação.
--     Caixa fechado não muda.
--   · Contas a pagar: com categoria, parcelas e "paga em". Conta paga não
--     se apaga (desfaça o pagamento antes). Custos fixos viram contas no
--     dia 10 (do mês e do seguinte); conta de custo fixo apagada não volta.
--   · Resultado do mês (competência): vendas − devoluções − taxas −
--     imposto − custo das peças = lucro bruto; − despesas por categoria =
--     resultado. Compra de mercadoria (categoria fornecedores) não entra:
--     o custo da peça já entra quando ela é vendida.
--   · Crediário (fiado): a loja não vende fiado (decisão de 17/10/2026).
-- =====================================================================

create or replace function public.pode_financeiro()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.tem_acesso_area('financeiro');
$$;

create or replace function public._exigir_financeiro()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.tem_acesso_area('financeiro') then
    raise exception 'Abra o Financeiro com o código para fazer isso.' using errcode = '42501';
  end if;
end;
$$;

-- dia de hoje no fuso da loja
create or replace function public.hoje_loja()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- ---------------------------------------------------------------------
-- Prazo da maquininha e imposto de cada CNPJ
-- ---------------------------------------------------------------------
alter table public.empresas
  add column prazo_debito_dias   int not null default 1 check (prazo_debito_dias between 0 and 60),
  add column prazo_credito_dias  int not null default 30 check (prazo_credito_dias between 1 and 60),
  add column imposto_percentual  numeric(5,2) not null default 0 check (imposto_percentual between 0 and 30);

-- ---------------------------------------------------------------------
-- Configuração da Calculadora (margem, embalagem...) e custos fixos
-- ---------------------------------------------------------------------
create table public.config_financeiro (
  chave          text primary key,
  valor          jsonb not null check (length(valor::text) <= 2000),
  atualizado_em  timestamptz not null default now()
);
insert into public.config_financeiro (chave, valor) values ('calculadora',
  '{"empresa": "day", "embalagem": 0, "entrega": 0, "entregaQuemPaga": "loja", "comEntrega": false, "margem": 20, "formaBase": "credito", "final90": true, "faturamento": null}');

create trigger config_financeiro_atualizado_em before update on public.config_financeiro
  for each row execute function public.definir_atualizado_em();

create table public.custos_fixos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(trim(nome)) between 1 and 40),
  valor      numeric(12,2) not null default 0 check (valor between 0 and 999999.99),
  categoria  text not null default 'outros',
  ordem      int not null default 0,
  criado_em  timestamptz not null default now()
);
-- só os nomes, com valor zero: quem preenche são as irmãs (nada inventado)
insert into public.custos_fixos (nome, categoria, ordem) values
  ('Aluguel', 'aluguel', 1), ('Energia', 'contas_loja', 2), ('Internet e telefone', 'contas_loja', 3),
  ('Contadora', 'contadora', 4), ('Tarifa do banco e da maquininha', 'taxas_tarifas', 5),
  ('Sistema e aplicativos', 'outros', 6), ('Pró-labore das sócias', 'pro_labore', 7);

-- ---------------------------------------------------------------------
-- Contas a pagar
-- ---------------------------------------------------------------------
create table public.contas_pagar (
  id             uuid primary key default gen_random_uuid(),
  descricao      text not null check (length(trim(descricao)) between 2 and 110),
  fornecedor     text check (length(fornecedor) <= 60),
  categoria      text not null,
  valor          numeric(12,2) not null check (valor between 0.01 and 999999.99),
  vencimento     date not null check (vencimento between '2000-01-01' and '2100-12-31'),
  pago_em        date check (pago_em between '2000-01-01' and '2100-12-31'),
  pago_por       uuid references public.perfis (id) on delete set null,
  -- parcelas de uma mesma compra
  grupo          uuid,
  parcela        int check (parcela between 1 and 24),
  parcelas       int check (parcelas between 1 and 24),
  custo_fixo_id  uuid references public.custos_fixos (id) on delete set null,
  observacao     text check (length(observacao) <= 200),
  criado_por     uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index contas_pagar_vencimento_idx on public.contas_pagar (vencimento);
create index contas_pagar_abertas_idx on public.contas_pagar (vencimento) where pago_em is null;

alter table public.custos_fixos add constraint custos_fixos_categoria_check
  check (categoria in ('aluguel', 'contas_loja', 'fornecedores', 'contadora', 'marketing', 'taxas_tarifas', 'impostos', 'pro_labore', 'outros'));
alter table public.contas_pagar add constraint contas_pagar_categoria_check
  check (categoria in ('aluguel', 'contas_loja', 'fornecedores', 'contadora', 'marketing', 'taxas_tarifas', 'impostos', 'pro_labore', 'outros'));

create trigger contas_pagar_atualizado_em before update on public.contas_pagar
  for each row execute function public.definir_atualizado_em();
create trigger contas_pagar_auditoria after insert or update or delete on public.contas_pagar
  for each row execute function public.registrar_auditoria();
create trigger custos_fixos_auditoria after insert or update or delete on public.custos_fixos
  for each row execute function public.registrar_auditoria();

-- quem marcou como paga fica registrado
create or replace function public._conferir_conta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.pago_em is distinct from old.pago_em then
    new.pago_por := case when new.pago_em is null then null else auth.uid() end;
  end if;
  return new;
end;
$$;
create trigger contas_pagar_conferir before update on public.contas_pagar
  for each row execute function public._conferir_conta();

-- Custos fixos → contas do mês (dia 10). O registro de "já gerada" faz
-- com que uma conta apagada de propósito não volte.
create table public.custos_fixos_gerados (
  custo_fixo_id  uuid not null references public.custos_fixos (id) on delete cascade,
  competencia    date not null,
  primary key (custo_fixo_id, competencia)
);

create or replace function public.gerar_contas_fixas()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mes   date;
  v_n     int := 0;
  f       record;
begin
  perform public._exigir_financeiro();
  for v_mes in select generate_series(date_trunc('month', public.hoje_loja())::date,
                                      (date_trunc('month', public.hoje_loja()) + interval '1 month')::date,
                                      interval '1 month')::date loop
    for f in select * from public.custos_fixos where valor > 0 order by ordem loop
      insert into public.custos_fixos_gerados (custo_fixo_id, competencia) values (f.id, v_mes)
      on conflict do nothing;
      if found then
        insert into public.contas_pagar (descricao, categoria, valor, vencimento, custo_fixo_id)
        values (f.nome || ' · ' || to_char(v_mes, 'MM/YYYY'), f.categoria, f.valor, v_mes + 9, f.id);
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end;
$$;

-- Nova conta, dividida em parcelas mensais (a última fica com os centavos)
-- Entrada: { descricao, fornecedor, categoria, valor, vencimento, vezes, observacao }
create or replace function public.criar_contas(p jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vezes   int := coalesce(nullif(p ->> 'vezes', '')::int, 1);
  v_valor   numeric := round((p ->> 'valor')::numeric, 2);
  v_parcela numeric;
  v_venc    date := (p ->> 'vencimento')::date;
  v_grupo   uuid := case when v_vezes > 1 then gen_random_uuid() end;
  v_desc    text := trim(p ->> 'descricao');
  i         int;
begin
  perform public._exigir_financeiro();
  if v_vezes not between 1 and 24 then
    raise exception 'Divida em 1 a 24 vezes.';
  end if;
  if v_valor is null or v_valor < 0.01 * v_vezes then
    raise exception 'O valor é pequeno demais para tantas parcelas.';
  end if;
  if v_venc < public.hoje_loja() - interval '1 year' or v_venc > public.hoje_loja() + interval '5 years' then
    raise exception 'Use um vencimento entre um ano atrás e cinco anos para a frente.';
  end if;
  v_parcela := round(v_valor / v_vezes, 2);
  for i in 1..v_vezes loop
    insert into public.contas_pagar (descricao, fornecedor, categoria, valor, vencimento, grupo, parcela, parcelas, observacao)
    values (
      case when v_vezes > 1 then left(v_desc, 100) || ' (' || i || '/' || v_vezes || ')' else v_desc end,
      nullif(trim(p ->> 'fornecedor'), ''), p ->> 'categoria',
      case when i = v_vezes then v_valor - v_parcela * (v_vezes - 1) else v_parcela end,
      -- mesmo dia nos meses seguintes (dia 31 vira o último dia do mês)
      (v_venc + make_interval(months => i - 1))::date,
      v_grupo, case when v_vezes > 1 then i end, case when v_vezes > 1 then v_vezes end,
      nullif(trim(p ->> 'observacao'), '')
    );
  end loop;
  return v_vezes;
end;
$$;

-- ---------------------------------------------------------------------
-- A receber do cartão
-- ---------------------------------------------------------------------
create table public.recebiveis (
  id              uuid primary key default gen_random_uuid(),
  venda_id        uuid not null references public.vendas (id) on delete restrict,
  pagamento_id    uuid references public.venda_pagamentos (id) on delete restrict,
  devolucao_id    uuid references public.devolucoes (id) on delete restrict,
  empresa_id      text not null references public.empresas (id),
  -- estorno = desconto no repasse (venda cancelada depois de cair, ou devolução no cartão)
  forma           text not null check (forma in ('cartao_debito', 'cartao_credito', 'estorno')),
  parcela         int not null default 1,
  parcelas        int not null default 1,
  data_prevista   date not null,
  bruto           numeric(12,2) not null,
  taxa            numeric(12,2) not null default 0,
  liquido         numeric(12,2) not null,
  status          text not null default 'a_receber' check (status in ('a_receber', 'recebido', 'estornado')),
  recebido_em     date,
  criado_em       timestamptz not null default now(),
  check (liquido = bruto - taxa)
);
create index recebiveis_data_idx on public.recebiveis (data_prevista);
create index recebiveis_venda_idx on public.recebiveis (venda_id);

-- Pagamento no cartão → parcelas a receber
create or replace function public._gerar_recebiveis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v       record;
  v_dia   date;
  v_n     int := case when new.forma = 'cartao_credito' then greatest(new.parcelas, 1) else 1 end;
  v_parc  numeric := round(new.valor / v_n, 2);
  v_bruto numeric;
  v_taxa  numeric;
  i       int;
begin
  if new.forma not in ('cartao_debito', 'cartao_credito') then
    return new;
  end if;
  select ve.empresa_id, ve.criado_em, e.prazo_debito_dias, e.prazo_credito_dias into v
  from public.vendas ve join public.empresas e on e.id = ve.empresa_id
  where ve.id = new.venda_id;
  v_dia := (v.criado_em at time zone 'America/Sao_Paulo')::date;
  for i in 1..v_n loop
    v_bruto := case when i = v_n then new.valor - v_parc * (v_n - 1) else v_parc end;
    v_taxa := round(v_bruto * new.taxa_percentual / 100, 2);
    insert into public.recebiveis (venda_id, pagamento_id, empresa_id, forma, parcela, parcelas, data_prevista, bruto, taxa, liquido)
    values (new.venda_id, new.id, v.empresa_id, new.forma, i, v_n,
      v_dia + case when new.forma = 'cartao_debito' then v.prazo_debito_dias else v.prazo_credito_dias * i end,
      v_bruto, v_taxa, v_bruto - v_taxa);
  end loop;
  return new;
end;
$$;
create trigger venda_pagamentos_recebiveis after insert on public.venda_pagamentos
  for each row execute function public._gerar_recebiveis();

-- Venda cancelada: o que não caiu é estornado; o que já caiu vira desconto no próximo repasse
create or replace function public._estornar_recebiveis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelada' and old.status <> 'cancelada' then
    insert into public.recebiveis (venda_id, empresa_id, forma, data_prevista, bruto, taxa, liquido)
    select r.venda_id, r.empresa_id, 'estorno', public.hoje_loja(), -r.bruto, -r.taxa, -r.liquido
    from public.recebiveis r
    where r.venda_id = new.id and r.status = 'recebido' and r.forma <> 'estorno';
    update public.recebiveis set status = 'estornado' where venda_id = new.id and status = 'a_receber' and forma <> 'estorno';
  end if;
  return new;
end;
$$;
create trigger vendas_estornar_recebiveis after update of status on public.vendas
  for each row execute function public._estornar_recebiveis();

-- Devolução com "estorno no cartão": a maquininha desconta do próximo repasse
create or replace function public._recebivel_da_devolucao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.como_devolveu = 'estorno_cartao' and new.valor_devolvido > 0 and old.valor_devolvido = 0 then
    insert into public.recebiveis (venda_id, devolucao_id, empresa_id, forma, data_prevista, bruto, taxa, liquido)
    select new.venda_id, new.id, ve.empresa_id, 'estorno', public.hoje_loja(), -new.valor_devolvido, 0, -new.valor_devolvido
    from public.vendas ve where ve.id = new.venda_id;
  end if;
  return new;
end;
$$;
create trigger devolucoes_recebiveis after update of valor_devolvido on public.devolucoes
  for each row execute function public._recebivel_da_devolucao();

-- Conferir com o extrato: marcar (ou desmarcar) como recebido
create or replace function public.marcar_recebidos(p_ids uuid[], p_recebido boolean, p_data date default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  perform public._exigir_financeiro();
  update public.recebiveis set
    status = case when p_recebido then 'recebido' else 'a_receber' end,
    recebido_em = case when p_recebido then coalesce(p_data, public.hoje_loja()) end
  where id = any (p_ids) and status in ('a_receber', 'recebido');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- vendas que já existiam antes desta migration também geram o a receber
insert into public.recebiveis (venda_id, pagamento_id, empresa_id, forma, parcela, parcelas, data_prevista, bruto, taxa, liquido, status)
select p.venda_id, p.id, ve.empresa_id, p.forma, g.i, g.n,
  (ve.criado_em at time zone 'America/Sao_Paulo')::date + case when p.forma = 'cartao_debito' then e.prazo_debito_dias else e.prazo_credito_dias * g.i end,
  g.bruto, round(g.bruto * p.taxa_percentual / 100, 2), g.bruto - round(g.bruto * p.taxa_percentual / 100, 2),
  case when ve.status = 'cancelada' then 'estornado' else 'a_receber' end
from public.venda_pagamentos p
join public.vendas ve on ve.id = p.venda_id
join public.empresas e on e.id = ve.empresa_id
cross join lateral (
  select i, p.parcelas as n,
    case when i = p.parcelas then p.valor - round(p.valor / p.parcelas, 2) * (p.parcelas - 1) else round(p.valor / p.parcelas, 2) end as bruto
  from generate_series(1, case when p.forma = 'cartao_credito' then p.parcelas else 1 end) i
) g
where p.forma in ('cartao_debito', 'cartao_credito');

-- ---------------------------------------------------------------------
-- Caixa do dia
-- ---------------------------------------------------------------------
create table public.caixas (
  id            uuid primary key default gen_random_uuid(),
  dia           date not null unique,
  abertura      numeric(12,2) not null check (abertura between 0 and 999999.99),
  aberto_por    uuid references public.perfis (id) on delete set null,
  aberto_em     timestamptz not null default now(),
  fechado_em    timestamptz,
  fechado_por   uuid references public.perfis (id) on delete set null,
  contado       numeric(12,2) check (contado between 0 and 999999.99),
  esperado      numeric(12,2),
  observacao    text check (length(observacao) <= 200)
);

create table public.caixa_lancamentos (
  id            uuid primary key default gen_random_uuid(),
  caixa_id      uuid not null references public.caixas (id) on delete restrict,
  tipo          text not null check (tipo in ('suprimento', 'sangria')),
  valor         numeric(12,2) not null check (valor between 0.01 and 999999.99),
  motivo        text not null check (length(trim(motivo)) between 3 and 120),
  usuario_id    uuid references public.perfis (id) on delete set null,
  usuario_nome  text not null default '',
  criado_em     timestamptz not null default now()
);
create index caixa_lancamentos_caixa_idx on public.caixa_lancamentos (caixa_id);

-- O que mexe na gaveta num dia, calculado das vendas, encomendas e devoluções
create or replace function public.resumo_caixa(p_dia date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dia        date := coalesce(p_dia, public.hoje_loja());
  v_caixa      public.caixas;
  v_formas     jsonb;
  v_dinheiro   numeric;
  v_sinais     numeric;
  v_devolvido  numeric;
  v_supr       numeric;
  v_sang       numeric;
  v_lanc       jsonb;
begin
  perform public._exigir_financeiro();
  select * into v_caixa from public.caixas where dia = v_dia;

  select coalesce(jsonb_object_agg(forma, total), '{}'::jsonb) into v_formas
  from (
    select p.forma, sum(p.valor) as total
    from public.venda_pagamentos p join public.vendas ve on ve.id = p.venda_id
    where ve.status = 'concluida' and (ve.criado_em at time zone 'America/Sao_Paulo')::date = v_dia
    group by p.forma
  ) x;
  v_dinheiro := coalesce((v_formas ->> 'dinheiro')::numeric, 0);

  select coalesce(sum(sinal_valor), 0) into v_sinais from public.encomendas
  where sinal_forma = 'dinheiro' and (criado_em at time zone 'America/Sao_Paulo')::date = v_dia;

  select coalesce(sum(valor_devolvido), 0) into v_devolvido from public.devolucoes
  where como_devolveu = 'dinheiro' and (criado_em at time zone 'America/Sao_Paulo')::date = v_dia;

  select coalesce(sum(valor) filter (where tipo = 'suprimento'), 0), coalesce(sum(valor) filter (where tipo = 'sangria'), 0),
         coalesce(jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'valor', valor, 'motivo', motivo, 'usuario_nome', usuario_nome, 'criado_em', criado_em) order by criado_em), '[]'::jsonb)
    into v_supr, v_sang, v_lanc
  from public.caixa_lancamentos where caixa_id = v_caixa.id;

  return jsonb_build_object(
    'dia', v_dia,
    'caixa', case when v_caixa.id is null then null else to_jsonb(v_caixa) end,
    'lancamentos', v_lanc,
    'vendas_por_forma', v_formas,
    'dinheiro', v_dinheiro,
    'sinais', v_sinais,
    'devolucoes', v_devolvido,
    'suprimentos', v_supr,
    'sangrias', v_sang,
    'esperado', case when v_caixa.id is null then null
                     else v_caixa.abertura + v_dinheiro + v_sinais - v_devolvido + v_supr - v_sang end
  );
end;
$$;

create or replace function public.abrir_caixa(p_abertura numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public._exigir_financeiro();
  if exists (select 1 from public.caixas where dia = public.hoje_loja()) then
    raise exception 'O caixa de hoje já foi aberto.';
  end if;
  insert into public.caixas (dia, abertura, aberto_por) values (public.hoje_loja(), round(coalesce(p_abertura, 0), 2), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.lancar_caixa(p_tipo text, p_valor numeric, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caixa public.caixas;
  v_esperado numeric;
begin
  perform public._exigir_financeiro();
  select * into v_caixa from public.caixas where dia = public.hoje_loja() for update;
  if v_caixa.id is null then raise exception 'Abra o caixa de hoje primeiro.'; end if;
  if v_caixa.fechado_em is not null then raise exception 'O caixa de hoje já foi fechado.'; end if;
  if p_tipo = 'sangria' then
    v_esperado := (public.resumo_caixa() ->> 'esperado')::numeric;
    if round(p_valor, 2) > v_esperado then
      raise exception 'A gaveta deveria ter só R$ %.', replace(to_char(v_esperado, 'FM999990.00'), '.', ',');
    end if;
  end if;
  insert into public.caixa_lancamentos (caixa_id, tipo, valor, motivo, usuario_id, usuario_nome)
  values (v_caixa.id, p_tipo, round(p_valor, 2), trim(p_motivo), auth.uid(), coalesce((select nome from public.perfis where id = auth.uid()), ''));
end;
$$;

create or replace function public.fechar_caixa(p_contado numeric, p_observacao text default null)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caixa public.caixas;
  v_esperado numeric;
begin
  perform public._exigir_financeiro();
  select * into v_caixa from public.caixas where dia = public.hoje_loja() for update;
  if v_caixa.id is null then raise exception 'Abra o caixa de hoje primeiro.'; end if;
  if v_caixa.fechado_em is not null then raise exception 'O caixa de hoje já foi fechado.'; end if;
  v_esperado := (public.resumo_caixa() ->> 'esperado')::numeric;
  if round(p_contado, 2) <> v_esperado and length(trim(coalesce(p_observacao, ''))) < 3 then
    raise exception 'Houve diferença: explique o motivo antes de fechar.';
  end if;
  update public.caixas set fechado_em = now(), fechado_por = auth.uid(), contado = round(p_contado, 2),
    esperado = v_esperado, observacao = nullif(trim(p_observacao), '')
  where id = v_caixa.id;
  return round(p_contado, 2) - v_esperado;
end;
$$;

-- ---------------------------------------------------------------------
-- Resultado do mês (competência)
-- ---------------------------------------------------------------------
create or replace function public.resultado_mes(p_mes date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ini  date := date_trunc('month', p_mes)::date;
  v_fim  date := (date_trunc('month', p_mes) + interval '1 month')::date;
  r      jsonb;
begin
  perform public._exigir_financeiro();
  with
  vendas_mes as (
    select ve.* from public.vendas ve
    where ve.status = 'concluida' and (ve.criado_em at time zone 'America/Sao_Paulo')::date >= v_ini
      and (ve.criado_em at time zone 'America/Sao_Paulo')::date < v_fim
  ),
  devol_mes as (
    select d.*, ve.empresa_id from public.devolucoes d join public.vendas ve on ve.id = d.venda_id
    where ve.status = 'concluida' and (d.criado_em at time zone 'America/Sao_Paulo')::date >= v_ini
      and (d.criado_em at time zone 'America/Sao_Paulo')::date < v_fim
  ),
  por_empresa as (
    select e.id, e.apelido, e.imposto_percentual,
      coalesce((select sum(total) from vendas_mes where empresa_id = e.id), 0) as vendas,
      coalesce((select sum(valor_devolvido) from devol_mes where empresa_id = e.id), 0) as devolvido
    from public.empresas e
  ),
  numeros as (
    select
      (select coalesce(sum(vendas), 0) from por_empresa) as faturamento,
      (select coalesce(sum(devolvido), 0) from por_empresa) as devolucoes,
      (select coalesce(sum(round(p.valor * p.taxa_percentual / 100, 2)), 0)
         from public.venda_pagamentos p join vendas_mes vm on vm.id = p.venda_id) as taxas,
      (select coalesce(sum(round((vendas - devolvido) * imposto_percentual / 100, 2)), 0) from por_empresa) as imposto,
      (select coalesce(sum(c.custo_unitario * vi.quantidade), 0)
         from public.venda_itens vi join vendas_mes vm on vm.id = vi.venda_id
         join public.custos_venda_itens c on c.venda_item_id = vi.id)
      - (select coalesce(sum(c.custo_unitario * di.quantidade), 0)
         from public.devolucao_itens di join devol_mes dm on dm.id = di.devolucao_id
         join public.custos_venda_itens c on c.venda_item_id = di.venda_item_id
         where di.volta_ao_estoque) as custo_pecas
  ),
  despesas as (
    select categoria, sum(valor) as valor from public.contas_pagar
    where vencimento >= v_ini and vencimento < v_fim and categoria <> 'fornecedores'
    group by categoria
  )
  select jsonb_build_object(
    'faturamento', n.faturamento,
    'devolucoes', n.devolucoes,
    'taxas', n.taxas,
    'imposto', n.imposto,
    'custo_pecas', n.custo_pecas,
    'lucro_bruto', n.faturamento - n.devolucoes - n.taxas - n.imposto - n.custo_pecas,
    'por_empresa', (select jsonb_agg(jsonb_build_object('id', id, 'apelido', apelido, 'vendas', vendas, 'imposto_percentual', imposto_percentual) order by id) from por_empresa),
    'despesas', coalesce((select jsonb_object_agg(categoria, valor) from despesas), '{}'::jsonb),
    'total_despesas', coalesce((select sum(valor) from despesas), 0),
    'resultado', n.faturamento - n.devolucoes - n.taxas - n.imposto - n.custo_pecas - coalesce((select sum(valor) from despesas), 0),
    'compras_mercadoria', coalesce((select sum(valor) from public.contas_pagar where vencimento >= v_ini and vencimento < v_fim and categoria = 'fornecedores'), 0)
  ) into r
  from numeros n;
  return r;
end;
$$;

-- ---------------------------------------------------------------------
-- Quem vê e quem mexe: só com o Financeiro aberto
-- ---------------------------------------------------------------------
alter table public.config_financeiro enable row level security;
alter table public.custos_fixos enable row level security;
alter table public.custos_fixos_gerados enable row level security;
alter table public.contas_pagar enable row level security;
alter table public.recebiveis enable row level security;
alter table public.caixas enable row level security;
alter table public.caixa_lancamentos enable row level security;

create policy "Financeiro vê a configuração" on public.config_financeiro for select to authenticated using ((select public.pode_financeiro()));
create policy "Financeiro muda a configuração" on public.config_financeiro for update to authenticated using ((select public.pode_financeiro())) with check ((select public.pode_financeiro()));
create policy "Financeiro vê os custos fixos" on public.custos_fixos for select to authenticated using ((select public.pode_financeiro()));
create policy "Financeiro cria custos fixos" on public.custos_fixos for insert to authenticated with check ((select public.pode_financeiro()));
create policy "Financeiro muda custos fixos" on public.custos_fixos for update to authenticated using ((select public.pode_financeiro())) with check ((select public.pode_financeiro()));
create policy "Financeiro apaga custos fixos" on public.custos_fixos for delete to authenticated using ((select public.pode_financeiro()));
create policy "Financeiro vê as contas" on public.contas_pagar for select to authenticated using ((select public.pode_financeiro()));
create policy "Financeiro muda as contas" on public.contas_pagar for update to authenticated using ((select public.pode_financeiro())) with check ((select public.pode_financeiro()));
-- conta paga não se apaga: desfaça o pagamento antes
create policy "Financeiro apaga conta em aberto" on public.contas_pagar for delete to authenticated using ((select public.pode_financeiro()) and pago_em is null);
create policy "Financeiro vê o a receber" on public.recebiveis for select to authenticated using ((select public.pode_financeiro()));
create policy "Financeiro vê os caixas" on public.caixas for select to authenticated using ((select public.pode_financeiro()));
create policy "Financeiro vê os lançamentos do caixa" on public.caixa_lancamentos for select to authenticated using ((select public.pode_financeiro()));
-- criar conta, a receber, caixa e lançamentos: só pelas funções acima

revoke execute on function public._exigir_financeiro() from public, anon, authenticated;
revoke execute on function public._gerar_recebiveis() from public, anon, authenticated;
revoke execute on function public._estornar_recebiveis() from public, anon, authenticated;
revoke execute on function public._recebivel_da_devolucao() from public, anon, authenticated;
revoke execute on function public._conferir_conta() from public, anon, authenticated;
revoke execute on function public.pode_financeiro() from public, anon;
revoke execute on function public.gerar_contas_fixas() from public, anon;
revoke execute on function public.criar_contas(jsonb) from public, anon;
revoke execute on function public.marcar_recebidos(uuid[], boolean, date) from public, anon;
revoke execute on function public.resumo_caixa(date) from public, anon;
revoke execute on function public.abrir_caixa(numeric) from public, anon;
revoke execute on function public.lancar_caixa(text, numeric, text) from public, anon;
revoke execute on function public.fechar_caixa(numeric, text) from public, anon;
revoke execute on function public.resultado_mes(date) from public, anon;
grant execute on function public.pode_financeiro() to authenticated;
grant execute on function public.gerar_contas_fixas() to authenticated;
grant execute on function public.criar_contas(jsonb) to authenticated;
grant execute on function public.marcar_recebidos(uuid[], boolean, date) to authenticated;
grant execute on function public.resumo_caixa(date) to authenticated;
grant execute on function public.abrir_caixa(numeric) to authenticated;
grant execute on function public.lancar_caixa(text, numeric, text) to authenticated;
grant execute on function public.fechar_caixa(numeric, text) to authenticated;
grant execute on function public.resultado_mes(date) to authenticated;
