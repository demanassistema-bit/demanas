-- =====================================================================
-- DEMANAS · 08 · Relatórios: vendas do período, giro do estoque e
--                parâmetros do "O que recomprar"
-- =====================================================================
-- O banco soma; a tela organiza (curva ABC, cobertura, recompra).
--   · relatorio_vendas(início, fim): faturamento, devoluções, compras
--     (venda dos dois CNPJs conta como uma), por CNPJ, canal, forma,
--     vendedora, peças vendidas e ranking de clientes. Custo e lucro só
--     vêm para quem pode ver custos.
--   · giro_estoque(dias): quanto cada peça saiu por venda nos últimos
--     dias (líquido de devoluções e cancelamentos), tirado do livro do
--     estoque. Assim a peça vendida dentro de um kit também conta.
--   · Parâmetros: peça parada = 45 dias sem vender; recomprar quando o
--     estoque dura menos de 15 dias, pedindo o suficiente para 30.
--     As proprietárias mudam em Configurações.
--
-- A nota fiscal (Etapa 7) fica para depois, esperando a aprovação das
-- irmãs; quando voltar, entra como migration 09.
-- =====================================================================

insert into public.parametros (chave, valor) values
  ('dias_peca_parada', '45'),
  ('recomprar_dias_alerta', '15'),
  ('recomprar_dias_cobertura', '30')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- Vendas do período (datas no fuso da loja, fim incluído)
-- ---------------------------------------------------------------------
create or replace function public.relatorio_vendas(p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_custos boolean := public.pode_ver_custos();
  r        jsonb;
begin
  if not public.eh_membro_ativo() then
    raise exception 'Entre no sistema para ver os relatórios.' using errcode = '42501';
  end if;
  if p_fim < p_inicio or p_fim - p_inicio > 400 then
    raise exception 'Escolha um período de até 400 dias.';
  end if;

  with
  vendas_p as (
    select ve.* from public.vendas ve
    where ve.status = 'concluida'
      and (ve.criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
  ),
  devol_p as (
    select d.valor_devolvido, ve.empresa_id from public.devolucoes d join public.vendas ve on ve.id = d.venda_id
    where ve.status = 'concluida' and (d.criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
  ),
  itens_p as (
    select vi.variacao_id, sum(vi.quantidade)::int as quantidade,
      sum(vi.preco_unitario * vi.quantidade - vi.desconto) as valor,
      sum(c.custo_unitario * vi.quantidade) as custo
    from public.venda_itens vi
    join vendas_p vp on vp.id = vi.venda_id
    left join public.custos_venda_itens c on c.venda_item_id = vi.id
    group by vi.variacao_id
  ),
  clientes_p as (
    select vp.cliente_id, c.nome, count(distinct coalesce(vp.grupo, vp.id))::int as compras, sum(vp.total) as total
    from vendas_p vp join public.clientes c on c.id = vp.cliente_id
    where c.removida_em is null
    group by vp.cliente_id, c.nome
    order by total desc
    limit 10
  ),
  agrupar as (
    select 'empresa' as por, empresa_id as chave, sum(total) as valor from vendas_p group by empresa_id
    union all
    select 'canal', canal, sum(total) from vendas_p group by canal
    union all
    select 'vendedora', coalesce(nullif(vendedora_nome, ''), 'Sem nome'), sum(total) from vendas_p group by 2
    union all
    select 'forma', p.forma, sum(p.valor) from public.venda_pagamentos p join vendas_p vp on vp.id = p.venda_id group by p.forma
  )
  select jsonb_build_object(
    'faturamento', coalesce((select sum(total) from vendas_p), 0),
    'devolucoes', coalesce((select sum(valor_devolvido) from devol_p), 0),
    'vendas', (select count(*) from vendas_p),
    'compras', (select count(distinct coalesce(grupo, id)) from vendas_p),
    'desconto', coalesce((select sum(desconto) from vendas_p), 0),
    'por', coalesce((select jsonb_object_agg(por, lista) from (
              select por, jsonb_agg(jsonb_build_object('chave', chave, 'valor', valor) order by valor desc) as lista
              from agrupar group by por) x), '{}'::jsonb),
    'pecas', coalesce((select jsonb_agg(jsonb_build_object(
              'variacao_id', variacao_id, 'quantidade', quantidade, 'valor', valor,
              'custo', case when v_custos then custo end) order by valor desc) from itens_p), '[]'::jsonb),
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('cliente_id', cliente_id, 'nome', nome, 'compras', compras, 'total', total)) from clientes_p), '[]'::jsonb),
    'custo', case when v_custos then coalesce((select sum(custo) from itens_p), 0) end,
    've_custos', v_custos
  ) into r;
  return r;
end;
$$;

-- ---------------------------------------------------------------------
-- Giro do estoque: saída líquida por venda nos últimos dias e a data da
-- última venda de cada peça (do livro do estoque, kits incluídos)
-- ---------------------------------------------------------------------
create or replace function public.giro_estoque(p_dias int default 30)
returns table (variacao_id uuid, saiu int, ultima_venda timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.eh_membro_ativo() then
    raise exception 'Entre no sistema para ver os relatórios.' using errcode = '42501';
  end if;
  return query
  select m.variacao_id,
    greatest(0, -coalesce(sum(m.quantidade) filter (where m.criado_em >= now() - make_interval(days => least(greatest(p_dias, 1), 400))), 0))::int,
    max(m.criado_em) filter (where m.tipo = 'saida_venda')
  from public.movimentacoes_estoque m
  where m.origem_tipo = 'venda'
  group by m.variacao_id;
end;
$$;

revoke execute on function public.relatorio_vendas(date, date) from public, anon;
revoke execute on function public.giro_estoque(int) from public, anon;
grant execute on function public.relatorio_vendas(date, date) to authenticated;
grant execute on function public.giro_estoque(int) to authenticated;
