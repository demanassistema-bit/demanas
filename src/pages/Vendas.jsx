import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCatalogo } from '../contexts/CatalogoContext'
import { supabase, traduzirErro } from '../lib/supabase'
import { formatarMoeda, arred, CANAIS } from '../lib/moeda'
import { filtroInteiro, formatarWhatsApp, limparTexto, TAMANHO } from '../lib/limites'
import { formatarDataHora, hojeISO, deISO, somarDias } from '../lib/datas'
import { COMO_DEVOLVEU, FORMAS, valorDevolucao } from '../lib/vendas'
import Modal, { BotaoPerigo } from '../components/Modal'
import Icone from '../components/Icone'
import { Aviso, Selo, Vazio } from '../components/ui'

const PERIODOS = { hoje: 'Hoje', semana: '7 dias', mes: '30 dias', tudo: 'Tudo' }
const NOTA = { a_emitir: ['ambar', 'Nota a emitir'], emitida: ['oliva', 'Nota emitida'], pendente: ['vinho', 'Nota pendente'], cancelada: ['neutro', 'Nota cancelada'] }
const POR_PAGINA = 100

export default function Vendas() {
  const { empresas } = useCatalogo()
  const [params, setParams] = useSearchParams()
  const periodo = PERIODOS[params.get('periodo')] ? params.get('periodo') : 'semana'
  const empresa = params.get('cnpj') || 'todas'
  const soCanceladas = params.get('canceladas') === '1'
  const vendaId = params.get('venda')
  const [lista, setLista] = useState(null)
  const [fim, setFim] = useState(false)
  const [erro, setErro] = useState('')

  const mudar = (campos) => {
    const novo = new URLSearchParams(params)
    Object.entries(campos).forEach(([k, v]) => (v ? novo.set(k, v) : novo.delete(k)))
    setParams(novo, { replace: true })
  }

  const buscar = useCallback(async (desde) => {
    let q = supabase.from('vendas')
      .select('id, numero, empresa_id, canal, total, desconto, status, nota_status, criado_em, vendedora_nome, clientes(nome), venda_pagamentos(forma)')
      .order('numero', { ascending: false })
      .range(desde, desde + POR_PAGINA - 1)
    if (periodo !== 'tudo') {
      const dias = { hoje: 0, semana: 6, mes: 29 }[periodo]
      q = q.gte('criado_em', somarDias(deISO(hojeISO()), -dias).toISOString())
    }
    if (empresa !== 'todas') q = q.eq('empresa_id', empresa)
    if (soCanceladas) q = q.eq('status', 'cancelada')
    const { data, error } = await q
    if (error) return setErro(traduzirErro(error))
    setErro('')
    setFim(data.length < POR_PAGINA)
    setLista((atual) => (desde === 0 ? data : [...(atual || []), ...data]))
  }, [periodo, empresa, soCanceladas])

  useEffect(() => { setLista(null); buscar(0) }, [buscar])

  const concluidas = (lista || []).filter((v) => v.status === 'concluida')
  const totalLista = arred(concluidas.reduce((s, v) => s + Number(v.total), 0))

  return (
    <div className="pagina">
      <header className="pagina-topo">
        <div>
          <h1>Vendas</h1>
          <p className="texto-suave">{concluidas.length} vendas · {formatarMoeda(totalLista)}{!fim && lista && ' (até aqui)'}</p>
        </div>
      </header>

      <div className="filtros">
        <div className="fichas" role="tablist">
          {Object.entries(PERIODOS).map(([chave, nome]) => (
            <button key={chave} className={`ficha ${periodo === chave ? 'ativo' : ''}`} onClick={() => mudar({ periodo: chave })}>{nome}</button>
          ))}
          <span className="separador-fichas" aria-hidden="true" />
          <button className={`ficha ${empresa === 'todas' ? 'ativo' : ''}`} onClick={() => mudar({ cnpj: null })}>Os dois CNPJs</button>
          {Object.values(empresas).map((e) => (
            <button key={e.id} className={`ficha ${empresa === e.id ? 'ativo' : ''}`} onClick={() => mudar({ cnpj: e.id })}>{e.apelido}</button>
          ))}
          <span className="separador-fichas" aria-hidden="true" />
          <button className={`ficha ${soCanceladas ? 'ativo' : ''}`} onClick={() => mudar({ canceladas: soCanceladas ? null : '1' })}>Canceladas</button>
        </div>
      </div>

      {erro && <Aviso tom="vinho">{erro}</Aviso>}
      {lista === null ? <p className="texto-suave">Carregando…</p> : lista.length === 0 ? <Vazio icone="vendas" titulo="Nenhuma venda neste filtro" /> : (
        <>
          <ul className="cartao lista">
            {lista.map((v) => (
              <li key={v.id}>
                <button className="linha-lista" onClick={() => mudar({ venda: v.id })}>
                  <span>
                    <strong>nº {v.numero} · {formatarMoeda(v.total)}</strong>
                    <small>
                      {[formatarDataHora(v.criado_em), empresas[v.empresa_id]?.apelido, CANAIS[v.canal],
                        [...new Set(v.venda_pagamentos.map((p) => FORMAS[p.forma]))].join(' + '), v.clientes?.nome, v.vendedora_nome].filter(Boolean).join(' · ')}
                    </small>
                  </span>
                  <span className="selos">
                    {v.status === 'cancelada' && <Selo tom="vinho">Cancelada</Selo>}
                    {v.status !== 'cancelada' && NOTA[v.nota_status] && <Selo tom={NOTA[v.nota_status][0]}>{NOTA[v.nota_status][1]}</Selo>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!fim && <button className="botao botao-secundario" onClick={() => buscar(lista.length)}>Ver mais antigas</button>}
        </>
      )}

      {vendaId && <VendaAberta id={vendaId} aoFechar={() => mudar({ venda: null })} aoMudar={() => buscar(0)} />}
    </div>
  )
}

// Código de aprovação: a proprietária digita no celular de quem está pedindo
function PedirAprovacao({ aoAprovar, texto }) {
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  async function aprovar() {
    setErro('')
    const { data, error } = await supabase.rpc('pedir_aprovacao', { p_codigo: codigo })
    setCodigo('')
    if (error) return setErro(traduzirErro(error))
    if (!data.ok) return setErro(data.erro)
    aoAprovar(data.aprovacao)
  }
  return (
    <div className="formulario">
      <p className="texto-suave pequeno">{texto}</p>
      <div className="linha-campos">
        <input className="campo-solto" type="password" autoComplete="off" value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={TAMANHO.codigo} aria-label="Código de aprovação" placeholder="Código de aprovação" />
        <button type="button" className="botao botao-secundario" onClick={aprovar} disabled={!codigo}>Aprovar</button>
      </div>
      {erro && <Aviso tom="vinho">{erro}</Aviso>}
    </div>
  )
}

function VendaAberta({ id, aoFechar, aoMudar }) {
  const { permissoes } = useAuth()
  const { empresas, podeVerCustos, recarregar } = useCatalogo()
  const admin = permissoes.admin
  const [venda, setVenda] = useState(null)
  const [erro, setErro] = useState('')
  const [modo, setModo] = useState(null) // 'devolver' | 'cancelar'

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('vendas')
      .select('*, clientes(nome, whatsapp), venda_itens(*), venda_pagamentos(*), devolucoes(*, devolucao_itens(*))')
      .eq('id', id).maybeSingle()
    if (error) return setErro(traduzirErro(error))
    if (!data) return setErro('Venda não encontrada.')
    let custos = new Map()
    if (podeVerCustos && data.venda_itens.length) {
      const r = await supabase.from('custos_venda_itens').select('*').in('venda_item_id', data.venda_itens.map((i) => i.id))
      custos = new Map((r.data || []).map((c) => [c.venda_item_id, Number(c.custo_unitario)]))
    }
    let outras = []
    if (data.grupo) {
      const r = await supabase.from('vendas').select('id, numero').eq('grupo', data.grupo).neq('id', id)
      outras = r.data || []
    }
    setVenda({ ...data, custos, outras })
  }, [id, podeVerCustos])

  useEffect(() => { carregar() }, [carregar])

  async function depoisDeMudar() {
    setModo(null)
    await Promise.all([carregar(), recarregar()])
    aoMudar()
  }

  if (!venda) return <Modal titulo="Venda" aoFechar={aoFechar}>{erro ? <Aviso tom="vinho">{erro}</Aviso> : <p className="texto-suave">Carregando…</p>}</Modal>

  const devolvido = new Map()
  for (const d of venda.devolucoes) for (const i of d.devolucao_itens) devolvido.set(i.venda_item_id, (devolvido.get(i.venda_item_id) || 0) + i.quantidade)
  const cancelada = venda.status === 'cancelada'
  const temDevolucao = venda.devolucoes.length > 0
  const tudoDevolvido = venda.venda_itens.every((i) => (devolvido.get(i.id) || 0) >= i.quantidade)

  return (
    <Modal titulo={`Venda nº ${venda.numero}`} aoFechar={aoFechar}>
      <p className="texto-suave">
        {[formatarDataHora(venda.criado_em), empresas[venda.empresa_id]?.apelido, CANAIS[venda.canal], venda.vendedora_nome && `vendida por ${venda.vendedora_nome}`].filter(Boolean).join(' · ')}
        {venda.clientes && <> · {venda.clientes.nome}{venda.clientes.whatsapp && ` (${formatarWhatsApp(venda.clientes.whatsapp)})`}</>}
      </p>
      {venda.aprovada_com_codigo && <p className="texto-suave pequeno">Desconto aprovado com o código da proprietária.</p>}

      <ul className="lista lista-compacta">
        {venda.venda_itens.map((i) => (
          <li key={i.id} className="linha-lista">
            <span>
              <strong>{i.quantidade}x {i.descricao}</strong>
              <small>
                {formatarMoeda(i.preco_unitario)} cada
                {Number(i.desconto) > 0 && ` · desconto ${formatarMoeda(i.desconto)}`}
                {podeVerCustos && venda.custos.has(i.id) && ` · custo ${formatarMoeda(venda.custos.get(i.id))}`}
                {devolvido.get(i.id) ? ` · ${devolvido.get(i.id)} devolvida${devolvido.get(i.id) > 1 ? 's' : ''}` : ''}
              </small>
            </span>
            <strong>{formatarMoeda(arred(i.preco_unitario * i.quantidade))}</strong>
          </li>
        ))}
      </ul>
      <dl className="totais">
        <div><dt>Subtotal</dt><dd>{formatarMoeda(venda.subtotal)}</dd></div>
        {Number(venda.desconto) > 0 && <div><dt>Desconto</dt><dd>− {formatarMoeda(venda.desconto)}</dd></div>}
        <div className="total"><dt>Total</dt><dd>{formatarMoeda(venda.total)}</dd></div>
        {venda.venda_pagamentos.map((p) => (
          <div key={p.id}>
            <dt>{FORMAS[p.forma]}{p.parcelas > 1 ? ` em ${p.parcelas}x` : ''}{podeVerCustos && Number(p.taxa_percentual) > 0 && ` · taxa ${String(p.taxa_percentual).replace('.', ',')}%`}</dt>
            <dd>{formatarMoeda(p.valor)}</dd>
          </div>
        ))}
      </dl>

      {venda.outras.length > 0 && (
        <p className="texto-suave pequeno">Esta compra teve peças dos dois CNPJs. A outra parte é a venda nº {venda.outras.map((x) => x.numero).join(', ')}.</p>
      )}
      <p className="texto-suave pequeno">
        <Icone nome="fiscal" tamanho={16} />{' '}
        {venda.nota_status === 'sem_nota' ? 'Sem nota fiscal: venda do CNPJ MEI, só para consumidor final.' : `${NOTA[venda.nota_status]?.[1] || ''}. A emissão chega na etapa da Nota fiscal.`}
      </p>

      {venda.devolucoes.map((d) => (
        <Aviso key={d.id} tom="ambar">
          Devolução em {formatarDataHora(d.criado_em)}: {d.devolucao_itens.reduce((s, i) => s + i.quantidade, 0)} peça(s), {formatarMoeda(d.valor_devolvido)} por {COMO_DEVOLVEU[d.como_devolveu]?.toLowerCase()}. {d.motivo}{d.usuario_nome && ` · ${d.usuario_nome}`}
        </Aviso>
      ))}

      {cancelada ? (
        <Aviso tom="vinho">Cancelada em {formatarDataHora(venda.cancelada_em)} por {venda.cancelada_por_nome}: {venda.motivo_cancelamento}. As peças voltaram ao estoque, e a venda continua registrada.</Aviso>
      ) : (
        <>
          {erro && <Aviso tom="vinho">{erro}</Aviso>}
          {!modo && (
            <div className="linha-campos">
              {!tudoDevolvido && <button className="botao botao-secundario" onClick={() => setModo('devolver')}>Devolução ou troca</button>}
              {!temDevolucao && <button className="botao botao-fantasma perigo" onClick={() => setModo('cancelar')}>Cancelar venda</button>}
            </div>
          )}
          {modo === 'cancelar' && <Cancelar venda={venda} admin={admin} aoVoltar={() => setModo(null)} aoConcluir={depoisDeMudar} />}
          {modo === 'devolver' && <Devolver venda={venda} devolvido={devolvido} admin={admin} aoVoltar={() => setModo(null)} aoConcluir={depoisDeMudar} />}
        </>
      )}
    </Modal>
  )
}

function Cancelar({ venda, admin, aoVoltar, aoConcluir }) {
  const [motivo, setMotivo] = useState('')
  const [aprovacao, setAprovacao] = useState(null)
  const [erro, setErro] = useState('')

  async function cancelar() {
    setErro('')
    const { error } = await supabase.rpc('cancelar_venda', { p_venda: venda.id, p_motivo: limparTexto(motivo), p_aprovacao: aprovacao })
    if (error) { setAprovacao(null); return setErro(traduzirErro(error)) }
    aoConcluir()
  }

  return (
    <section className="cartao secao secao-interna formulario">
      <h3>Cancelar a venda nº {venda.numero}</h3>
      <p className="texto-suave pequeno">A venda não é apagada: as peças voltam ao estoque, e fica registrado quem cancelou e por quê. Se a cliente devolveu só parte, use "Devolução ou troca".</p>
      <label className="campo"><span>Motivo</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={TAMANHO.motivo} placeholder="Ex.: cliente desistiu na hora" /></label>
      {!admin && !aprovacao && <PedirAprovacao aoAprovar={setAprovacao} texto="Para cancelar, a proprietária digita o código de aprovação." />}
      {!admin && aprovacao && <Aviso tom="oliva">Aprovado pela proprietária.</Aviso>}
      {erro && <Aviso tom="vinho">{erro}</Aviso>}
      <div className="linha-campos">
        <button className="botao botao-fantasma" onClick={aoVoltar}>Voltar</button>
        <BotaoPerigo texto="Cancelar venda" disabled={limparTexto(motivo).length < 3 || (!admin && !aprovacao)} aoConfirmar={cancelar} />
      </div>
    </section>
  )
}

function Devolver({ venda, devolvido, admin, aoVoltar, aoConcluir }) {
  const { linhas, categoriaPorId } = useCatalogo()
  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])
  const itens = venda.venda_itens.map((i) => {
    const linha = linhaPorId.get(i.variacao_id)
    const higiene = Boolean(linha && categoriaPorId.get(linha.produto.categoria_id)?.nao_volta_ao_estoque)
    return { ...i, resta: i.quantidade - (devolvido.get(i.id) || 0), higiene }
  }).filter((i) => i.resta > 0)
  const [qtds, setQtds] = useState({})
  const [volta, setVolta] = useState(() => Object.fromEntries(itens.map((i) => [i.id, !i.higiene])))
  const [motivo, setMotivo] = useState('')
  const [como, setComo] = useState('troca')
  const [aprovacao, setAprovacao] = useState(null)
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState(null)

  const escolhidos = itens.map((i) => ({ ...i, qtd: Math.min(Number(qtds[i.id] || 0), i.resta) })).filter((i) => i.qtd > 0)
  const valor = arred(escolhidos.reduce((s, i) => s + valorDevolucao({ ...i, preco_unitario: Number(i.preco_unitario), desconto: Number(i.desconto) }, i.qtd), 0))

  async function devolver() {
    setErro('')
    if (!escolhidos.length) return setErro('Diga quantas peças voltaram.')
    if (limparTexto(motivo).length < 3) return setErro('O motivo é obrigatório.')
    const { data, error } = await supabase.rpc('registrar_devolucao', {
      p_venda: venda.id,
      p_itens: escolhidos.map((i) => ({ venda_item_id: i.id, quantidade: i.qtd, volta_ao_estoque: volta[i.id] })),
      p_motivo: limparTexto(motivo), p_como: como, p_aprovacao: aprovacao,
    })
    if (error) { setAprovacao(null); return setErro(traduzirErro(error)) }
    setFeito(Number(data))
  }

  if (feito != null) {
    return (
      <section className="cartao secao secao-interna">
        <Aviso tom="oliva">
          Devolução registrada. {como === 'troca'
            ? `Valor de ${formatarMoeda(feito)} para usar na troca: faça a venda da peça nova e desconte esse valor.`
            : `Devolva ${formatarMoeda(feito)} à cliente (${COMO_DEVOLVEU[como].toLowerCase()}).`}
        </Aviso>
        <button className="botao botao-principal" onClick={aoConcluir}>Pronto</button>
      </section>
    )
  }

  return (
    <section className="cartao secao secao-interna formulario">
      <h3>Devolução ou troca</h3>
      <p className="texto-suave pequeno">Diga quantas de cada peça voltaram. Peça de categoria de higiene vem marcada para não voltar ao estoque (dá para mudar).</p>
      {itens.map((i) => (
        <div key={i.id} className="devolucao-item">
          <span><strong>{i.descricao}</strong><small className="texto-suave"> · pode devolver até {i.resta}</small></span>
          <span className="linha-campos">
            <input inputMode="numeric" value={qtds[i.id] ?? ''} onChange={(e) => setQtds({ ...qtds, [i.id]: filtroInteiro(e.target.value, 3) })} placeholder="0" aria-label={`Quantas de ${i.descricao}`} />
            <label className="campo-check"><input type="checkbox" checked={volta[i.id]} onChange={(e) => setVolta({ ...volta, [i.id]: e.target.checked })} /> volta ao estoque</label>
          </span>
        </div>
      ))}
      <div className="grade-campos">
        <label className="campo"><span>Motivo</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={TAMANHO.motivo} placeholder="Ex.: tamanho errado" /></label>
        <label className="campo">
          <span>Como o valor volta para a cliente</span>
          <select value={como} onChange={(e) => setComo(e.target.value)}>
            {Object.entries(COMO_DEVOLVEU).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
      </div>
      {valor > 0 && <Aviso tom="ambar">Valor da devolução: <strong>{formatarMoeda(valor)}</strong> (já com o desconto que a cliente teve).</Aviso>}
      {!admin && !aprovacao && <PedirAprovacao aoAprovar={setAprovacao} texto="Para registrar devolução, a proprietária digita o código de aprovação." />}
      {!admin && aprovacao && <Aviso tom="oliva">Aprovado pela proprietária.</Aviso>}
      {erro && <Aviso tom="vinho">{erro}</Aviso>}
      <div className="linha-campos">
        <button className="botao botao-fantasma" onClick={aoVoltar}>Voltar</button>
        <button className="botao botao-principal" onClick={devolver} disabled={!escolhidos.length || (!admin && !aprovacao)}>Registrar devolução</button>
      </div>
    </section>
  )
}
