-- =====================================================================
-- DEMANAS · 11 · Categorias de despesa que as irmãs criam
-- =====================================================================
-- Antes a lista de categorias (aluguel, contas da loja...) era fixa.
-- Agora fica numa tabela: dá para criar categorias novas nos custos fixos
-- e nas contas a pagar (só com o Financeiro aberto).
--   · "Compra de mercadoria" (como Fornecedores) não entra nas despesas
--     do Resultado do mês: o custo da peça já entra quando ela é vendida.
--   · Categoria não se apaga (as contas antigas apontam para ela); dá
--     para trocar o nome.
-- =====================================================================

create table public.categorias_despesa (
  id            text primary key default ('c_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
                check (id ~ '^[a-z0-9_]{2,40}$'),
  nome          text not null check (length(trim(nome)) between 2 and 40),
  -- compra de mercadoria: fora das despesas do resultado
  mercadoria    boolean not null default false,
  ordem         int not null default 100,
  criado_em     timestamptz not null default now()
);
create unique index categorias_despesa_nome_unico on public.categorias_despesa (lower(trim(nome)));

insert into public.categorias_despesa (id, nome, mercadoria, ordem) values
  ('aluguel', 'Aluguel', false, 1),
  ('contas_loja', 'Contas da loja', false, 2),
  ('fornecedores', 'Fornecedores (mercadoria)', true, 3),
  ('contadora', 'Contadora', false, 4),
  ('marketing', 'Marketing', false, 5),
  ('taxas_tarifas', 'Taxas e tarifas', false, 6),
  ('impostos', 'Impostos (DAS)', false, 7),
  ('pro_labore', 'Pró-labore', false, 8),
  ('outros', 'Outros', false, 99);

create trigger categorias_despesa_auditoria after insert or update or delete on public.categorias_despesa
  for each row execute function public.registrar_auditoria();

-- as contas e os custos fixos passam a apontar para a tabela
alter table public.custos_fixos drop constraint custos_fixos_categoria_check;
alter table public.contas_pagar drop constraint contas_pagar_categoria_check;
alter table public.custos_fixos add constraint custos_fixos_categoria_fk
  foreign key (categoria) references public.categorias_despesa (id) on update cascade on delete restrict;
alter table public.contas_pagar add constraint contas_pagar_categoria_fk
  foreign key (categoria) references public.categorias_despesa (id) on update cascade on delete restrict;

alter table public.categorias_despesa enable row level security;
create policy "Financeiro vê as categorias de despesa" on public.categorias_despesa for select to authenticated using ((select public.pode_financeiro()));
create policy "Financeiro cria categorias de despesa" on public.categorias_despesa for insert to authenticated with check ((select public.pode_financeiro()));
create policy "Financeiro renomeia categorias de despesa" on public.categorias_despesa for update to authenticated using ((select public.pode_financeiro())) with check ((select public.pode_financeiro()));
-- apagar: ninguém (contas antigas apontam para a categoria)
grant select, insert, update on public.categorias_despesa to authenticated;

-- resultado_mes: o que fica fora das despesas vem da marca "mercadoria", não do nome fixo
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
    where vencimento >= v_ini and vencimento < v_fim
      and categoria not in (select id from public.categorias_despesa where mercadoria)
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
    'compras_mercadoria', coalesce((select sum(valor) from public.contas_pagar where vencimento >= v_ini and vencimento < v_fim and categoria in (select id from public.categorias_despesa where mercadoria)), 0)
  ) into r
  from numeros n;
  return r;
end;
$$;
