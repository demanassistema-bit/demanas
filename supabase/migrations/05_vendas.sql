-- =====================================================================
-- DEMANAS · 05 · Vendas: clientes (básico), vendas, itens, pagamentos,
--                devoluções, cancelamento, taxas e código de aprovação
-- =====================================================================
-- A venda nasce numa função só (concluir_venda): confere tudo, grava a
-- venda e dá baixa no estoque na mesma transação. Ou tudo dá certo, ou
-- nada é gravado.
--
-- Regras (parte 6.8 do briefing):
--   · Preço e custo vêm do banco e são COPIADOS para o item no momento
--     da venda. Mudar o preço depois não muda a venda antiga.
--   · A taxa da maquininha também é copiada para o pagamento.
--   · Sem saldo, não vende (a menos que "permitir vender sem estoque"
--     esteja ligado). Lote vencido nunca sai numa venda.
--   · Cosmético com lote sai pela validade mais próxima.
--   · Kit dá baixa nas peças que o formam.
--   · Peças dos dois CNPJs = duas vendas ligadas pelo mesmo "grupo",
--     cada uma paga na maquininha do seu CNPJ.
--   · Venda nunca é apagada nem editada. Cancelar devolve as peças ao
--     estoque (estorno) e guarda quem, quando e por quê. Devolução de
--     parte das peças fica registrada; a peça volta ao estoque, ou não
--     volta (higiene: categoria marcada "não volta ao estoque").
--   · Desconto da vendedora acima do limite, cancelamento e devolução
--     feitos pela vendedora pedem o CÓDIGO DE APROVAÇÃO, que só as
--     proprietárias criam (Equipe). O código gera uma autorização que
--     vale uma ação só, por 10 minutos.
--
-- Clientes: só o básico agora (nome e WhatsApp), para a venda já ficar
-- ligada à cliente. Histórico, aniversário e segmentos chegam na Etapa 5.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Código de aprovação: uma terceira área de código
-- ---------------------------------------------------------------------
alter type public.area_protegida add value if not exists 'aprovacao';

-- ---------------------------------------------------------------------
-- Clientes (básico)
-- ---------------------------------------------------------------------
create table public.clientes (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (length(trim(nome)) between 2 and 80),
  -- só os números, com DDD (e o 55 do Brasil, se vier)
  whatsapp       text check (whatsapp ~ '^\d{10,13}$'),
  criado_por     uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create unique index clientes_whatsapp_unico on public.clientes (whatsapp) where whatsapp is not null;
create index clientes_nome_idx on public.clientes (lower(nome));

create trigger clientes_atualizado_em before update on public.clientes
  for each row execute function public.definir_atualizado_em();
create trigger clientes_auditoria after insert or update or delete on public.clientes
  for each row execute function public.registrar_auditoria();

alter table public.clientes enable row level security;
create policy "Equipe vê as clientes" on public.clientes for select to authenticated using ((select public.eh_membro_ativo()));
create policy "Equipe cadastra clientes" on public.clientes for insert to authenticated with check ((select public.eh_membro_ativo()));
create policy "Equipe corrige clientes" on public.clientes for update to authenticated using ((select public.eh_membro_ativo())) with check ((select public.eh_membro_ativo()));
-- apagar cliente: só na Etapa 5, com a regra da LGPD (quem tem compra é anonimizada)

-- ---------------------------------------------------------------------
-- Categoria de higiene: peça devolvida não volta ao estoque
-- ---------------------------------------------------------------------
alter table public.categorias add column nao_volta_ao_estoque boolean not null default false;

-- ---------------------------------------------------------------------
-- Taxas da maquininha de cada CNPJ (copiadas para cada pagamento).
-- Começam em zero: quem preenche são as proprietárias, em Configurações.
-- ---------------------------------------------------------------------
create table public.taxas_pagamento (
  empresa_id     text not null references public.empresas (id) on delete cascade,
  tipo           text not null check (tipo in ('pix', 'debito', 'credito', 'credito_parcelado')),
  percentual     numeric(5,2) not null default 0 check (percentual between 0 and 30),
  atualizado_em  timestamptz not null default now(),
  primary key (empresa_id, tipo)
);
insert into public.taxas_pagamento (empresa_id, tipo)
select e.id, t.tipo from public.empresas e
cross join (values ('pix'), ('debito'), ('credito'), ('credito_parcelado')) as t(tipo);

create trigger taxas_pagamento_atualizado_em before update on public.taxas_pagamento
  for each row execute function public.definir_atualizado_em();
create trigger taxas_pagamento_auditoria after insert or update or delete on public.taxas_pagamento
  for each row execute function public.registrar_auditoria();

alter table public.taxas_pagamento enable row level security;
create policy "Quem vê custos vê as taxas" on public.taxas_pagamento for select to authenticated using ((select public.pode_ver_custos()));
create policy "Admin altera as taxas" on public.taxas_pagamento for update to authenticated using ((select public.eh_admin())) with check ((select public.eh_admin()));

-- Parâmetros de venda (a tabela parametros veio na 03)
insert into public.parametros (chave, valor) values
  ('limite_desconto_vendedora', '10'::jsonb),
  ('permitir_estoque_negativo', 'false'::jsonb)
on conflict (chave) do nothing;

create or replace function public.parametro(p_chave text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select valor from public.parametros where chave = p_chave;
$$;

-- ---------------------------------------------------------------------
-- Vendas
-- ---------------------------------------------------------------------
-- Número da venda sem buraco: um contador que trava e volta atrás junto
-- com a venda recusada (uma sequência pularia números)
create table public.contadores (
  chave  text primary key,
  valor  int not null
);
insert into public.contadores (chave, valor) values ('venda', 0);
alter table public.contadores enable row level security;
revoke all on public.contadores from anon, authenticated;

create or replace function public._proximo_numero(p_chave text)
returns int
language sql
security definer
set search_path = ''
as $
  update public.contadores set valor = valor + 1 where chave = p_chave returning valor;
$;

create table public.vendas (
  id                     uuid primary key default gen_random_uuid(),
  numero                 int not null unique,
  -- peças dos dois CNPJs: duas vendas com o mesmo grupo
  grupo                  uuid,
  empresa_id             text not null references public.empresas (id),
  cliente_id             uuid references public.clientes (id) on delete set null,
  canal                  text not null check (canal in ('loja', 'instagram', 'whatsapp')),
  subtotal               numeric(12,2) not null check (subtotal > 0),
  desconto               numeric(12,2) not null default 0 check (desconto >= 0),
  total                  numeric(12,2) not null check (total > 0),
  status                 text not null default 'concluida' check (status in ('concluida', 'cancelada')),
  -- a nota sai na Etapa 7; aqui só marca o que vai precisar dela
  nota_status            text not null check (nota_status in ('sem_nota', 'a_emitir', 'emitida', 'pendente', 'cancelada')),
  aprovada_com_codigo    boolean not null default false,
  vendedora_id           uuid,
  vendedora_nome         text not null default '',
  criado_em              timestamptz not null default now(),
  cancelada_em           timestamptz,
  cancelada_por_nome     text,
  motivo_cancelamento    text check (length(motivo_cancelamento) <= 120),
  check (total = subtotal - desconto)
);
create index vendas_data_idx on public.vendas (criado_em desc);
create index vendas_cliente_idx on public.vendas (cliente_id, criado_em desc);
create index vendas_grupo_idx on public.vendas (grupo) where grupo is not null;

create table public.venda_itens (
  id              uuid primary key default gen_random_uuid(),
  venda_id        uuid not null references public.vendas (id) on delete restrict,
  variacao_id     uuid not null references public.variacoes (id) on delete restrict,
  -- nome do momento da venda (o cadastro pode mudar depois)
  descricao       text not null,
  quantidade      int not null check (quantidade between 1 and 999),
  preco_unitario  numeric(12,2) not null check (preco_unitario >= 0),
  -- parte do desconto da venda que coube a este item
  desconto        numeric(12,2) not null default 0 check (desconto >= 0)
);
create index venda_itens_venda_idx on public.venda_itens (venda_id);
create index venda_itens_variacao_idx on public.venda_itens (variacao_id);

-- Custo de cada item: à parte, só para quem pode ver custos
create table public.custos_venda_itens (
  venda_item_id   uuid primary key references public.venda_itens (id) on delete restrict,
  custo_unitario  numeric(12,2) not null check (custo_unitario >= 0)
);

create table public.venda_pagamentos (
  id               uuid primary key default gen_random_uuid(),
  venda_id         uuid not null references public.vendas (id) on delete restrict,
  forma            text not null check (forma in ('pix', 'cartao_debito', 'cartao_credito', 'dinheiro')),
  valor            numeric(12,2) not null check (valor > 0),
  parcelas         int not null default 1 check (parcelas between 1 and 12),
  taxa_percentual  numeric(5,2) not null default 0,
  check (forma = 'cartao_credito' or parcelas = 1)
);
create index venda_pagamentos_venda_idx on public.venda_pagamentos (venda_id);

create table public.devolucoes (
  id               uuid primary key default gen_random_uuid(),
  venda_id         uuid not null references public.vendas (id) on delete restrict,
  motivo           text not null check (length(motivo) between 3 and 120),
  valor_devolvido  numeric(12,2) not null check (valor_devolvido >= 0),
  como_devolveu    text not null check (como_devolveu in ('dinheiro', 'pix', 'estorno_cartao', 'credito_loja', 'troca')),
  aprovada_com_codigo boolean not null default false,
  usuario_id       uuid,
  usuario_nome     text not null default '',
  criado_em        timestamptz not null default now()
);
create index devolucoes_venda_idx on public.devolucoes (venda_id);

create table public.devolucao_itens (
  devolucao_id     uuid not null references public.devolucoes (id) on delete restrict,
  venda_item_id    uuid not null references public.venda_itens (id) on delete restrict,
  quantidade       int not null check (quantidade between 1 and 999),
  volta_ao_estoque boolean not null,
  primary key (devolucao_id, venda_item_id)
);

-- Venda é registro: ninguém edita nem apaga pela API (só as funções)
alter table public.vendas enable row level security;
alter table public.venda_itens enable row level security;
alter table public.custos_venda_itens enable row level security;
alter table public.venda_pagamentos enable row level security;
alter table public.devolucoes enable row level security;
alter table public.devolucao_itens enable row level security;

revoke insert, update, delete, truncate on public.vendas, public.venda_itens, public.custos_venda_itens,
  public.venda_pagamentos, public.devolucoes, public.devolucao_itens from anon, authenticated;

create policy "Equipe vê as vendas" on public.vendas for select to authenticated using ((select public.eh_membro_ativo()));
create policy "Equipe vê os itens" on public.venda_itens for select to authenticated using ((select public.eh_membro_ativo()));
create policy "Só quem pode ver custos" on public.custos_venda_itens for select to authenticated using ((select public.pode_ver_custos()));
create policy "Equipe vê os pagamentos" on public.venda_pagamentos for select to authenticated using ((select public.eh_membro_ativo()));
create policy "Equipe vê as devoluções" on public.devolucoes for select to authenticated using ((select public.eh_membro_ativo()));
create policy "Equipe vê os itens devolvidos" on public.devolucao_itens for select to authenticated using ((select public.eh_membro_ativo()));

-- Nada de apagar venda, nem pelo dono do banco
create or replace function public.impedir_apagar_venda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Venda não se apaga: cancele, e o registro continua guardado.' using errcode = '42501';
end;
$$;
create trigger vendas_nao_apaga before delete on public.vendas
  for each row execute function public.impedir_apagar_venda();
create trigger venda_itens_imutaveis before update or delete on public.venda_itens
  for each row execute function public.impedir_apagar_venda();
create trigger venda_pagamentos_imutaveis before update or delete on public.venda_pagamentos
  for each row execute function public.impedir_apagar_venda();
create trigger custos_venda_itens_imutaveis before update or delete on public.custos_venda_itens
  for each row execute function public.impedir_apagar_venda();

-- ---------------------------------------------------------------------
-- Código de aprovação
-- A proprietária digita o código no celular da vendedora (pedir_aprovacao).
-- Certo → nasce uma autorização que vale UMA ação, por 10 minutos.
-- Errado → fica registrado; 5 erros em 15 minutos bloqueiam por 15 minutos.
-- ---------------------------------------------------------------------
create table public.aprovacoes (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null,
  expira_em   timestamptz not null,
  usada_em    timestamptz
);
alter table public.aprovacoes enable row level security;
revoke all on public.aprovacoes from anon, authenticated;

create or replace function public.pedir_aprovacao(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_id uuid;
begin
  if not public.eh_membro_ativo() then
    return jsonb_build_object('ok', false, 'erro', 'Entre no sistema.');
  end if;
  if (select count(*) from public.tentativas_codigo
      where usuario_id = auth.uid() and area = 'aprovacao' and not sucesso
        and criado_em > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'erro', 'Muitas tentativas erradas. Espere 15 minutos.');
  end if;
  select codigo_hash into v_hash from public.codigos_acesso where area = 'aprovacao';
  if v_hash is null then
    return jsonb_build_object('ok', false, 'erro', 'O código de aprovação ainda não foi criado. Uma proprietária cria em Equipe.');
  end if;
  if extensions.crypt(coalesce(p_codigo, ''), v_hash) <> v_hash then
    insert into public.tentativas_codigo (usuario_id, area, sucesso) values (auth.uid(), 'aprovacao', false);
    return jsonb_build_object('ok', false, 'erro', 'Código de aprovação incorreto.');
  end if;
  insert into public.tentativas_codigo (usuario_id, area, sucesso) values (auth.uid(), 'aprovacao', true);
  insert into public.aprovacoes (usuario_id, expira_em) values (auth.uid(), now() + interval '10 minutes')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'aprovacao', v_id);
end;
$$;

-- Usa a autorização (uma vez só). Sem ela: erro P0002, e a tela pede o código.
create or replace function public._usar_aprovacao(p_aprovacao uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.aprovacoes set usada_em = now()
  where id = p_aprovacao and usuario_id = auth.uid() and usada_em is null and expira_em > now();
  if not found then
    raise exception 'Precisa da aprovação da proprietária: ela digita o código de aprovação.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Baixa de venda: pela validade mais próxima, sem lote vencido.
-- Sem saldo: recusa, ou (com "permitir vender sem estoque") deixa negativo.
-- ---------------------------------------------------------------------
create or replace function public._baixar_venda(p_variacao uuid, p_quantidade int, p_motivo text, p_venda uuid, p_negativo boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_custo numeric := (select custo_medio from public.custos_variacao where variacao_id = p_variacao);
  v_falta int := p_quantidade;
  v_usa int;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
begin
  for r in
    select m.lote_id, sum(m.quantidade)::int as saldo
    from public.movimentacoes_estoque m
    left join public.lotes l on l.id = m.lote_id
    where m.variacao_id = p_variacao and (l.validade is null or l.validade >= v_hoje)
    group by m.lote_id, l.validade
    having sum(m.quantidade) > 0
    order by l.validade asc nulls last, (m.lote_id is null) asc
  loop
    exit when v_falta <= 0;
    v_usa := least(v_falta, r.saldo);
    perform public._lancar(p_variacao, r.lote_id, 'saida_venda', -v_usa, v_custo, p_motivo, 'venda', p_venda);
    v_falta := v_falta - v_usa;
  end loop;
  if v_falta > 0 then
    if not p_negativo then
      raise exception 'Sem estoque de "%" (faltam %). Lance a entrada ou corrija o saldo antes.',
        (select p.nome || coalesce(' · ' || nullif(concat_ws(' ', v.modelo, v.cor, v.tamanho, v.tonalidade, v.volume), ''), '')
         from public.variacoes v join public.produtos p on p.id = v.produto_id where v.id = p_variacao),
        v_falta;
    end if;
    perform public._lancar(p_variacao, null, 'saida_venda', -v_falta, v_custo, p_motivo, 'venda', p_venda);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- concluir_venda
-- Entrada: { cliente_id, canal, aprovacao,
--            partes: [{ empresa_id, desconto,
--                       itens: [{ variacao_id, quantidade }],
--                       pagamentos: [{ forma, valor, parcelas }] }] }
-- Saída: [{ id, numero, empresa_id, total }]
-- ---------------------------------------------------------------------
create or replace function public.concluir_venda(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin      boolean := public.eh_admin();
  v_nome       text := (select nome from public.perfis where id = auth.uid());
  v_negativo   boolean := coalesce((public.parametro('permitir_estoque_negativo'))::boolean, false);
  v_limite     numeric := coalesce((public.parametro('limite_desconto_vendedora'))::numeric, 0);
  v_canal      text := coalesce(p ->> 'canal', 'loja');
  v_cliente    uuid := nullif(p ->> 'cliente_id', '')::uuid;
  v_grupo      uuid;
  v_partes     int := jsonb_array_length(coalesce(p -> 'partes', '[]'::jsonb));
  v_aprovada   boolean := false;
  v_subtotal_g numeric := 0;
  v_desconto_g numeric := 0;
  parte        jsonb;
  item         jsonb;
  pag          jsonb;
  v_venda      uuid;
  v_numero     int;
  v_item       uuid;
  v_subtotal   numeric;
  v_desconto   numeric;
  v_total      numeric;
  v_pago       numeric;
  v_resto      numeric;
  v_rateio     numeric;
  v_n          int;
  v_i          int;
  v_tipo_taxa  text;
  v_resultado  jsonb := '[]'::jsonb;
  r            record;
  k            record;
begin
  if not public.eh_membro_ativo() then
    raise exception 'Entre no sistema para vender.' using errcode = '42501';
  end if;
  if v_partes < 1 or v_partes > 2 then
    raise exception 'A venda precisa de pelo menos uma peça.';
  end if;
  if v_canal not in ('loja', 'instagram', 'whatsapp') then
    raise exception 'Canal de venda desconhecido.';
  end if;
  if v_cliente is not null and not exists (select 1 from public.clientes where id = v_cliente) then
    raise exception 'Cliente não encontrada. Busque de novo.';
  end if;
  if v_partes = 2 then
    if (p -> 'partes' -> 0 ->> 'empresa_id') = (p -> 'partes' -> 1 ->> 'empresa_id') then
      raise exception 'As duas partes da venda são do mesmo CNPJ.';
    end if;
    v_grupo := gen_random_uuid();
  end if;

  -- 1) Confere itens, preços e totais de cada parte (preço vem do banco)
  for parte in select value from jsonb_array_elements(p -> 'partes') loop
    if jsonb_array_length(coalesce(parte -> 'itens', '[]'::jsonb)) = 0 then
      raise exception 'Uma parte da venda está sem peças.';
    end if;
    if jsonb_array_length(parte -> 'itens') > 100 then
      raise exception 'São muitas peças numa venda só (até 100 linhas).';
    end if;
    v_subtotal := 0;
    for item in select value from jsonb_array_elements(parte -> 'itens') loop
      select v.preco_venda, p2.empresa_id, v.ativo and p2.ativo as vende, p2.nome
        into r
      from public.variacoes v join public.produtos p2 on p2.id = v.produto_id
      where v.id = (item ->> 'variacao_id')::uuid;
      if not found then
        raise exception 'Uma das peças não existe mais. Atualize a página.';
      end if;
      if not r.vende then
        raise exception '"%" está arquivado ou fora de linha.', r.nome;
      end if;
      if r.empresa_id <> parte ->> 'empresa_id' then
        raise exception '"%" mudou de CNPJ. Volte aos itens e conclua de novo.', r.nome;
      end if;
      if (item ->> 'quantidade')::int not between 1 and 999 then
        raise exception 'A quantidade de cada peça vai de 1 a 999.';
      end if;
      v_subtotal := v_subtotal + r.preco_venda * (item ->> 'quantidade')::int;
    end loop;
    v_desconto := round(coalesce((parte ->> 'desconto')::numeric, 0), 2);
    if v_desconto < 0 or v_desconto >= v_subtotal then
      raise exception 'O desconto precisa ser menor que o valor da compra.';
    end if;
    v_total := v_subtotal - v_desconto;
    v_pago := 0;
    if jsonb_array_length(coalesce(parte -> 'pagamentos', '[]'::jsonb)) = 0 then
      raise exception 'Falta a forma de pagamento.';
    end if;
    for pag in select value from jsonb_array_elements(parte -> 'pagamentos') loop
      v_pago := v_pago + round((pag ->> 'valor')::numeric, 2);
    end loop;
    if v_pago <> v_total then
      raise exception 'Os pagamentos (R$ %) não fecham com o total (R$ %). Se um preço mudou agora há pouco, volte aos itens e confira.',
        to_char(v_pago, 'FM999G990D00'), to_char(v_total, 'FM999G990D00');
    end if;
    v_subtotal_g := v_subtotal_g + v_subtotal;
    v_desconto_g := v_desconto_g + v_desconto;
  end loop;

  -- 2) Desconto acima do limite da vendedora → código de aprovação
  if not v_admin and v_desconto_g > 0 and v_desconto_g * 100 > v_limite * v_subtotal_g then
    perform public._usar_aprovacao(nullif(p ->> 'aprovacao', '')::uuid);
    v_aprovada := true;
  end if;

  -- 3) Trava as peças (sempre na mesma ordem) antes de mexer no estoque
  for r in
    select distinct coalesce(ki.componente_variacao_id, (it.item ->> 'variacao_id')::uuid) as id
    from jsonb_array_elements(p -> 'partes') as pa(parte)
    cross join lateral jsonb_array_elements(pa.parte -> 'itens') as it(item)
    left join public.kit_itens ki on ki.kit_variacao_id = (it.item ->> 'variacao_id')::uuid
    order by 1
  loop
    perform 1 from public.variacoes where id = r.id for update;
  end loop;

  -- 4) Grava cada parte
  for parte in select value from jsonb_array_elements(p -> 'partes') loop
    v_subtotal := 0;
    for item in select value from jsonb_array_elements(parte -> 'itens') loop
      v_subtotal := v_subtotal + (select preco_venda from public.variacoes where id = (item ->> 'variacao_id')::uuid) * (item ->> 'quantidade')::int;
    end loop;
    v_desconto := round(coalesce((parte ->> 'desconto')::numeric, 0), 2);
    v_total := v_subtotal - v_desconto;

    insert into public.vendas (numero, grupo, empresa_id, cliente_id, canal, subtotal, desconto, total, nota_status,
                               aprovada_com_codigo, vendedora_id, vendedora_nome)
    values (
      public._proximo_numero('venda'), v_grupo, parte ->> 'empresa_id', v_cliente, v_canal, v_subtotal, v_desconto, v_total,
      case when (select tipo from public.empresas where id = parte ->> 'empresa_id') = 'me' then 'a_emitir' else 'sem_nota' end,
      v_aprovada, auth.uid(), coalesce(v_nome, '')
    )
    returning id, numero into v_venda, v_numero;

    -- itens: desconto rateado pelo valor de cada um (o último fica com o resto)
    v_resto := v_desconto;
    v_n := jsonb_array_length(parte -> 'itens');
    v_i := 0;
    for item in select value from jsonb_array_elements(parte -> 'itens') loop
      v_i := v_i + 1;
      select v.id, v.preco_venda, p2.tipo, p2.nome,
             nullif(concat_ws(' ', v.modelo, v.cor, v.tamanho, v.tonalidade, v.volume), '') as var
        into r
      from public.variacoes v join public.produtos p2 on p2.id = v.produto_id
      where v.id = (item ->> 'variacao_id')::uuid;

      v_rateio := case when v_i = v_n then v_resto
                       else round(v_desconto * r.preco_venda * (item ->> 'quantidade')::int / v_subtotal, 2) end;
      v_rateio := least(v_rateio, r.preco_venda * (item ->> 'quantidade')::int);
      v_resto := v_resto - v_rateio;

      insert into public.venda_itens (venda_id, variacao_id, descricao, quantidade, preco_unitario, desconto)
      values (v_venda, r.id, left(r.nome || coalesce(' · ' || r.var, ''), 160), (item ->> 'quantidade')::int, r.preco_venda, v_rateio)
      returning id into v_item;

      if r.tipo = 'kit' then
        if not exists (select 1 from public.kit_itens where kit_variacao_id = r.id) then
          raise exception 'O kit "%" está sem as peças definidas. Defina na ficha do produto.', r.nome;
        end if;
        insert into public.custos_venda_itens (venda_item_id, custo_unitario)
        select v_item, coalesce(sum(coalesce(c.custo_medio, 0) * ki.quantidade), 0)
        from public.kit_itens ki left join public.custos_variacao c on c.variacao_id = ki.componente_variacao_id
        where ki.kit_variacao_id = r.id;
        for k in select componente_variacao_id, quantidade from public.kit_itens where kit_variacao_id = r.id loop
          perform public._baixar_venda(k.componente_variacao_id, k.quantidade * (item ->> 'quantidade')::int,
            'Venda nº ' || v_numero || ' (kit ' || r.nome || ')', v_venda, v_negativo);
        end loop;
      else
        insert into public.custos_venda_itens (venda_item_id, custo_unitario)
        values (v_item, coalesce((select custo_medio from public.custos_variacao where variacao_id = r.id), 0));
        perform public._baixar_venda(r.id, (item ->> 'quantidade')::int, 'Venda nº ' || v_numero, v_venda, v_negativo);
      end if;
    end loop;

    for pag in select value from jsonb_array_elements(parte -> 'pagamentos') loop
      if pag ->> 'forma' not in ('pix', 'cartao_debito', 'cartao_credito', 'dinheiro') then
        raise exception 'Forma de pagamento desconhecida.';
      end if;
      v_tipo_taxa := case pag ->> 'forma'
        when 'pix' then 'pix'
        when 'cartao_debito' then 'debito'
        when 'cartao_credito' then case when coalesce((pag ->> 'parcelas')::int, 1) > 1 then 'credito_parcelado' else 'credito' end
      end;
      insert into public.venda_pagamentos (venda_id, forma, valor, parcelas, taxa_percentual)
      values (
        v_venda, pag ->> 'forma', round((pag ->> 'valor')::numeric, 2),
        case when pag ->> 'forma' = 'cartao_credito' then coalesce((pag ->> 'parcelas')::int, 1) else 1 end,
        coalesce((select percentual from public.taxas_pagamento where empresa_id = parte ->> 'empresa_id' and tipo = v_tipo_taxa), 0)
      );
    end loop;

    v_resultado := v_resultado || jsonb_build_object('id', v_venda, 'numero', v_numero, 'empresa_id', parte ->> 'empresa_id', 'total', v_total);
  end loop;

  return v_resultado;
end;
$$;

-- ---------------------------------------------------------------------
-- Cancelar: a venda fica guardada; as peças voltam aos mesmos lotes.
-- Venda com devolução não se cancela: devolva o restante.
-- ---------------------------------------------------------------------
create or replace function public.cancelar_venda(p_venda uuid, p_motivo text, p_aprovacao uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.vendas;
  v_motivo text := trim(coalesce(p_motivo, ''));
  r record;
begin
  if not public.eh_membro_ativo() then
    raise exception 'Entre no sistema.' using errcode = '42501';
  end if;
  select * into v from public.vendas where id = p_venda for update;
  if v.id is null then raise exception 'Venda não encontrada.'; end if;
  if v.status = 'cancelada' then raise exception 'Esta venda já foi cancelada.'; end if;
  if exists (select 1 from public.devolucoes where venda_id = p_venda) then
    raise exception 'Esta venda já teve devolução. Para desfazer o resto, registre a devolução das peças que faltam.';
  end if;
  if length(v_motivo) < 3 or length(v_motivo) > 120 then
    raise exception 'O motivo é obrigatório (de 3 a 120 letras).';
  end if;
  if not public.eh_admin() then
    perform public._usar_aprovacao(p_aprovacao);
  end if;

  for r in
    select variacao_id, lote_id, sum(quantidade)::int as liquido
    from public.movimentacoes_estoque
    where origem_tipo = 'venda' and origem_id = p_venda
    group by variacao_id, lote_id
    having sum(quantidade) < 0
    order by variacao_id
  loop
    perform 1 from public.variacoes where id = r.variacao_id for update;
    perform public._lancar(r.variacao_id, r.lote_id, 'cancelamento_venda', -r.liquido,
      (select custo_medio from public.custos_variacao where variacao_id = r.variacao_id),
      'Cancelamento da venda nº ' || v.numero, 'venda', p_venda);
  end loop;

  update public.vendas
  set status = 'cancelada', cancelada_em = now(),
      cancelada_por_nome = coalesce((select nome from public.perfis where id = auth.uid()), ''),
      motivo_cancelamento = v_motivo,
      nota_status = case when nota_status = 'sem_nota' then 'sem_nota' else 'cancelada' end
  where id = p_venda;
end;
$$;

-- ---------------------------------------------------------------------
-- Devolução de parte (ou de todas) as peças
-- Itens: [{ venda_item_id, quantidade, volta_ao_estoque }]
-- Devolve o valor a reembolsar (proporcional, já com o desconto).
-- ---------------------------------------------------------------------
create or replace function public.registrar_devolucao(
  p_venda uuid, p_itens jsonb, p_motivo text, p_como text, p_aprovacao uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.vendas;
  v_motivo text := trim(coalesce(p_motivo, ''));
  v_dev uuid;
  v_valor numeric := 0;
  v_aprovada boolean := false;
  it jsonb;
  vi public.venda_itens;
  v_qtd int;
  v_ja int;
  v_volta boolean;
  c record;
  b record;
  v_falta int;
  v_usa int;
begin
  if not public.eh_membro_ativo() then
    raise exception 'Entre no sistema.' using errcode = '42501';
  end if;
  select * into v from public.vendas where id = p_venda for update;
  if v.id is null then raise exception 'Venda não encontrada.'; end if;
  if v.status = 'cancelada' then raise exception 'Venda cancelada não tem devolução.'; end if;
  if length(v_motivo) < 3 or length(v_motivo) > 120 then
    raise exception 'O motivo é obrigatório (de 3 a 120 letras).';
  end if;
  if p_como not in ('dinheiro', 'pix', 'estorno_cartao', 'credito_loja', 'troca') then
    raise exception 'Diga como o valor foi devolvido.';
  end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Escolha as peças devolvidas.';
  end if;
  if not public.eh_admin() then
    perform public._usar_aprovacao(p_aprovacao);
    v_aprovada := true;
  end if;

  insert into public.devolucoes (venda_id, motivo, valor_devolvido, como_devolveu, aprovada_com_codigo, usuario_id, usuario_nome)
  values (p_venda, v_motivo, 0, p_como, v_aprovada, auth.uid(), coalesce((select nome from public.perfis where id = auth.uid()), ''))
  returning id into v_dev;

  for it in select value from jsonb_array_elements(p_itens) loop
    select * into vi from public.venda_itens where id = (it ->> 'venda_item_id')::uuid and venda_id = p_venda;
    if vi.id is null then raise exception 'Peça não é desta venda.'; end if;
    v_qtd := (it ->> 'quantidade')::int;
    v_volta := coalesce((it ->> 'volta_ao_estoque')::boolean, true);
    select coalesce(sum(quantidade), 0) into v_ja from public.devolucao_itens where venda_item_id = vi.id;
    if v_qtd is null or v_qtd < 1 or v_qtd > vi.quantidade - v_ja then
      raise exception 'De "%" dá para devolver no máximo %.', vi.descricao, vi.quantidade - v_ja;
    end if;

    insert into public.devolucao_itens (devolucao_id, venda_item_id, quantidade, volta_ao_estoque)
    values (v_dev, vi.id, v_qtd, v_volta);

    -- valor proporcional: (preço × qtd − desconto do item) ÷ qtd
    v_valor := v_valor + round((vi.preco_unitario * vi.quantidade - vi.desconto) * v_qtd / vi.quantidade, 2);

    if v_volta then
      -- as peças (ou as peças do kit) voltam aos lotes de onde saíram
      for c in
        select coalesce(ki.componente_variacao_id, vi.variacao_id) as variacao_id, coalesce(ki.quantidade, 1) * v_qtd as qtd
        from (select 1) x
        left join public.kit_itens ki on ki.kit_variacao_id = vi.variacao_id
        order by 1
      loop
        perform 1 from public.variacoes where id = c.variacao_id for update;
        v_falta := c.qtd;
        for b in
          select m.lote_id, -sum(m.quantidade)::int as saiu
          from public.movimentacoes_estoque m
          left join public.lotes l on l.id = m.lote_id
          where m.origem_tipo = 'venda' and m.origem_id = p_venda and m.variacao_id = c.variacao_id
          group by m.lote_id, l.validade
          having sum(m.quantidade) < 0
          order by l.validade desc nulls first
        loop
          exit when v_falta <= 0;
          v_usa := least(v_falta, b.saiu);
          perform public._lancar(c.variacao_id, b.lote_id, 'devolucao_cliente', v_usa,
            (select custo_medio from public.custos_variacao where variacao_id = c.variacao_id),
            'Devolução da venda nº ' || v.numero || ' · ' || v_motivo, 'venda', p_venda);
          v_falta := v_falta - v_usa;
        end loop;
        if v_falta > 0 then
          perform public._lancar(c.variacao_id, null, 'devolucao_cliente', v_falta,
            (select custo_medio from public.custos_variacao where variacao_id = c.variacao_id),
            'Devolução da venda nº ' || v.numero || ' · ' || v_motivo, 'venda', p_venda);
        end if;
      end loop;
    end if;
  end loop;

  update public.devolucoes set valor_devolvido = v_valor where id = v_dev;
  return v_valor;
end;
$$;

-- ---------------------------------------------------------------------
-- Quem pode chamar o quê
-- ---------------------------------------------------------------------
revoke execute on function public.impedir_apagar_venda() from public, anon, authenticated;
revoke execute on function public._usar_aprovacao(uuid) from public, anon, authenticated;
revoke execute on function public._proximo_numero(text) from public, anon, authenticated;
revoke execute on function public._baixar_venda(uuid, int, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.parametro(text) from public, anon;
revoke execute on function public.pedir_aprovacao(text) from public, anon;
revoke execute on function public.concluir_venda(jsonb) from public, anon;
revoke execute on function public.cancelar_venda(uuid, text, uuid) from public, anon;
revoke execute on function public.registrar_devolucao(uuid, jsonb, text, text, uuid) from public, anon;

grant execute on function public.parametro(text) to authenticated;
grant execute on function public.pedir_aprovacao(text) to authenticated;
grant execute on function public.concluir_venda(jsonb) to authenticated;
grant execute on function public.cancelar_venda(uuid, text, uuid) to authenticated;
grant execute on function public.registrar_devolucao(uuid, jsonb, text, text, uuid) to authenticated;
