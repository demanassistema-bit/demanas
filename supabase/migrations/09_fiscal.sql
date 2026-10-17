-- =====================================================================
-- DEMANAS · 09 · Nota fiscal (NFC-e) · AMBIENTE DE TESTE
-- =====================================================================
-- A nota sai sozinha a cada venda do CNPJ que emite (a ME), em segundo
-- plano: a venda nunca espera a SEFAZ (parte 8 do briefing).
--
--   · Serviço de emissão: começa no SIMULADO (sem contratar nada, sem
--     valor fiscal). O adaptador da Focus NFe já existe; ligar é trocar o
--     provedor em Dados fiscais depois que as irmãs aprovarem.
--   · Ambiente: TRAVADO em homologação (teste). Ir para produção exige
--     uma migration nova, com ordem explícita (CLAUDE.md, parte Fiscal).
--   · A nota usa o INSTANTÂNEO da venda (itens, preços, descontos e
--     pagamentos copiados na venda), nunca o cadastro atual. Os códigos
--     fiscais vêm da categoria no momento de montar a nota.
--   · Faltou dado (CNPJ, UF, NCM, validação da contadora...)? A venda
--     fica feita e a nota fica PENDENTE, dizendo o que falta. Corrigiu,
--     é só reenviar.
--   · Fila com repetição: sem resposta do serviço, tenta de novo com
--     espera crescente (2, 4, 8... até 60 min). Cada tentativa e cada
--     retorno ficam registrados em documento_fiscal_eventos.
--   · Venda cancelada: nota na fila é descartada; nota autorizada é
--     cancelada no serviço (até 30 min, regra da NFC-e). Depois disso o
--     sistema avisa: devolução é com a contadora.
--   · Nota autorizada nunca é editada. Segredos (token, certificado A1,
--     CSC) nunca entram no banco: ficam no serviço de emissão.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuração fiscal de cada CNPJ
-- ---------------------------------------------------------------------
alter table public.empresas
  add column fiscal_provedor       text not null default 'simulado' check (fiscal_provedor in ('simulado', 'focus')),
  -- produção só com uma migration nova e ordem explícita
  add column fiscal_ambiente       text not null default 'homologacao' check (fiscal_ambiente = 'homologacao'),
  add column emitir_quando         text not null default 'sempre' check (emitir_quando in ('sempre', 'pedido')),
  add column nfce_serie            int not null default 1 check (nfce_serie between 1 and 999),
  add column certificado_validade  date check (certificado_validade between '2020-01-01' and '2040-12-31');

-- Dados fiscais do CNPJ só mudam com a área Fiscal aberta (código)
create or replace function public._proteger_dados_fiscais()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.tem_acesso_area('fiscal') and (
       new.razao_social, new.cnpj, new.inscricao_estadual, new.regime, new.endereco, new.municipio, new.uf,
       new.fiscal_provedor, new.emitir_quando, new.nfce_serie, new.certificado_validade
     ) is distinct from (
       old.razao_social, old.cnpj, old.inscricao_estadual, old.regime, old.endereco, old.municipio, old.uf,
       old.fiscal_provedor, old.emitir_quando, old.nfce_serie, old.certificado_validade
     ) then
    raise exception 'Abra a Nota fiscal com o código para mudar os dados fiscais.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger empresas_dados_fiscais before update on public.empresas
  for each row execute function public._proteger_dados_fiscais();

-- CPF com os dois dígitos verificadores
create or replace function public._cpf_valido(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  c   text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  s   int;
  d1  int;
  d2  int;
begin
  if c !~ '^\d{11}$' or c ~ '^(\d)\1{10}$' then return false; end if;
  select sum(substr(c, i, 1)::int * (11 - i)) into s from generate_series(1, 9) i;
  d1 := (s * 10) % 11; if d1 = 10 then d1 := 0; end if;
  select sum(substr(c, i, 1)::int * (12 - i)) into s from generate_series(1, 10) i;
  d2 := (s * 10) % 11; if d2 = 10 then d2 := 0; end if;
  return d1 = substr(c, 10, 1)::int and d2 = substr(c, 11, 1)::int;
end;
$$;

-- CPF na nota (opcional, pedido na venda)
alter table public.vendas add column cpf_nota text check (cpf_nota ~ '^\d{11}$');

-- ---------------------------------------------------------------------
-- Documentos fiscais e o registro de cada tentativa
-- ---------------------------------------------------------------------
create table public.documentos_fiscais (
  id                    uuid primary key default gen_random_uuid(),
  venda_id              uuid not null unique references public.vendas (id) on delete restrict,
  empresa_id            text not null references public.empresas (id),
  modelo                text not null default 'nfce' check (modelo = 'nfce'),
  ambiente              text not null default 'homologacao' check (ambiente = 'homologacao'),
  provedor              text not null check (provedor in ('simulado', 'focus')),
  -- identificador único que vai para o serviço (evita nota em dobro)
  referencia            text not null unique,
  status                text not null check (status in (
                          'na_fila', 'enviando', 'autorizada', 'pendente',
                          'a_cancelar', 'cancelando', 'cancelada', 'descartada')),
  serie                 int not null default 1,
  numero                int,
  chave                 text check (chave ~ '^\d{44}$'),
  protocolo             text,
  emitida_em            timestamptz,
  cancelada_em          timestamptz,
  motivo                text check (length(motivo) <= 1000),
  motivo_simples        text check (length(motivo_simples) <= 1000),
  motivo_cancelamento   text check (length(motivo_cancelamento) <= 255),
  cancelar_depois       boolean not null default false,
  tentativas            int not null default 0,
  proxima_tentativa     timestamptz not null default now(),
  em_processo_ate       timestamptz,
  url_xml               text,
  url_cupom             text,
  qrcode_url            text,
  valor_total           numeric(12,2) not null,
  -- instantâneo da venda e dos dados fiscais no momento de montar a nota
  documento             jsonb not null,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index documentos_fiscais_fila_idx on public.documentos_fiscais (proxima_tentativa)
  where status in ('na_fila', 'a_cancelar', 'enviando', 'cancelando');
create index documentos_fiscais_data_idx on public.documentos_fiscais (criado_em desc);

create trigger documentos_fiscais_atualizado_em before update on public.documentos_fiscais
  for each row execute function public.definir_atualizado_em();

create table public.documento_fiscal_eventos (
  id            bigint generated always as identity primary key,
  documento_id  uuid not null references public.documentos_fiscais (id) on delete restrict,
  tipo          text not null check (tipo in ('criada', 'envio', 'cancelamento', 'reenvio', 'pedido')),
  resultado     text not null,
  mensagem      text check (length(mensagem) <= 1000),
  bruto         jsonb check (length(bruto::text) <= 20000),
  usuario_id    uuid,
  criado_em     timestamptz not null default now()
);
create index documento_fiscal_eventos_doc_idx on public.documento_fiscal_eventos (documento_id, id);

-- o registro não muda nem some
create or replace function public._impedir_alterar_evento_fiscal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O registro da nota não pode ser alterado nem apagado.';
end;
$$;
create trigger documento_fiscal_eventos_imutaveis before update or delete on public.documento_fiscal_eventos
  for each row execute function public._impedir_alterar_evento_fiscal();

-- ---------------------------------------------------------------------
-- Montar a nota a partir da venda (instantâneo) e apontar o que falta
-- ---------------------------------------------------------------------
create or replace function public._montar_documento(p_venda uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v       public.vendas;
  e       public.empresas;
  v_itens jsonb;
  v_pags  jsonb;
  faltas  text[] := '{}';
begin
  select * into v from public.vendas where id = p_venda;
  select * into e from public.empresas where id = v.empresa_id;

  -- itens e o que falta nos produtos
  select
    jsonb_agg(jsonb_build_object(
      'codigo', coalesce(nullif(va.codigo_barras, ''), va.codigo_interno),
      'descricao', vi.descricao, 'quantidade', vi.quantidade,
      'valor_unitario', vi.preco_unitario, 'valor_bruto', vi.preco_unitario * vi.quantidade, 'desconto', vi.desconto,
      'categoria', coalesce(c.nome, ''), 'ncm', coalesce(pf.ncm, ''), 'cest', coalesce(pf.cest, ''), 'origem', coalesce(pf.origem, ''),
      'cfop', coalesce(pf.cfop, ''), 'csosn', coalesce(pf.csosn_ou_cst, ''), 'unidade', coalesce(pf.unidade, 'UN')
    ) order by vi.descricao),
    array(
      select distinct x from unnest(array_agg(
        case
          when p.categoria_id is null then 'O produto "' || p.nome || '" está sem categoria (a categoria leva os dados fiscais).'
          when pf.categoria_id is null or pf.ncm = '' or pf.origem = '' or pf.cfop = '' or pf.csosn_ou_cst = ''
            then 'A categoria "' || c.nome || '" está sem NCM, origem, CFOP ou CSOSN em Dados fiscais.'
          when not pf.validado then 'Os dados fiscais da categoria "' || c.nome || '" ainda não foram validados pela contadora.'
        end)) x where x is not null
    )
  into v_itens, faltas
  from public.venda_itens vi
  join public.variacoes va on va.id = vi.variacao_id
  join public.produtos p on p.id = va.produto_id
  left join public.categorias c on c.id = p.categoria_id
  left join public.perfis_fiscais pf on pf.categoria_id = p.categoria_id
  where vi.venda_id = p_venda;

  -- as faltas do CNPJ vêm antes das faltas dos produtos
  faltas := array(
    select x from unnest(array[
      case when regexp_replace(e.cnpj, '\D', '', 'g') !~ '^\d{14}$' then 'Falta o CNPJ do ' || e.apelido || ' em Dados fiscais.' end,
      case when e.inscricao_estadual = '' then 'Falta a inscrição estadual do ' || e.apelido || ' em Dados fiscais.' end,
      case when e.uf = '' then 'Falta o estado (UF) do ' || e.apelido || ' em Dados fiscais.' end,
      case when e.regime = '' then 'Falta o regime tributário do ' || e.apelido || ' em Dados fiscais.' end,
      case when v_itens is null then 'A nota ficou sem itens. Avise quem cuida do sistema.' end
    ] || faltas) x where x is not null
  );

  select jsonb_agg(jsonb_build_object('forma', forma, 'valor', valor, 'parcelas', parcelas) order by valor desc) into v_pags
  from public.venda_pagamentos where venda_id = p_venda;

  return jsonb_build_object(
    'venda', jsonb_build_object('id', v.id, 'numero', v.numero, 'criado_em', v.criado_em, 'total', v.total, 'desconto', v.desconto),
    'emitente', jsonb_build_object('cnpj', regexp_replace(e.cnpj, '\D', '', 'g'), 'razao_social', e.razao_social,
      'inscricao_estadual', e.inscricao_estadual, 'regime', e.regime, 'endereco', e.endereco, 'municipio', e.municipio, 'uf', e.uf),
    'consumidor', case when v.cpf_nota is not null then jsonb_build_object('cpf', v.cpf_nota) end,
    'itens', coalesce(v_itens, '[]'::jsonb),
    'pagamentos', coalesce(v_pags, '[]'::jsonb),
    'faltas', to_jsonb(faltas)
  );
end;
$$;

-- Cria a nota da venda: na fila, ou pendente dizendo o que falta
create or replace function public._criar_documento(p_venda uuid, p_tipo_evento text default 'criada')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc  jsonb := public._montar_documento(p_venda);
  v_id   uuid;
  v_falt text := array_to_string(array(select jsonb_array_elements_text(v_doc -> 'faltas')), ' ');
  e      public.empresas;
begin
  select em.* into e from public.empresas em join public.vendas ve on ve.empresa_id = em.id where ve.id = p_venda;
  insert into public.documentos_fiscais (venda_id, empresa_id, provedor, serie, referencia, status, motivo_simples, valor_total, documento)
  values (
    p_venda, e.id, e.fiscal_provedor, e.nfce_serie, 'demanas-' || replace(p_venda::text, '-', ''),
    case when v_falt = '' then 'na_fila' else 'pendente' end,
    nullif(v_falt, ''), (v_doc -> 'venda' ->> 'total')::numeric, v_doc
  )
  on conflict (venda_id) do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.documento_fiscal_eventos (documento_id, tipo, resultado, mensagem, usuario_id)
    values (v_id, p_tipo_evento, case when v_falt = '' then 'na_fila' else 'pendente' end, nullif(v_falt, ''), auth.uid());
  end if;
  return v_id;
end;
$$;

-- Venda concluída do CNPJ que emite → nota. Roda no fim da transação
-- (deferred), quando os itens e pagamentos da venda já estão gravados.
create or replace function public._nota_da_venda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.empresas;
begin
  select * into e from public.empresas where id = new.empresa_id;
  if e.tipo <> 'me' or new.status <> 'concluida' then return null; end if;
  if e.emitir_quando = 'pedido' then
    update public.vendas set nota_status = 'sem_nota' where id = new.id;
  else
    perform public._criar_documento(new.id);
  end if;
  return null;
end;
$$;
create constraint trigger vendas_nota_fiscal after insert on public.vendas
  deferrable initially deferred
  for each row execute function public._nota_da_venda();

-- Situação da nota refletida na venda (lista de Vendas, Início)
create or replace function public._nota_na_venda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.vendas set nota_status = case new.status
      when 'autorizada' then 'emitida' when 'a_cancelar' then 'emitida' when 'cancelando' then 'emitida'
      when 'cancelada' then 'cancelada' when 'pendente' then 'pendente' when 'descartada' then 'sem_nota'
      else 'a_emitir' end
  where id = new.venda_id and status = 'concluida';
  return null;
end;
$$;
create trigger documentos_fiscais_na_venda after insert or update of status on public.documentos_fiscais
  for each row execute function public._nota_na_venda();

-- Venda cancelada: nota que não saiu é descartada; autorizada vai ser cancelada no serviço
create or replace function public._nota_da_venda_cancelada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelada' and old.status <> 'cancelada' then
    update public.documentos_fiscais set
      status = case status when 'na_fila' then 'descartada' when 'pendente' then 'descartada' when 'autorizada' then 'a_cancelar' else status end,
      cancelar_depois = status in ('enviando'),
      proxima_tentativa = now(),
      motivo_cancelamento = left('Venda cancelada no sistema da loja: ' || coalesce(new.motivo_cancelamento, 'sem motivo informado'), 255)
    where venda_id = new.id;
  end if;
  return new;
end;
$$;
create trigger vendas_cancelar_nota after update of status on public.vendas
  for each row execute function public._nota_da_venda_cancelada();

-- ---------------------------------------------------------------------
-- Fila: quem processa é a Edge Function (serviço de verdade) ou, no
-- modo simulado, a própria tela Nota fiscal de quem abriu com o código.
-- ---------------------------------------------------------------------
create or replace function public._pode_processar_fiscal()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(auth.jwt() ->> 'role', '') = 'service_role' then 'todos'
    when public.tem_acesso_area('fiscal') then 'simulado'
    else null end;
$$;

create or replace function public.pegar_fila_fiscal(p_limite int default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quem text := public._pode_processar_fiscal();
  r      jsonb;
begin
  if v_quem is null then
    raise exception 'Abra a Nota fiscal com o código para processar as notas.' using errcode = '42501';
  end if;
  with alvo as (
    select id from public.documentos_fiscais
    where (v_quem = 'todos' or provedor = 'simulado')
      and ((status in ('na_fila', 'a_cancelar') and proxima_tentativa <= now())
        or (status in ('enviando', 'cancelando') and em_processo_ate < now()))
    order by criado_em
    limit least(greatest(p_limite, 1), 50)
    for update skip locked
  ), pegos as (
    update public.documentos_fiscais d set
      status = case when d.status in ('na_fila', 'enviando') then 'enviando' else 'cancelando' end,
      em_processo_ate = now() + interval '2 minutes',
      tentativas = d.tentativas + 1
    from alvo where d.id = alvo.id
    returning d.id, d.status, d.provedor, d.referencia, d.serie, d.emitida_em, d.motivo_cancelamento, d.documento, d.criado_em
  )
  select coalesce(jsonb_agg(to_jsonb(pegos) order by criado_em), '[]'::jsonb) into r from pegos;
  return r;
end;
$$;

-- Retorno do serviço: { resultado: autorizada | rejeitada | falha | cancelada | cancelamento_rejeitado,
--   numero, serie, chave, protocolo, emitida_em, motivo, motivo_simples, codigo, url_xml, url_cupom, qrcode_url, bruto }
create or replace function public.registrar_retorno_fiscal(p_doc uuid, p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quem  text := public._pode_processar_fiscal();
  d       public.documentos_fiscais;
  v_venda text;
  v_res   text := p ->> 'resultado';
  v_novo  text;
begin
  if v_quem is null then
    raise exception 'Abra a Nota fiscal com o código para processar as notas.' using errcode = '42501';
  end if;
  select * into d from public.documentos_fiscais where id = p_doc for update;
  if d.id is null or d.status not in ('enviando', 'cancelando') then
    raise exception 'Esta nota não está sendo processada agora.';
  end if;
  if v_quem = 'simulado' and d.provedor <> 'simulado' then
    raise exception 'Só o servidor registra o retorno do serviço de emissão de verdade.' using errcode = '42501';
  end if;
  select status into v_venda from public.vendas where id = d.venda_id;

  if v_res = 'autorizada' then
    if (p ->> 'chave') !~ '^\d{44}$' then raise exception 'Chave de acesso inválida no retorno.'; end if;
    v_novo := case when d.cancelar_depois or v_venda = 'cancelada' then 'a_cancelar' else 'autorizada' end;
    update public.documentos_fiscais set status = v_novo, numero = (p ->> 'numero')::int, serie = coalesce((p ->> 'serie')::int, serie),
      chave = p ->> 'chave', protocolo = p ->> 'protocolo', emitida_em = coalesce((p ->> 'emitida_em')::timestamptz, now()),
      url_xml = p ->> 'url_xml', url_cupom = p ->> 'url_cupom', qrcode_url = p ->> 'qrcode_url',
      motivo = null, motivo_simples = null, em_processo_ate = null, proxima_tentativa = now(),
      motivo_cancelamento = coalesce(motivo_cancelamento, 'Venda cancelada no sistema da loja')
    where id = d.id;
  elsif v_res = 'rejeitada' then
    v_novo := 'pendente';
    update public.documentos_fiscais set status = 'pendente', motivo = left(p ->> 'motivo', 1000),
      motivo_simples = left(coalesce(p ->> 'motivo_simples', p ->> 'motivo'), 1000), em_processo_ate = null
    where id = d.id;
  elsif v_res = 'falha' then
    if d.tentativas >= 8 then
      v_novo := case when d.status = 'cancelando' then 'autorizada' else 'pendente' end;
      update public.documentos_fiscais set status = v_novo, em_processo_ate = null, motivo = left(p ->> 'motivo', 1000),
        motivo_simples = 'O serviço de emissão não respondeu depois de várias tentativas. Tente reenviar mais tarde; se repetir, avise quem cuida do sistema.'
      where id = d.id;
    else
      v_novo := case when d.status = 'cancelando' then 'a_cancelar' else 'na_fila' end;
      update public.documentos_fiscais set status = v_novo, em_processo_ate = null, motivo = left(p ->> 'motivo', 1000),
        proxima_tentativa = now() + make_interval(mins => least(power(2, d.tentativas)::int, 60))
      where id = d.id;
    end if;
  elsif v_res = 'cancelada' then
    v_novo := 'cancelada';
    update public.documentos_fiscais set status = 'cancelada', cancelada_em = now(), em_processo_ate = null where id = d.id;
  elsif v_res = 'cancelamento_rejeitado' then
    v_novo := 'autorizada';
    update public.documentos_fiscais set status = 'autorizada', em_processo_ate = null, motivo = left(p ->> 'motivo', 1000),
      motivo_simples = left('A venda foi cancelada, mas a nota não: ' || coalesce(p ->> 'motivo', 'o serviço recusou o cancelamento.') || ' Fale com a contadora.', 1000)
    where id = d.id;
  else
    raise exception 'Resultado desconhecido: %', v_res;
  end if;

  insert into public.documento_fiscal_eventos (documento_id, tipo, resultado, mensagem, bruto, usuario_id)
  values (d.id, case when d.status = 'cancelando' then 'cancelamento' else 'envio' end, v_res,
    left(coalesce(p ->> 'motivo_simples', p ->> 'motivo'), 1000), p -> 'bruto', auth.uid());
  return v_novo;
end;
$$;

-- Reenviar uma nota pendente: monta de novo (os dados fiscais podem ter sido corrigidos)
create or replace function public.reenviar_nota(p_doc uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d      public.documentos_fiscais;
  v_doc  jsonb;
  v_falt text;
begin
  if not public.tem_acesso_area('fiscal') then
    raise exception 'Abra a Nota fiscal com o código para reenviar.' using errcode = '42501';
  end if;
  select * into d from public.documentos_fiscais where id = p_doc for update;
  if d.status <> 'pendente' then raise exception 'Só nota pendente pode ser reenviada.'; end if;
  v_doc := public._montar_documento(d.venda_id);
  v_falt := array_to_string(array(select jsonb_array_elements_text(v_doc -> 'faltas')), ' ');
  update public.documentos_fiscais set documento = v_doc, tentativas = 0, proxima_tentativa = now(),
    provedor = (select fiscal_provedor from public.empresas where id = d.empresa_id),
    status = case when v_falt = '' then 'na_fila' else 'pendente' end,
    motivo = null, motivo_simples = nullif(v_falt, '')
  where id = d.id;
  insert into public.documento_fiscal_eventos (documento_id, tipo, resultado, mensagem, usuario_id)
  values (d.id, 'reenvio', case when v_falt = '' then 'na_fila' else 'pendente' end, nullif(v_falt, ''), auth.uid());
  return case when v_falt = '' then 'na_fila' else 'pendente' end;
end;
$$;

-- "Só quando pedirem": a nota é pedida depois, na venda (com CPF opcional)
create or replace function public.pedir_nota(p_venda uuid, p_cpf text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v    public.vendas;
  v_id uuid;
begin
  if not public.eh_membro_ativo() then
    raise exception 'Entre no sistema para pedir a nota.' using errcode = '42501';
  end if;
  select * into v from public.vendas where id = p_venda for update;
  if v.id is null or v.status <> 'concluida' then raise exception 'Venda não encontrada ou cancelada.'; end if;
  if (select tipo from public.empresas where id = v.empresa_id) <> 'me' then
    raise exception 'Este CNPJ (MEI) vende sem nota.';
  end if;
  if exists (select 1 from public.documentos_fiscais where venda_id = p_venda) then
    raise exception 'Esta venda já tem nota.';
  end if;
  if nullif(p_cpf, '') is not null then
    if not public._cpf_valido(p_cpf) then raise exception 'CPF com número errado. Confira com a cliente.'; end if;
    update public.vendas set cpf_nota = regexp_replace(p_cpf, '\D', '', 'g') where id = p_venda;
  end if;
  v_id := public._criar_documento(p_venda, 'pedido');
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Quem vê: só com a área Fiscal aberta. A venda mostra só a situação.
-- ---------------------------------------------------------------------
alter table public.documentos_fiscais enable row level security;
alter table public.documento_fiscal_eventos enable row level security;
create policy "Fiscal vê as notas" on public.documentos_fiscais for select to authenticated using ((select public.tem_acesso_area('fiscal')));
create policy "Fiscal vê o registro das notas" on public.documento_fiscal_eventos for select to authenticated using ((select public.tem_acesso_area('fiscal')));
-- criar, mudar e registrar: só pelas funções acima

-- concluir_venda: igual à da 06, mais o CPF na nota (opcional)
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
  v_cpf        text := nullif(regexp_replace(coalesce(p ->> 'cpf_nota', ''), '\D', '', 'g'), '');
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
  if v_cpf is not null and not public._cpf_valido(v_cpf) then
    raise exception 'CPF na nota com número errado. Confira com a cliente ou deixe em branco.';
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
                               aprovada_com_codigo, vendedora_id, vendedora_nome, encomenda_id, cpf_nota)
    values (
      public._proximo_numero('venda'), v_grupo, parte ->> 'empresa_id', v_cliente, v_canal, v_subtotal, v_desconto, v_total,
      case when (select tipo from public.empresas where id = parte ->> 'empresa_id') = 'me' then 'a_emitir' else 'sem_nota' end,
      v_aprovada, auth.uid(), coalesce(v_nome, ''), v_encomenda, v_cpf
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
revoke execute on function public._proteger_dados_fiscais() from public, anon, authenticated;
revoke execute on function public._impedir_alterar_evento_fiscal() from public, anon, authenticated;
revoke execute on function public._montar_documento(uuid) from public, anon, authenticated;
revoke execute on function public._criar_documento(uuid, text) from public, anon, authenticated;
revoke execute on function public._nota_da_venda() from public, anon, authenticated;
revoke execute on function public._nota_na_venda() from public, anon, authenticated;
revoke execute on function public._nota_da_venda_cancelada() from public, anon, authenticated;
revoke execute on function public._pode_processar_fiscal() from public, anon, authenticated;
revoke execute on function public._cpf_valido(text) from public, anon;
revoke execute on function public.pegar_fila_fiscal(int) from public, anon;
revoke execute on function public.registrar_retorno_fiscal(uuid, jsonb) from public, anon;
revoke execute on function public.reenviar_nota(uuid) from public, anon;
revoke execute on function public.pedir_nota(uuid, text) from public, anon;
revoke execute on function public.concluir_venda(jsonb) from public, anon;
grant execute on function public._cpf_valido(text) to authenticated;
grant execute on function public.pegar_fila_fiscal(int) to authenticated, service_role;
grant execute on function public.registrar_retorno_fiscal(uuid, jsonb) to authenticated, service_role;
grant execute on function public.reenviar_nota(uuid) to authenticated;
grant execute on function public.pedir_nota(uuid, text) to authenticated;
grant execute on function public.concluir_venda(jsonb) to authenticated;
