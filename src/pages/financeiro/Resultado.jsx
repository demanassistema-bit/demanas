import { useMemo, useState } from 'react'
import { useDemo } from '../../demo/DemoContext'
import { arred, formatarMoeda, formatarPercentual } from '../../lib/moeda'
import { diaDe, formatarData, hojeISO, NOMES_MESES, paraISO, somarDias } from '../../lib/datas'
import { CATEGORIAS_DESPESA, percentual, resultadoDoMes } from '../../demo/regras'
import { useRecebiveis } from './AReceber'

export default function Resultado() {
  const { dados } = useDemo()
  const recebiveis = useRecebiveis()
  const agora = new Date()
  const meses = [0, -1, -2].map((m) => {
    const d = new Date(agora.getFullYear(), agora.getMonth() + m, 1)
    return { chave: paraISO(d).slice(0, 7), nome: NOMES_MESES[d.getMonth()] }
  })
  const [mes, setMes] = useState(meses[0].chave)

  const r = useMemo(() => resultadoDoMes({
    vendas: dados.vendas.filter((v) => v.status === 'concluida' && diaDe(v.data).startsWith(mes)),
    contas: dados.contasPagar.filter((c) => c.vencimento.startsWith(mes)),
    taxas: dados.config.taxas,
    imposto: dados.config.calculadora?.imposto || 0,
  }), [dados.vendas, dados.contasPagar, dados.config, mes])

  // Fluxo de caixa das próximas 4 semanas: o que entra do cartão × o que sai de contas em aberto
  const semanas = useMemo(() => {
    const hoje = hojeISO()
    return [0, 1, 2, 3].map((s) => {
      const inicio = s === 0 ? '0000-00-00' : paraISO(somarDias(agora, s * 7))
      const fim = paraISO(somarDias(agora, s * 7 + 6))
      const entradas = arred(recebiveis.filter((x) => x.data >= (s === 0 ? hoje : inicio) && x.data <= fim).reduce((t, x) => t + x.liquido, 0))
      const saidas = arred(dados.contasPagar.filter((c) => !c.pagoEm && c.vencimento >= inicio && c.vencimento <= fim).reduce((t, c) => t + c.valor, 0))
      return { s, fim, entradas, saidas, saldo: arred(entradas - saidas) }
    })
  }, [recebiveis, dados.contasPagar]) // eslint-disable-line react-hooks/exhaustive-deps

  const linha = (nome, valor, { sinal = '−', forte, tom } = {}) => (
    <tr className={forte ? 'linha-total' : ''}>
      <th scope="row">{sinal && `${sinal} `}{nome}</th>
      <td className={tom || (valor < 0 ? 'texto-negativo' : '')}>{formatarMoeda(valor)}</td>
      <td className="texto-suave">{formatarPercentual(percentual(valor, r.faturamento))}</td>
    </tr>
  )

  return (
    <div className="calculadora">
      <div className="fichas">
        {meses.map((m) => <button key={m.chave} className={`ficha ${mes === m.chave ? 'ativo' : ''}`} onClick={() => setMes(m.chave)}>{m.nome}</button>)}
      </div>

      <section className="cartao secao">
        <h2>Resultado de {meses.find((m) => m.chave === mes).nome}</h2>
        {mes === meses[0].chave && (
          <p className="aviso aviso-ambar pequeno">Mês em andamento: as despesas do mês inteiro já aparecem, mas as vendas só até hoje. O resultado final sai no último dia.</p>
        )}
        <table className="tabela">
          <tbody>
            {linha('Vendas', r.faturamento, { sinal: '' })}
            {linha('Taxas da maquininha', r.valorTaxas)}
            {r.valorImposto > 0 && linha('Imposto (estimado)', r.valorImposto)}
            {linha('Custo das peças vendidas', r.custoPecas)}
            {linha('Lucro bruto', r.lucroBruto, { sinal: '=', forte: true })}
            {Object.entries(r.porCategoria).sort((a, b) => b[1] - a[1]).map(([cat, valor]) => (
              <tr key={cat}><th scope="row">− {CATEGORIAS_DESPESA[cat]}</th><td>{formatarMoeda(valor)}</td><td className="texto-suave">{formatarPercentual(percentual(valor, r.faturamento))}</td></tr>
            ))}
            {linha('Resultado do mês', r.resultado, { sinal: '=', forte: true, tom: r.resultado < 0 ? 'texto-negativo' : 'texto-positivo' })}
          </tbody>
        </table>
        <p className="texto-suave pequeno">
          As despesas contam no mês do vencimento, pagas ou não. A compra de mercadoria não entra aqui: o custo de cada peça já entra quando ela é vendida.
          {r.valorImposto === 0 && ' O imposto está em 0%: preencha o percentual na Calculadora quando a contadora informar.'}
        </p>
      </section>

      <section className="cartao secao">
        <h2>Fluxo de caixa: próximas 4 semanas</h2>
        <table className="tabela">
          <thead><tr><th>Até</th><th>Entra</th><th>Sai</th><th>Saldo</th></tr></thead>
          <tbody>
            {semanas.map((w) => (
              <tr key={w.s}>
                <th scope="row">{formatarData(w.fim).slice(0, 5)}<small>{w.s === 0 ? 'esta semana, com as vencidas' : `semana ${w.s + 1}`}</small></th>
                <td className="texto-positivo">{formatarMoeda(w.entradas)}</td>
                <td className="texto-negativo">{formatarMoeda(w.saidas)}</td>
                <td className={w.saldo < 0 ? 'texto-negativo' : ''}><strong>{formatarMoeda(w.saldo)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="texto-suave pequeno">"Entra" é só o que já foi vendido no cartão. As vendas novas, em Pix e dinheiro, somam por cima.</p>
      </section>
    </div>
  )
}
