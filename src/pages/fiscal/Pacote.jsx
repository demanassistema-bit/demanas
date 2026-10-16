import { useState } from 'react'
import { arred, formatarMoeda, FORMAS_PAGAMENTO } from '../../lib/moeda'
import { diaDe, formatarDataHora, NOMES_MESES, paraISO } from '../../lib/datas'
import Icone from '../../components/Icone'
import { Aviso, Metrica } from '../../components/ui'
import { NOMES_STATUS, numeroNota, useNotas } from './comum'

function baixarCSV(nome, linhas) {
  const texto = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}

// Pacote mensal da contadora: na versão real, um .zip com todos os XMLs + este resumo
export default function Pacote() {
  const notas = useNotas()
  const agora = new Date()
  const meses = [-1, 0, -2].map((m) => {
    const d = new Date(agora.getFullYear(), agora.getMonth() + m, 1)
    return { chave: paraISO(d).slice(0, 7), nome: NOMES_MESES[d.getMonth()] }
  })
  const [mes, setMes] = useState(meses[0].chave)
  const doMes = notas.filter((n) => diaDe(n.venda.data).startsWith(mes))
  const autorizadas = doMes.filter((n) => n.status === 'autorizada')
  const pendentes = doMes.filter((n) => n.status === 'pendente' || n.status === 'enviando')
  const canceladas = doMes.filter((n) => n.status === 'cancelada')
  const total = arred(autorizadas.reduce((s, n) => s + n.venda.total, 0))
  const porForma = {}
  for (const n of autorizadas) for (const p of n.venda.pagamentos) porForma[p.forma] = arred((porForma[p.forma] || 0) + p.valor)
  const nomeMes = meses.find((m) => m.chave === mes).nome

  function baixar() {
    baixarCSV(`demanas-notas-${mes}.csv`, [
      ['NFC-e', 'Série', 'Data', 'Venda', 'Situação', 'Valor'],
      ...[...doMes].reverse().map((n) => [numeroNota(n.numero), n.serie, formatarDataHora(n.venda.data), n.venda.numero, NOMES_STATUS[n.status], String(n.venda.total).replace('.', ',')]),
    ])
  }

  return (
    <div className="calculadora">
      <div className="fichas">
        {[...meses].sort((a, b) => b.chave.localeCompare(a.chave)).map((m) => (
          <button key={m.chave} className={`ficha ${mes === m.chave ? 'ativo' : ''}`} onClick={() => setMes(m.chave)}>{m.nome}</button>
        ))}
      </div>

      <section className="grade-metricas">
        <Metrica rotulo="Notas autorizadas" valor={autorizadas.length} detalhe={formatarMoeda(total)} />
        <Metrica rotulo="Canceladas" valor={canceladas.length} />
        <Metrica rotulo="Pendentes" valor={pendentes.length} />
      </section>

      {pendentes.length > 0 && <Aviso tom="vinho">Há {pendentes.length} {pendentes.length === 1 ? 'nota pendente' : 'notas pendentes'} em {nomeMes}. Resolva antes de mandar o pacote para a contadora.</Aviso>}

      <section className="cartao secao">
        <h2>Pacote de {nomeMes} para a contadora</h2>
        <table className="tabela">
          <tbody>
            {Object.entries(porForma).sort((a, b) => b[1] - a[1]).map(([f, v]) => (
              <tr key={f}><th scope="row">{FORMAS_PAGAMENTO[f]}</th><td>{formatarMoeda(v)}</td></tr>
            ))}
            <tr className="linha-total"><th scope="row">Total autorizado</th><td>{formatarMoeda(total)}</td></tr>
          </tbody>
        </table>
        <button className="botao botao-principal botao-grande" onClick={baixar}><Icone nome="baixar" /> Baixar resumo de {nomeMes}</button>
        <p className="texto-suave pequeno">Na demonstração, sai uma planilha com todas as notas do mês. Na versão real, vem junto um arquivo com todos os XMLs autorizados e cancelados, guardados por 5 anos. Dá para mandar por e-mail para a contadora em um clique.</p>
      </section>
    </div>
  )
}
