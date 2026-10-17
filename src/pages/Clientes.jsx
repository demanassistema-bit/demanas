import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCatalogo } from '../contexts/CatalogoContext'
import { useClientes } from '../contexts/ClientesContext'
import { supabase, traduzirErro } from '../lib/supabase'
import { arred, formatarMoeda, CANAIS } from '../lib/moeda'
import { diasDesde, formatarData, formatarDataHora, hojeISO, NOMES_MESES } from '../lib/datas'
import { filtroTelefone, formatarWhatsApp, linkWhatsApp, TAMANHO } from '../lib/limites'
import { emAberto, MENSAGENS, montarCliente, ORIGENS, SEGMENTOS, segmentar, situacaoEncomenda, textoItem } from '../lib/clientes'
import { normalizar } from '../demo/regras'
import Modal, { BotaoPerigo } from '../components/Modal'
import Icone from '../components/Icone'
import { Aviso, CampoBusca, Selo, Vazio } from '../components/ui'

// Busca por nome ou e-mail (sem acento) e pelos números do WhatsApp
export function achaCliente(c, busca) {
  const texto = normalizar(busca.trim())
  const digitos = busca.replace(/\D/g, '')
  if (!texto) return true
  return normalizar(`${c.nome} ${c.email || ''}`).includes(texto) || (digitos.length >= 4 && (c.whatsapp || '').includes(digitos))
}

export default function Clientes() {
  const { ativas, carregando, erro } = useClientes()
  const [params, setParams] = useSearchParams()
  const segmento = params.get('segmento') || 'todas'
  const [busca, setBusca] = useState('')
  const [nova, setNova] = useState(false)
  const mes = new Date().getMonth() + 1

  const lista = segmentar(ativas, segmento, mes).filter((c) => achaCliente(c, busca))

  return (
    <div className="pagina">
      <header className="pagina-topo">
        <div>
          <h1>Clientes</h1>
          <p className="texto-suave">{ativas.length} {ativas.length === 1 ? 'cliente cadastrada' : 'clientes cadastradas'}</p>
        </div>
        <button className="botao botao-principal" onClick={() => setNova(true)}><Icone nome="somar" /> Nova cliente</button>
      </header>

      <div className="filtros">
        <CampoBusca valor={busca} aoMudar={setBusca} placeholder="Nome, WhatsApp ou e-mail" />
        <div className="fichas">
          {Object.entries(SEGMENTOS).map(([chave, nome]) => (
            <button key={chave} className={`ficha ${segmento === chave ? 'ativo' : ''}`} onClick={() => setParams({ segmento: chave }, { replace: true })}>
              {chave === 'aniversario' ? `Aniversariantes de ${NOMES_MESES[mes - 1]}` : nome}
            </button>
          ))}
        </div>
      </div>

      {erro && <Aviso tom="vinho">{erro}</Aviso>}
      {carregando ? <p className="texto-suave">Carregando…</p> : lista.length === 0 ? (
        <Vazio icone="clientes" titulo={ativas.length ? 'Nenhuma cliente neste filtro' : 'Nenhuma cliente cadastrada ainda'}>
          {!ativas.length && 'Cadastre aqui ou direto na venda, pelo "Cadastro rápido".'}
        </Vazio>
      ) : (
        <ul className="cartao lista">
          {lista.map((c) => (
            <li key={c.id}>
              <Link to={`/clientes/${c.id}`} className="linha-lista">
                <span className="com-avatar">
                  <span className="avatar">{c.nome.charAt(0)}</span>
                  <span>
                    <strong>{c.nome}</strong>
                    <small>
                      {segmento === 'aniversario' ? `aniversário dia ${Number(c.nascimento.slice(8))}` : c.ultima_compra ? `última compra há ${diasDesde(c.ultima_compra)} dias` : 'ainda sem compras'}
                    </small>
                  </span>
                </span>
                <strong>{formatarMoeda(c.total)}</strong>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {nova && <FormCliente aoFechar={() => setNova(false)} />}
    </div>
  )
}

const camposVazios = { nome: '', whatsapp: '', email: '', nascimento: '', origem: '', observacoes: '', sutia: '', calcinha: '', tom_pele: '', tipo_pele: '', aceita_contato: false }

function paraFormulario(c) {
  return {
    ...camposVazios,
    ...c.preferencias,
    nome: c.nome, whatsapp: c.whatsapp ? formatarWhatsApp(c.whatsapp) : '', email: c.email || '', nascimento: c.nascimento || '',
    origem: c.origem || '', observacoes: c.observacoes || '', aceita_contato: c.aceita_contato,
  }
}

// Nova cliente (sem "cliente") ou editar os dados de uma cliente
function FormCliente({ cliente, aoFechar }) {
  const { ativas, criarCliente, atualizarCliente } = useClientes()
  const navegar = useNavigate()
  const [f, setF] = useState(() => (cliente ? paraFormulario(cliente) : camposVazios))
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const mudar = (campo) => (e) => setF({ ...f, [campo]: e.target.value })

  async function salvar(e) {
    e.preventDefault()
    const r = montarCliente(f, { hoje: hojeISO(), outras: ativas.filter((c) => c.id !== cliente?.id) })
    if (r.erro) return setErro(r.erro)
    setSalvando(true)
    const feito = cliente ? await atualizarCliente(cliente.id, r.cliente) : await criarCliente(r.cliente)
    setSalvando(false)
    if (feito.erro) return setErro(feito.erro)
    aoFechar()
    if (!cliente) navegar(`/clientes/${feito.data.id}`)
  }

  return (
    <Modal titulo={cliente ? 'Editar dados' : 'Nova cliente'} aoFechar={aoFechar} rodape={<><button className="botao botao-fantasma" onClick={aoFechar}>Cancelar</button><button className="botao botao-principal" form="form-cliente" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button></>}>
      <form id="form-cliente" className="formulario" onSubmit={salvar}>
        <label className="campo"><span>Nome</span><input value={f.nome} onChange={mudar('nome')} maxLength={TAMANHO.nome} autoFocus /></label>
        <div className="grade-campos">
          <label className="campo"><span>WhatsApp</span><input inputMode="tel" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: filtroTelefone(e.target.value) })} placeholder="(00) 00000-0000" /></label>
          <label className="campo"><span>Aniversário</span><input type="date" min="1900-01-01" max={hojeISO()} value={f.nascimento} onChange={mudar('nascimento')} /></label>
          <label className="campo"><span>E-mail</span><input type="email" inputMode="email" value={f.email} onChange={mudar('email')} maxLength={TAMANHO.email} /></label>
          <label className="campo"><span>Como conheceu a loja</span>
            <select value={f.origem} onChange={mudar('origem')}>
              <option value="">Não sei</option>
              {Object.entries(ORIGENS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
          <label className="campo"><span>Tamanho de sutiã</span><input value={f.sutia} onChange={mudar('sutia')} maxLength={TAMANHO.preferencia} /></label>
          <label className="campo"><span>Tamanho de calcinha</span><input value={f.calcinha} onChange={mudar('calcinha')} maxLength={TAMANHO.preferencia} /></label>
          <label className="campo"><span>Tom de pele</span><input value={f.tom_pele} onChange={mudar('tom_pele')} maxLength={TAMANHO.preferencia} /></label>
          <label className="campo"><span>Tipo de pele</span><input value={f.tipo_pele} onChange={mudar('tipo_pele')} maxLength={TAMANHO.preferencia} placeholder="Ex.: oleosa" /></label>
        </div>
        <label className="campo"><span>Observações</span><input value={f.observacoes} onChange={mudar('observacoes')} maxLength={TAMANHO.observacao} placeholder="Ex.: prefere renda, alergia a perfume" /></label>
        <label className="campo-check"><input type="checkbox" checked={f.aceita_contato} onChange={(e) => setF({ ...f, aceita_contato: e.target.checked })} /> Aceita receber mensagens da loja (pergunte para ela)</label>
        {erro && <Aviso tom="vinho">{erro}</Aviso>}
      </form>
    </Modal>
  )
}

export function FichaCliente() {
  const { clienteId } = useParams()
  const { permissoes } = useAuth()
  const { linhas } = useCatalogo()
  const { clientePorId, encomendas, carregando, excluirCliente } = useClientes()
  const navegar = useNavigate()
  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])
  const [modelo, setModelo] = useState('novidades')
  const [editar, setEditar] = useState(false)
  const [compras, setCompras] = useState(null)
  const [erro, setErro] = useState('')
  const c = clientePorId.get(clienteId)

  useEffect(() => {
    supabase.from('vendas')
      .select('id, numero, total, status, canal, criado_em, venda_itens(descricao, quantidade), devolucoes(valor_devolvido)')
      .eq('cliente_id', clienteId).order('criado_em', { ascending: false }).limit(200)
      .then(({ data, error }) => (error ? setErro(traduzirErro(error)) : setCompras(data)))
  }, [clienteId, c?.total])

  if (carregando) return <div className="pagina"><p className="texto-suave">Carregando…</p></div>
  if (!c || c.removida_em) return <Navigate to="/clientes" replace />

  const primeiroNome = c.nome.split(' ')[0]
  const link = linkWhatsApp(c.whatsapp, MENSAGENS[modelo](primeiroNome))
  const prefs = c.preferencias || {}
  const minhas = encomendas.filter((e) => e.cliente_id === c.id && emAberto(e))
  const temHistorico = (compras?.length ?? c.compras) > 0 || encomendas.some((e) => e.cliente_id === c.id)

  async function excluir() {
    const r = await excluirCliente(c.id)
    if (r.erro) return setErro(r.erro)
    navegar('/clientes')
  }

  return (
    <div className="pagina">
      <Link to="/clientes" className="botao-link voltar"><Icone nome="voltar" tamanho={18} /> Clientes</Link>
      <header className="pagina-topo">
        <div>
          <h1>{c.nome}</h1>
          <p className="texto-suave">
            {c.whatsapp ? formatarWhatsApp(c.whatsapp) : 'sem WhatsApp'}
            {c.nascimento && ` · aniversário ${formatarData(c.nascimento).slice(0, 5)}`}
            {c.email && ` · ${c.email}`}
            {c.origem && ` · conheceu: ${ORIGENS[c.origem].toLowerCase()}`}
          </p>
        </div>
        <button className="botao botao-secundario" onClick={() => setEditar(true)}><Icone nome="configuracoes" /> Editar dados</button>
      </header>

      <section className="grade-metricas">
        <div className="cartao metrica"><span className="metrica-rotulo">Total comprado</span><strong className="metrica-valor">{formatarMoeda(c.total)}</strong></div>
        <div className="cartao metrica"><span className="metrica-rotulo">Compras</span><strong className="metrica-valor">{c.compras}</strong></div>
        <div className="cartao metrica"><span className="metrica-rotulo">Ticket médio</span><strong className="metrica-valor">{formatarMoeda(c.compras ? arred(c.total / c.compras) : 0)}</strong></div>
        <div className="cartao metrica"><span className="metrica-rotulo">Última compra</span><strong className="metrica-valor">{c.ultima_compra ? `há ${diasDesde(c.ultima_compra)} d` : '—'}</strong></div>
      </section>

      <div className="grade-blocos">
        <section className="cartao secao">
          <h2>Falar no WhatsApp</h2>
          {!c.aceita_contato && <Aviso tom="ambar">Esta cliente não autorizou mensagens da loja. Pergunte antes de mandar novidades.</Aviso>}
          {!c.whatsapp && <p className="texto-suave pequeno">Sem WhatsApp cadastrado: a conversa abre para você escolher o contato.</p>}
          <div className="fichas">
            {[['novidades', 'Novidades'], ['aniversario', 'Aniversário'], ['saudade', 'Saudade']].map(([k, n]) => (
              <button key={k} className={`ficha ${modelo === k ? 'ativo' : ''}`} onClick={() => setModelo(k)}>{n}</button>
            ))}
          </div>
          <p className="mensagem-pronta">{MENSAGENS[modelo](primeiroNome)}</p>
          <a className="botao botao-principal" href={link} target="_blank" rel="noreferrer"><Icone nome="conversa" /> Abrir conversa</a>
        </section>

        <section className="cartao secao">
          <h2>Preferências</h2>
          <dl className="preferencias">
            <div><dt>Sutiã</dt><dd>{prefs.sutia || '—'}</dd></div>
            <div><dt>Calcinha</dt><dd>{prefs.calcinha || '—'}</dd></div>
            <div><dt>Tom de pele</dt><dd>{prefs.tom_pele || '—'}</dd></div>
            <div><dt>Tipo de pele</dt><dd>{prefs.tipo_pele || '—'}</dd></div>
          </dl>
          {c.observacoes && <p className="texto-suave pequeno">{c.observacoes}</p>}
        </section>
      </div>

      {minhas.length > 0 && (
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
                  <span><strong>{e.itens.map((i) => textoItem(i, linhaPorId)).join(', ')}</strong><small>{e.previsao ? `previsão ${formatarData(e.previsao)}` : 'sem data'}{e.sinal_valor > 0 && ` · sinal ${formatarMoeda(e.sinal_valor)}`}</small></span>
                  <Selo tom={sit.tom}>{sit.texto}</Selo>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="cartao secao">
        <h2>Histórico de compras</h2>
        {compras == null ? <p className="texto-suave">Carregando…</p> : compras.length === 0 ? <Vazio icone="vendas" titulo="Ainda sem compras" /> : (
          <ul className="lista">
            {compras.map((v) => {
              const devolvido = arred(v.devolucoes.reduce((s, d) => s + Number(d.valor_devolvido), 0))
              return (
                <li key={v.id}>
                  <Link to={`/vendas?venda=${v.id}`} className="linha-lista">
                    <span>
                      <strong>nº {v.numero} · {formatarMoeda(v.total)} · {formatarDataHora(v.criado_em)}</strong>
                      <small>{v.venda_itens.map((i) => `${i.quantidade}x ${i.descricao}`).join(', ')}{devolvido > 0 && ` · devolveu ${formatarMoeda(devolvido)}`}</small>
                    </span>
                    {v.status === 'cancelada' ? <Selo tom="vinho">Cancelada</Selo> : <Selo>{CANAIS[v.canal]}</Selo>}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {permissoes.admin && (
        <section className="cartao secao">
          <h2>Excluir cliente</h2>
          {temHistorico
            ? <p className="texto-suave pequeno">Esta cliente já comprou ou fez encomenda. Os <strong>dados pessoais são apagados</strong> (nome, WhatsApp, e-mail, aniversário, preferências e observações) e as compras continuam no histórico como "Cliente removida", como pede a LGPD.</p>
            : <p className="texto-suave pequeno">Esta cliente não tem compras nem encomendas: o cadastro é apagado de vez.</p>}
          <BotaoPerigo texto="Excluir cliente" aoConfirmar={excluir} />
        </section>
      )}
      {erro && <Aviso tom="vinho">{erro}</Aviso>}

      {editar && <FormCliente cliente={c} aoFechar={() => setEditar(false)} />}
    </div>
  )
}
