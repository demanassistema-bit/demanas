import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useDemo } from '../demo/DemoContext'
import { formatarMoeda, FORMAS_PAGAMENTO } from '../lib/moeda'
import { formatarData, hojeISO, paraISO, somarDias } from '../lib/datas'
import { erroData, erroWhatsApp, filtroDinheiro, filtroTelefone, formatarWhatsApp, LIMITE, lerValor, limparTexto, linkWhatsApp as linkDoNumero, TAMANHO } from '../lib/limites'
import { normalizar, situacaoEncomenda } from '../demo/regras'
import Modal, { BotaoPerigo } from '../components/Modal'
import Icone from '../components/Icone'
import { Aviso, CampoBusca, Selo, SeletorVariacao, Vazio } from '../components/ui'

const FILTROS = { abertas: 'Em aberto', atrasadas: 'Atrasadas', chegou: 'Chegaram', entregue: 'Entregues', cancelada: 'Canceladas' }

// Texto de um item da encomenda (do catálogo ou descrito à mão)
export function textoItem(item, linhaPorId) {
  if (item.descricao) return `${item.quantidade}x ${item.descricao}`
  const l = linhaPorId.get(item.variacao_id)
  return l ? `${item.quantidade}x ${l.produto.nome} (${l.nomeVariacao})` : `${item.quantidade}x peça`
}

export function mensagemChegou(cliente, encomenda, linhaPorId) {
  const nome = cliente?.nome.split(' ')[0] || ''
  const itens = encomenda.itens.map((i) => textoItem(i, linhaPorId)).join(', ')
  return `Oi, ${nome}! Sua encomenda chegou aqui na deMana's: ${itens}. 🌹 Quando quer vir buscar?`
}

export function linkWhatsApp(cliente, texto) {
  return linkDoNumero(cliente?.whatsapp, texto)
}

export default function Encomendas() {
  const { dados, linhas, clientePorId, atualizarEncomenda, excluirEncomenda, ehProprietaria } = useDemo()
  const [params, setParams] = useSearchParams()
  const navegar = useNavigate()
  const filtro = params.get('filtro') || 'abertas'
  const novaPara = params.get('nova') // variação vinda da Nova venda
  const [nova, setNova] = useState(Boolean(novaPara))
  const [datas, setDatas] = useState({})
  const hoje = hojeISO()
  const limiteData = paraISO(somarDias(new Date(), 365))
  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])
  const encomendas = dados.encomendas || []

  const lista = encomendas
    .filter((e) => {
      if (filtro === 'abertas') return e.status === 'aguardando' || e.status === 'chegou'
      if (filtro === 'atrasadas') return e.status === 'aguardando' && e.previsao && e.previsao < hoje
      return e.status === filtro
    })
    // as que chegaram (avisar a cliente) primeiro, depois pela data prevista
    .sort((a, b) => (b.status === 'chegou') - (a.status === 'chegou') || (a.previsao || '9999').localeCompare(b.previsao || '9999'))
  const conta = (f) => encomendas.filter((e) => (f === 'atrasadas' ? e.status === 'aguardando' && e.previsao && e.previsao < hoje : f === 'abertas' ? ['aguardando', 'chegou'].includes(e.status) : e.status === f)).length

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
        {Object.entries(FILTROS).map(([k, n]) => (
          <button key={k} className={`ficha ${filtro === k ? 'ativo' : ''}`} onClick={() => setParams({ filtro: k }, { replace: true })}>{n} ({conta(k)})</button>
        ))}
      </div>

      {lista.length === 0 ? <Vazio icone="relogio" titulo="Nenhuma encomenda aqui" /> : (
        <ul className="lista-encomendas">
          {lista.map((e) => {
            const cliente = clientePorId.get(e.cliente_id)
            const sit = situacaoEncomenda(e, hoje)
            return (
              <li key={e.id} className="cartao encomenda">
                <header className="bloco-topo">
                  <Link to={`/clientes/${e.cliente_id}`} className="encomenda-cliente">{cliente?.nome || 'Cliente'}</Link>
                  <Selo tom={sit.tom}>{sit.texto}</Selo>
                </header>
                <ul className="lista-simples">
                  {e.itens.map((i, n) => <li key={n}>{textoItem(i, linhaPorId)}{i.descricao && <small className="texto-suave"> · fora do catálogo</small>}</li>)}
                </ul>
                <p className="texto-suave pequeno">
                  {e.previsao ? `Previsão: ${formatarData(e.previsao)}` : 'Sem data prevista'}
                  {e.sinal?.valor > 0 && ` · sinal de ${formatarMoeda(e.sinal.valor)} (${FORMAS_PAGAMENTO[e.sinal.forma]})`}
                  {e.observacao && ` · ${e.observacao}`}
                </p>

                {e.status === 'aguardando' && (
                  <div className="acoes-encomenda">
                    <button className="botao botao-secundario" onClick={() => atualizarEncomenda(e.id, { status: 'chegou', chegou_em: hoje })}><Icone nome="confirmar" tamanho={18} /> Chegou</button>
                    <label className="campo-data">
                      <span className="texto-suave pequeno">Nova data</span>
                      <input type="date" value={datas[e.id] ?? e.previsao ?? ''} min={hoje} max={limiteData} onChange={(ev) => { setDatas({ ...datas, [e.id]: ev.target.value }); if (!erroData(ev.target.value, { min: hoje, max: limiteData })) atualizarEncomenda(e.id, { previsao: ev.target.value }) }} />
                    </label>
                    <BotaoPerigo texto="Cancelar" aoConfirmar={() => atualizarEncomenda(e.id, { status: 'cancelada', cancelada_em: hoje })} />
                  </div>
                )}
                {e.status === 'chegou' && (
                  <div className="acoes-encomenda">
                    <a className="botao botao-secundario" href={linkWhatsApp(cliente, mensagemChegou(cliente, e, linhaPorId))} target="_blank" rel="noreferrer"><Icone nome="conversa" tamanho={18} /> Avisar a cliente</a>
                    <button className="botao botao-principal" onClick={() => navegar(`/vender?encomenda=${e.id}`)}><Icone nome="vender" tamanho={18} /> Entregar e vender</button>
                  </div>
                )}
                {e.status === 'entregue' && e.vendas?.length > 0 && (
                  <p className="pequeno">Virou a venda nº {e.vendas.map((id) => dados.vendas.find((v) => v.id === id)?.numero).filter(Boolean).join(' e ')}.</p>
                )}
                {ehProprietaria && (
                  <div className="excluir-discreto">
                    <BotaoPerigo texto="Excluir encomenda" aoConfirmar={() => excluirEncomenda(e.id)} />
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
  const { dados, linhas, criarCliente, criarEncomenda } = useDemo()
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
  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])
  const cliente = dados.clientes.find((c) => c.id === clienteId)
  const encontrados = buscaCliente.trim()
    ? dados.clientes.filter((c) => !c.removida && normalizar(`${c.nome} ${c.whatsapp}`).includes(normalizar(buscaCliente))).slice(0, 5)
    : []

  const cheio = itens.length >= LIMITE.itensEncomenda
  function adicionar(item) {
    setErro('')
    // a mesma peça do catálogo soma na quantidade, em vez de repetir a linha
    const igual = item.variacao_id ? itens.findIndex((x) => x.variacao_id === item.variacao_id) : -1
    if (igual >= 0) return mudarQuantidade(igual, 1)
    if (cheio) return setErro(`Até ${LIMITE.itensEncomenda} peças diferentes por encomenda. Faça outra encomenda para o resto.`)
    setItens([...itens, item])
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

  function salvar(e) {
    e.preventDefault()
    const nomeNovo = limparTexto(cadastro?.nome)
    if (!clienteId && !nomeNovo) return setErro('Escolha a cliente: é para ela que o lembrete vai.')
    if (!clienteId) {
      const erroCadastro = nomeNovo.length < 2 ? 'Informe o nome da cliente.' : erroWhatsApp(dados.clientes, cadastro.whatsapp)
      if (erroCadastro) return setErro(erroCadastro)
    }
    if (!itens.length) return setErro('Adicione pelo menos uma peça.')
    const erroPrevisao = erroData(previsao, { rotulo: 'a data prevista', min: hojeISO(), max: paraISO(somarDias(new Date(), 365)), obrigatoria: false })
    if (erroPrevisao) return setErro(`${erroPrevisao} Ela precisa ser de hoje até um ano para a frente.`)
    const valorSinal = temSinal ? lerValor(sinal.valor, { rotulo: 'o valor do sinal' }) : { valor: null }
    if (valorSinal.erro) return setErro(valorSinal.erro)
    const cliente_id = clienteId || criarCliente({ nome: nomeNovo, whatsapp: formatarWhatsApp(cadastro.whatsapp) })
    criarEncomenda({
      cliente_id, itens, previsao, observacao: limparTexto(observacao),
      sinal: temSinal ? { valor: valorSinal.valor, forma: sinal.forma } : null,
    })
    aoFechar()
  }

  return (
    <Modal titulo="Nova encomenda" aoFechar={aoFechar} rodape={<><button className="botao botao-fantasma" onClick={aoFechar}>Cancelar</button><button className="botao botao-principal" form="form-encomenda">Salvar encomenda</button></>}>
      <form id="form-encomenda" className="formulario" onSubmit={salvar}>
        <div className="campo">
          <span>Cliente</span>
          {cliente ? (
            <div className="seletor-escolhido">
              <div><strong>{cliente.nome}</strong><small>{cliente.whatsapp}</small></div>
              <button type="button" className="botao-link" onClick={() => setClienteId(null)}>Trocar</button>
            </div>
          ) : cadastro ? (
            <div className="grade-campos">
              <label className="campo"><span>Nome</span><input value={cadastro.nome} onChange={(e) => setCadastro({ ...cadastro, nome: e.target.value })} maxLength={TAMANHO.nome} autoFocus /></label>
              <label className="campo"><span>WhatsApp</span><input inputMode="tel" value={cadastro.whatsapp} onChange={(e) => setCadastro({ ...cadastro, whatsapp: filtroTelefone(e.target.value) })} placeholder="(00) 00000-0000" /></label>
            </div>
          ) : (
            <>
              <CampoBusca valor={buscaCliente} aoMudar={setBuscaCliente} placeholder="Nome ou WhatsApp da cliente" />
              {encontrados.length > 0 && (
                <ul className="lista-opcoes">
                  {encontrados.map((c) => <li key={c.id}><button type="button" onClick={() => { setClienteId(c.id); setBuscaCliente('') }}><span><strong>{c.nome}</strong><small>{c.whatsapp}</small></span></button></li>)}
                </ul>
              )}
              <button type="button" className="botao-link" onClick={() => setCadastro({ nome: buscaCliente.slice(0, TAMANHO.nome), whatsapp: '' })}><Icone nome="somar" tamanho={16} /> Cadastro rápido</button>
            </>
          )}
        </div>

        <div className="campo">
          <span>Peças encomendadas</span>
          {itens.length > 0 && (
            <ul className="lista lista-compacta">
              {itens.map((i, n) => (
                <li key={n} className="linha-lista">
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
          <SeletorVariacao escolhida={null} aoEscolher={(l) => l && adicionar({ variacao_id: l.id, quantidade: 1 })} />
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
                {Object.entries(FORMAS_PAGAMENTO).filter(([k]) => k !== 'crediario').map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
            </label>
          </div>
        )}
        <p className="texto-suave pequeno">A encomenda não mexe no estoque. Quando a peça chegar, dê entrada no Estoque normalmente: o sistema avisa que ela tem dona.</p>
        {erro && <Aviso tom="vinho">{erro}</Aviso>}
      </form>
    </Modal>
  )
}
