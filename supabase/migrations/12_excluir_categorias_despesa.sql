-- =====================================================================
-- DEMANAS · 12 · Excluir categoria de despesa
-- =====================================================================
-- Autonomia: o que as irmãs criam, elas também excluem.
--   · Categoria que nunca foi usada: apagada de vez.
--   · Categoria usada em alguma conta ou custo fixo: sai das listas de
--     escolha (fica "excluída"), mas as contas antigas continuam
--     mostrando o nome e o resultado do mês continua certo.
--   · Dá para criar de novo uma categoria com o nome de uma excluída.
-- =====================================================================

alter table public.categorias_despesa add column excluida_em timestamptz;

-- o nome só precisa ser único entre as que estão na lista
drop index public.categorias_despesa_nome_unico;
create unique index categorias_despesa_nome_unico on public.categorias_despesa (lower(trim(nome))) where excluida_em is null;

-- Devolve 'apagada' ou 'excluida'
create or replace function public.excluir_categoria_despesa(p_categoria text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._exigir_financeiro();
  if not exists (select 1 from public.categorias_despesa where id = p_categoria and excluida_em is null) then
    raise exception 'Categoria não encontrada.';
  end if;
  if exists (select 1 from public.contas_pagar where categoria = p_categoria)
     or exists (select 1 from public.custos_fixos where categoria = p_categoria) then
    update public.categorias_despesa set excluida_em = now() where id = p_categoria;
    return 'excluida';
  end if;
  delete from public.categorias_despesa where id = p_categoria;
  return 'apagada';
end;
$$;

revoke execute on function public.excluir_categoria_despesa(text) from public, anon;
grant execute on function public.excluir_categoria_despesa(text) to authenticated;
