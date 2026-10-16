import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDemo } from '../demo/DemoContext'
import { formatarMoeda, arred, FORMAS_PAGAMENTO, CANAIS } from '../lib/moeda'
import { diaDe, diasDesde, formatarDataHora, hojeISO } from '../lib/datas'
import { nomeVariacao } from '../demo/regras'
import Modal, { BotaoPerigo } from '../components/Modal'
import Icone from '../components/Icone'
import { Aviso, Selo, Vazio } from '../components/ui'

const FILTROS = { hoje: 'Hoje', semana: '7 dias', mes: '30 dias', pendentes: 'Notas pendentes', canceladas: 'Canceladas' }

function seloNota(nota) {
  if (!nota) return null
  if (nota.status === 'pendente') return <Selo tom="vinho">Nota pendente</Selo>
  if (nota.status === 'enviando') return <Selo tom="ambar">Emitindo nota…</Selo>
  return null
}

export default function Vendas() {
  const { dados, clientePorId, variacaoPorId, produtoPorId, ehProprietaria, podeVerCustos, cancelarVenda, reenviarNota } = useDemo()
  const [params, setParams] = useSearchParams()
  const filtro = params.get('filtro') || 'semana'
  const vendaAberta = dados.vendas.find((v) => v.id === params.get('venda'))
  const [motivo, setMotivo] = useState('')

  const lista = useMemo(() => {
    const hoje = hojeISO()
    return [...dados.vendas].reverse().filter((v) => {
      if (filtro === 'hoje') return diaDe(v.data) === hoje
      if (filtro === 'semana') return diasDesde(v.data) < 7
      if (filtro === 'mes') return diasDesde(v.data) < 30
      if (filtro === 'pendentes') return v.nota?.status === 'pendente'
      if (filtro === 'canceladas') return v.status === 'cancelada'
      return true
    })
  }, [dados.vendas, filtro])

  const totalLista = arred(lista.filter((v) => v.status === 'concluida').reduce((s, v) => s + v.total, 0))
  const mudar = (campos) => {
    const novo = new URLSearchParams(params)
    Object.entries(campos).forEach(([k, v]) => (v ? novo.set(k, v) : novo.delete(k)))
    setParams(novo, { replace: true })
  }

  return (
    <div className="pagina">
      <header className="pagina-topo">
        <div>
          <h1>Vendas</h1>
          <p className="texto-suave">{lista.length} vendas · {formatarMoeda(totalLista)} concluídas</p>
        </div>
      </header>

      <div className="fichas" role="tablist">
        {Object.entries(FILTROS).map(([chave, nome]) => (
          <button key={chave} className={`ficha ${filtro === chave ? 'ativo' : ''}`} onClick={() => mudar({ filtro: chave })}>{nome}</button>
        ))}
      </div>

      {lista.length === 0 ? <Vazio icone="vendas" titulo="Nenhuma venda neste filtro" /> : (
        <ul className="cartao lista">
          {lista.map((v) => (
            <li key={v.id}>
              <button className="linha-lista" onClick={() => mudar({ venda: v.id })}>
                <span>
                  <strong>nº {v.numero} · {formatarMoeda(v.total)}</strong>
                  <small>
                    {formatarDataHora(v.data)} · {dados.config.empresas[v.empresa_id]?.apelido} · {CANAIS[v.canal]} · {v.pagamentos.map((p) => FORMAS_PAGAMENTO[p.forma]).join(' + ')}
                    {v.cliente_id ? ` · ${clientePorId.get(v.cliente_id)?.nome}` : ''}
                  </small>
                </span>
                <span className="selos">
                  {v.status === 'cancelada' && <Selo tom="vinho">Cancelada</Selo>}
                  {seloNota(v.nota)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {vendaAberta && (
        <Modal titulo={`Venda nº ${vendaAberta.numero}`} aoFechar={() => { mudar({ venda: null }); setMotivo('') }}>
          <p className="texto-suave">
            {formatarDataHora(vendaAberta.data)} · {dados.config.empresas[vendaAberta.empresa_id]?.apelido} · {CANAIS[vendaAberta.canal]} · vendida por {vendaAberta.vendedora}
            {vendaAberta.cliente_id && <> · {clientePorId.get(vendaAberta.cliente_id)?.nome}</>}
          </p>
          <ul className="lista lista-compacta">
            {vendaAberta.itens.map((i) => {
              const v = variacaoPorId.get(i.variacao_id)
              return (
                <li key={i.variacao_id} className="linha-lista">
                  <span><strong>{i.quantidade}x {produtoPorId.get(v.produto_id).nome}</strong><small>{nomeVariacao(v)} · {formatarMoeda(i.preco_unitario)}{podeVerCustos && ` · custo ${formatarMoeda(i.custo_unitario)}`}</small></span>
                  <strong>{formatarMoeda(arred(i.preco_unitario * i.quantidade))}</strong>
                </li>
              )
            })}
          </ul>
          <dl className="totais">
            <div><dt>Subtotal</dt><dd>{formatarMoeda(vendaAberta.subtotal)}</dd></div>
            {vendaAberta.desconto > 0 && <div><dt>Desconto</dt><dd>− {formatarMoeda(vendaAberta.desconto)}</dd></div>}
            <div className="total"><dt>Total</dt><dd>{formatarMoeda(vendaAberta.total)}</dd></div>
            {vendaAberta.pagamentos.map((p, i) => (
              <div key={i}><dt>{FORMAS_PAGAMENTO[p.forma]}{p.parcelas > 1 ? ` em ${p.parcelas}x` : ''}</dt><dd>{formatarMoeda(p.valor)}</dd></div>
            ))}
          </dl>

          {vendaAberta.grupo && (
            <p className="texto-suave pequeno">
              Esta compra teve peças dos dois CNPJs. A outra parte é a venda nº {dados.vendas.filter((x) => x.grupo === vendaAberta.grupo && x.id !== vendaAberta.id).map((x) => x.numero).join(', ')}.
            </p>
          )}
          {!vendaAberta.nota ? (
            <div className="cartao secao secao-interna">
              <h3><Icone nome="fiscal" tamanho={18} /> Sem nota fiscal</h3>
              <p className="texto-suave pequeno">Venda do {dados.config.empresas[vendaAberta.empresa_id]?.apelido} (MEI), que vende só para consumidor final e não precisa emitir nota.</p>
            </div>
          ) : (
          <div className="cartao secao secao-interna">
            <h3><Icone nome="fiscal" tamanho={18} /> Nota fiscal <Selo tom="ambar">teste</Selo></h3>
            {vendaAberta.nota?.status === 'autorizada' && <p>Autorizada.</p>}
            {vendaAberta.nota?.status === 'enviando' && <p>Emitindo em segundo plano…</p>}
            {vendaAberta.nota?.status === 'cancelada' && <p>Nota cancelada junto com a venda.</p>}
            {vendaAberta.nota?.status === 'pendente' && (
              <>
                <Aviso tom="vinho">{vendaAberta.nota.motivo}</Aviso>
                <button className="botao botao-secundario" onClick={() => reenviarNota(vendaAberta.id)}>Reenviar nota</button>
              </>
            )}
          </div>
          )}

          {vendaAberta.status === 'cancelada' ? (
            <Aviso tom="vinho">Cancelada: {vendaAberta.motivo_cancelamento}. O estoque voltou por estorno, e a venda continua registrada.</Aviso>
          ) : ehProprietaria ? (
            <div className="cancelar">
              <label className="campo"><span>Motivo do cancelamento</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: cliente desistiu" /></label>
              <BotaoPerigo texto="Cancelar venda" disabled={!motivo.trim()} aoConfirmar={() => { cancelarVenda(vendaAberta.id, motivo.trim()); setMotivo('') }} />
              <p className="texto-suave pequeno">Cancelar não apaga a venda: devolve as peças ao estoque com um estorno e guarda o motivo.</p>
            </div>
          ) : (
            <p className="texto-suave pequeno">Para cancelar, peça à proprietária.</p>
          )}
        </Modal>
      )}
    </div>
  )
}
