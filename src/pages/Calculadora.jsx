import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCatalogo } from '../contexts/CatalogoContext'
import { supabase, traduzirErro } from '../lib/supabase'
import { arred, formatarMoeda, formatarPercentual, lerMoeda, paraCampoMoeda } from '../lib/moeda'
import { filtroDinheiro, filtroPercentual, LIMITE, TAMANHO } from '../lib/limites'
import { arredondarPara90, lucroDaVenda, percentual, percentualFixo, precoMinimo, precoPelaMargem } from '../lib/precos'
import Icone from '../components/Icone'
import { Aviso, SeletorVariacao } from '../components/ui'

const FORMAS = [
  { chave: 'pix', nome: 'Pix' },
  { chave: 'debito', nome: 'Débito' },
  { chave: 'credito', nome: 'Crédito à vista' },
  { chave: 'credito_parcelado', nome: 'Crédito parcelado' },
]

const numero = (texto) => {
  const n = lerMoeda(texto)
  return n == null || Number.isNaN(n) ? 0 : n
}
const campo = (valor) => (valor == null ? '' : paraCampoMoeda(valor))

// Guarda no banco um pouco depois da última mudança (sem gravar a cada tecla)
function useGuardarDepois(guardar, atraso = 700) {
  const timers = useRef({})
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])
  return (chave, ...args) => {
    clearTimeout(timers.current[chave])
    timers.current[chave] = setTimeout(() => guardar(...args), atraso)
  }
}

// Calculadora de preço de venda: fica dentro do Financeiro (área protegida por código).
// A configuração (margem, embalagem, entrega) e os custos fixos ficam no banco, para as duas usarem igual.
export default function Calculadora() {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    const desde = new Date(Date.now() - 90 * 86400000).toISOString()
    Promise.all([
      supabase.from('config_financeiro').select('valor').eq('chave', 'calculadora').single(),
      supabase.from('custos_fixos').select('*').order('ordem').order('criado_em'),
      supabase.from('vendas').select('total').eq('status', 'concluida').gte('criado_em', desde).limit(20000),
    ]).then(([cfg, fix, ven]) => {
      const falha = [cfg, fix, ven].find((r) => r.error)
      if (falha) return setErro(traduzirErro(falha.error))
      setDados({
        calc: cfg.data.valor,
        custos: fix.data.map((c) => ({ ...c, valor: Number(c.valor) })),
        faturamentoMedio: arred(ven.data.reduce((s, v) => s + Number(v.total), 0) / 3),
      })
    })
  }, [])

  if (!dados) return <div className="calculadora">{erro ? <Aviso tom="vinho">{erro}</Aviso> : <p className="texto-suave">Carregando…</p>}</div>
  return <TelaCalculadora inicial={dados} />
}

function TelaCalculadora({ inicial }) {
  const catalogo = useCatalogo()
  const [calc, setCalc] = useState(inicial.calc)
  const [custos, setCustos] = useState(inicial.custos)
  const [erro, setErro] = useState('')
  const { faturamentoMedio } = inicial
  // cada CNPJ tem sua maquininha: a calculadora usa as taxas e o imposto do CNPJ escolhido
  const empresaCalc = catalogo.empresas[calc.empresa] ? calc.empresa : 'day'
  const empresa = catalogo.empresas[empresaCalc]
  const taxas = catalogo.taxas[empresaCalc] || {}
  const imposto = Number(empresa?.imposto_percentual || 0)
  const linhas = useMemo(() => catalogo.linhas.filter((l) => l.ativo), [catalogo.linhas])

  const avisar = ({ error }) => setErro(error ? traduzirErro(error) : '')
  const depois = useGuardarDepois((chave, valor) => {
    if (chave === 'calc') supabase.from('config_financeiro').update({ valor }).eq('chave', 'calculadora').then(avisar)
    else supabase.from('custos_fixos').update(valor).eq('id', chave).then(avisar)
  })

  // Campos de texto (o que a pessoa digita) guardando o número na configuração
  const [textos, setTextos] = useState(() => ({
    custo: '',
    embalagem: campo(calc.embalagem),
    entrega: campo(calc.entrega),
    margem: campo(calc.margem),
    faturamento: campo(calc.faturamento ?? faturamentoMedio),
    teste: '',
    ...Object.fromEntries(custos.map((c) => [`fixo_${c.id}`, campo(c.valor)])),
  }))
  const mudar = (chave, texto, guardar) => {
    setTextos((t) => ({ ...t, [chave]: texto }))
    if (guardar) guardar(Math.min(numero(texto), LIMITE.valor))
  }
  // dinheiro e percentual: só números e vírgula; percentual nunca passa de 100
  const mudarValor = (chave, texto, guardar) => mudar(chave, filtroDinheiro(texto), guardar)
  const mudarPercentual = (chave, texto, guardar) => mudar(chave, filtroPercentual(texto), guardar)
  const marcarCalc = (campos) => setCalc((atual) => {
    const novo = { ...atual, ...campos }
    depois('calc', 'calc', novo)
    return novo
  })
  const guardarCalc = (chave) => (n) => marcarCalc({ [chave]: n })

  const [produtoId, setProdutoId] = useState(null)
  const produto = linhas.find((l) => l.id === produtoId)

  // ---------------- Contas ----------------
  const custoPeca = numero(textos.custo)
  const entregaNoCusto = calc.comEntrega && calc.entregaQuemPaga === 'loja' ? calc.entrega : 0
  const custo = arred(custoPeca + calc.embalagem + entregaNoCusto)
  const fixos = percentualFixo(custos, calc.faturamento ?? faturamentoMedio)
  const taxaBase = taxas[calc.formaBase] || 0
  const bruto = precoPelaMargem({ custo, margem: calc.margem, taxa: taxaBase, imposto, fixo: fixos.percentual })
  // sem o custo da peça não há preço para sugerir (só a embalagem não conta)
  const sugerido = custoPeca <= 0 ? null : calc.final90 ? arredondarPara90(bruto) : bruto
  const minimo = precoMinimo({ custo, taxa: taxas.credito_parcelado, imposto, fixo: fixos.percentual })
  const precoTeste = numero(textos.teste) || sugerido

  const resultados = precoTeste
    ? FORMAS.map((f) => ({ ...f, taxa: taxas[f.chave] || 0, ...lucroDaVenda({ preco: precoTeste, custo, taxa: taxas[f.chave] || 0, imposto, fixo: fixos.percentual }) }))
    : []
  const base = precoTeste ? lucroDaVenda({ preco: precoTeste, custo, taxa: taxaBase, imposto, fixo: fixos.percentual }) : null
  const composicao = base ? [
    { nome: 'Peça', valor: custoPeca },
    { nome: 'Embalagem', valor: calc.embalagem },
    entregaNoCusto > 0 && { nome: 'Entrega', valor: entregaNoCusto },
    { nome: 'Custos fixos', valor: base.valorFixo },
    { nome: `Taxa (${FORMAS.find((f) => f.chave === calc.formaBase).nome})`, valor: base.valorTaxa },
    imposto > 0 && { nome: 'Imposto', valor: base.valorImposto },
    { nome: 'Lucro', valor: base.lucro, destaque: true },
  ].filter(Boolean) : []

  // ---------------- Custos fixos (no banco: viram contas a pagar no dia 10) ----------------
  function mudarFixo(id, campos) {
    setCustos((lista) => lista.map((c) => (c.id === id ? { ...c, ...campos } : c)))
    // nome e valor guardam cada um no seu tempo (um não apaga o outro)
    if (campos.nome !== undefined) depois(`${id}:nome`, id, { nome: campos.nome.trim() || 'Custo' })
    else depois(`${id}:valor`, id, campos)
  }
  async function adicionarFixo() {
    if (custos.length >= LIMITE.custosFixos) return
    const { data, error } = await supabase.from('custos_fixos').insert({ nome: 'Novo custo', ordem: custos.length + 1 }).select().single()
    if (error) return setErro(traduzirErro(error))
    setCustos((lista) => [...lista, { ...data, valor: 0 }])
    setTextos((t) => ({ ...t, [`fixo_${data.id}`]: '' }))
  }
  async function removerFixo(id) {
    const { error } = await supabase.from('custos_fixos').delete().eq('id', id)
    if (error) return setErro(traduzirErro(error))
    setCustos((lista) => lista.filter((c) => c.id !== id))
  }

  function escolherProduto(l) {
    setProdutoId(l?.id || null)
    if (l) {
      setTextos((t) => ({ ...t, custo: paraCampoMoeda(l.custo), teste: '' }))
      // o produto já diz por qual CNPJ (e maquininha) ele é vendido
      if (l.produto.empresa_id && l.produto.empresa_id !== empresaCalc) marcarCalc({ empresa: l.produto.empresa_id })
    }
  }

  return (
    <div className="calculadora">
      <p className="texto-suave">Coloque os custos da loja uma vez. Depois é só trocar o custo da peça (ou escolher o produto) para achar o preço certo.</p>
      {erro && <Aviso tom="vinho">{erro}</Aviso>}

      <section className="cartao secao">
        <h2>1. Custo da peça</h2>
        <SeletorVariacao escolhida={produto} aoEscolher={escolherProduto} opcoes={linhas} />
        <div className="grade-campos">
          <label className="campo"><span>Preço de custo da peça</span><input inputMode="decimal" value={textos.custo} onChange={(e) => mudarValor('custo', e.target.value)} placeholder="0,00" /></label>
          <label className="campo"><span>Embalagem por peça</span><input inputMode="decimal" value={textos.embalagem} onChange={(e) => mudarValor('embalagem', e.target.value, guardarCalc('embalagem'))} /></label>
        </div>
      </section>

      <section className="cartao secao">
        <h2>2. Entrega</h2>
        <label className="campo-check">
          <input type="checkbox" checked={calc.comEntrega} onChange={(e) => marcarCalc({ comEntrega: e.target.checked })} /> Calcular com entrega
        </label>
        {calc.comEntrega && (
          <>
            <label className="campo campo-estreito"><span>Custo da entrega</span><input inputMode="decimal" value={textos.entrega} onChange={(e) => mudarValor('entrega', e.target.value, guardarCalc('entrega'))} /></label>
            <div className="segmentado">
              <button className={calc.entregaQuemPaga === 'loja' ? 'ativo' : ''} onClick={() => marcarCalc({ entregaQuemPaga: 'loja' })}>A loja paga</button>
              <button className={calc.entregaQuemPaga === 'cliente' ? 'ativo' : ''} onClick={() => marcarCalc({ entregaQuemPaga: 'cliente' })}>A cliente paga</button>
            </div>
            <p className="texto-suave pequeno">
              {calc.entregaQuemPaga === 'loja'
                ? 'A entrega entra no custo e já vem embutida no preço.'
                : `A entrega não entra no preço: cobrar ${formatarMoeda(calc.entrega)} à parte da cliente.`}
            </p>
          </>
        )}
      </section>

      <section className="cartao secao">
        <header className="bloco-topo">
          <h2>3. Custos fixos do mês</h2>
          <strong>{formatarMoeda(fixos.total)}</strong>
        </header>
        <ul className="lista-fixos">
          {custos.map((c) => (
            <li key={c.id}>
              <input className="campo-solto" value={c.nome} maxLength={TAMANHO.custoFixo} placeholder="Nome do custo" onChange={(e) => mudarFixo(c.id, { nome: e.target.value })} aria-label="Nome do custo" />
              <input className="campo-solto valor" inputMode="decimal" value={textos[`fixo_${c.id}`] ?? ''} placeholder="0,00" onChange={(e) => mudarValor(`fixo_${c.id}`, e.target.value, (n) => mudarFixo(c.id, { valor: n }))} aria-label={`Valor de ${c.nome || 'custo'}`} />
              <button className="botao-icone" onClick={() => removerFixo(c.id)} aria-label={`Remover ${c.nome || 'custo'}`}><Icone nome="lixo" tamanho={18} /></button>
            </li>
          ))}
        </ul>
        {custos.length < LIMITE.custosFixos
          ? <button className="botao-link" onClick={adicionarFixo}><Icone nome="somar" tamanho={16} /> Adicionar custo fixo</button>
          : <p className="texto-suave pequeno">Limite de {LIMITE.custosFixos} custos fixos. Junte os pequenos num só (ex.: "Outros").</p>}
        <p className="texto-suave pequeno">Cada custo com valor vira uma conta em "A pagar" no dia 10 de cada mês.</p>
        <label className="campo campo-estreito">
          <span>Faturamento médio por mês</span>
          <input inputMode="decimal" value={textos.faturamento} onChange={(e) => mudarValor('faturamento', e.target.value, guardarCalc('faturamento'))} />
        </label>
        <p className="texto-suave pequeno">Média das vendas dos últimos 3 meses: {formatarMoeda(faturamentoMedio)}.</p>
        {fixos.total > 0 && !(calc.faturamento ?? faturamentoMedio) && <Aviso tom="vinho">Sem o faturamento do mês, os custos fixos não entram no preço. Informe quanto a loja vende por mês.</Aviso>}
        <Aviso tom="oliva">Os custos fixos pesam <strong>{formatarPercentual(fixos.percentual)}</strong> de cada venda. Esse valor entra no preço.</Aviso>
      </section>

      <section className="cartao secao">
        <h2>4. Taxas do cartão e imposto</h2>
        <div className="segmentado">
          {Object.entries(catalogo.empresas).map(([id, e]) => (
            <button key={id} className={empresaCalc === id ? 'ativo' : ''} onClick={() => marcarCalc({ empresa: id })}>Maquininha {e.apelido}</button>
          ))}
        </div>
        <div className="grade-campos">
          {FORMAS.map((f) => (
            <div key={f.chave} className="campo">
              <span>{f.nome}</span>
              <strong>{formatarPercentual(taxas[f.chave] || 0, 2)}</strong>
            </div>
          ))}
          <div className="campo">
            <span>Imposto sobre a venda</span>
            <strong>{formatarPercentual(imposto, 2)}</strong>
          </div>
        </div>
        <p className="texto-suave pequeno">As taxas e o imposto de cada CNPJ são os mesmos do resto do sistema. Para mudar (o imposto, conforme a contadora recomendar), vá em <Link to="/configuracoes">Configurações</Link>. Tarifa mensal do banco ou da maquininha entra nos custos fixos, acima.</p>
      </section>

      <section className="cartao secao">
        <h2>5. Lucro</h2>
        <label className="campo campo-estreito"><span>Margem de lucro (%)</span><input inputMode="decimal" value={textos.margem} onChange={(e) => mudarPercentual('margem', e.target.value, guardarCalc('margem'))} /></label>
        <p className="texto-suave pequeno">A margem é o que sobra limpo, depois de pagar tudo.</p>
        <div className="campo">
          <span>Garantir essa margem mesmo quando pagarem no</span>
          <div className="segmentado compacto quebra">
            {FORMAS.map((f) => (
              <button key={f.chave} className={calc.formaBase === f.chave ? 'ativo' : ''} onClick={() => marcarCalc({ formaBase: f.chave })}>{f.nome}</button>
            ))}
          </div>
        </div>
        <label className="campo-check"><input type="checkbox" checked={calc.final90} onChange={(e) => marcarCalc({ final90: e.target.checked })} /> Arredondar para final ,90</label>
      </section>

      <section className="cartao secao resultado-calculadora">
        {sugerido == null ? (
          <Aviso tom="vinho">
            {custoPeca <= 0 ? 'Informe o custo da peça (ou escolha o produto).' : 'Margem, taxa, imposto e custos fixos passam de 100% do preço. Diminua a margem ou reveja os custos fixos.'}
          </Aviso>
        ) : (
          <>
            <span className="metrica-rotulo">Preço certo</span>
            <strong className="preco-sugerido">{formatarMoeda(sugerido)}</strong>
            <p className="texto-suave pequeno">
              {calc.final90 && bruto !== sugerido && <>sem arredondar: {formatarMoeda(bruto)} · </>}
              {(sugerido / custo).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x o custo
            </p>
            {minimo && <p className="texto-suave pequeno">Abaixo de <strong>{formatarMoeda(minimo)}</strong> a loja tem prejuízo no crédito parcelado.</p>}
            {produto && <p className="pequeno">Preço atual de {produto.produto.nome} ({produto.nomeVariacao}): <strong>{formatarMoeda(produto.preco)}</strong></p>}
          </>
        )}
      </section>

      {composicao.length > 0 && (
        <section className="cartao secao">
          <h2>Para onde vai cada real</h2>
          <label className="campo campo-estreito">
            <span>Testar outro preço</span>
            <input inputMode="decimal" value={textos.teste} onChange={(e) => mudarValor('teste', e.target.value)} placeholder={paraCampoMoeda(sugerido)} />
          </label>
          <table className="tabela">
            <tbody>
              {composicao.map((c) => (
                <tr key={c.nome} className={c.destaque ? 'linha-destaque' : ''}>
                  <th scope="row">{c.nome}</th>
                  <td className={c.valor < 0 ? 'texto-negativo' : ''}>{formatarMoeda(c.valor)}</td>
                  <td className={c.valor < 0 ? 'texto-negativo' : 'texto-suave'}>{formatarPercentual(percentual(c.valor, precoTeste))}</td>
                </tr>
              ))}
              <tr className="linha-total"><th scope="row">Preço de venda</th><td>{formatarMoeda(precoTeste)}</td><td className="texto-suave">100%</td></tr>
            </tbody>
          </table>
        </section>
      )}

      {resultados.length > 0 && (
        <section className="cartao secao">
          <h2>Lucro em cada forma de pagamento</h2>
          <table className="tabela">
            <thead><tr><th>Pagamento</th><th>Recebe</th><th>Lucro</th><th>Margem</th></tr></thead>
            <tbody>
              {resultados.map((r) => (
                <tr key={r.chave}>
                  <th scope="row">{r.nome}<small>taxa de {formatarPercentual(r.taxa, 2)}</small></th>
                  <td>{formatarMoeda(r.recebe)}</td>
                  <td className={r.lucro < 0 ? 'texto-negativo' : ''}><strong>{formatarMoeda(r.lucro)}</strong></td>
                  <td className={r.lucro < 0 ? 'texto-negativo' : 'texto-suave'}>{formatarPercentual(r.margem)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="texto-suave pequeno">Lucro depois de pagar a peça, a embalagem, a entrega (se a loja paga), a parte dos custos fixos, a taxa e o imposto.</p>
        </section>
      )}
    </div>
  )
}
