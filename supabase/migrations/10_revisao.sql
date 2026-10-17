-- =====================================================================
-- DEMANAS · 10 · Revisão geral (17/10/2026)
-- =====================================================================
--   · Segunda tranca para quem não entrou no sistema: o papel "anon"
--     perde toda permissão em tabelas, sequências e funções. As regras
--     de acesso (RLS) já barravam tudo; agora nem a permissão existe.
--   · Mensagem certa ao tentar editar um item ou pagamento de venda
--     ("não muda"), em vez de "não se apaga".
--   · giro_estoque devolve uma lista só (jsonb): a API do Supabase corta
--     respostas em 1000 linhas, e a loja pode ter mais peças que isso.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Anônimo: nenhuma permissão (o site só mostra a tela de entrar)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- funções de apoio que vinham liberadas para todo mundo (public): só para quem entrou
revoke execute on function public.definir_atualizado_em() from public;
revoke execute on function public.digito_ean(text) from public;
revoke execute on function public.hoje_loja() from public;
revoke execute on function public.preparar_variacao() from public;
grant execute on function public.definir_atualizado_em() to authenticated;
grant execute on function public.digito_ean(text) to authenticated;
grant execute on function public.hoje_loja() to authenticated;
grant execute on function public.preparar_variacao() to authenticated;

-- ---------------------------------------------------------------------
-- Venda registrada: não se apaga e não muda (cada caso com a sua mensagem)
-- ---------------------------------------------------------------------
create or replace function public.impedir_apagar_venda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Venda não se apaga: cancele, e o registro continua guardado.' using errcode = '42501';
  end if;
  raise exception 'Venda registrada não muda: para corrigir, cancele a venda ou registre uma devolução.' using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------
-- Giro do estoque numa lista só (sem o corte de 1000 linhas da API)
-- ---------------------------------------------------------------------
drop function public.giro_estoque(int);
create function public.giro_estoque(p_dias int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.eh_membro_ativo() then
    raise exception 'Entre no sistema para ver os relatórios.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('variacao_id', variacao_id, 'saiu', saiu, 'ultima_venda', ultima_venda))
    from (
      select m.variacao_id,
        greatest(0, -coalesce(sum(m.quantidade) filter (where m.criado_em >= now() - make_interval(days => least(greatest(p_dias, 1), 400))), 0))::int as saiu,
        max(m.criado_em) filter (where m.tipo = 'saida_venda') as ultima_venda
      from public.movimentacoes_estoque m
      where m.origem_tipo = 'venda'
      group by m.variacao_id
    ) g
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.giro_estoque(int) from public, anon;
grant execute on function public.giro_estoque(int) to authenticated;
