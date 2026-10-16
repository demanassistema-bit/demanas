import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDemo } from '../demo/DemoContext'
import { arred, formatarMoeda, formatarPercentual, lerMoeda, paraCampoMoeda, FORMAS_PAGAMENTO, CANAIS } from '../lib/moeda'
import { diasDesde } from '../lib/datas'
import { descontoPrecisaAprovacao, normalizar, percentual, taxaPagamento, totaisVenda } from '../demo/regras'
import Icone from '../components/Icone'
import { Aviso, buscarVariacoes, CampoBusca, Selo } from '../components/ui'

const vazio = () => ({ carrinho: [], etapa: 'itens', inicio: null })

export default function NovaVenda() {
  const demo = useDemo()
  const { dados, linhas, clientePorId, ehProprietaria, podeVerCustos, concluirVenda, criarCliente } = demo
  const config = dados.config

  const [estado, setEstado] = useState(vazio)
  const { carrinho, etapa } = estado
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')

  // pagamento
  const [clienteId, setClienteId] = useState(null)
  const [buscaCliente, setBuscaCliente] = useState('')
  const [cadastro, setCadastro] = useState(null) // { nome, whatsapp } quando aberto
  const [canal, setCanal] = useState('loja')
  const [descontoTexto, setDescontoTexto] = useState('')
  const [descontoModo, setDescontoModo] = useState('reais')
  const [aprovado, setAprovado] = useState(false)
  const [pagamentos, setPagamentos] = useState([{ forma: 'pix', valorTexto: '', parcelas: 1 }])
  const [recebido, setRecebido] = useState('')
  const [resultado, setResultado] = useState(null)

  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])
  const resultados = useMemo(() => buscarVariacoes(linhas.filter((l) => l.ativo), busca), [linhas, busca])

  // Atalhos: o que mais vendeu nos últimos 30 dias e ainda tem em estoque
  const atalhos = useMemo(() => {
    const contagem = new Map()
    for (const v of dados.vendas) {
      if (v.status !== 'concluida' || diasDesde(v.data) > 30) continue
      for (const i of v.itens) contagem.set(i.variacao_id, (contagem.get(i.variacao_id) || 0) + i.quantidade)
    }
    return [...contagem.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => linhaPorId.get(id))
      .filter((l) => l && l.saldo > 0)
      .slice(0, 6)
  }, [dados.vendas, linhaPorId])

  const itens = carrinho.map((c) => ({ ...c, linha: linhaPorId.get(c.variacao_id) }))
  const pecas = itens.reduce((s, i) => s + i.quantidade, 0)
  const textoPecas = `${pecas} ${pecas === 1 ? 'peça' : 'peças'}`
  const subtotal = totaisVenda(itens.map((i) => ({ preco: i.linha.preco, quantidade: i.quantidade }))).subtotal
  const descontoDigitado = lerMoeda(descontoTexto) || 0
  const descontoReais = descontoModo === 'percentual' ? arred((subtotal * descontoDigitado) / 100) : descontoDigitado
  const { desconto, total } = totaisVenda(itens.map((i) => ({ preco: i.linha.preco, quantidade: i.quantidade })), descontoReais)
  const precisaAprovacao = descontoPrecisaAprovacao(subtotal, desconto, config.limiteDescontoVendedora, ehProprietaria) && !aprovado

  // Com uma forma só, o valor é o total (pagamento em um toque)
  const pagamentosFinais = pagamentos.length === 1
    ? [{ ...pagamentos[0], valor: total }]
    : pagamentos.map((p) => ({ ...p, valor: lerMoeda(p.valorTexto) || 0 }))
  const somaPagamentos = arred(pagamentosFinais.reduce((s, p) => s + p.valor, 0))
  const falta = arred(total - somaPagamentos)
  const taxaTotal = arred(pagamentosFinais.reduce((s, p) => s + taxaPagamento(p, config.taxas), 0))

  function adicionar(linha) {
    setErro('')
    const atual = carrinho.find((c) => c.variacao_id === linha.id)
    const qtd = (atual?.quantidade || 0) + 1
    if (!config.permitirEstoqueNegativo && qtd > linha.saldo) {
      setErro(linha.saldo <= 0 ? `${linha.produto.nome} (${linha.nomeVariacao}) está sem estoque.` : `Só há ${linha.saldo} em estoque de ${linha.nomeVariacao}.`)
      return
    }
    setEstado((e) => ({
      ...e,
      inicio: e.inicio || Date.now(),
      carrinho: atual
        ? e.carrinho.map((c) => (c.variacao_id === linha.id ? { ...c, quantidade: qtd } : c))
        : [...e.carrinho, { variacao_id: linha.id, quantidade: 1 }],
    }))
    setBusca('')
  }

  function mudarQuantidade(variacaoId, delta) {
    setErro('')
    const linha = linhaPorId.get(variacaoId)
    setEstado((e) => ({
      ...e,
      carrinho: e.carrinho
        .map((c) => {
          if (c.variacao_id !== variacaoId) return c
          const qtd = c.quantidade + delta
          if (delta > 0 && !config.permitirEstoqueNegativo && qtd > linha.saldo) {
            setErro(`Só há ${linha.saldo} em estoque de ${linha.nomeVariacao}.`)
            return c
          }
          return { ...c, quantidade: qtd }
        })
        .filter((c) => c.quantidade > 0),
    }))
  }

  function irParaPagamento() {
    setErro('')
    setPagamentos([{ forma: pagamentos[0].forma, valorTexto: '', parcelas: 1 }])
    setEstado((e) => ({ ...e, etapa: 'pagamento' }))
  }

  function dividir() {
    const primeiro = arred(total / 2)
    setPagamentos([
      { ...pagamentos[0], valorTexto: paraCampoMoeda(primeiro) },
      { forma: pagamentos[0].forma === 'pix' ? 'cartao_credito' : 'pix', valorTexto: paraCampoMoeda(arred(total - primeiro)), parcelas: 1 },
    ])
  }

  function mudarPagamento(indice, campos) {
    setPagamentos((lista) => lista.map((p, i) => (i === indice ? { ...p, ...campos } : p)))
  }

  function concluir() {
    setErro('')
    if (falta !== 0) return setErro('A soma das formas de pagamento precisa ser igual ao total.')
    let cliente_id = clienteId
    if (cadastro?.nome?.trim()) cliente_id = criarCliente({ nome: cadastro.nome.trim(), whatsapp: cadastro.whatsapp.trim() })
    const r = concluirVenda({
      itens: carrinho, desconto,
      pagamentos: pagamentosFinais.map(({ forma, valor, parcelas }) => ({ forma, valor, parcelas: forma === 'cartao_credito' ? parcelas : 1 })),
      cliente_id, canal,
    })
    if (r.erro) return setErro(r.erro)
    setResultado({ venda: r.venda, segundos: Math.max(1, Math.round((Date.now() - estado.inicio) / 1000)) })
    setEstado((e) => ({ ...e, etapa: 'concluida' }))
  }

  function novaVenda() {
    setEstado(vazio())
    setClienteId(null); setBuscaCliente(''); setCadastro(null); setCanal('loja')
    setDescontoTexto(''); setDescontoModo('reais'); setAprovado(false)
    setPagamentos([{ forma: 'pix', valorTexto: '', parcelas: 1 }]); setRecebido(''); setResultado(null); setErro('')
  }

  // ---------------- Concluída ----------------
  if (etapa === 'concluida' && resultado) {
    const venda = dados.vendas.find((v) => v.id === resultado.venda.id) || resultado.venda
    const cliente = clientePorId.get(venda.cliente_id)
    const recibo = [
      `deMana's · recibo da compra nº ${venda.numero}`,
      ...venda.itens.map((i) => {
        const l = linhaPorId.get(i.variacao_id)
        return `${i.quantidade}x ${l.produto.nome} (${l.nomeVariacao}) ${formatarMoeda(i.preco_unitario * i.quantidade)}`
      }),
      venda.desconto > 0 ? `Desconto: ${formatarMoeda(venda.desconto)}` : null,
      `Total: ${formatarMoeda(venda.total)}`,
      'Obrigada pela preferência! 🌹',
    ].filter(Boolean).join('\n')
    const numero = cliente?.whatsapp?.replace(/\D/g, '')
    const linkWhats = `https://wa.me/${numero ? `55${numero}` : ''}?text=${encodeURIComponent(recibo)}`

    return (
      <div className="pagina pagina-estreita">
        <div className="cartao concluida">
          <span className="concluida-icone"><Icone nome="confirmar" tamanho={36} /></span>
          <h1>Venda nº {venda.numero} concluída</h1>
          <p className="concluida-total">{formatarMoeda(venda.total)}</p>
          <p className="texto-suave"><Icone nome="relogio" tamanho={16} /> registrada em {resultado.segundos} segundos {resultado.segundos <= 30 ? '· dentro da meta de 30 s' : ''}</p>
          <div className="nota-status">
            {venda.nota.status === 'enviando'
              ? <><span className="pulso" /> Emitindo a nota em segundo plano…</>
              : <><Icone nome="fiscal" tamanho={18} /> Nota emitida <Selo tom="ambar">ambiente de teste</Selo></>}
          </div>
          <p className="texto-suave pequeno">A cliente não espera a nota: a venda já está registrada e o estoque já foi baixado.</p>
          <div className="acoes-coluna">
            <a href={linkWhats} target="_blank" rel="noreferrer" className="botao botao-secundario botao-grande"><Icone nome="conversa" /> Enviar recibo por WhatsApp</a>
            <button className="botao botao-principal botao-grande" onClick={novaVenda}><Icone nome="somar" /> Nova venda</button>
          </div>
        </div>
      </div>
    )
  }

  // ---------------- Pagamento ----------------
  if (etapa === 'pagamento') {
    const clientesEncontrados = buscaCliente.trim()
      ? dados.clientes.filter((c) => normalizar(`${c.nome} ${c.whatsapp}`).includes(normalizar(buscaCliente))).slice(0, 5)
      : []
    const cliente = clientePorId.get(clienteId)
    const formas = Object.entries(FORMAS_PAGAMENTO).filter(([f]) => f !== 'crediario' || config.aceitaCrediario)
    const dinheiroUnico = pagamentos.length === 1 && pagamentos[0].forma === 'dinheiro'
    const troco = dinheiroUnico && lerMoeda(recebido) ? arred(lerMoeda(recebido) - total) : null

    return (
      <div className="pagina pagina-estreita com-rodape-fixo">
        <button className="botao-link voltar" onClick={() => setEstado((e) => ({ ...e, etapa: 'itens' }))}><Icone nome="voltar" tamanho={18} /> Voltar aos itens</button>
        <header className="pagina-topo"><h1>Pagamento</h1></header>

        <section className="cartao secao">
          <h2>Cliente <small className="texto-suave">(opcional)</small></h2>
          {cliente ? (
            <div className="seletor-escolhido">
              <div><strong>{cliente.nome}</strong><small>{cliente.whatsapp}</small></div>
              <button className="botao-link" onClick={() => setClienteId(null)}>Trocar</button>
            </div>
          ) : cadastro ? (
            <div className="grade-campos">
              <label className="campo"><span>Nome</span><input value={cadastro.nome} onChange={(e) => setCadastro({ ...cadastro, nome: e.target.value })} autoFocus /></label>
              <label className="campo"><span>WhatsApp</span><input inputMode="tel" value={cadastro.whatsapp} onChange={(e) => setCadastro({ ...cadastro, whatsapp: e.target.value })} placeholder="(00) 00000-0000" /></label>
              <button className="botao-link" onClick={() => setCadastro(null)}>Cancelar cadastro</button>
            </div>
          ) : (
            <>
              <CampoBusca valor={buscaCliente} aoMudar={setBuscaCliente} placeholder="Nome ou WhatsApp da cliente" />
              {clientesEncontrados.length > 0 && (
                <ul className="lista-opcoes">
                  {clientesEncontrados.map((c) => (
                    <li key={c.id}><button onClick={() => { setClienteId(c.id); setBuscaCliente('') }}><span><strong>{c.nome}</strong><small>{c.whatsapp}</small></span></button></li>
                  ))}
                </ul>
              )}
              <button className="botao-link" onClick={() => setCadastro({ nome: buscaCliente, whatsapp: '' })}><Icone nome="somar" tamanho={16} /> Cadastro rápido</button>
            </>
          )}
        </section>

        <section className="cartao secao">
          <h2>Onde foi a venda</h2>
          <div className="segmentado">
            {Object.entries(CANAIS).map(([chave, nome]) => (
              <button key={chave} className={canal === chave ? 'ativo' : ''} onClick={() => setCanal(chave)}>{nome}</button>
            ))}
          </div>
        </section>

        <section className="cartao secao">
          <h2>Desconto</h2>
          <div className="linha-campos">
            <div className="segmentado compacto">
              <button className={descontoModo === 'reais' ? 'ativo' : ''} onClick={() => setDescontoModo('reais')}>R$</button>
              <button className={descontoModo === 'percentual' ? 'ativo' : ''} onClick={() => setDescontoModo('percentual')}>%</button>
            </div>
            <input className="campo-solto" inputMode="decimal" placeholder="0" value={descontoTexto} onChange={(e) => { setDescontoTexto(e.target.value); setAprovado(false) }} aria-label="Desconto" />
          </div>
          {desconto > 0 && <p className="texto-suave pequeno">{formatarMoeda(desconto)} · {formatarPercentual(percentual(desconto, subtotal))} do valor</p>}
          {!ehProprietaria && <p className="texto-suave pequeno">Seu limite de desconto: {config.limiteDescontoVendedora}%</p>}
          {precisaAprovacao && (
            <Aviso tom="vinho">
              Desconto acima do limite. Precisa da aprovação da proprietária.{' '}
              <button className="botao-link" onClick={() => setAprovado(true)}>Proprietária aprovou</button>
              <br /><small>Na versão real, ela confirma com a senha dela.</small>
            </Aviso>
          )}
        </section>

        <section className="cartao secao">
          <h2>Forma de pagamento</h2>
          {pagamentos.map((p, i) => (
            <div key={i} className="pagamento-linha">
              <div className="formas">
                {formas.map(([chave, nome]) => (
                  <button key={chave} className={`forma ${p.forma === chave ? 'ativo' : ''}`} onClick={() => mudarPagamento(i, { forma: chave })}>{nome}</button>
                ))}
              </div>
              <div className="linha-campos">
                {pagamentos.length > 1 && (
                  <input className="campo-solto" inputMode="decimal" value={p.valorTexto} onChange={(e) => mudarPagamento(i, { valorTexto: e.target.value })} aria-label="Valor" />
                )}
                {p.forma === 'cartao_credito' && (
                  <select className="campo-solto" value={p.parcelas} onChange={(e) => mudarPagamento(i, { parcelas: Number(e.target.value) })} aria-label="Parcelas">
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 1 ? 'À vista' : `${n}x de ${formatarMoeda(arred(pagamentosFinais[i].valor / n))}`}</option>)}
                  </select>
                )}
              </div>
            </div>
          ))}
          {dinheiroUnico && (
            <div className="linha-campos">
              <label className="campo"><span>Valor recebido</span><input inputMode="decimal" value={recebido} onChange={(e) => setRecebido(e.target.value)} placeholder={paraCampoMoeda(total)} /></label>
              {troco != null && troco >= 0 && <p className="troco">Troco: <strong>{formatarMoeda(troco)}</strong></p>}
            </div>
          )}
          {pagamentos.length === 1
            ? <button className="botao-link" onClick={dividir}><Icone nome="somar" tamanho={16} /> Dividir em duas formas</button>
            : <button className="botao-link" onClick={() => setPagamentos([{ ...pagamentos[0], valorTexto: '' }])}>Voltar para uma forma só</button>}
          {pagamentos.length > 1 && falta !== 0 && <p className="texto-alerta pequeno">{falta > 0 ? `Faltam ${formatarMoeda(falta)}` : `Passou ${formatarMoeda(-falta)} do total`}</p>}
          {podeVerCustos && taxaTotal > 0 && <p className="texto-suave pequeno">Taxa estimada da maquininha: {formatarMoeda(taxaTotal)}</p>}
        </section>

        {erro && <Aviso tom="vinho">{erro}</Aviso>}

        <footer className="rodape-fixo">
          <div className="rodape-total">
            <small>{desconto > 0 ? `${formatarMoeda(subtotal)} − ${formatarMoeda(desconto)}` : textoPecas}</small>
            <strong>{formatarMoeda(total)}</strong>
          </div>
          <button className="botao botao-principal botao-grande" disabled={precisaAprovacao || falta !== 0} onClick={concluir}>
            <Icone nome="confirmar" /> Concluir venda
          </button>
        </footer>
      </div>
    )
  }

  // ---------------- Itens ----------------
  return (
    <div className="pagina pagina-estreita com-rodape-fixo">
      <header className="pagina-topo"><h1>Nova venda</h1></header>

      <div className="busca-venda">
        <CampoBusca grande valor={busca} aoMudar={setBusca} placeholder="Buscar produto, cor, tamanho ou código" autoFocus />
        <button className="botao-icone botao-camera" title="Ler código de barras" aria-label="Ler código de barras pela câmera" onClick={() => setErro('Na versão real, este botão abre a câmera do celular para ler o código de barras.')}>
          <Icone nome="camera" />
        </button>
      </div>

      {busca.trim() ? (
        <ul className="lista-opcoes resultados-venda">
          {resultados.length === 0 && <li className="texto-suave recuo">Nada encontrado para "{busca}".</li>}
          {resultados.map((l) => (
            <li key={l.id}>
              <button onClick={() => adicionar(l)} disabled={!config.permitirEstoqueNegativo && l.saldo <= 0}>
                <span><strong>{l.produto.nome}</strong><small>{l.nomeVariacao}</small></span>
                <span className="resultado-direita">
                  <strong>{formatarMoeda(l.preco)}</strong>
                  <small className={l.saldo <= 0 ? 'texto-alerta' : 'texto-suave'}>{l.saldo <= 0 ? 'sem estoque' : `${l.saldo} em estoque`}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : carrinho.length === 0 && (
        <section className="atalhos">
          <h2 className="texto-suave pequeno">Mais vendidos · toque para adicionar</h2>
          <div className="grade-atalhos">
            {atalhos.map((l) => (
              <button key={l.id} className="cartao atalho" onClick={() => adicionar(l)}>
                <strong>{l.produto.nome}</strong>
                <small>{l.nomeVariacao}</small>
                <span>{formatarMoeda(l.preco)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {erro && <Aviso tom="vinho">{erro}</Aviso>}

      {itens.length > 0 && (
        <section className="cartao carrinho">
          {itens.map((i) => (
            <div key={i.variacao_id} className="item-carrinho">
              <div className="item-nome">
                <strong>{i.linha.produto.nome}</strong>
                <small>{i.linha.nomeVariacao} · {formatarMoeda(i.linha.preco)}</small>
              </div>
              <div className="quantidade">
                <button className="botao-icone" onClick={() => mudarQuantidade(i.variacao_id, -1)} aria-label="Diminuir"><Icone nome={i.quantidade === 1 ? 'lixo' : 'subtrair'} tamanho={18} /></button>
                <span>{i.quantidade}</span>
                <button className="botao-icone" onClick={() => mudarQuantidade(i.variacao_id, 1)} aria-label="Aumentar"><Icone nome="somar" tamanho={18} /></button>
              </div>
              <strong className="item-total">{formatarMoeda(arred(i.linha.preco * i.quantidade))}</strong>
            </div>
          ))}
        </section>
      )}

      {itens.length > 0 && (
        <footer className="rodape-fixo">
          <div className="rodape-total">
            <small>{textoPecas}</small>
            <strong>{formatarMoeda(subtotal)}</strong>
          </div>
          <button className="botao botao-principal botao-grande" onClick={irParaPagamento}>Pagamento <Icone nome="seguir" /></button>
        </footer>
      )}
      {itens.length === 0 && !busca && <p className="texto-suave pequeno recuo">Dica: digite parte do nome e a cor, por exemplo "aurora preto 42".</p>}
      <p className="texto-suave pequeno recuo"><Link to="/vendas">Ver vendas anteriores</Link></p>
    </div>
  )
}
