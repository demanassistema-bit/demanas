import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useDemo } from '../demo/DemoContext'
import { arred, formatarMoeda, formatarPercentual, lerMoeda, paraCampoMoeda, FORMAS_PAGAMENTO, CANAIS } from '../lib/moeda'
import { diasDesde } from '../lib/datas'
import { erroWhatsApp, filtroDinheiro, filtroPercentual, filtroTelefone, formatarWhatsApp, LIMITE, limparTexto, linkWhatsApp, TAMANHO } from '../lib/limites'
import { descontoPrecisaAprovacao, dividirDesconto, emiteNota, normalizar, percentual, taxaPagamento, taxasDe, totaisVenda } from '../demo/regras'
import Icone from '../components/Icone'
import { Aviso, buscarVariacoes, CampoBusca, Selo } from '../components/ui'

const vazio = () => ({ carrinho: [], etapa: 'itens', inicio: null })
const pagamentoInicial = () => [{ forma: 'pix', valorTexto: '', parcelas: 1 }]

// Pagamento de uma parte da venda (um CNPJ = uma maquininha)
function BlocoPagamento({ titulo, subtitulo, total, pagamentos, setPagamentos, formas, taxas, podeVerCustos }) {
  const [recebido, setRecebido] = useState('')
  const finais = pagamentos.length === 1
    ? [{ ...pagamentos[0], valor: total }]
    : pagamentos.map((p) => ({ ...p, valor: lerMoeda(p.valorTexto) || 0 }))
  const falta = arred(total - finais.reduce((s, p) => s + p.valor, 0))
  const taxa = arred(finais.reduce((s, p) => s + taxaPagamento(p, taxas), 0))
  const dinheiroUnico = pagamentos.length === 1 && pagamentos[0].forma === 'dinheiro'
  const troco = dinheiroUnico && lerMoeda(recebido) ? arred(lerMoeda(recebido) - total) : null
  const mudar = (i, campos) => setPagamentos(pagamentos.map((p, j) => (j === i ? { ...p, ...campos } : p)))

  function dividir() {
    const primeiro = arred(total / 2)
    setPagamentos([
      { ...pagamentos[0], valorTexto: paraCampoMoeda(primeiro) },
      { forma: pagamentos[0].forma === 'pix' ? 'cartao_credito' : 'pix', valorTexto: paraCampoMoeda(arred(total - primeiro)), parcelas: 1 },
    ])
  }

  return (
    <section className="cartao secao">
      <header className="bloco-topo">
        <h2>{titulo}</h2>
        <strong>{formatarMoeda(total)}</strong>
      </header>
      {subtitulo && <p className="texto-suave pequeno">{subtitulo}</p>}
      {pagamentos.map((p, i) => (
        <div key={i} className="pagamento-linha">
          {p.sinal && <small className="texto-positivo">Sinal já pago na encomenda</small>}
          <div className="formas">
            {formas.map(([chave, nome]) => (
              <button key={chave} className={`forma ${p.forma === chave ? 'ativo' : ''}`} onClick={() => mudar(i, { forma: chave })}>{nome}</button>
            ))}
          </div>
          <div className="linha-campos">
            {pagamentos.length > 1 && (
              <input className="campo-solto" inputMode="decimal" value={p.valorTexto} onChange={(e) => mudar(i, { valorTexto: filtroDinheiro(e.target.value) })} aria-label="Valor" />
            )}
            {p.forma === 'cartao_credito' && (
              <select className="campo-solto" value={p.parcelas} onChange={(e) => mudar(i, { parcelas: Number(e.target.value) })} aria-label="Parcelas">
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 1 ? 'À vista' : `${n}x de ${formatarMoeda(arred(finais[i].valor / n))}`}</option>)}
              </select>
            )}
          </div>
        </div>
      ))}
      {dinheiroUnico && (
        <div className="linha-campos">
          <label className="campo"><span>Valor recebido</span><input inputMode="decimal" value={recebido} onChange={(e) => setRecebido(filtroDinheiro(e.target.value))} placeholder={paraCampoMoeda(total)} /></label>
          {troco != null && (troco >= 0
            ? <p className="troco">Troco: <strong>{formatarMoeda(troco)}</strong></p>
            : <p className="texto-alerta pequeno">Recebeu menos que o total: faltam {formatarMoeda(-troco)}</p>)}
        </div>
      )}
      {pagamentos.length === 1
        ? <button className="botao-link" onClick={dividir}><Icone nome="somar" tamanho={16} /> Dividir em duas formas</button>
        : <button className="botao-link" onClick={() => setPagamentos([{ ...pagamentos[0], valorTexto: '' }])}>Voltar para uma forma só</button>}
      {pagamentos.length > 1 && falta !== 0 && <p className="texto-alerta pequeno">{falta > 0 ? `Faltam ${formatarMoeda(falta)}` : `Passou ${formatarMoeda(-falta)} do total`}</p>}
      {podeVerCustos && taxa > 0 && <p className="texto-suave pequeno">Taxa estimada da maquininha: {formatarMoeda(taxa)}</p>}
    </section>
  )
}

export function valoresPagamento(pagamentos, total) {
  return pagamentos.length === 1
    ? [{ forma: pagamentos[0].forma, valor: total, parcelas: pagamentos[0].parcelas }]
    : pagamentos.map((p) => ({ forma: p.forma, valor: lerMoeda(p.valorTexto) || 0, parcelas: p.parcelas }))
}

export default function NovaVenda() {
  const { dados, linhas, clientePorId, ehProprietaria, podeVerCustos, concluirVenda, criarCliente, atualizarEncomenda } = useDemo()
  const config = dados.config
  const empresas = config.empresas

  // Entrega de encomenda: a venda já abre com as peças e a cliente
  const [params] = useSearchParams()
  const [encomenda, setEncomenda] = useState(() => (dados.encomendas || []).find((e) => e.id === params.get('encomenda') && e.status !== 'entregue') || null)
  const [estado, setEstado] = useState(() => (encomenda
    ? { carrinho: encomenda.itens.filter((i) => i.variacao_id).map(({ variacao_id, quantidade }) => ({ variacao_id, quantidade })), etapa: 'itens', inicio: Date.now() }
    : vazio()))
  const { carrinho, etapa } = estado
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')

  // pagamento
  const [clienteId, setClienteId] = useState(encomenda?.cliente_id || null)
  const [buscaCliente, setBuscaCliente] = useState('')
  const [cadastro, setCadastro] = useState(null) // { nome, whatsapp } quando aberto
  const [canal, setCanal] = useState('loja')
  const [descontoTexto, setDescontoTexto] = useState('')
  const [descontoModo, setDescontoModo] = useState('reais')
  const [aprovado, setAprovado] = useState(false)
  const [pagamentosPor, setPagamentosPor] = useState({}) // { day: [...], fe: [...] }
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
  const descontoPassou = descontoReais > subtotal
  const vendaZerada = itens.length > 0 && total <= 0
  const precisaAprovacao = descontoPrecisaAprovacao(subtotal, desconto, config.limiteDescontoVendedora, ehProprietaria) && !aprovado

  // A venda separada por CNPJ: cada parte paga na maquininha do seu CNPJ
  const partes = useMemo(() => {
    const ordem = []
    const por = {}
    for (const i of itens) {
      const e = i.linha.produto.empresa_id
      if (!por[e]) { por[e] = []; ordem.push(e) }
      por[e].push(i)
    }
    const lista = ordem.map((e) => ({ chave: e, itens: por[e], subtotal: totaisVenda(por[e].map((i) => ({ preco: i.linha.preco, quantidade: i.quantidade }))).subtotal }))
    const descontos = dividirDesconto(lista, desconto)
    return lista.map((p) => ({ ...p, desconto: descontos[p.chave], total: arred(p.subtotal - descontos[p.chave]) }))
  }, [itens, desconto]) // eslint-disable-line react-hooks/exhaustive-deps
  const duasEmpresas = partes.length > 1

  const faltas = partes.map((p) => {
    const vals = valoresPagamento(pagamentosPor[p.chave] || pagamentoInicial(), p.total)
    return arred(p.total - vals.reduce((s, v) => s + v.valor, 0))
  })
  const pagamentoFecha = faltas.every((f) => f === 0)

  function adicionar(linha) {
    setErro('')
    const atual = carrinho.find((c) => c.variacao_id === linha.id)
    const qtd = (atual?.quantidade || 0) + 1
    if (qtd > LIMITE.quantidadeItem) return setErro(`Até ${LIMITE.quantidadeItem} da mesma peça por venda.`)
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
    const atual = carrinho.find((c) => c.variacao_id === variacaoId)
    if (delta > 0 && atual.quantidade + delta > LIMITE.quantidadeItem) return
    if (delta > 0 && !config.permitirEstoqueNegativo && atual.quantidade + delta > linha.saldo) {
      setErro(`Só há ${linha.saldo} em estoque de ${linha.nomeVariacao}.`)
      return
    }
    setEstado((e) => ({
      ...e,
      carrinho: e.carrinho
        .map((c) => (c.variacao_id === variacaoId ? { ...c, quantidade: c.quantidade + delta } : c))
        .filter((c) => c.quantidade > 0),
    }))
  }

  function irParaPagamento() {
    setErro('')
    const iniciais = Object.fromEntries(partes.map((p) => [p.chave, pagamentoInicial()]))
    // sinal já pago na encomenda entra como a primeira forma de pagamento da primeira parte
    const sinal = encomenda?.sinal
    if (sinal?.valor > 0 && partes[0] && sinal.valor >= partes[0].total) {
      // o sinal cobre a parte toda (se passou, a diferença é devolvida à cliente)
      iniciais[partes[0].chave] = [{ forma: sinal.forma, valorTexto: '', parcelas: 1, sinal: true }]
    } else if (sinal?.valor > 0 && partes[0]) {
      iniciais[partes[0].chave] = [
        { forma: sinal.forma, valorTexto: paraCampoMoeda(sinal.valor), parcelas: 1, sinal: true },
        { forma: 'pix', valorTexto: paraCampoMoeda(arred(partes[0].total - sinal.valor)), parcelas: 1 },
      ]
    }
    setPagamentosPor(iniciais)
    setEstado((e) => ({ ...e, etapa: 'pagamento' }))
  }

  function concluir() {
    setErro('')
    if (vendaZerada) return setErro('O desconto zerou a venda. Para dar a peça de presente, use "Brinde" em Estoque → Ajuste e perda.')
    if (!pagamentoFecha) return setErro('A soma das formas de pagamento precisa ser igual ao total de cada parte.')
    let cliente_id = clienteId
    const nomeNovo = limparTexto(cadastro?.nome)
    if (cadastro && nomeNovo) {
      const erroCadastro = nomeNovo.length < 2 ? 'Informe o nome da cliente, ou cancele o cadastro.' : erroWhatsApp(dados.clientes, cadastro.whatsapp)
      if (erroCadastro) return setErro(erroCadastro)
      cliente_id = criarCliente({ nome: nomeNovo, whatsapp: formatarWhatsApp(cadastro.whatsapp) })
      // se a venda não fechar (ex.: estoque), a cliente já fica escolhida e não é cadastrada de novo
      setClienteId(cliente_id); setCadastro(null)
    }
    const r = concluirVenda({
      partes: partes.map((p) => ({
        empresa_id: p.chave,
        itens: p.itens.map(({ variacao_id, quantidade }) => ({ variacao_id, quantidade })),
        desconto: p.desconto,
        pagamentos: valoresPagamento(pagamentosPor[p.chave], p.total)
          .filter((p) => p.valor > 0)
          .map(({ forma, valor, parcelas }) => ({ forma, valor, parcelas: forma === 'cartao_credito' ? parcelas : 1 })),
      })),
      cliente_id, canal,
    })
    if (r.erro) return setErro(encomenda ? `${r.erro} Dê entrada da peça no Estoque antes de entregar a encomenda.` : r.erro)
    if (encomenda) {
      atualizarEncomenda(encomenda.id, { status: 'entregue', entregue_em: new Date().toISOString(), vendas: r.vendas.map((v) => v.id) })
      setEncomenda(null)
    }
    setResultado({ ids: r.vendas.map((v) => v.id), segundos: Math.max(1, Math.round((Date.now() - estado.inicio) / 1000)) })
    setEstado((e) => ({ ...e, etapa: 'concluida' }))
  }

  function novaVenda() {
    setEstado(vazio())
    setClienteId(null); setBuscaCliente(''); setCadastro(null); setCanal('loja')
    setDescontoTexto(''); setDescontoModo('reais'); setAprovado(false)
    setPagamentosPor({}); setResultado(null); setErro('')
  }

  // ---------------- Concluída ----------------
  if (etapa === 'concluida' && resultado) {
    const vendas = resultado.ids.map((id) => dados.vendas.find((v) => v.id === id)).filter(Boolean)
    const totalGeral = arred(vendas.reduce((s, v) => s + v.total, 0))
    const cliente = clientePorId.get(vendas[0]?.cliente_id)
    const recibo = [
      "deMana's · recibo da sua compra",
      ...vendas.flatMap((v) => v.itens.map((i) => {
        const l = linhaPorId.get(i.variacao_id)
        return `${i.quantidade}x ${l.produto.nome} (${l.nomeVariacao}) ${formatarMoeda(i.preco_unitario * i.quantidade)}`
      })),
      vendas.some((v) => v.desconto > 0) ? `Desconto: ${formatarMoeda(arred(vendas.reduce((s, v) => s + v.desconto, 0)))}` : null,
      `Total: ${formatarMoeda(totalGeral)}`,
      'Obrigada pela preferência! 🌹',
    ].filter(Boolean).join('\n')
    const linkWhats = linkWhatsApp(cliente?.whatsapp, recibo)

    return (
      <div className="pagina pagina-estreita">
        <div className="cartao concluida">
          <span className="concluida-icone"><Icone nome="confirmar" tamanho={36} /></span>
          <h1>Venda concluída</h1>
          <p className="concluida-total">{formatarMoeda(totalGeral)}</p>
          <p className="texto-suave"><Icone nome="relogio" tamanho={16} /> registrada em {resultado.segundos} segundos {resultado.segundos <= 30 ? '· dentro da meta de 30 s' : ''}</p>
          <ul className="lista partes-concluidas">
            {vendas.map((v) => (
              <li key={v.id} className="linha-lista">
                <span>
                  <strong>{empresas[v.empresa_id].apelido} · venda nº {v.numero}</strong>
                  <small>{v.pagamentos.map((p) => `${FORMAS_PAGAMENTO[p.forma]}${p.parcelas > 1 ? ` ${p.parcelas}x` : ''}`).join(' + ')} · {formatarMoeda(v.total)}</small>
                </span>
                {!v.nota
                  ? <Selo>Sem nota (MEI)</Selo>
                  : v.nota.status === 'enviando'
                    ? <span className="selos"><span className="pulso" /> Emitindo nota…</span>
                    : <Selo tom="ambar">Nota emitida · teste</Selo>}
              </li>
            ))}
          </ul>
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
      ? dados.clientes.filter((c) => !c.removida && normalizar(`${c.nome} ${c.whatsapp}`).includes(normalizar(buscaCliente))).slice(0, 5)
      : []
    const cliente = clientePorId.get(clienteId)
    const formas = Object.entries(FORMAS_PAGAMENTO).filter(([f]) => f !== 'crediario' || config.aceitaCrediario)

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
              <label className="campo"><span>Nome</span><input value={cadastro.nome} onChange={(e) => setCadastro({ ...cadastro, nome: e.target.value })} maxLength={TAMANHO.nome} autoFocus /></label>
              <label className="campo"><span>WhatsApp</span><input inputMode="tel" value={cadastro.whatsapp} onChange={(e) => setCadastro({ ...cadastro, whatsapp: filtroTelefone(e.target.value) })} placeholder="(00) 00000-0000" /></label>
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
              <button className="botao-link" onClick={() => setCadastro({ nome: buscaCliente.slice(0, TAMANHO.nome), whatsapp: '' })}><Icone nome="somar" tamanho={16} /> Cadastro rápido</button>
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
              <button className={descontoModo === 'percentual' ? 'ativo' : ''} onClick={() => { setDescontoModo('percentual'); setDescontoTexto(filtroPercentual(descontoTexto)) }}>%</button>
            </div>
            <input className="campo-solto" inputMode="decimal" placeholder="0" value={descontoTexto} onChange={(e) => { setDescontoTexto(descontoModo === 'percentual' ? filtroPercentual(e.target.value) : filtroDinheiro(e.target.value)); setAprovado(false); setPagamentosPor(Object.fromEntries(partes.map((p) => [p.chave, pagamentoInicial()]))) }} aria-label="Desconto" />
          </div>
          {descontoPassou && <p className="texto-alerta pequeno">O desconto passa do valor da compra ({formatarMoeda(subtotal)}).</p>}
          {vendaZerada && !descontoPassou && <Aviso tom="vinho">O desconto zerou a venda. Para dar a peça de presente, use "Brinde" em Estoque → Ajuste e perda.</Aviso>}
          {desconto > 0 && !descontoPassou && <p className="texto-suave pequeno">{formatarMoeda(desconto)} · {formatarPercentual(percentual(desconto, subtotal))} do valor{duasEmpresas && ', dividido entre os dois CNPJs'}</p>}
          {!ehProprietaria && <p className="texto-suave pequeno">Seu limite de desconto: {config.limiteDescontoVendedora}%</p>}
          {precisaAprovacao && (
            <Aviso tom="vinho">
              Desconto acima do limite. Precisa da aprovação da proprietária.{' '}
              <button className="botao-link" onClick={() => setAprovado(true)}>Proprietária aprovou</button>
              <br /><small>Na versão real, ela confirma com a senha dela.</small>
            </Aviso>
          )}
        </section>

        {duasEmpresas && (
          <Aviso tom="ambar">Esta venda tem peças dos dois CNPJs. Cobre cada parte na maquininha do seu CNPJ.</Aviso>
        )}
        {encomenda?.sinal?.valor > 0 && (
          <Aviso tom={encomenda.sinal.valor > (partes[0]?.total || 0) ? 'ambar' : 'oliva'}>
            A cliente já pagou {formatarMoeda(encomenda.sinal.valor)} de sinal ({FORMAS_PAGAMENTO[encomenda.sinal.forma]}).{' '}
            {encomenda.sinal.valor < (partes[0]?.total || 0)
              ? 'Ele já está na primeira forma de pagamento: cobre só o restante.'
              : encomenda.sinal.valor === partes[0]?.total
                ? 'O sinal paga esta parte inteira: não há nada a cobrar nela.'
                : `O sinal passou do valor desta parte: devolva ${formatarMoeda(arred(encomenda.sinal.valor - (partes[0]?.total || 0)))} à cliente.`}
          </Aviso>
        )}
        {partes.map((p) => (
          <BlocoPagamento
            key={p.chave}
            titulo={duasEmpresas ? `${empresas[p.chave].apelido} · maquininha da ${empresas[p.chave].dona}` : 'Forma de pagamento'}
            subtitulo={duasEmpresas
              ? `${p.itens.map((i) => i.linha.produto.nome).join(', ')}${emiteNota(config, p.chave) ? ' · sai com nota' : ' · sem nota (MEI)'}`
              : `${empresas[p.chave].apelido} · maquininha da ${empresas[p.chave].dona}`}
            total={p.total}
            pagamentos={pagamentosPor[p.chave] || pagamentoInicial()}
            setPagamentos={(lista) => setPagamentosPor((atual) => ({ ...atual, [p.chave]: lista }))}
            formas={formas}
            taxas={taxasDe(config, p.chave)}
            podeVerCustos={podeVerCustos}
          />
        ))}

        {erro && <Aviso tom="vinho">{erro}</Aviso>}

        <footer className="rodape-fixo">
          <div className="rodape-total">
            <small>{desconto > 0 ? `${formatarMoeda(subtotal)} − ${formatarMoeda(desconto)}` : textoPecas}</small>
            <strong>{formatarMoeda(total)}</strong>
          </div>
          <button className="botao botao-principal botao-grande" disabled={precisaAprovacao || !pagamentoFecha || vendaZerada || descontoPassou} onClick={concluir}>
            <Icone nome="confirmar" /> Concluir venda
          </button>
        </footer>
      </div>
    )
  }

  // ---------------- Itens ----------------
  return (
    <div className="pagina pagina-estreita com-rodape-fixo">
      <header className="pagina-topo"><h1>{encomenda ? 'Entregar encomenda' : 'Nova venda'}</h1></header>
      {encomenda && (
        <Aviso tom="oliva">
          Encomenda de <strong>{clientePorId.get(encomenda.cliente_id)?.nome}</strong>. As peças já estão na venda.
          {encomenda.itens.some((i) => i.descricao) && ' Peças descritas à mão precisam ser cadastradas e adicionadas pela busca.'}
        </Aviso>
      )}

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
            <li key={l.id} className="resultado-com-acao">
              <button onClick={() => adicionar(l)} disabled={!config.permitirEstoqueNegativo && l.saldo <= 0}>
                <span><strong>{l.produto.nome}</strong><small>{l.nomeVariacao} · {empresas[l.produto.empresa_id]?.apelido}</small></span>
                <span className="resultado-direita">
                  <strong>{formatarMoeda(l.preco)}</strong>
                  <small className={l.saldo <= 0 ? 'texto-alerta' : 'texto-suave'}>{l.saldo <= 0 ? 'sem estoque' : `${l.saldo} em estoque`}</small>
                </span>
              </button>
              {l.saldo <= 0 && <Link className="botao botao-secundario" to={`/encomendas?nova=${l.id}`}>Encomendar</Link>}
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
                <small>{i.linha.nomeVariacao} · {formatarMoeda(i.linha.preco)} · {empresas[i.linha.produto.empresa_id]?.apelido}</small>
              </div>
              <div className="quantidade">
                <button className="botao-icone" onClick={() => mudarQuantidade(i.variacao_id, -1)} aria-label="Diminuir"><Icone nome={i.quantidade === 1 ? 'lixo' : 'subtrair'} tamanho={18} /></button>
                <span>{i.quantidade}</span>
                <button className="botao-icone" onClick={() => mudarQuantidade(i.variacao_id, 1)} disabled={i.quantidade >= LIMITE.quantidadeItem} aria-label="Aumentar"><Icone nome="somar" tamanho={18} /></button>
              </div>
              <strong className="item-total">{formatarMoeda(arred(i.linha.preco * i.quantidade))}</strong>
            </div>
          ))}
        </section>
      )}
      {duasEmpresas && <p className="texto-suave pequeno">Peças dos dois CNPJs: no pagamento, o sistema separa quanto cobrar em cada maquininha.</p>}

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
