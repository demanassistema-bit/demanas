import { useMemo, useState } from 'react'
import { useDemo } from '../demo/DemoContext'
import { arred, formatarMoeda, formatarPercentual, FORMAS_PAGAMENTO, CANAIS } from '../lib/moeda'
import { diasDesde } from '../lib/datas'
import { percentual } from '../demo/regras'
import Icone from '../components/Icone'
import { Metrica } from '../components/ui'

const PERIODOS = { 7: '7 dias', 30: '30 dias', 90: '90 dias' }

function baixarCSV(nome, linhas) {
  const texto = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}

export default function Relatorios() {
  const { dados, linhas, podeVerCustos } = useDemo()
  const [periodo, setPeriodo] = useState(30)
  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])

  const r = useMemo(() => {
    const vendas = dados.vendas.filter((v) => v.status === 'concluida' && diasDesde(v.data) < periodo)
    const faturamento = arred(vendas.reduce((s, v) => s + v.total, 0))
    const custo = arred(vendas.reduce((s, v) => s + v.itens.reduce((c, i) => c + i.custo_unitario * i.quantidade, 0), 0))
    const porVariacao = new Map()
    for (const v of vendas) {
      for (const i of v.itens) {
        const atual = porVariacao.get(i.variacao_id) || { qtd: 0, valor: 0 }
        porVariacao.set(i.variacao_id, { qtd: atual.qtd + i.quantidade, valor: arred(atual.valor + i.preco_unitario * i.quantidade) })
      }
    }
    const somarPor = (chave) => {
      const m = new Map()
      for (const v of vendas) {
        if (chave === 'forma') for (const p of v.pagamentos) m.set(p.forma, arred((m.get(p.forma) || 0) + p.valor))
        else m.set(v[chave], arred((m.get(v[chave]) || 0) + v.total))
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1])
    }
    // peças paradas: têm estoque e não venderam nada no período
    const ultimaVenda = new Map()
    for (const v of dados.vendas) if (v.status === 'concluida') for (const i of v.itens) ultimaVenda.set(i.variacao_id, v.data)
    const parados = linhas.filter((l) => l.saldo > 0 && (!ultimaVenda.has(l.id) || diasDesde(ultimaVenda.get(l.id)) >= 45))
    return {
      qtd: vendas.length, faturamento, custo, lucro: arred(faturamento - custo),
      ticket: vendas.length ? arred(faturamento / vendas.length) : 0,
      maisVendidos: [...porVariacao.entries()].sort((a, b) => b[1].qtd - a[1].qtd || b[1].valor - a[1].valor).slice(0, 10),
      canais: somarPor('canal'), formas: somarPor('forma'), vendedoras: somarPor('vendedora'), empresas: somarPor('empresa_id'),
      parados, ultimaVenda,
    }
  }, [dados.vendas, linhas, periodo])

  const tabela = (titulo, pares, rotulos) => (
    <section className="cartao secao">
      <h2>{titulo}</h2>
      <table className="tabela">
        <tbody>
          {pares.map(([chave, valor]) => (
            <tr key={chave}>
              <th scope="row">{rotulos ? rotulos[chave] : chave}</th>
              <td>{formatarMoeda(valor)}</td>
              <td className="texto-suave">{formatarPercentual(percentual(valor, r.faturamento))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )

  return (
    <div className="pagina">
      <header className="pagina-topo">
        <h1>Relatórios</h1>
        <div className="segmentado compacto">
          {Object.entries(PERIODOS).map(([k, n]) => (
            <button key={k} className={periodo === Number(k) ? 'ativo' : ''} onClick={() => setPeriodo(Number(k))}>{n}</button>
          ))}
        </div>
      </header>

      <section className="grade-metricas">
        <Metrica rotulo="Faturamento" valor={formatarMoeda(r.faturamento)} detalhe={`${r.qtd} vendas`} />
        <Metrica rotulo="Ticket médio" valor={formatarMoeda(r.ticket)} />
        {podeVerCustos && <Metrica rotulo="Lucro bruto" valor={formatarMoeda(r.lucro)} detalhe={`margem de ${formatarPercentual(percentual(r.lucro, r.faturamento))}`} />}
      </section>

      <section className="cartao secao">
        <header className="bloco-topo">
          <h2>Mais vendidos</h2>
          <button className="botao-link" onClick={() => baixarCSV(`mais-vendidos-${periodo}-dias.csv`, [
            ['Produto', 'Variação', 'Quantidade', 'Faturamento'],
            ...r.maisVendidos.map(([id, x]) => [linhaPorId.get(id).produto.nome, linhaPorId.get(id).nomeVariacao, x.qtd, String(x.valor).replace('.', ',')]),
          ])}><Icone nome="baixar" tamanho={16} /> Baixar planilha</button>
        </header>
        <table className="tabela">
          <thead><tr><th>Peça</th><th>Qtd.</th><th>Valor</th></tr></thead>
          <tbody>
            {r.maisVendidos.map(([id, x]) => (
              <tr key={id}>
                <th scope="row">{linhaPorId.get(id).produto.nome}<small>{linhaPorId.get(id).nomeVariacao}</small></th>
                <td>{x.qtd}</td>
                <td>{formatarMoeda(x.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grade-blocos">
        {tabela('Por CNPJ', r.empresas, Object.fromEntries(Object.entries(dados.config.empresas).map(([id, e]) => [id, e.apelido])))}
        {tabela('Por canal', r.canais, CANAIS)}
        {tabela('Por forma de pagamento', r.formas, FORMAS_PAGAMENTO)}
        {tabela('Por quem vendeu', r.vendedoras)}
      </div>

      <section className="cartao secao">
        <h2>Paradas há 45 dias ou mais</h2>
        <p className="texto-suave pequeno">Têm estoque e não venderam. Bom para promoção ou para não recomprar.</p>
        <table className="tabela">
          <thead><tr><th>Peça</th><th>Estoque</th><th>Última venda</th></tr></thead>
          <tbody>
            {r.parados.slice(0, 15).map((l) => (
              <tr key={l.id}>
                <th scope="row">{l.produto.nome}<small>{l.nomeVariacao}</small></th>
                <td>{l.saldo}</td>
                <td className="texto-suave">{r.ultimaVenda.has(l.id) ? `há ${diasDesde(r.ultimaVenda.get(l.id))} d` : 'nunca'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
