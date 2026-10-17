-- =====================================================================
-- DEMANAS · 06 · Clientes: cadastro completo, resumo de compras,
--                exclusão pela LGPD e encomendas
-- =====================================================================
-- A tabela clientes nasceu na 05 só com nome e WhatsApp. Aqui ela ganha
-- o resto da ficha (parte 6.5 do briefing):
--   · e-mail, aniversário, de onde veio, observações, preferências
--     (tamanhos, tom e tipo de pele) e se aceita mensagens da loja.
--   · resumo_clientes: compras, total comprado (já sem as devoluções),
--     última compra. Uma venda com peças dos dois CNPJs conta como UMA
--     compra (as duas partes têm o mesmo grupo).
--   · Excluir cliente (só proprietárias): sem compras nem encomendas, o
--     cadastro é apagado; com histórico, só os dados pessoais saem e ela
--     vira "Cliente removida" (LGPD). Os dados pessoais também saem da
--     auditoria.
--
-- Encomendas: pedido de uma peça em falta. NÃO mexe no estoque.
--   · Peças do catálogo ou descritas à mão, data prevista, sinal e
--     observação. Situação: aguardando → chegou → entregue (ou cancelada).
--   · "Entregue" só acontece pela venda (concluir_venda com encomenda_id),
--     na mesma transação. O sinal já pago entra como forma de pagamento
--     "sinal", sem taxa, até o valor que a cliente pagou.
--   · Sinal é dinheiro registrado: depois de criado, não muda.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ficha completa da cliente
-- ---------------------------------------------------------------------
alter table public.clientes
  add column email           text check (email is null or (length(email) <= 120 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add column nascimento      date check (nascimento between '1900-01-01' and '2100-12-31'),
  add column origem          text check (origem in ('loja', 'instagram', 'whatsapp', 'indicacao', 'outro')),
  add column observacoes     text check (length(observacoes) <= 200),
  -- { sutia, calcinha, tom_pele, tipo_pele }: tudo opcional
  add column preferencias    jsonb not null default '{}'::jsonb
                             check (jsonb_typeof(preferencias) = 'object' and length(preferencias::text) <= 600),
  add column aceita_contato  boolean not null default false,
  -- preenchido quando a cliente é excluída mas tem histórico (LGPD)
  add column removida_em     timestamptz;

create index clientes_aniversario_idx on public.clientes (extract(month from nascimento)) where nascimento is not null;

-- cliente removida não volta a ser editada
drop policy "Equipe corrige clientes" on public.clientes;
create policy "Equipe corrige clientes" on public.clientes for update to authenticated
  using ((select public.eh_membro_ativo()) and removida_em is null)
  with check ((select public.eh_membro_ativo()) and removida_em is null);

-- ---------------------------------------------------------------------
-- Resumo de compras de cada cliente (respeita as regras de quem vê)
-- ---------------------------------------------------------------------
create view public.resumo_clientes with (security_invoker = true) as
with vendas_ok as (
  select v.id, v.grupo, v.cliente_id, v.total, v.criado_em
  from public.vendas v
  where v.status = 'concluida' and v.cliente_id is not null
),
devolvido as (
  select vo.cliente_id, sum(d.valor_devolvido) as valor
  from public.devolucoes d join vendas_ok vo on vo.id = d.venda_id
  group by vo.cliente_id
)
select
  c.id as cliente_id,
  count(distinct coalesce(vo.grupo, vo.id))::int as compras,
  (coalesce(sum(vo.total), 0) - coalesce(max(dv.valor), 0))::numeric(12,2) as total,
  max(vo.criado_em) as ultima_compra
from public.clientes c
left join vendas_ok vo on vo.cliente_id = c.id
left join devolvido dv on dv.cliente_id = c.id
group by c.id;

grant select on public.resumo_clientes to authenticated;

-- ---------------------------------------------------------------------
-- Encomendas
-- ---------------------------------------------------------------------
create table public.encomendas (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes (id) on delete restrict,
  status         text not null default 'aguardando' check (status in ('aguardando', 'chegou', 'entregue', 'cancelada')),
  previsao       date check (previsao between '2000-01-01' and '2100-12-31'),
  observacao     text check (length(observacao) <= 200),
  sinal_valor    numeric(12,2) check (sinal_valor between 0.01 and 999999.99),
  sinal_forma    text check (sinal_forma in ('pix', 'cartao_debito', 'cartao_credito', 'dinheiro')),
  chegou_em      date,
  entregue_em    timestamptz,
  cancelada_em   timestamptz,
  criado_por     uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  check ((sinal_valor is null) = (sinal_forma is null))
);
create index encomendas_cliente_idx on public.encomendas (cliente_id, criado_em desc);
create index encomendas_abertas_idx on public.encomendas (previsao) where status in ('aguardando', 'chegou');

create table public.encomenda_itens (
  id            uuid primary key default gen_random_uuid(),
  encomenda_id  uuid not null references public.encomendas (id) on delete cascade,
  -- peça do catálogo OU descrita à mão (uma das duas)
  variacao_id   uuid references public.variacoes (id) on delete restrict,
  descricao     text check (length(trim(descricao)) between 2 and 100),
  quantidade    int not null check (quantidade between 1 and 999),
  check ((variacao_id is null) <> (descricao is null))
);
create index encomenda_itens_encomenda_idx on public.encomenda_itens (encomenda_id);
create index encomenda_itens_variacao_idx on public.encomenda_itens (variacao_id) where variacao_id is not null;

create trigger encomendas_atualizado_em before update on public.encomendas
  for each row execute function public.definir_atualizado_em();
create trigger encomendas_auditoria after insert or update or delete on public.encomendas
  for each row execute function public.registrar_auditoria();

-- O que pode mudar numa encomenda depois de criada
create or replace function public._conferir_encomenda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cliente_id <> old.cliente_id then
    raise exception 'A cliente da encomenda não muda. Cancele e faça outra.';
  end if;
  if new.sinal_valor is distinct from old.sinal_valor or new.sinal_forma is distinct from old.sinal_forma then
    raise exception 'O sinal registrado não muda depois de salvo.';
  end if;
  if old.status in ('entregue', 'cancelada') then
    raise exception 'Esta encomenda já foi %. Não dá para mudar.', case old.status when 'entregue' then 'entregue' else 'cancelada' end;
  end if;
  if new.status = 'entregue' and coalesce(current_setting('demanas.entregando', true), '') <> 'sim' then
    raise exception 'A encomenda é entregue pela venda: use "Entregar e vender".';
  end if;
  if new.status = 'chegou' and old.status <> 'chegou' then
    new.chegou_em := coalesce(new.chegou_em, (now() at time zone 'America/Sao_Paulo')::date);
  elsif new.status = 'aguardando' then
    new.chegou_em := null;
  end if;
  if new.status = 'cancelada' then
    new.cancelada_em := coalesce(new.cancelada_em, now());
  end if;
  return new;
end;
$$;
create trigger encomendas_conferir before update on public.encomendas
  for each row execute function public._conferir_encomenda();

alter table public.encomendas enable row level security;
alter table public.encomenda_itens enable row level security;
create policy "Equipe vê as encomendas" on public.encomendas for select to authenticated using ((select public.eh_membro_ativo()));
create policy "Equipe atualiza encomendas" on public.encomendas for update to authenticated
  using ((select public.eh_membro_ativo())) with check ((select public.eh_membro_ativo()));
create policy "Proprietária apaga encomendas" on public.encomendas for delete to authenticated using ((select public.eh_admin()));
create policy "Equipe vê os itens das encomendas" on public.encomenda_itens for select to authenticated using ((select public.eh_membro_ativo()));
-- criar: só por salvar_encomenda (cabeçalho e peças numa transação só)

-- Entrada: { cliente_id, previsao, observacao, sinal_valor, sinal_forma,
--            itens: [{ variacao_id } ou { descricao }, quantidade] }
create or replace function public.salvar_encomenda(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_itens int := jsonb_array_length(coalesce(p -> 'itens', '[]'::jsonb));
  item    jsonb;
begin
  if not public.eh_membro_ativo() then
    raise exception 'Entre no sistema para registrar encomendas.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clientes where id = (p ->> 'cliente_id')::uuid and removida_em is null) then
    raise exception 'Cliente não encontrada. Busque de novo.';
  end if;
  if v_itens = 0 then
    raise exception 'Adicione pelo menos uma peça.';
  end if;
  if v_itens > 20 then
    raise exception 'Até 20 peças diferentes por encomenda. Faça outra encomenda para o resto.';
  end if;
  if (p ->> 'previsao')::date < (now() at time zone 'America/Sao_Paulo')::date - 1 then
    raise exception 'A data prevista já passou.';
  end if;

  insert into public.encomendas (cliente_id, previsao, observacao, sinal_valor, sinal_forma)
  values (
    (p ->> 'cliente_id')::uuid,
    nullif(p ->> 'previsao', '')::date,
    nullif(trim(p ->> 'observacao'), ''),
    round(nullif(p ->> 'sinal_valor', '')::numeric, 2),
    nullif(p ->> 'sinal_forma', '')
  )
  returning id into v_id;

  for item in select value from jsonb_array_elements(p -> 'itens') loop
    insert into public.encomenda_itens (encomenda_id, variacao_id, descricao, quantidade)
    values (v_id, nullif(item ->> 'variacao_id', '')::uuid, nullif(trim(item ->> 'descricao'), ''), (item ->> 'quantidade')::int);
  end loop;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Excluir cliente (LGPD)
-- Sem compras nem encomendas: apaga. Com histórico: anonimiza.
-- Nos dois casos, os dados pessoais também saem da auditoria.
-- Devolve 'apagada' ou 'anonimizada'.
-- ---------------------------------------------------------------------
create or replace function public.excluir_cliente(p_cliente uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resultado text;
  pessoais    text[] := array['nome', 'whatsapp', 'email', 'nascimento', 'observacoes', 'preferencias'];
begin
  if not public.eh_admin() then
    raise exception 'Somente as proprietárias excluem clientes.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente) then
    raise exception 'Cliente não encontrada.';
  end if;

  if exists (select 1 from public.vendas where cliente_id = p_cliente)
     or exists (select 1 from public.encomendas where cliente_id = p_cliente) then
    update public.clientes set
      nome = 'Cliente removida', whatsapp = null, email = null, nascimento = null, origem = null,
      observacoes = null, preferencias = '{}'::jsonb, aceita_contato = false, removida_em = now()
    where id = p_cliente;
    v_resultado := 'anonimizada';
  else
    delete from public.clientes where id = p_cliente;
    v_resultado := 'apagada';
  end if;

  update public.auditoria set
    antes  = case when antes  is null then null else (antes  - pessoais) || '{"nome": "Cliente removida"}'::jsonb end,
    depois = case when depois is null then null else (depois - pessoais) || '{"nome": "Cliente removida"}'::jsonb end
  where entidade = 'clientes' and entidade_id = p_cliente::text;

  return v_resultado;
end;
$$;

-- ---------------------------------------------------------------------
-- Venda ligada à encomenda e o sinal como forma de pagamento
-- ---------------------------------------------------------------------
alter table public.vendas add column encomenda_id uuid references public.encomendas (id) on delete restrict;
create index vendas_encomenda_idx on public.vendas (encomenda_id) where encomenda_id is not null;

alter table public.venda_pagamentos drop constraint venda_pagamentos_forma_check;
alter table public.venda_pagamentos add constraint venda_pagamentos_forma_check
  check (forma in ('pix', 'cartao_debito', 'cartao_credito', 'dinheiro', 'sinal'));

-- concluir_venda: igual à da 05, mais a encomenda.
-- Entrada nova: encomenda_id (opcional). Com ela, a cliente é a da
-- encomenda, pagamentos { forma: 'sinal' } somam no máximo o sinal pago,
-- e a encomenda vira "entregue" na mesma transação.
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
  v_encomenda  uuid := nullif(p ->> 'encomenda_id', '')::uuid;
  v_sinal      numeric := 0;
  v_sinal_pago numeric := 0;
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
  if v_encomenda is not null then
    select cliente_id, status, coalesce(sinal_valor, 0) as sinal into r
    from public.encomendas where id = v_encomenda for update;
    if not found then
      raise exception 'Encomenda não encontrada. Atualize a página.';
    end if;
    if r.status not in ('aguardando', 'chegou') then
      raise exception 'Esta encomenda já foi entregue ou cancelada.';
    end if;
    if v_cliente is not null and v_cliente <> r.cliente_id then
      raise exception 'A venda da encomenda precisa ser da mesma cliente.';
    end if;
    v_cliente := r.cliente_id;
    v_sinal_pago := r.sinal;
  end if;
  if v_cliente is not null and not exists (select 1 from public.clientes where id = v_cliente and removida_em is null) then
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
      if pag ->> 'forma' = 'sinal' then
        v_sinal := v_sinal + round((pag ->> 'valor')::numeric, 2);
      end if;
    end loop;
    if v_pago <> v_total then
      raise exception 'Os pagamentos (R$ %) não fecham com o total (R$ %). Se um preço mudou agora há pouco, volte aos itens e confira.',
        to_char(v_pago, 'FM999G990D00'), to_char(v_total, 'FM999G990D00');
    end if;
    v_subtotal_g := v_subtotal_g + v_subtotal;
    v_desconto_g := v_desconto_g + v_desconto;
  end loop;

  if v_sinal > 0 and v_encomenda is null then
    raise exception 'Sinal só entra como pagamento na entrega de uma encomenda.';
  end if;
  if v_sinal > v_sinal_pago then
    raise exception 'O sinal usado (R$ %) passa do que a cliente pagou na encomenda (R$ %).',
      replace(to_char(v_sinal, 'FM999990.00'), '.', ','), replace(to_char(v_sinal_pago, 'FM999990.00'), '.', ',');
  end if;

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
                               aprovada_com_codigo, vendedora_id, vendedora_nome, encomenda_id)
    values (
      public._proximo_numero('venda'), v_grupo, parte ->> 'empresa_id', v_cliente, v_canal, v_subtotal, v_desconto, v_total,
      case when (select tipo from public.empresas where id = parte ->> 'empresa_id') = 'me' then 'a_emitir' else 'sem_nota' end,
      v_aprovada, auth.uid(), coalesce(v_nome, ''), v_encomenda
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
      if pag ->> 'forma' not in ('pix', 'cartao_debito', 'cartao_credito', 'dinheiro', 'sinal') then
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

  if v_encomenda is not null then
    perform set_config('demanas.entregando', 'sim', true);
    update public.encomendas set status = 'entregue', entregue_em = now() where id = v_encomenda;
    perform set_config('demanas.entregando', '', true);
  end if;

  return v_resultado;
end;
$$;

-- ---------------------------------------------------------------------
-- Quem executa as funções novas
-- ---------------------------------------------------------------------
revoke execute on function public.salvar_encomenda(jsonb) from public, anon;
revoke execute on function public.excluir_cliente(uuid) from public, anon;
revoke execute on function public.concluir_venda(jsonb) from public, anon;
revoke execute on function public._conferir_encomenda() from public, anon, authenticated;
grant execute on function public.salvar_encomenda(jsonb) to authenticated;
grant execute on function public.excluir_cliente(uuid) to authenticated;
grant execute on function public.concluir_venda(jsonb) to authenticated;
