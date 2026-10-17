import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCatalogo } from '../contexts/CatalogoContext'
import { supabase, traduzirErro } from '../lib/supabase'
import { arred, formatarMoeda, formatarPercentual, lerMoeda, paraCampoMoeda, CANAIS } from '../lib/moeda'
import { filtroDinheiro, filtroPercentual, filtroTelefone, formatarWhatsApp, LIMITE, limparTexto, linkWhatsApp, numeroWhatsApp, TAMANHO, whatsappValido } from '../lib/limites'
import { falta, FORMAS, MAX_PARCELAS, partesDaVenda, passaDoLimite, taxaEstimada, textoRecibo } from '../lib/vendas'
import { percentual } from '../demo/regras'
import Icone from '../components/Icone'
import LeitorCamera, { temLeitorCamera } from '../components/LeitorCamera'
import { Aviso, buscarVariacoes, CampoBusca, Selo } from '../components/ui'

const vazio = () => ({ carrinho: [], etapa: 'itens', inicio: null })
const pagamentoInicial = () => [{ forma: 'pix', valorTexto: '', parcelas: 1 }]

// Uma forma só: paga o total. Duas: cada uma com o valor digitado.
export function valoresPagamento(pagamentos, total) {
  return pagamentos.length === 1
    ? [{ forma: pagamentos[0].forma, valor: total, parcelas: pagamentos[0].parcelas }]
    : pagamentos.map((p) => ({ forma: p.forma, valor: lerMoeda(p.valorTexto) || 0, parcelas: p.parcelas }))
}

// Pagamento de uma parte da venda (um CNPJ = uma maquininha)
function BlocoPagamento({ titulo, subtitulo, total, pagamentos, setPagamentos, taxas }) {
  const [recebido, setRecebido] = useState('')
  const finais = valoresPagamento(pagamentos, total)
  const faltando = falta(total, finais)
  const taxa = taxas ? taxaEstimada(finais, taxas) : 0
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
          <div className="formas">
            {Object.entries(FORMAS).map(([chave, nome]) => (
              <button key={chave} className={`forma ${p.forma === chave ? 'ativo' : ''}`} onClick={() => mudar(i, { forma: chave, parcelas: 1 })}>{nome}</button>
            ))}
          </div>
          <div className="linha-campos">
            {pagamentos.length > 1 && (
              <input className="campo-solto" inputMode="decimal" value={p.valorTexto} onChange={(e) => mudar(i, { valorTexto: filtroDinheiro(e.target.value) })} aria-label="Valor" />
            )}
            {p.forma === 'cartao_credito' && (
              <select className="campo-solto" value={p.parcelas} onChange={(e) => mudar(i, { parcelas: Number(e.target.value) })} aria-label="Parcelas">
                {Array.from({ length: MAX_PARCELAS }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n === 1 ? 'À vista' : `${n}x de ${formatarMoeda(arred(finais[i].valor / n))}`}</option>)}
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
      {pagamentos.length > 1 && faltando !== 0 && <p className="texto-alerta pequeno">{faltando > 0 ? `Faltam ${formatarMoeda(faltando)}` : `Passou ${formatarMoeda(-faltando)} do total`}</p>}
      {taxa > 0 && <p className="texto-suave pequeno">Taxa estimada da maquininha: {formatarMoeda(taxa)}</p>}
    </section>
  )
}

export default function NovaVenda() {
  const { permissoes } = useAuth()
  const cat = useCatalogo()
  const { linhas, empresas, parametros, taxas, podeVerCustos, recarregar } = cat
  const admin = permissoes.admin
  const permitirNegativo = parametros.permitir_estoque_negativo === true
  const limite = Number(parametros.limite_desconto_vendedora ?? 0)
  const [params] = useSearchParams()
  const veioDeEncomenda = params.has('encomenda')

  const [estado, setEstado] = useState(vazio)
  const { carrinho, etapa } = estado
  const [busca, setBusca] = useState('')
  const [camera, setCamera] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  // pagamento
  const [cliente, setCliente] = useState(null)
  const [buscaCliente, setBuscaCliente] = useState('')
  const [clientesEncontrados, setClientesEncontrados] = useState([])
  const [cadastro, setCadastro] = useState(null) // { nome, whatsapp } quando aberto
  const [canal, setCanal] = useState('loja')
  const [descontoTexto, setDescontoTexto] = useState('')
  const [descontoModo, setDescontoModo] = useState('reais')
  const [aprovacao, setAprovacao] = useState(null) // id da autorização
  const [codigo, setCodigo] = useState('')
  const [pagamentosPor, setPagamentosPor] = useState({}) // { day: [...], fe: [...] }
  const [resultado, setResultado] = useState(null)

  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])
  const vendaveis = useMemo(() => linhas.filter((l) => l.ativo), [linhas])
  const resultados = useMemo(() => buscarVariacoes(vendaveis, busca), [vendaveis, busca])

  // Atalhos: o que mais vendeu nos últimos 30 dias e ainda tem em estoque
  const [maisVendidos, setMaisVendidos] = useState([])
  useEffect(() => {
    const desde = new Date(Date.now() - 30 * 86400000).toISOString()
    supabase.from('venda_itens').select('variacao_id, quantidade, vendas!inner(criado_em, status)')
      .gte('vendas.criado_em', desde).eq('vendas.status', 'concluida').limit(3000)
      .then(({ data }) => {
        const soma = new Map()
        for (const i of data || []) soma.set(i.variacao_id, (soma.get(i.variacao_id) || 0) + i.quantidade)
        setMaisVendidos([...soma.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id))
      })
  }, [])
  const atalhos = maisVendidos.map((id) => linhaPorId.get(id)).filter((l) => l && l.ativo && (l.saldo > 0 || permitirNegativo)).slice(0, 6)

  // Busca de cliente no banco (nome ou WhatsApp)
  useEffect(() => {
    const texto = buscaCliente.replace(/[,()%*\\]/g, ' ').trim()
    if (texto.length < 2) { setClientesEncontrados([]); return undefined }
    const t = setTimeout(async () => {
      const digitos = texto.replace(/\D/g, '')
      const filtro = digitos.length >= 4 ? `nome.ilike.%${texto}%,whatsapp.ilike.%${digitos}%` : `nome.ilike.%${texto}%`
      const { data } = await supabase.from('clientes').select('id, nome, whatsapp').or(filtro).order('nome').limit(6)
      setClientesEncontrados(data || [])
    }, 250)
    return () => clearTimeout(t)
  }, [buscaCliente])

  const itens = carrinho.map((c) => ({ ...c, linha: linhaPorId.get(c.variacao_id) })).filter((i) => i.linha)
  const pecas = itens.reduce((s, i) => s + i.quantidade, 0)
  const textoPecas = `${pecas} ${pecas === 1 ? 'peça' : 'peças'}`
  const subtotal = arred(itens.reduce((s, i) => s + i.linha.preco * i.quantidade, 0))
  const descontoDigitado = lerMoeda(descontoTexto) || 0
  const desconto = descontoModo === 'percentual' ? arred((subtotal * Math.min(descontoDigitado, 100)) / 100) : descontoDigitado
  const total = arred(subtotal - desconto)
  const descontoInvalido = desconto >= subtotal && itens.length > 0
  const precisaAprovacao = !admin && passaDoLimite(subtotal, desconto, limite) && !aprovacao

  const partes = useMemo(() => partesDaVenda(
    itens.map((i) => ({ variacao_id: i.variacao_id, quantidade: i.quantidade, preco: i.linha.preco, empresa_id: i.linha.produto.empresa_id })),
    descontoInvalido ? 0 : desconto,
  ), [itens, desconto, descontoInvalido]) // eslint-disable-line react-hooks/exhaustive-deps
  const duasEmpresas = partes.length > 1
  const pagamentoFecha = partes.every((p) => falta(p.total, valoresPagamento(pagamentosPor[p.empresa_id] || pagamentoInicial(), p.total)) === 0)

  // quanto já está no carrinho de cada peça (o kit usa as peças que o formam)
  function cabe(linha, qtd) {
    if (permitirNegativo) return null
    if (qtd <= linha.saldo) return null
    if (linha.produto.tipo === 'kit') return linha.saldo <= 0 ? `Não dá para montar o kit ${linha.produto.nome}: falta peça no estoque.` : `Dá para montar só ${linha.saldo} desse kit.`
    return linha.saldo <= 0 ? `${linha.produto.nome} (${linha.nomeVariacao}) está sem estoque.` : `Só há ${linha.saldo} em estoque de ${linha.produto.nome} (${linha.nomeVariacao}).`
  }

  function adicionar(linha) {
    setErro('')
    const atual = carrinho.find((c) => c.variacao_id === linha.id)
    const qtd = (atual?.quantidade || 0) + 1
    if (qtd > LIMITE.quantidadeItem) return setErro(`Até ${LIMITE.quantidadeItem} da mesma peça por venda.`)
    const semEstoque = cabe(linha, qtd)
    if (semEstoque) return setErro(semEstoque)
    setEstado((e) => ({
      ...e,
      inicio: e.inicio || Date.now(),
      carrinho: atual
        ? e.carrinho.map((c) => (c.variacao_id === linha.id ? { ...c, quantidade: qtd } : c))
        : [...e.carrinho, { variacao_id: linha.id, quantidade: 1 }],
    }))
    setBusca('')
  }

  // leitor de código (USB ou câmera): código exato entra direto no carrinho
  function lerCodigo(codigo) {
    const exata = vendaveis.find((l) => l.codigo_barras === codigo.trim() || l.sku === codigo.trim())
    if (exata) adicionar(exata)
    else setErro(`Nenhuma peça com o código ${codigo}. Confira se ela está cadastrada.`)
  }

  function mudarQuantidade(variacaoId, delta) {
    setErro('')
    const linha = linhaPorId.get(variacaoId)
    const atual = carrinho.find((c) => c.variacao_id === variacaoId)
    if (delta > 0) {
      if (atual.quantidade + delta > LIMITE.quantidadeItem) return
      const semEstoque = cabe(linha, atual.quantidade + delta)
      if (semEstoque) return setErro(semEstoque)
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
    setPagamentosPor(Object.fromEntries(partes.map((p) => [p.empresa_id, pagamentoInicial()])))
    setEstado((e) => ({ ...e, etapa: 'pagamento' }))
  }

  function mudarDesconto(texto) {
    setDescontoTexto(descontoModo === 'percentual' ? filtroPercentual(texto) : filtroDinheiro(texto))
    setAprovacao(null)
    setPagamentosPor(Object.fromEntries(partes.map((p) => [p.empresa_id, pagamentoInicial()])))
  }

  async function aprovar() {
    setErro('')
    const { data, error } = await supabase.rpc('pedir_aprovacao', { p_codigo: codigo })
    setCodigo('')
    if (error) return setErro(traduzirErro(error))
    if (!data.ok) return setErro(data.erro)
    setAprovacao(data.aprovacao)
  }

  async function concluir() {
    setErro('')
    if (descontoInvalido) return setErro('O desconto zerou a venda. Para dar a peça de presente, use "Brinde" em Estoque → Saída e correção.')
    if (!pagamentoFecha) return setErro('A soma das formas de pagamento precisa ser igual ao total de cada parte.')
    setEnviando(true)

    // cadastro rápido: a cliente é criada antes; se a venda não fechar, ela já fica escolhida
    let clienteDaVenda = cliente
    const nomeNovo = limparTexto(cadastro?.nome)
    if (cadastro && nomeNovo) {
      if (nomeNovo.length < 2) { setEnviando(false); return setErro('Informe o nome da cliente, ou cancele o cadastro.') }
      if (!whatsappValido(cadastro.whatsapp)) { setEnviando(false); return setErro('WhatsApp incompleto: coloque o DDD e o número, como (11) 98888-7777.') }
      const { data, error } = await supabase.from('clientes')
        .insert({ nome: nomeNovo, whatsapp: numeroWhatsApp(cadastro.whatsapp) || null })
        .select('id, nome, whatsapp').single()
      if (error) {
        setEnviando(false)
        return setErro(error.code === '23505' ? 'Esse WhatsApp já é de uma cliente cadastrada. Busque por ela em vez de cadastrar de novo.' : traduzirErro(error))
      }
      clienteDaVenda = data
      setCliente(data); setCadastro(null)
    }

    const { data, error } = await supabase.rpc('concluir_venda', {
      p: {
        cliente_id: clienteDaVenda?.id || null,
        canal,
        aprovacao,
        partes: partes.map((p) => ({
          empresa_id: p.empresa_id,
          desconto: p.desconto,
          itens: p.itens.map(({ variacao_id, quantidade }) => ({ variacao_id, quantidade })),
          pagamentos: valoresPagamento(pagamentosPor[p.empresa_id] || pagamentoInicial(), p.total)
            .filter((x) => x.valor > 0)
            .map(({ forma, valor, parcelas }) => ({ forma, valor, parcelas: forma === 'cartao_credito' ? parcelas : 1 })),
        })),
      },
    })
    setEnviando(false)
    if (error) {
      if (error.code === 'P0002') setAprovacao(null)
      await recarregar() // o estoque pode ter mudado
      return setErro(traduzirErro(error))
    }
    setResultado({
      vendas: data.map((v) => ({ ...v, desconto: partes.find((p) => p.empresa_id === v.empresa_id)?.desconto || 0 })),
      itens: itens.map((i) => ({ descricao: `${i.linha.produto.nome} (${i.linha.nomeVariacao})`, quantidade: i.quantidade, preco_unitario: i.linha.preco })),
      cliente: clienteDaVenda,
      segundos: Math.max(1, Math.round((Date.now() - estado.inicio) / 1000)),
    })
    setEstado((e) => ({ ...e, etapa: 'concluida' }))
    recarregar()
  }

  function novaVenda() {
    setEstado(vazio())
    setCliente(null); setBuscaCliente(''); setCadastro(null); setCanal('loja')
    setDescontoTexto(''); setDescontoModo('reais'); setAprovacao(null); setCodigo('')
    setPagamentosPor({}); setResultado(null); setErro('')
  }

  // ---------------- Concluída ----------------
  if (etapa === 'concluida' && resultado) {
    const totalGeral = arred(resultado.vendas.reduce((s, v) => s + Number(v.total), 0))
    const linkWhats = linkWhatsApp(resultado.cliente?.whatsapp, textoRecibo(resultado))

    return (
      <div className="pagina pagina-estreita">
        <div className="cartao concluida">
          <span className="concluida-icone"><Icone nome="confirmar" tamanho={36} /></span>
          <h1>Venda concluída</h1>
          <p className="concluida-total">{formatarMoeda(totalGeral)}</p>
          <p className="texto-suave"><Icone nome="relogio" tamanho={16} /> registrada em {resultado.segundos} segundos {resultado.segundos <= 30 ? '· dentro da meta de 30 s' : ''}</p>
          <ul className="lista partes-concluidas">
            {resultado.vendas.map((v) => (
              <li key={v.id} className="linha-lista">
                <span>
                  <strong>{empresas[v.empresa_id]?.apelido} · venda nº {v.numero}</strong>
                  <small>{formatarMoeda(v.total)}</small>
                </span>
                {empresas[v.empresa_id]?.tipo === 'me' ? <Selo tom="ambar">Nota a emitir</Selo> : <Selo>Sem nota (MEI)</Selo>}
              </li>
            ))}
          </ul>
          <p className="texto-suave pequeno">A venda está registrada e o estoque já foi baixado. A emissão da nota fiscal chega na etapa da Nota fiscal.</p>
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
    return (
      <div className="pagina pagina-estreita com-rodape-fixo">
        <button className="botao-link voltar" onClick={() => setEstado((e) => ({ ...e, etapa: 'itens' }))}><Icone nome="voltar" tamanho={18} /> Voltar aos itens</button>
        <header className="pagina-topo"><h1>Pagamento</h1></header>

        <section className="cartao secao">
          <h2>Cliente <small className="texto-suave">(opcional)</small></h2>
          {cliente ? (
            <div className="seletor-escolhido">
              <div><strong>{cliente.nome}</strong><small>{cliente.whatsapp ? formatarWhatsApp(cliente.whatsapp) : 'sem WhatsApp'}</small></div>
              <button className="botao-link" onClick={() => setCliente(null)}>Trocar</button>
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
                    <li key={c.id}><button onClick={() => { setCliente(c); setBuscaCliente('') }}><span><strong>{c.nome}</strong><small>{c.whatsapp ? formatarWhatsApp(c.whatsapp) : 'sem WhatsApp'}</small></span></button></li>
                  ))}
                </ul>
              )}
              <button className="botao-link" onClick={() => setCadastro({ nome: /\d/.test(buscaCliente) ? '' : buscaCliente.slice(0, TAMANHO.nome), whatsapp: /\d/.test(buscaCliente) ? filtroTelefone(buscaCliente) : '' })}><Icone nome="somar" tamanho={16} /> Cadastro rápido</button>
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
              <button className={descontoModo === 'reais' ? 'ativo' : ''} onClick={() => { setDescontoModo('reais'); setAprovacao(null) }}>R$</button>
              <button className={descontoModo === 'percentual' ? 'ativo' : ''} onClick={() => { setDescontoModo('percentual'); setDescontoTexto(filtroPercentual(descontoTexto)); setAprovacao(null) }}>%</button>
            </div>
            <input className="campo-solto" inputMode="decimal" placeholder="0" value={descontoTexto} onChange={(e) => mudarDesconto(e.target.value)} aria-label="Desconto" />
          </div>
          {descontoInvalido && <Aviso tom="vinho">O desconto zera a venda. Para dar a peça de presente, use "Brinde" em Estoque → Saída e correção.</Aviso>}
          {desconto > 0 && !descontoInvalido && <p className="texto-suave pequeno">{formatarMoeda(desconto)} · {formatarPercentual(percentual(desconto, subtotal))} do valor{duasEmpresas && ', dividido entre os dois CNPJs'}</p>}
          {!admin && <p className="texto-suave pequeno">Seu limite de desconto: {limite}%</p>}
          {!admin && aprovacao && <Aviso tom="oliva">Desconto aprovado pela proprietária.</Aviso>}
          {precisaAprovacao && !descontoInvalido && (
            <div className="formulario">
              <Aviso tom="ambar">Desconto acima do seu limite. A proprietária digita o código de aprovação aqui.</Aviso>
              <div className="linha-campos">
                <input className="campo-solto" type="password" autoComplete="off" value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={TAMANHO.codigo} aria-label="Código de aprovação" placeholder="Código de aprovação" />
                <button className="botao botao-secundario" onClick={aprovar} disabled={!codigo}>Aprovar</button>
              </div>
            </div>
          )}
        </section>

        {duasEmpresas && <Aviso tom="ambar">Esta venda tem peças dos dois CNPJs. Cobre cada parte na maquininha do seu CNPJ.</Aviso>}
        {partes.map((p) => (
          <BlocoPagamento
            key={p.empresa_id}
            titulo={duasEmpresas ? `${empresas[p.empresa_id]?.apelido} · maquininha da ${empresas[p.empresa_id]?.dona}` : 'Forma de pagamento'}
            subtitulo={duasEmpresas
              ? `${p.itens.map((i) => linhaPorId.get(i.variacao_id)?.produto.nome).join(', ')}${empresas[p.empresa_id]?.tipo === 'me' ? ' · sai com nota' : ' · sem nota (MEI)'}`
              : `${empresas[p.empresa_id]?.apelido} · maquininha da ${empresas[p.empresa_id]?.dona}`}
            total={p.total}
            pagamentos={pagamentosPor[p.empresa_id] || pagamentoInicial()}
            setPagamentos={(lista) => setPagamentosPor((atual) => ({ ...atual, [p.empresa_id]: lista }))}
            taxas={podeVerCustos ? taxas[p.empresa_id] : null}
          />
        ))}

        {erro && <Aviso tom="vinho">{erro}</Aviso>}

        <footer className="rodape-fixo">
          <div className="rodape-total">
            <small>{desconto > 0 ? `${formatarMoeda(subtotal)} − ${formatarMoeda(desconto)}` : textoPecas}</small>
            <strong>{formatarMoeda(descontoInvalido ? subtotal : total)}</strong>
          </div>
          <button className="botao botao-principal botao-grande" disabled={enviando || precisaAprovacao || !pagamentoFecha || descontoInvalido} onClick={concluir}>
            <Icone nome="confirmar" /> {enviando ? 'Registrando…' : 'Concluir venda'}
          </button>
        </footer>
      </div>
    )
  }

  // ---------------- Itens ----------------
  return (
    <div className="pagina pagina-estreita com-rodape-fixo">
      <header className="pagina-topo"><h1>Nova venda</h1></header>
      {veioDeEncomenda && <Aviso tom="ambar">As encomendas ainda são de exemplo (até a etapa de Clientes). Para entregar, faça a venda normal pela busca.</Aviso>}

      <div className="busca-venda">
        <CampoBusca grande valor={busca} aoMudar={setBusca} aoEnter={() => busca.trim() && (resultados.length === 1 ? adicionar(resultados[0]) : lerCodigo(busca))} placeholder="Buscar produto, cor, tamanho ou código" autoFocus />
        <button className="botao-icone botao-camera" title="Ler código de barras" aria-label="Ler código de barras pela câmera"
          onClick={() => (temLeitorCamera() ? setCamera(true) : setErro('Neste celular o navegador não lê código pela câmera. Use o leitor de código ou digite o nome (no Android, use o Chrome).'))}>
          <Icone nome="camera" />
        </button>
      </div>
      {camera && <LeitorCamera aoFechar={() => setCamera(false)} aoLer={(c) => { setCamera(false); lerCodigo(c) }} />}

      {busca.trim() ? (
        <ul className="lista-opcoes resultados-venda">
          {resultados.length === 0 && <li className="texto-suave recuo">Nada encontrado para "{busca}".</li>}
          {resultados.map((l) => (
            <li key={l.id} className="resultado-com-acao">
              <button onClick={() => adicionar(l)} disabled={!permitirNegativo && l.saldo <= 0}>
                <span><strong>{l.produto.nome}</strong><small>{l.nomeVariacao} · {empresas[l.produto.empresa_id]?.apelido}</small></span>
                <span className="resultado-direita">
                  <strong>{formatarMoeda(l.preco)}</strong>
                  <small className={l.saldo <= 0 ? 'texto-alerta' : 'texto-suave'}>{l.saldo <= 0 ? 'sem estoque' : l.produto.tipo === 'kit' ? `dá para montar ${l.saldo}` : `${l.saldo} em estoque`}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : carrinho.length === 0 && atalhos.length > 0 && (
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
      {permitirNegativo && <p className="texto-suave pequeno">"Vender sem estoque" está ligado em Configurações: a venda passa mesmo quando o sistema diz que a peça acabou.</p>}

      {itens.length > 0 && (
        <footer className="rodape-fixo">
          <div className="rodape-total">
            <small>{textoPecas}</small>
            <strong>{formatarMoeda(subtotal)}</strong>
          </div>
          <button className="botao botao-principal botao-grande" onClick={irParaPagamento}>Pagamento <Icone nome="seguir" /></button>
        </footer>
      )}
      {itens.length === 0 && !busca && (
        <p className="texto-suave pequeno recuo">
          {linhas.length ? 'Dica: digite parte do nome e a cor, por exemplo "aurora preto 42", ou leia o código de barras.' : <>Ainda não há produtos cadastrados. Comece por <Link to="/produtos">Produtos</Link>.</>}
        </p>
      )}
      <p className="texto-suave pequeno recuo"><Link to="/vendas">Ver vendas anteriores</Link></p>
    </div>
  )
}

