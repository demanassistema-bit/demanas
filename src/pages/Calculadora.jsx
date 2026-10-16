import { useState } from 'react'
import { useDemo } from '../demo/DemoContext'
import { arred, formatarMoeda, formatarPercentual, lerMoeda, paraCampoMoeda } from '../lib/moeda'
import { arredondarPara90, lucroDaVenda, precoMinimo, precoPelaMargem, precoPeloMultiplicador } from '../demo/regras'
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

export default function Calculadora() {
  const { dados, linhas } = useDemo()
  const taxas = dados.config.taxas

  const [produtoId, setProdutoId] = useState(null)
  const produto = linhas.find((l) => l.id === produtoId)
  const [custoTexto, setCustoTexto] = useState('38,00')
  const [outrosTexto, setOutrosTexto] = useState('2,00')
  const [modo, setModo] = useState('margem')
  const [margemTexto, setMargemTexto] = useState('50')
  const [multTexto, setMultTexto] = useState('2,5')
  const [impostoTexto, setImpostoTexto] = useState('0')
  const [formaBase, setFormaBase] = useState('credito')
  const [final90, setFinal90] = useState(true)
  const [testeTexto, setTesteTexto] = useState('')

  const custo = arred(numero(custoTexto) + numero(outrosTexto))
  const imposto = numero(impostoTexto)
  const taxaBase = taxas[formaBase] || 0

  const bruto = modo === 'margem'
    ? precoPelaMargem({ custo, margem: numero(margemTexto), taxa: taxaBase, imposto })
    : precoPeloMultiplicador(custo, numero(multTexto))
  const sugerido = final90 ? arredondarPara90(bruto) : bruto
  const minimo = precoMinimo({ custo, taxa: taxas.credito_parcelado, imposto })

  const precoTeste = numero(testeTexto) || sugerido
  const resultados = precoTeste
    ? FORMAS.map((f) => ({ ...f, taxa: taxas[f.chave] || 0, ...lucroDaVenda({ preco: precoTeste, custo, taxa: taxas[f.chave] || 0, imposto }) }))
    : []

  function escolherProduto(l) {
    setProdutoId(l?.id || null)
    if (l) {
      setCustoTexto(paraCampoMoeda(l.custo))
      setTesteTexto('')
    }
  }

  return (
    <div className="pagina pagina-estreita">
      <header className="pagina-topo">
        <div>
          <h1>Calculadora de preço</h1>
          <p className="texto-suave">Descubra o preço de venda e o lucro de verdade em cada forma de pagamento.</p>
        </div>
      </header>

      <section className="cartao secao">
        <h2>1. Quanto custa a peça</h2>
        <p className="texto-suave pequeno">Digite o custo, ou puxe de um produto já cadastrado.</p>
        <SeletorVariacao escolhida={produto} aoEscolher={escolherProduto} />
        <div className="grade-campos">
          <label className="campo"><span>Custo da peça</span><input inputMode="decimal" value={custoTexto} onChange={(e) => setCustoTexto(e.target.value)} /></label>
          <label className="campo"><span>Frete e embalagem por peça</span><input inputMode="decimal" value={outrosTexto} onChange={(e) => setOutrosTexto(e.target.value)} /></label>
        </div>
        <p className="texto-suave pequeno">Custo total: <strong>{formatarMoeda(custo)}</strong></p>
      </section>

      <section className="cartao secao">
        <h2>2. Como vocês calculam</h2>
        <div className="segmentado">
          <button className={modo === 'margem' ? 'ativo' : ''} onClick={() => setModo('margem')}>Pela margem</button>
          <button className={modo === 'multiplicador' ? 'ativo' : ''} onClick={() => setModo('multiplicador')}>Custo vezes…</button>
        </div>
        {modo === 'margem' ? (
          <>
            <label className="campo">
              <span>Margem desejada (%): quanto do preço vira lucro</span>
              <input inputMode="decimal" value={margemTexto} onChange={(e) => setMargemTexto(e.target.value)} />
            </label>
            <div className="campo">
              <span>Garantir essa margem mesmo quando pagarem no</span>
              <div className="segmentado compacto quebra">
                {FORMAS.map((f) => (
                  <button key={f.chave} className={formaBase === f.chave ? 'ativo' : ''} onClick={() => setFormaBase(f.chave)}>{f.nome}</button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <label className="campo">
            <span>Multiplicar o custo por</span>
            <input inputMode="decimal" value={multTexto} onChange={(e) => setMultTexto(e.target.value)} />
          </label>
        )}
        <label className="campo">
          <span>Imposto sobre a venda (%)</span>
          <input inputMode="decimal" value={impostoTexto} onChange={(e) => setImpostoTexto(e.target.value)} />
        </label>
        <p className="texto-suave pequeno">O percentual do imposto depende do regime da loja. Quem informa é a contadora.</p>
        <label className="campo-check"><input type="checkbox" checked={final90} onChange={(e) => setFinal90(e.target.checked)} /> Arredondar para final ,90</label>
      </section>

      <section className="cartao secao resultado-calculadora">
        {sugerido == null ? (
          <Aviso tom="vinho">
            {custo <= 0 ? 'Informe o custo da peça.' : 'Margem, taxa e imposto passam de 100% do preço. Diminua a margem.'}
          </Aviso>
        ) : (
          <>
            <span className="metrica-rotulo">Preço sugerido</span>
            <strong className="preco-sugerido">{formatarMoeda(sugerido)}</strong>
            <p className="texto-suave pequeno">
              {final90 && bruto !== sugerido && <>sem arredondar: {formatarMoeda(bruto)} · </>}
              {(sugerido / custo).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x o custo
            </p>
            {minimo && <p className="texto-suave pequeno">Abaixo de <strong>{formatarMoeda(minimo)}</strong> a loja tem prejuízo no crédito parcelado.</p>}
            {produto && (
              <p className="pequeno">Preço atual de {produto.produto.nome} ({produto.nomeVariacao}): <strong>{formatarMoeda(produto.preco)}</strong></p>
            )}
          </>
        )}
      </section>

      {resultados.length > 0 && (
        <section className="cartao secao">
          <h2>3. Quanto sobra em cada forma de pagamento</h2>
          <label className="campo campo-estreito">
            <span>Testar outro preço</span>
            <input inputMode="decimal" value={testeTexto} onChange={(e) => setTesteTexto(e.target.value)} placeholder={paraCampoMoeda(sugerido)} />
          </label>
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
          <p className="texto-suave pequeno">
            Preço de {formatarMoeda(precoTeste)}, custo de {formatarMoeda(custo)}{imposto > 0 && ` e imposto de ${formatarPercentual(imposto)}`}.
            As taxas vêm de Configurações.
          </p>
        </section>
      )}
    </div>
  )
}
