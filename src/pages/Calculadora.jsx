import { useMemo, useState } from 'react'
import { useDemo } from '../demo/DemoContext'
import { arred, formatarMoeda, formatarPercentual, lerMoeda, paraCampoMoeda } from '../lib/moeda'
import { diasDesde } from '../lib/datas'
import { filtroDinheiro, filtroPercentual, LIMITE, TAMANHO } from '../lib/limites'
import { arredondarPara90, lucroDaVenda, percentual, percentualFixo, precoMinimo, precoPelaMargem, taxasDe } from '../demo/regras'
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

// Calculadora de preço de venda: fica dentro do Financeiro (área protegida por código)
export default function Calculadora() {
  const { dados, linhas, atualizarConfig } = useDemo()
  const config = dados.config
  const calc = config.calculadora
  // cada CNPJ tem sua maquininha: a calculadora usa as taxas do CNPJ escolhido
  const empresaCalc = config.empresas[calc.empresa] ? calc.empresa : 'day'
  const taxas = taxasDe(config, empresaCalc)
  const salvarTaxa = (chave, n) => atualizarConfig({
    empresas: { ...config.empresas, [empresaCalc]: { ...config.empresas[empresaCalc], taxas: { ...taxas, [chave]: n } } },
  })

  // Faturamento médio dos últimos 3 meses, para sugerir
  const faturamentoMedio = useMemo(() => arred(dados.vendas
    .filter((v) => v.status === 'concluida' && diasDesde(v.data) < 90)
    .reduce((s, v) => s + v.total, 0) / 3), [dados.vendas])

  // Campos de texto (o que a pessoa digita) guardando o número nas configurações
  const [textos, setTextos] = useState(() => ({
    custo: '38,00',
    embalagem: campo(calc.embalagem),
    entrega: campo(calc.entrega),
    margem: campo(calc.margem),
    imposto: campo(calc.imposto),
    faturamento: campo(calc.faturamento ?? faturamentoMedio),
    teste: '',
    ...Object.fromEntries(config.custosFixos.map((c) => [`fixo_${c.id}`, campo(c.valor)])),
  }))
  const mudar = (chave, texto, guardar) => {
    setTextos((t) => ({ ...t, [chave]: texto }))
    if (guardar) guardar(Math.min(numero(texto), LIMITE.valor))
  }
  // dinheiro e percentual: só números e vírgula; percentual nunca passa de 100
  const mudarValor = (chave, texto, guardar) => mudar(chave, filtroDinheiro(texto), guardar)
  const mudarPercentual = (chave, texto, guardar) => mudar(chave, filtroPercentual(texto), guardar)
  const guardarCalc = (chave) => (n) => atualizarConfig({ calculadora: { ...calc, [chave]: n } })
  const marcarCalc = (campos) => atualizarConfig({ calculadora: { ...calc, ...campos } })

  const [produtoId, setProdutoId] = useState(null)
  const produto = linhas.find((l) => l.id === produtoId)

  // ---------------- Contas ----------------
  const custoPeca = numero(textos.custo)
  const entregaNoCusto = calc.comEntrega && calc.entregaQuemPaga === 'loja' ? calc.entrega : 0
  const custo = arred(custoPeca + calc.embalagem + entregaNoCusto)
  const fixos = percentualFixo(config.custosFixos, calc.faturamento ?? faturamentoMedio)
  const taxaBase = taxas[calc.formaBase] || 0
  const bruto = precoPelaMargem({ custo, margem: calc.margem, taxa: taxaBase, imposto: calc.imposto, fixo: fixos.percentual })
  const sugerido = calc.final90 ? arredondarPara90(bruto) : bruto
  const minimo = precoMinimo({ custo, taxa: taxas.credito_parcelado, imposto: calc.imposto, fixo: fixos.percentual })
  const precoTeste = numero(textos.teste) || sugerido

  const resultados = precoTeste
    ? FORMAS.map((f) => ({ ...f, taxa: taxas[f.chave] || 0, ...lucroDaVenda({ preco: precoTeste, custo, taxa: taxas[f.chave] || 0, imposto: calc.imposto, fixo: fixos.percentual }) }))
    : []
  const base = precoTeste ? lucroDaVenda({ preco: precoTeste, custo, taxa: taxaBase, imposto: calc.imposto, fixo: fixos.percentual }) : null
  const composicao = base ? [
    { nome: 'Peça', valor: custoPeca },
    { nome: 'Embalagem', valor: calc.embalagem },
    entregaNoCusto > 0 && { nome: 'Entrega', valor: entregaNoCusto },
    { nome: 'Custos fixos', valor: base.valorFixo },
    { nome: `Taxa (${FORMAS.find((f) => f.chave === calc.formaBase).nome})`, valor: base.valorTaxa },
    calc.imposto > 0 && { nome: 'Imposto', valor: base.valorImposto },
    { nome: 'Lucro', valor: base.lucro, destaque: true },
  ].filter(Boolean) : []

  // ---------------- Custos fixos ----------------
  function mudarFixo(id, campos) {
    atualizarConfig({ custosFixos: config.custosFixos.map((c) => (c.id === id ? { ...c, ...campos } : c)) })
  }
  function adicionarFixo() {
    if (config.custosFixos.length >= LIMITE.custosFixos) return
    const id = `f${Date.now()}`
    atualizarConfig({ custosFixos: [...config.custosFixos, { id, nome: '', valor: 0 }] })
    setTextos((t) => ({ ...t, [`fixo_${id}`]: '' }))
  }
  const removerFixo = (id) => atualizarConfig({ custosFixos: config.custosFixos.filter((c) => c.id !== id) })

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
      <p className="texto-suave">Coloque os custos da loja uma vez. Depois é só trocar o custo da peça para achar o preço certo. Os valores que já vêm preenchidos são de exemplo.</p>

      <section className="cartao secao">
        <h2>1. Custo da peça</h2>
        <SeletorVariacao escolhida={produto} aoEscolher={escolherProduto} />
        <div className="grade-campos">
          <label className="campo"><span>Preço de custo da peça</span><input inputMode="decimal" value={textos.custo} onChange={(e) => mudarValor('custo', e.target.value)} /></label>
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
          {config.custosFixos.map((c) => (
            <li key={c.id}>
              <input className="campo-solto" value={c.nome} maxLength={TAMANHO.custoFixo} placeholder="Nome do custo" onChange={(e) => mudarFixo(c.id, { nome: e.target.value })} aria-label="Nome do custo" />
              <input className="campo-solto valor" inputMode="decimal" value={textos[`fixo_${c.id}`] ?? ''} onChange={(e) => mudarValor(`fixo_${c.id}`, e.target.value, (n) => mudarFixo(c.id, { valor: n }))} aria-label={`Valor de ${c.nome || 'custo'}`} />
              <button className="botao-icone" onClick={() => removerFixo(c.id)} aria-label={`Remover ${c.nome || 'custo'}`}><Icone nome="lixo" tamanho={18} /></button>
            </li>
          ))}
        </ul>
        {config.custosFixos.length < LIMITE.custosFixos
          ? <button className="botao-link" onClick={adicionarFixo}><Icone nome="somar" tamanho={16} /> Adicionar custo fixo</button>
          : <p className="texto-suave pequeno">Limite de {LIMITE.custosFixos} custos fixos. Junte os pequenos num só (ex.: "Outros").</p>}
        <label className="campo campo-estreito">
          <span>Faturamento médio por mês</span>
          <input inputMode="decimal" value={textos.faturamento} onChange={(e) => mudarValor('faturamento', e.target.value, guardarCalc('faturamento'))} />
        </label>
        <p className="texto-suave pequeno">Média das vendas dos últimos 3 meses: {formatarMoeda(faturamentoMedio)}.</p>
        {fixos.total > 0 && !(calc.faturamento ?? faturamentoMedio) && <Aviso tom="vinho">Sem o faturamento do mês, os custos fixos não entram no preço. Informe quanto a loja vende por mês.</Aviso>}
        <Aviso tom="oliva">Os custos fixos pesam <strong>{formatarPercentual(fixos.percentual)}</strong> de cada venda. Esse valor entra no preço.</Aviso>
      </section>

      <section className="cartao secao">
        <h2>4. Taxas do cartão e do banco</h2>
        <div className="segmentado">
          {Object.entries(config.empresas).map(([id, e]) => (
            <button key={id} className={empresaCalc === id ? 'ativo' : ''} onClick={() => marcarCalc({ empresa: id })}>Maquininha {e.apelido}</button>
          ))}
        </div>
        <div className="grade-campos">
          {FORMAS.map((f) => (
            <label key={f.chave} className="campo">
              <span>{f.nome} (%)</span>
              <input inputMode="decimal" value={textos[`taxa_${empresaCalc}_${f.chave}`] ?? campo(taxas[f.chave])} onChange={(e) => mudarPercentual(`taxa_${empresaCalc}_${f.chave}`, e.target.value, (n) => salvarTaxa(f.chave, n))} />
            </label>
          ))}
        </div>
        <p className="texto-suave pequeno">Tarifa mensal do banco ou da maquininha entra nos custos fixos, acima.</p>
      </section>

      <section className="cartao secao">
        <h2>5. Imposto e lucro</h2>
        <div className="grade-campos">
          <label className="campo"><span>Imposto sobre a venda (%)</span><input inputMode="decimal" value={textos.imposto} onChange={(e) => mudarPercentual('imposto', e.target.value, guardarCalc('imposto'))} /></label>
          <label className="campo"><span>Margem de lucro (%)</span><input inputMode="decimal" value={textos.margem} onChange={(e) => mudarPercentual('margem', e.target.value, guardarCalc('margem'))} /></label>
        </div>
        <p className="texto-suave pequeno">O imposto depende do regime da loja: quem informa é a contadora. A margem é o que sobra limpo, depois de pagar tudo.</p>
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
            {custo <= 0 ? 'Informe o custo da peça.' : 'Margem, taxa, imposto e custos fixos passam de 100% do preço. Diminua a margem ou reveja os custos fixos.'}
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
