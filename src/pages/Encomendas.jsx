import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCatalogo } from '../contexts/CatalogoContext'
import { useClientes } from '../contexts/ClientesContext'
import { formatarMoeda } from '../lib/moeda'
import { formatarData, hojeISO, paraISO, somarDias } from '../lib/datas'
import { erroData, filtroDinheiro, filtroTelefone, formatarWhatsApp, LIMITE, lerValor, limparTexto, linkWhatsApp, TAMANHO } from '../lib/limites'
import { FORMAS } from '../lib/vendas'
import { filtrarEncomendas, FILTROS_ENCOMENDA, juntarItem, mensagemChegou, montarCliente, ordemEncomendas, situacaoEncomenda, textoItem } from '../lib/clientes'
import { achaCliente } from './Clientes'
import Modal, { BotaoPerigo } from '../components/Modal'
import Icone from '../components/Icone'
import { Aviso, CampoBusca, Selo, SeletorVariacao, Vazio } from '../components/ui'

export default function Encomendas() {
  const { permissoes } = useAuth()
  const { linhas } = useCatalogo()
  const { encomendas, clientePorId, carregando, erro: erroCarga, atualizarEncomenda, excluirEncomenda } = useClientes()
  const [params, setParams] = useSearchParams()
  const navegar = useNavigate()
  const filtro = params.get('filtro') || 'abertas'
  const novaPara = params.get('nova') // peça vinda da Nova venda (sem estoque)
  const [nova, setNova] = useState(Boolean(novaPara))
  const [erro, setErro] = useState('')
  const hoje = hojeISO()
  const limiteData = paraISO(somarDias(new Date(), 365))
  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])

  const lista = filtrarEncomendas(encomendas, filtro, hoje).sort(ordemEncomendas)
  const conta = (f) => filtrarEncomendas(encomendas, f, hoje).length

  async function mudar(id, campos) {
    setErro('')
    const r = await atualizarEncomenda(id, campos)
    if (r.erro) setErro(r.erro)
  }
  async function excluir(id) {
    setErro('')
    const r = await excluirEncomenda(id)
    if (r.erro) setErro(r.erro)
  }

  return (
    <div className="pagina">
      <header className="pagina-topo">
        <div>
          <h1>Encomendas</h1>
          <p className="texto-suave">Pedidos de peças em falta. Não mexem no estoque até a peça chegar e ser vendida.</p>
        </div>
        <button className="botao botao-principal" onClick={() => setNova(true)}><Icone nome="somar" /> Nova encomenda</button>
      </header>

      <div className="fichas">
        {Object.entries(FILTROS_ENCOMENDA).map(([k, n]) => (
          <button key={k} className={`ficha ${filtro === k ? 'ativo' : ''}`} onClick={() => setParams({ filtro: k }, { replace: true })}>{n} ({conta(k)})</button>
        ))}
      </div>

      {(erro || erroCarga) && <Aviso tom="vinho">{erro || erroCarga}</Aviso>}
      {carregando ? <p className="texto-suave">Carregando…</p> : lista.length === 0 ? <Vazio icone="relogio" titulo="Nenhuma encomenda aqui" /> : (
        <ul className="lista-encomendas">
          {lista.map((e) => {
            const cliente = clientePorId.get(e.cliente_id)
            const sit = situacaoEncomenda(e, hoje)
            return (
              <li key={e.id} className="cartao encomenda">
                <header className="bloco-topo">
                  {cliente && !cliente.removida_em
                    ? <Link to={`/clientes/${e.cliente_id}`} className="encomenda-cliente">{cliente.nome}</Link>
                    : <span className="encomenda-cliente">{cliente?.nome || 'Cliente'}</span>}
                  <Selo tom={sit.tom}>{sit.texto}</Selo>
                </header>
                <ul className="lista-simples">
                  {e.itens.map((i) => <li key={i.id}>{textoItem(i, linhaPorId)}{i.descricao && <small className="texto-suave"> · fora do catálogo</small>}</li>)}
                </ul>
                <p className="texto-suave pequeno">
                  {e.previsao ? `Previsão: ${formatarData(e.previsao)}` : 'Sem data prevista'}
                  {e.sinal_valor > 0 && ` · sinal de ${formatarMoeda(e.sinal_valor)} (${FORMAS[e.sinal_forma]})`}
                  {e.observacao && ` · ${e.observacao}`}
                </p>

                {e.status === 'aguardando' && (
                  <div className="acoes-encomenda">
                    <button className="botao botao-secundario" onClick={() => mudar(e.id, { status: 'chegou' })}><Icone nome="confirmar" tamanho={18} /> Chegou</button>
                    <label className="campo-data">
                      <span className="texto-suave pequeno">Nova data</span>
                      <input type="date" defaultValue={e.previsao ?? ''} min={hoje} max={limiteData} onBlur={(ev) => { const v = ev.target.value; if (v && v !== e.previsao && !erroData(v, { min: hoje, max: limiteData })) mudar(e.id, { previsao: v }) }} />
                    </label>
                    <BotaoPerigo texto="Cancelar" aoConfirmar={() => mudar(e.id, { status: 'cancelada' })} />
                  </div>
                )}
                {e.status === 'chegou' && (
                  <div className="acoes-encomenda">
                    <a className="botao botao-secundario" href={linkWhatsApp(cliente?.whatsapp, mensagemChegou(cliente, e, linhaPorId))} target="_blank" rel="noreferrer"><Icone nome="conversa" tamanho={18} /> Avisar a cliente</a>
                    <button className="botao botao-principal" onClick={() => navegar(`/vender?encomenda=${e.id}`)}><Icone nome="vender" tamanho={18} /> Entregar e vender</button>
                    <button className="botao-link" onClick={() => mudar(e.id, { status: 'aguardando' })}>Ainda não chegou</button>
                  </div>
                )}
                {e.status === 'entregue' && e.vendas?.length > 0 && (
                  <p className="pequeno">Virou a venda nº {e.vendas.map((v) => v.numero).sort((a, b) => a - b).join(' e ')}.</p>
                )}
                {e.status === 'cancelada' && e.sinal_valor > 0 && (
                  <p className="pequeno texto-suave">Cancelada com sinal de {formatarMoeda(e.sinal_valor)}: combine a devolução com a cliente.</p>
                )}
                {permissoes.admin && e.status !== 'entregue' && (
                  <div className="excluir-discreto">
                    <BotaoPerigo texto="Excluir encomenda" aoConfirmar={() => excluir(e.id)} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {nova && <NovaEncomenda variacaoInicial={novaPara} aoFechar={() => { setNova(false); if (novaPara) setParams({}, { replace: true }) }} />}
    </div>
  )
}

function NovaEncomenda({ variacaoInicial, aoFechar }) {
  const { linhas } = useCatalogo()
  const { ativas, clientePorId, criarCliente, salvarEncomenda } = useClientes()
  const [clienteId, setClienteId] = useState(null)
  const [buscaCliente, setBuscaCliente] = useState('')
  const [cadastro, setCadastro] = useState(null)
  const [itens, setItens] = useState(() => (variacaoInicial ? [{ variacao_id: variacaoInicial, quantidade: 1 }] : []))
  const [livre, setLivre] = useState('')
  const [previsao, setPrevisao] = useState(paraISO(somarDias(new Date(), 7)))
  const [temSinal, setTemSinal] = useState(false)
  const [sinal, setSinal] = useState({ valor: '', forma: 'pix' })
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])
  const pecas = useMemo(() => linhas.filter((l) => l.ativo), [linhas])
  const cliente = clientePorId.get(clienteId)
  const encontrados = buscaCliente.trim() ? ativas.filter((c) => achaCliente(c, buscaCliente)).slice(0, 5) : []

  function adicionar(item) {
    setErro('')
    const r = juntarItem(itens, item)
    setItens(r.itens)
    if (r.erro) setErro(r.erro)
  }
  function mudarQuantidade(n, delta) {
    setItens(itens.map((x, j) => (j === n ? { ...x, quantidade: Math.min(x.quantidade + delta, LIMITE.quantidadeItem) } : x)).filter((x) => x.quantidade > 0))
  }
  function adicionarLivre() {
    const descricao = limparTexto(livre)
    if (descricao.length < 2) return
    adicionar({ descricao, quantidade: 1 })
    setLivre('')
  }

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    if (!clienteId && !cadastro) return setErro('Escolha a cliente: é para ela que o lembrete vai.')
    if (!itens.length) return setErro('Adicione pelo menos uma peça.')
    const erroPrevisao = erroData(previsao, { rotulo: 'a data prevista', min: hojeISO(), max: paraISO(somarDias(new Date(), 365)), obrigatoria: false })
    if (erroPrevisao) return setErro(`${erroPrevisao} Ela precisa ser de hoje até um ano para a frente.`)
    const valorSinal = temSinal ? lerValor(sinal.valor, { rotulo: 'o valor do sinal' }) : { valor: null }
    if (valorSinal.erro) return setErro(valorSinal.erro)

    let cliente_id = clienteId
    if (!cliente_id) {
      const r = montarCliente(cadastro, { hoje: hojeISO(), outras: ativas })
      if (r.erro) return setErro(r.erro)
      setSalvando(true)
      const criada = await criarCliente(r.cliente)
      setSalvando(false)
      if (criada.erro) return setErro(criada.erro)
      cliente_id = criada.data.id
      setClienteId(cliente_id); setCadastro(null) // se a encomenda falhar, a cliente já fica escolhida
    }

    setSalvando(true)
    const r = await salvarEncomenda({
      cliente_id, previsao: previsao || null, observacao: limparTexto(observacao),
      sinal_valor: temSinal ? valorSinal.valor : null, sinal_forma: temSinal ? sinal.forma : null,
      itens: itens.map((i) => (i.variacao_id ? { variacao_id: i.variacao_id, quantidade: i.quantidade } : { descricao: i.descricao, quantidade: i.quantidade })),
    })
    setSalvando(false)
    if (r.erro) return setErro(r.erro)
    aoFechar()
  }

  return (
    <Modal titulo="Nova encomenda" aoFechar={aoFechar} rodape={<><button className="botao botao-fantasma" onClick={aoFechar}>Cancelar</button><button className="botao botao-principal" form="form-encomenda" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar encomenda'}</button></>}>
      <form id="form-encomenda" className="formulario" onSubmit={salvar}>
        <div className="campo">
          <span>Cliente</span>
          {cliente ? (
            <div className="seletor-escolhido">
              <div><strong>{cliente.nome}</strong><small>{cliente.whatsapp ? formatarWhatsApp(cliente.whatsapp) : 'sem WhatsApp'}</small></div>
              <button type="button" className="botao-link" onClick={() => setClienteId(null)}>Trocar</button>
            </div>
          ) : cadastro ? (
            <div className="grade-campos">
              <label className="campo"><span>Nome</span><input value={cadastro.nome} onChange={(e) => setCadastro({ ...cadastro, nome: e.target.value })} maxLength={TAMANHO.nome} autoFocus /></label>
              <label className="campo"><span>WhatsApp</span><input inputMode="tel" value={cadastro.whatsapp} onChange={(e) => setCadastro({ ...cadastro, whatsapp: filtroTelefone(e.target.value) })} placeholder="(00) 00000-0000" /></label>
              <button type="button" className="botao-link" onClick={() => setCadastro(null)}>Cancelar cadastro</button>
            </div>
          ) : (
            <>
              <CampoBusca valor={buscaCliente} aoMudar={setBuscaCliente} placeholder="Nome ou WhatsApp da cliente" />
              {encontrados.length > 0 && (
                <ul className="lista-opcoes">
                  {encontrados.map((c) => <li key={c.id}><button type="button" onClick={() => { setClienteId(c.id); setBuscaCliente('') }}><span><strong>{c.nome}</strong><small>{c.whatsapp ? formatarWhatsApp(c.whatsapp) : 'sem WhatsApp'}</small></span></button></li>)}
                </ul>
              )}
              <button type="button" className="botao-link" onClick={() => setCadastro({ nome: /\d/.test(buscaCliente) ? '' : buscaCliente.slice(0, TAMANHO.nome), whatsapp: /\d/.test(buscaCliente) ? filtroTelefone(buscaCliente) : '' })}><Icone nome="somar" tamanho={16} /> Cadastro rápido</button>
            </>
          )}
        </div>

        <div className="campo">
          <span>Peças encomendadas</span>
          {itens.length > 0 && (
            <ul className="lista lista-compacta">
              {itens.map((i, n) => (
                <li key={i.variacao_id || `livre-${n}`} className="linha-lista">
                  <span>{textoItem(i, linhaPorId)}</span>
                  <span className="quantidade">
                    <button type="button" className="botao-icone" onClick={() => mudarQuantidade(n, -1)} aria-label="Diminuir"><Icone nome={i.quantidade === 1 ? 'lixo' : 'subtrair'} tamanho={16} /></button>
                    <span>{i.quantidade}</span>
                    <button type="button" className="botao-icone" onClick={() => mudarQuantidade(n, 1)} disabled={i.quantidade >= LIMITE.quantidadeItem} aria-label="Aumentar"><Icone nome="somar" tamanho={16} /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <SeletorVariacao escolhida={null} opcoes={pecas} aoEscolher={(l) => l && adicionar({ variacao_id: l.id, quantidade: 1 })} />
          <div className="linha-campos">
            <input className="campo-solto" value={livre} onChange={(e) => setLivre(e.target.value)} maxLength={TAMANHO.descricao} placeholder="Ou descreva uma peça que não está no catálogo" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionarLivre() } }} />
            <button type="button" className="botao botao-fantasma" onClick={adicionarLivre}>Adicionar</button>
          </div>
        </div>

        <div className="grade-campos">
          <label className="campo"><span>Quando deve chegar</span><input type="date" min={hojeISO()} max={paraISO(somarDias(new Date(), 365))} value={previsao} onChange={(e) => setPrevisao(e.target.value)} /></label>
          <label className="campo"><span>Observação (opcional)</span><input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={TAMANHO.observacao} placeholder="Ex.: pedir na Dália" /></label>
        </div>

        <label className="campo-check"><input type="checkbox" checked={temSinal} onChange={(e) => setTemSinal(e.target.checked)} /> A cliente pagou um sinal</label>
        {temSinal && (
          <div className="grade-campos">
            <label className="campo"><span>Valor do sinal</span><input inputMode="decimal" value={sinal.valor} onChange={(e) => setSinal({ ...sinal, valor: filtroDinheiro(e.target.value) })} /></label>
            <label className="campo"><span>Pago em</span>
              <select value={sinal.forma} onChange={(e) => setSinal({ ...sinal, forma: e.target.value })}>
                {Object.entries(FORMAS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
            </label>
          </div>
        )}
        {temSinal && <p className="texto-suave pequeno">Confira o valor: depois de salvo, o sinal não muda. Na entrega, ele já entra como pagamento da venda.</p>}
        <p className="texto-suave pequeno">A encomenda não mexe no estoque. Quando a peça chegar, dê entrada no Estoque normalmente: o sistema avisa que ela tem dona.</p>
        {erro && <Aviso tom="vinho">{erro}</Aviso>}
      </form>
    </Modal>
  )
}
