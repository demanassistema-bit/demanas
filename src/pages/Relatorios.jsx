import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCatalogo } from '../contexts/CatalogoContext'
import { supabase, traduzirErro } from '../lib/supabase'
import { arred, formatarMoeda, formatarPercentual, CANAIS } from '../lib/moeda'
import { formatarData, hojeISO, paraISO, somarDias } from '../lib/datas'
import { NOMES_FORMAS } from '../lib/vendas'
import { analisarEstoque, curvaABC, margem, textoCSV, valorEstoque } from '../lib/relatorios'
import { percentual } from '../lib/precos'
import Icone from '../components/Icone'
import { Aviso, Metrica, Selo, Vazio } from '../components/ui'

const PERIODOS = { 7: '7 dias', 30: '30 dias', 90: '90 dias', datas: 'Escolher datas' }
const TOM_CLASSE = { A: 'oliva', B: 'ambar', C: 'neutro' }

function baixarCSV(nome, linhas) {
  const url = URL.createObjectURL(new Blob([`﻿${textoCSV(linhas)}`], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}

const BotaoPlanilha = ({ aoClicar }) => <button className="botao-link" onClick={aoClicar}><Icone nome="baixar" tamanho={16} /> Baixar planilha</button>

// Giro dos últimos 30 dias + parâmetros → análise de cada peça (usado aqui e no Início)
export function useAnaliseEstoque() {
  const { linhas, parametros } = useCatalogo()
  const [giro, setGiro] = useState(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    supabase.rpc('giro_estoque', { p_dias: 30 }).then(({ data, error }) => (error ? setErro(traduzirErro(error)) : setGiro(Array.isArray(data) ? data : [])))
  }, [])
  const analise = useMemo(() => (giro ? analisarEstoque({
    linhas,
    giro,
    dias: 30,
    diasAlerta: Number(parametros.recomprar_dias_alerta ?? 15),
    diasCobertura: Number(parametros.recomprar_dias_cobertura ?? 30),
    diasParada: Number(parametros.dias_peca_parada ?? 45),
  }) : null), [giro, linhas, parametros])
  return { analise, erro }
}

export default function Relatorios() {
  const { linhas, empresas, parametros, podeVerCustos } = useCatalogo()
  const [periodo, setPeriodo] = useState('30')
  const [datas, setDatas] = useState({ inicio: paraISO(somarDias(new Date(), -29)), fim: hojeISO() })
  const [r, setR] = useState(null)
  const [erro, setErro] = useState('')
  const { analise, erro: erroGiro } = useAnaliseEstoque()
  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])
  const diasParada = Number(parametros.dias_peca_parada ?? 45)
  const diasCobertura = Number(parametros.recomprar_dias_cobertura ?? 30)

  const intervalo = periodo === 'datas'
    ? datas
    : { inicio: paraISO(somarDias(new Date(), -(Number(periodo) - 1))), fim: hojeISO() }

  useEffect(() => {
    if (!intervalo.inicio || !intervalo.fim || intervalo.fim < intervalo.inicio) return
    setR(null)
    supabase.rpc('relatorio_vendas', { p_inicio: intervalo.inicio, p_fim: intervalo.fim })
      .then(({ data, error }) => (error ? setErro(traduzirErro(error)) : (setErro(''), setR(data))))
  }, [intervalo.inicio, intervalo.fim])

  const nomePeca = (id) => {
    const l = linhaPorId.get(id)
    return l ? [l.produto.nome, l.nomeVariacao] : ['Peça', '']
  }
  const sufixo = `${intervalo.inicio}-a-${intervalo.fim}`

  const pecas = useMemo(() => (r?.pecas || []).map((p) => ({ ...p, valor: Number(p.valor), custo: p.custo == null ? null : Number(p.custo) })), [r])
  const classes = useMemo(() => curvaABC(pecas), [pecas])
  const maisVendidas = [...pecas].sort((a, b) => b.quantidade - a.quantidade || b.valor - a.valor)
  const resumoABC = ['A', 'B', 'C'].map((c) => {
    const lista = pecas.filter((p) => classes.get(p.variacao_id) === c)
    return { classe: c, pecas: lista.length, valor: arred(lista.reduce((s, p) => s + p.valor, 0)) }
  })

  const recomprar = (analise || []).filter((l) => l.recomprar).sort((a, b) => a.cobertura - b.cobertura)
  const paradas = (analise || []).filter((l) => l.parada).sort((a, b) => b.diasSemVender - a.diasSemVender)

  const faturamento = Number(r?.faturamento || 0)
  const tabela = (titulo, pares, rotulo = (k) => k) => (
    <section className="cartao secao">
      <h2>{titulo}</h2>
      {!pares?.length ? <p className="texto-suave pequeno">Sem vendas no período.</p> : (
        <table className="tabela">
          <tbody>
            {pares.map(({ chave, valor }) => (
              <tr key={chave}>
                <th scope="row">{rotulo(chave)}</th>
                <td>{formatarMoeda(valor)}</td>
                <td className="texto-suave">{formatarPercentual(percentual(Number(valor), faturamento))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )

  return (
    <div className="pagina">
      <header className="pagina-topo">
        <h1>Relatórios</h1>
        <div className="segmentado compacto">
          {Object.entries(PERIODOS).map(([k, n]) => (
            <button key={k} className={periodo === k ? 'ativo' : ''} onClick={() => setPeriodo(k)}>{n}</button>
          ))}
        </div>
      </header>
      {periodo === 'datas' && (
        <div className="linha-campos">
          <label className="campo"><span>De</span><input type="date" value={datas.inicio} max={datas.fim} onChange={(e) => setDatas({ ...datas, inicio: e.target.value })} /></label>
          <label className="campo"><span>Até</span><input type="date" value={datas.fim} min={datas.inicio} max={hojeISO()} onChange={(e) => setDatas({ ...datas, fim: e.target.value })} /></label>
        </div>
      )}
      {(erro || erroGiro) && <Aviso tom="vinho">{erro || erroGiro}</Aviso>}

      {!r ? <p className="texto-suave">Carregando…</p> : (
        <section className="grade-metricas">
          <Metrica rotulo="Vendido" valor={formatarMoeda(faturamento)} detalhe={`${formatarData(intervalo.inicio)} a ${formatarData(intervalo.fim)}`} />
          <Metrica rotulo="Compras" valor={String(r.compras)} detalhe={Number(r.devolucoes) > 0 ? `devoluções: ${formatarMoeda(r.devolucoes)}` : 'sem devoluções'} />
          <Metrica rotulo="Ticket médio" valor={formatarMoeda(r.compras ? arred(faturamento / r.compras) : 0)} />
          {r.ve_custos && <Metrica rotulo="Lucro bruto" valor={formatarMoeda(arred(faturamento - Number(r.custo)))} detalhe={`margem de ${formatarPercentual(percentual(faturamento - Number(r.custo), faturamento))}`} />}
          {podeVerCustos && <Metrica rotulo="Estoque pelo custo" valor={formatarMoeda(valorEstoque(linhas))} detalhe="hoje" />}
        </section>
      )}

      <section className="cartao secao">
        <header className="bloco-topo">
          <h2><Icone nome="estoque" tamanho={18} /> O que recomprar</h2>
          {recomprar.length > 0 && <BotaoPlanilha aoClicar={() => baixarCSV('recomprar.csv', [
            ['Produto', 'Variação', 'Estoque', 'Vendeu em 30 dias', 'Dura (dias)', 'Pedir'],
            ...recomprar.map((l) => [l.produto.nome, l.nomeVariacao, l.saldo, l.saiu, l.cobertura, l.pedir]),
          ])} />}
        </header>
        <p className="texto-suave pequeno">Peças que vendem e acabam em menos de {parametros.recomprar_dias_alerta ?? 15} dias, no ritmo dos últimos 30. "Pedir" cobre {diasCobertura} dias. Os prazos mudam em <Link to="/configuracoes">Configurações</Link>.</p>
        {!analise ? <p className="texto-suave">Carregando…</p> : recomprar.length === 0 ? <Vazio icone="confirmar" titulo="Nada para recomprar agora" /> : (
          <table className="tabela">
            <thead><tr><th>Peça</th><th>Estoque</th><th>Dura</th><th>Pedir</th></tr></thead>
            <tbody>
              {recomprar.map((l) => (
                <tr key={l.id}>
                  <th scope="row"><Link to={`/produtos/${l.produto_id}`}>{l.produto.nome}</Link><small>{l.nomeVariacao} · vendeu {l.saiu} em 30 dias</small></th>
                  <td>{l.saldo}</td>
                  <td><Selo tom={l.cobertura <= 3 ? 'vinho' : 'ambar'}>{l.cobertura === 0 ? 'acabou' : `${l.cobertura} d`}</Selo></td>
                  <td><strong>{l.pedir}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {r && (
        <>
          <section className="cartao secao">
            <header className="bloco-topo">
              <h2>Mais vendidas</h2>
              {maisVendidas.length > 0 && <BotaoPlanilha aoClicar={() => baixarCSV(`mais-vendidas-${sufixo}.csv`, [
                ['Produto', 'Variação', 'Quantidade', 'Faturamento', 'Curva', ...(r.ve_custos ? ['Custo', 'Margem (%)'] : [])],
                ...maisVendidas.map((p) => [...nomePeca(p.variacao_id), p.quantidade, p.valor, classes.get(p.variacao_id), ...(r.ve_custos ? [p.custo, margem(p)] : [])]),
              ])} />}
            </header>
            {maisVendidas.length === 0 ? <Vazio icone="vendas" titulo="Sem vendas no período" /> : (
              <table className="tabela">
                <thead><tr><th>Peça</th><th>Qtd.</th><th>Valor</th>{r.ve_custos && <th>Margem</th>}</tr></thead>
                <tbody>
                  {maisVendidas.slice(0, 15).map((p) => {
                    const [nome, variacao] = nomePeca(p.variacao_id)
                    const m = margem(p)
                    return (
                      <tr key={p.variacao_id}>
                        <th scope="row">{nome} <Selo tom={TOM_CLASSE[classes.get(p.variacao_id)]}>{classes.get(p.variacao_id)}</Selo><small>{variacao}</small></th>
                        <td>{p.quantidade}</td>
                        <td>{formatarMoeda(p.valor)}</td>
                        {r.ve_custos && <td className={m != null && m < 0 ? 'texto-negativo' : 'texto-suave'}>{m == null ? '—' : formatarPercentual(m)}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>

          {pecas.length > 0 && (
            <section className="cartao secao">
              <h2>Curva ABC</h2>
              <p className="texto-suave pequeno">A = as peças que fazem 80% do que a loja vende: nunca podem faltar. B = os próximos 15%. C = o resto: compre com cuidado.</p>
              <table className="tabela">
                <tbody>
                  {resumoABC.map((c) => (
                    <tr key={c.classe}>
                      <th scope="row"><Selo tom={TOM_CLASSE[c.classe]}>{c.classe}</Selo> {c.pecas} {c.pecas === 1 ? 'peça' : 'peças'}</th>
                      <td>{formatarMoeda(c.valor)}</td>
                      <td className="texto-suave">{formatarPercentual(percentual(c.valor, faturamento))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <div className="grade-blocos">
            {tabela('Por CNPJ', r.por.empresa, (k) => empresas[k]?.apelido || k)}
            {tabela('Por canal', r.por.canal, (k) => CANAIS[k] || k)}
            {tabela('Por forma de pagamento', r.por.forma, (k) => NOMES_FORMAS[k] || k)}
            {tabela('Por quem vendeu', r.por.vendedora)}
          </div>

          <section className="cartao secao">
            <header className="bloco-topo">
              <h2>Melhores clientes do período</h2>
              <Link to="/clientes?segmento=melhores" className="botao-link">Clientes</Link>
            </header>
            {r.clientes.length === 0 ? <p className="texto-suave pequeno">Nenhuma venda com cliente no período.</p> : (
              <table className="tabela">
                <tbody>
                  {r.clientes.map((c) => (
                    <tr key={c.cliente_id}>
                      <th scope="row"><Link to={`/clientes/${c.cliente_id}`}>{c.nome}</Link><small>{c.compras} {c.compras === 1 ? 'compra' : 'compras'}</small></th>
                      <td>{formatarMoeda(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      <section className="cartao secao">
        <header className="bloco-topo">
          <h2>Paradas há {diasParada} dias ou mais</h2>
          {paradas.length > 0 && <BotaoPlanilha aoClicar={() => baixarCSV('pecas-paradas.csv', [
            ['Produto', 'Variação', 'Estoque', 'Dias sem vender', ...(podeVerCustos ? ['Valor parado (custo)'] : [])],
            ...paradas.map((l) => [l.produto.nome, l.nomeVariacao, l.saldo, l.diasSemVender, ...(podeVerCustos ? [l.custo != null ? arred(l.custo * l.saldo) : ''] : [])]),
          ])} />}
        </header>
        <p className="texto-suave pequeno">Têm estoque e não venderam. Bom para promoção ou para não recomprar.{podeVerCustos && paradas.length > 0 && ` Dinheiro parado nelas: ${formatarMoeda(valorEstoque(paradas))}.`}</p>
        {!analise ? <p className="texto-suave">Carregando…</p> : paradas.length === 0 ? <Vazio icone="confirmar" titulo="Nenhuma peça parada" /> : (
          <table className="tabela">
            <thead><tr><th>Peça</th><th>Estoque</th><th>Sem vender</th></tr></thead>
            <tbody>
              {paradas.slice(0, 30).map((l) => (
                <tr key={l.id}>
                  <th scope="row"><Link to={`/produtos/${l.produto_id}`}>{l.produto.nome}</Link><small>{l.nomeVariacao}</small></th>
                  <td>{l.saldo}</td>
                  <td className="texto-suave">{l.diasSemVender} d{l.nuncaVendeu ? ' (nunca vendeu)' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
