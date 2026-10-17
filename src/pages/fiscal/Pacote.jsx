import { useEffect, useState } from 'react'
import { buscarTudo, supabase, traduzirErro } from '../../lib/supabase'
import { arred, formatarMoeda } from '../../lib/moeda'
import { diaDe, formatarDataHora, NOMES_MESES, paraISO } from '../../lib/datas'
import { NOMES_FORMAS } from '../../lib/vendas'
import { textoCSV } from '../../lib/relatorios'
import Icone from '../../components/Icone'
import { Aviso, Metrica } from '../../components/ui'
import { NOMES_STATUS, numeroNota } from './comum'

function baixarCSV(nome, linhas) {
  const url = URL.createObjectURL(new Blob([`﻿${textoCSV(linhas)}`], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}

// Pacote mensal da contadora: resumo, planilha de todas as notas e os XMLs (quando o serviço de verdade estiver ligado)
export default function Pacote() {
  const agora = new Date()
  const meses = [-1, 0, -2].map((m) => {
    const d = new Date(agora.getFullYear(), agora.getMonth() + m, 1)
    return { chave: paraISO(d).slice(0, 7), nome: NOMES_MESES[d.getMonth()] }
  })
  const [mes, setMes] = useState(meses[0].chave)
  const [notas, setNotas] = useState(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    // a venda do último dia pode virar nota no dia seguinte: busca com uma folga e filtra pela data da nota
    const [a, m] = mes.split('-').map(Number)
    const de = new Date(a, m - 1, 1).toISOString()
    const ate = new Date(a, m, 2).toISOString()
    setNotas(null)
    buscarTudo(() => supabase.from('documentos_fiscais').select('*, vendas(numero)').gte('criado_em', de).lt('criado_em', ate).order('id'))
      .then(({ data, error }) => (error ? setErro(traduzirErro(error)) : setNotas(data.map((n) => ({ ...n, valor_total: Number(n.valor_total) })).sort((x, y) => y.criado_em.localeCompare(x.criado_em)))))
  }, [mes])
  if (!notas) return <div className="calculadora">{erro ? <Aviso tom="vinho">{erro}</Aviso> : <p className="texto-suave">Carregando…</p>}</div>

  // a nota conta no mês da emissão (ou da venda, se ainda não saiu)
  const doMes = notas.filter((n) => diaDe(n.emitida_em || n.criado_em).startsWith(mes) && n.status !== 'descartada')
  const autorizadas = doMes.filter((n) => n.status === 'autorizada')
  const pendentes = doMes.filter((n) => !['autorizada', 'cancelada'].includes(n.status))
  const canceladas = doMes.filter((n) => n.status === 'cancelada')
  const total = arred(autorizadas.reduce((s, n) => s + n.valor_total, 0))
  const porForma = {}
  for (const n of autorizadas) for (const p of n.documento.pagamentos) porForma[p.forma] = arred((porForma[p.forma] || 0) + Number(p.valor))
  const comXml = doMes.filter((n) => n.url_xml)
  const nomeMes = meses.find((m) => m.chave === mes).nome

  function baixar() {
    baixarCSV(`demanas-notas-${mes}.csv`, [
      ['NFC-e', 'Série', 'Data', 'Venda', 'Situação', 'Valor', 'CPF', 'Chave de acesso', 'Protocolo', 'XML'],
      ...[...doMes].reverse().map((n) => [numeroNota(n.numero), n.serie, formatarDataHora(n.emitida_em || n.criado_em), n.vendas?.numero,
        NOMES_STATUS[n.status], n.valor_total, n.documento.consumidor?.cpf || '', n.chave || '', n.protocolo || '', n.url_xml || '']),
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
        <Metrica rotulo="Pendentes ou na fila" valor={pendentes.length} />
      </section>

      {pendentes.length > 0 && <Aviso tom="vinho">Há {pendentes.length} {pendentes.length === 1 ? 'nota pendente ou na fila' : 'notas pendentes ou na fila'} em {nomeMes}. Resolva antes de mandar o pacote para a contadora.</Aviso>}

      <section className="cartao secao">
        <h2>Pacote de {nomeMes} para a contadora</h2>
        <table className="tabela">
          <tbody>
            {Object.entries(porForma).sort((a, b) => b[1] - a[1]).map(([f, v]) => (
              <tr key={f}><th scope="row">{NOMES_FORMAS[f] || f}</th><td>{formatarMoeda(v)}</td></tr>
            ))}
            <tr className="linha-total"><th scope="row">Total autorizado</th><td>{formatarMoeda(total)}</td></tr>
          </tbody>
        </table>
        <button className="botao botao-principal botao-grande" onClick={baixar} disabled={!doMes.length}><Icone nome="baixar" /> Baixar planilha de {nomeMes}</button>
        {comXml.length > 0 ? (
          <details className="perfil-fiscal">
            <summary><strong>XMLs do mês ({comXml.length})</strong></summary>
            <ul className="lista-simples">
              {comXml.map((n) => <li key={n.id}><a href={n.url_xml} target="_blank" rel="noreferrer">NFC-e {numeroNota(n.numero)}</a></li>)}
            </ul>
          </details>
        ) : (
          <p className="texto-suave pequeno">No teste simulado não há XML (a nota não existe na SEFAZ). Com o serviço de emissão contratado, os XMLs autorizados e cancelados ficam guardados lá por 5 anos e aparecem aqui.</p>
        )}
      </section>
    </div>
  )
}
