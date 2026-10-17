import { useEffect, useState } from 'react'
import { buscarTudo, supabase, traduzirErro } from '../../lib/supabase'
import { formatarMoeda, formatarPercentual } from '../../lib/moeda'
import { formatarData, hojeISO, NOMES_MESES, paraISO } from '../../lib/datas'
import { CATEGORIAS_DESPESA, fluxoSemanas } from '../../lib/financeiro'
import { percentual } from '../../lib/precos'
import { Aviso } from '../../components/ui'

export default function Resultado() {
  const agora = new Date()
  const meses = [0, -1, -2].map((m) => {
    const d = new Date(agora.getFullYear(), agora.getMonth() + m, 1)
    return { chave: paraISO(d), nome: NOMES_MESES[d.getMonth()] }
  })
  const [mes, setMes] = useState(meses[0].chave)
  const [r, setR] = useState(null)
  const [semanas, setSemanas] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    setR(null)
    supabase.rpc('resultado_mes', { p_mes: mes }).then(({ data, error }) => (error ? setErro(traduzirErro(error)) : setR(data)))
  }, [mes])

  useEffect(() => {
    Promise.all([
      buscarTudo(() => supabase.from('recebiveis').select('data_prevista, liquido, status').eq('status', 'a_receber').order('id')),
      buscarTudo(() => supabase.from('contas_pagar').select('vencimento, valor, pago_em').is('pago_em', null).order('id')),
    ]).then(([rec, contas]) => {
      if (rec.error || contas.error) return setErro(traduzirErro(rec.error || contas.error))
      setSemanas(fluxoSemanas({ recebiveis: rec.data, contas: contas.data, hoje: hojeISO() }))
    })
  }, [])

  const nomeMes = meses.find((m) => m.chave === mes).nome
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
      {erro && <Aviso tom="vinho">{erro}</Aviso>}

      <section className="cartao secao">
        <h2>Resultado de {nomeMes}</h2>
        {mes === meses[0].chave && (
          <p className="aviso aviso-ambar pequeno">Mês em andamento: as despesas do mês inteiro já aparecem, mas as vendas só até hoje. O resultado final sai no último dia.</p>
        )}
        {!r ? <p className="texto-suave">Carregando…</p> : (
          <table className="tabela">
            <tbody>
              {linha('Vendas', Number(r.faturamento), { sinal: '' })}
              {r.por_empresa.map((e) => (
                <tr key={e.id} className="linha-sub"><th scope="row">{e.apelido}</th><td>{formatarMoeda(e.vendas)}</td><td className="texto-suave">{formatarPercentual(percentual(Number(e.vendas), Number(r.faturamento)))}</td></tr>
              ))}
              {Number(r.devolucoes) > 0 && linha('Devoluções', Number(r.devolucoes))}
              {linha('Taxas da maquininha', Number(r.taxas))}
              {Number(r.imposto) > 0 && linha('Imposto (estimado)', Number(r.imposto))}
              {linha('Custo das peças vendidas', Number(r.custo_pecas))}
              {linha('Lucro bruto', Number(r.lucro_bruto), { sinal: '=', forte: true })}
              {Object.entries(r.despesas).sort((a, b) => b[1] - a[1]).map(([cat, valor]) => (
                <tr key={cat}><th scope="row">− {CATEGORIAS_DESPESA[cat] || cat}</th><td>{formatarMoeda(valor)}</td><td className="texto-suave">{formatarPercentual(percentual(Number(valor), Number(r.faturamento)))}</td></tr>
              ))}
              {linha('Resultado do mês', Number(r.resultado), { sinal: '=', forte: true, tom: Number(r.resultado) < 0 ? 'texto-negativo' : 'texto-positivo' })}
            </tbody>
          </table>
        )}
        {r && (
          <p className="texto-suave pequeno">
            Resultado da loja inteira (os dois CNPJs juntos), porque o estoque e as despesas são compartilhados. A contadora fecha cada CNPJ separado.
            As despesas contam no mês do vencimento, pagas ou não. A compra de mercadoria ({formatarMoeda(r.compras_mercadoria)} neste mês) não entra aqui: o custo de cada peça já entra quando ela é vendida.
            {' '}Imposto: {r.por_empresa.map((e) => `${e.apelido} ${formatarPercentual(Number(e.imposto_percentual), 2)}`).join(', ')} sobre as vendas (muda em Configurações, conforme a contadora).
          </p>
        )}
      </section>

      <section className="cartao secao">
        <h2>Fluxo de caixa: próximas 4 semanas</h2>
        {!semanas ? <p className="texto-suave">Carregando…</p> : (
          <table className="tabela">
            <thead><tr><th>Até</th><th>Entra</th><th>Sai</th><th>Saldo</th></tr></thead>
            <tbody>
              {semanas.map((w) => (
                <tr key={w.s}>
                  <th scope="row">{formatarData(w.fim).slice(0, 5)}<small>{w.s === 0 ? 'esta semana, com as atrasadas' : `semana ${w.s + 1}`}</small></th>
                  <td className="texto-positivo">{formatarMoeda(w.entradas)}</td>
                  <td className="texto-negativo">{formatarMoeda(w.saidas)}</td>
                  <td className={w.saldo < 0 ? 'texto-negativo' : ''}><strong>{formatarMoeda(w.saldo)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="texto-suave pequeno">"Entra" é só o que já foi vendido no cartão. As vendas novas, em Pix e dinheiro, somam por cima.</p>
      </section>
    </div>
  )
}
