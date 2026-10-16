import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useDemo } from '../demo/DemoContext'
import { arred, formatarMoeda, CANAIS } from '../lib/moeda'
import { diasDesde, formatarData, formatarDataHora, hojeISO, NOMES_MESES } from '../lib/datas'
import { nomeVariacao, normalizar, situacaoEncomenda } from '../demo/regras'
import { textoItem } from './Encomendas'
import Modal from '../components/Modal'
import Icone from '../components/Icone'
import { Aviso, CampoBusca, Selo, Vazio } from '../components/ui'

const SEGMENTOS = { todas: 'Todas', aniversario: 'Aniversariantes do mês', sumidas: 'Sem comprar há 60 dias', melhores: 'Melhores clientes' }

// Compras de cada cliente, calculadas a partir das vendas
function useResumoClientes() {
  const { dados } = useDemo()
  return useMemo(() => {
    const mapa = new Map(dados.clientes.map((c) => [c.id, { ...c, compras: [], total: 0, ultima: null }]))
    for (const v of dados.vendas) {
      if (v.status !== 'concluida' || !v.cliente_id) continue
      const c = mapa.get(v.cliente_id)
      if (!c) continue
      c.compras.push(v)
      c.total = arred(c.total + v.total)
      if (!c.ultima || v.data > c.ultima) c.ultima = v.data
    }
    return [...mapa.values()]
  }, [dados.clientes, dados.vendas])
}

export default function Clientes() {
  const clientes = useResumoClientes()
  const [params, setParams] = useSearchParams()
  const segmento = params.get('segmento') || 'todas'
  const [busca, setBusca] = useState('')
  const [nova, setNova] = useState(false)
  const mes = new Date().getMonth() + 1

  const corteMelhores = [...clientes].sort((a, b) => b.total - a.total)[4]?.total ?? 0
  const lista = clientes
    .filter((c) => {
      if (segmento === 'aniversario') return c.nascimento && Number(c.nascimento.slice(5, 7)) === mes
      if (segmento === 'sumidas') return c.ultima && diasDesde(c.ultima) > 60
      if (segmento === 'melhores') return c.total > 0 && c.total >= corteMelhores
      return true
    })
    .filter((c) => !busca.trim() || normalizar(`${c.nome} ${c.whatsapp}`).includes(normalizar(busca)))
    .sort((a, b) => (segmento === 'melhores' ? b.total - a.total : segmento === 'aniversario' ? a.nascimento.slice(8).localeCompare(b.nascimento.slice(8)) : a.nome.localeCompare(b.nome)))

  return (
    <div className="pagina">
      <header className="pagina-topo">
        <div>
          <h1>Clientes</h1>
          <p className="texto-suave">{clientes.length} clientes cadastradas</p>
        </div>
        <button className="botao botao-principal" onClick={() => setNova(true)}><Icone nome="somar" /> Nova cliente</button>
      </header>

      <div className="filtros">
        <CampoBusca valor={busca} aoMudar={setBusca} placeholder="Nome ou WhatsApp" />
        <div className="fichas">
          {Object.entries(SEGMENTOS).map(([chave, nome]) => (
            <button key={chave} className={`ficha ${segmento === chave ? 'ativo' : ''}`} onClick={() => setParams({ segmento: chave }, { replace: true })}>
              {chave === 'aniversario' ? `Aniversariantes de ${NOMES_MESES[mes - 1]}` : nome}
            </button>
          ))}
        </div>
      </div>

      {lista.length === 0 ? <Vazio icone="clientes" titulo="Nenhuma cliente neste filtro" /> : (
        <ul className="cartao lista">
          {lista.map((c) => (
            <li key={c.id}>
              <Link to={`/clientes/${c.id}`} className="linha-lista">
                <span className="com-avatar">
                  <span className="avatar">{c.nome.charAt(0)}</span>
                  <span>
                    <strong>{c.nome}</strong>
                    <small>
                      {segmento === 'aniversario' ? `aniversário dia ${Number(c.nascimento.slice(8))}` : c.ultima ? `última compra há ${diasDesde(c.ultima)} dias` : 'ainda sem compras'}
                    </small>
                  </span>
                </span>
                <strong>{formatarMoeda(c.total)}</strong>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {nova && <NovaCliente aoFechar={() => setNova(false)} />}
    </div>
  )
}

function NovaCliente({ aoFechar }) {
  const { criarCliente } = useDemo()
  const navegar = useNavigate()
  const [f, setF] = useState({ nome: '', whatsapp: '', nascimento: '', aceita_contato: true, sutia: '', calcinha: '', tom_pele: '' })
  const [erro, setErro] = useState('')
  function salvar(e) {
    e.preventDefault()
    if (!f.nome.trim()) return setErro('Informe o nome.')
    const id = criarCliente({
      nome: f.nome.trim(), whatsapp: f.whatsapp.trim(), nascimento: f.nascimento, aceita_contato: f.aceita_contato,
      preferencias: { sutia: f.sutia, calcinha: f.calcinha, tom_pele: f.tom_pele },
    })
    navegar(`/clientes/${id}`)
  }
  return (
    <Modal titulo="Nova cliente" aoFechar={aoFechar} rodape={<><button className="botao botao-fantasma" onClick={aoFechar}>Cancelar</button><button className="botao botao-principal" form="form-cliente">Salvar</button></>}>
      <form id="form-cliente" className="formulario" onSubmit={salvar}>
        <label className="campo"><span>Nome</span><input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoFocus /></label>
        <div className="grade-campos">
          <label className="campo"><span>WhatsApp</span><input inputMode="tel" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} placeholder="(00) 00000-0000" /></label>
          <label className="campo"><span>Aniversário</span><input type="date" value={f.nascimento} onChange={(e) => setF({ ...f, nascimento: e.target.value })} /></label>
          <label className="campo"><span>Tamanho de sutiã</span><input value={f.sutia} onChange={(e) => setF({ ...f, sutia: e.target.value })} /></label>
          <label className="campo"><span>Tamanho de calcinha</span><input value={f.calcinha} onChange={(e) => setF({ ...f, calcinha: e.target.value })} /></label>
          <label className="campo"><span>Tom de pele</span><input value={f.tom_pele} onChange={(e) => setF({ ...f, tom_pele: e.target.value })} /></label>
        </div>
        <label className="campo-check"><input type="checkbox" checked={f.aceita_contato} onChange={(e) => setF({ ...f, aceita_contato: e.target.checked })} /> Aceita receber mensagens da loja</label>
        {erro && <Aviso tom="vinho">{erro}</Aviso>}
      </form>
    </Modal>
  )
}

const MENSAGENS = {
  aniversario: (nome) => `Oi, ${nome}! Feliz aniversário! 🌹 Preparamos um mimo especial para você aqui na deMana's. Passa para ver?`,
  saudade: (nome) => `Oi, ${nome}! Faz tempo que você não aparece por aqui. Chegaram novidades que têm a sua cara. Quer que eu mande fotos?`,
  novidades: (nome) => `Oi, ${nome}! Chegou coleção nova na deMana's e lembrei de você. Posso te mostrar?`,
}

export function FichaCliente() {
  const { clienteId } = useParams()
  const clientes = useResumoClientes()
  const { dados, linhas, variacaoPorId, produtoPorId } = useDemo()
  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])
  const [modelo, setModelo] = useState('novidades')
  const c = clientes.find((x) => x.id === clienteId)
  if (!c) return <Navigate to="/clientes" replace />

  const primeiroNome = c.nome.split(' ')[0]
  const numero = c.whatsapp?.replace(/\D/g, '')
  const link = `https://wa.me/${numero ? `55${numero}` : ''}?text=${encodeURIComponent(MENSAGENS[modelo](primeiroNome))}`
  const prefs = c.preferencias || {}
  const compras = [...c.compras].reverse()

  return (
    <div className="pagina">
      <Link to="/clientes" className="botao-link voltar"><Icone nome="voltar" tamanho={18} /> Clientes</Link>
      <header className="pagina-topo">
        <div>
          <h1>{c.nome}</h1>
          <p className="texto-suave">{c.whatsapp || 'sem WhatsApp'}{c.nascimento && ` · aniversário ${formatarData(c.nascimento).slice(0, 5)}`}</p>
        </div>
      </header>

      <section className="grade-metricas">
        <div className="cartao metrica"><span className="metrica-rotulo">Total comprado</span><strong className="metrica-valor">{formatarMoeda(c.total)}</strong></div>
        <div className="cartao metrica"><span className="metrica-rotulo">Compras</span><strong className="metrica-valor">{c.compras.length}</strong></div>
        <div className="cartao metrica"><span className="metrica-rotulo">Ticket médio</span><strong className="metrica-valor">{formatarMoeda(c.compras.length ? arred(c.total / c.compras.length) : 0)}</strong></div>
        <div className="cartao metrica"><span className="metrica-rotulo">Última compra</span><strong className="metrica-valor">{c.ultima ? `há ${diasDesde(c.ultima)} d` : '—'}</strong></div>
      </section>

      <div className="grade-blocos">
        <section className="cartao secao">
          <h2>Falar no WhatsApp</h2>
          {!c.aceita_contato && <Aviso tom="ambar">Esta cliente não autorizou mensagens da loja.</Aviso>}
          <div className="fichas">
            {[['novidades', 'Novidades'], ['aniversario', 'Aniversário'], ['saudade', 'Saudade']].map(([k, n]) => (
              <button key={k} className={`ficha ${modelo === k ? 'ativo' : ''}`} onClick={() => setModelo(k)}>{n}</button>
            ))}
          </div>
          <p className="mensagem-pronta">{MENSAGENS[modelo](primeiroNome)}</p>
          <a className="botao botao-principal" href={link} target="_blank" rel="noreferrer" aria-disabled={!c.aceita_contato}><Icone nome="conversa" /> Abrir conversa</a>
        </section>

        <section className="cartao secao">
          <h2>Preferências</h2>
          <dl className="preferencias">
            <div><dt>Sutiã</dt><dd>{prefs.sutia || '—'}</dd></div>
            <div><dt>Calcinha</dt><dd>{prefs.calcinha || '—'}</dd></div>
            <div><dt>Tom de pele</dt><dd>{prefs.tom_pele || '—'}</dd></div>
          </dl>
        </section>
      </div>

      {(() => {
        const minhas = (dados.encomendas || []).filter((e) => e.cliente_id === c.id && (e.status === 'aguardando' || e.status === 'chegou'))
        if (!minhas.length) return null
        return (
          <section className="cartao secao">
            <header className="bloco-topo">
              <h2><Icone nome="encomenda" tamanho={18} /> Encomendas em aberto</h2>
              <Link to="/encomendas" className="botao-link">Encomendas</Link>
            </header>
            <ul className="lista">
              {minhas.map((e) => {
                const sit = situacaoEncomenda(e, hojeISO())
                return (
                  <li key={e.id} className="linha-lista">
                    <span><strong>{e.itens.map((i) => textoItem(i, linhaPorId)).join(', ')}</strong><small>{e.previsao ? `previsão ${formatarData(e.previsao)}` : 'sem data'}{e.sinal?.valor > 0 && ` · sinal ${formatarMoeda(e.sinal.valor)}`}</small></span>
                    <Selo tom={sit.tom}>{sit.texto}</Selo>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })()}

      <section className="cartao secao">
        <h2>Histórico de compras</h2>
        {compras.length === 0 ? <Vazio icone="vendas" titulo="Ainda sem compras" /> : (
          <ul className="lista">
            {compras.map((v) => (
              <li key={v.id} className="linha-lista">
                <span>
                  <strong>{formatarMoeda(v.total)} · {formatarDataHora(v.data)}</strong>
                  <small>{v.itens.map((i) => { const vr = variacaoPorId.get(i.variacao_id); return `${produtoPorId.get(vr.produto_id).nome} (${nomeVariacao(vr)})` }).join(', ')}</small>
                </span>
                <Selo>{CANAIS[v.canal]}</Selo>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
