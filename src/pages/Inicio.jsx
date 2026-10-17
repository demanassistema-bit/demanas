import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
import { useDemo } from '../demo/DemoContext'
import { useCatalogo } from '../contexts/CatalogoContext'
import { useClientes } from '../contexts/ClientesContext'
import { textoLote } from '../lib/estoque'
import { formatarMoeda, arred, CANAIS } from '../lib/moeda'
import { deISO, diaDe, hojeISO, formatarHora, NOMES_MESES, diasAte } from '../lib/datas'
import Icone from '../components/Icone'
import { Metrica, Selo, seloValidade, Vazio } from '../components/ui'
import { aniversarioNoMes, situacaoEncomenda, textoItem } from '../lib/clientes'

function saudacao() {
  const h = new Date().getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

export default function Inicio() {
  const { dados } = useDemo() // contas a pagar: ainda de exemplo até o Financeiro
  const { ativas, encomendas, clientePorId } = useClientes()
  const catalogo = useCatalogo()
  const podeVerCustos = catalogo.podeVerCustos
  const linhaReal = useMemo(() => new Map(catalogo.linhas.map((l) => [l.id, l])), [catalogo.linhas])
  const hoje = hojeISO()
  const mes = hoje.slice(0, 7)
  const mesAtual = new Date().getMonth()

  // Vendas de verdade do mês (do banco)
  const [vendasMes, setVendasMes] = useState([])
  const [custoMes, setCustoMes] = useState(0)
  useEffect(() => {
    const inicioMes = deISO(`${mes}-01`).toISOString()
    supabase.from('vendas')
      .select('id, numero, total, status, canal, criado_em, clientes(nome), venda_itens(id, quantidade)')
      .gte('criado_em', inicioMes).order('numero', { ascending: false }).limit(2000)
      .then(async ({ data }) => {
        const lista = data || []
        setVendasMes(lista)
        if (!podeVerCustos) return
        const itens = lista.filter((v) => v.status === 'concluida').flatMap((v) => v.venda_itens)
        if (!itens.length) return setCustoMes(0)
        const { data: custos } = await supabase.from('custos_venda_itens').select('venda_item_id, custo_unitario').in('venda_item_id', itens.map((i) => i.id))
        const porItem = new Map((custos || []).map((c) => [c.venda_item_id, Number(c.custo_unitario)]))
        setCustoMes(arred(itens.reduce((s, i) => s + (porItem.get(i.id) || 0) * i.quantidade, 0)))
      })
  }, [mes, podeVerCustos])

  const resumo = useMemo(() => {
    const validas = vendasMes.filter((v) => v.status === 'concluida')
    const doDia = validas.filter((v) => diaDe(v.criado_em) === hoje)
    const soma = (lista) => arred(lista.reduce((s, v) => s + Number(v.total), 0))
    return {
      dia: soma(doDia), qtdDia: doDia.length,
      mes: soma(validas), qtdMes: validas.length,
      ticket: validas.length ? arred(soma(validas) / validas.length) : 0,
      lucro: arred(soma(validas) - custoMes),
    }
  }, [vendasMes, custoMes, hoje])

  const acabando = catalogo.linhas
    .filter((l) => l.ativo && l.produto.tipo !== 'kit' && l.saldo <= l.estoque_minimo)
    .sort((a, b) => a.saldo - b.saldo)
  const vencendo = catalogo.lotesComSaldo
    .filter((l) => l.validade && diasAte(l.validade) <= 90 && linhaReal.has(l.variacao_id))
    .sort((a, b) => a.validade.localeCompare(b.validade))
  const aniversariantes = ativas
    .filter((c) => aniversarioNoMes(c.nascimento, mesAtual + 1))
    .sort((a, b) => a.nascimento.slice(8).localeCompare(b.nascimento.slice(8)))
  const ultimas = vendasMes.slice(0, 5)
  const contasProximas = (dados.contasPagar || []).filter((c) => !c.pagoEm && diasAte(c.vencimento) <= 7)
  // encomendas que pedem atenção: chegaram (avisar), atrasadas, chegando em até 7 dias
  const encomendasAtencao = encomendas
    .filter((e) => e.status === 'chegou' || (e.status === 'aguardando' && e.previsao && diasAte(e.previsao) <= 7))
    .sort((a, b) => (b.status === 'chegou') - (a.status === 'chegou') || (a.previsao || '').localeCompare(b.previsao || ''))

  return (
    <div className="pagina">
      <header className="pagina-topo">
        <div>
          <h1>{saudacao()}!</h1>
          <p className="texto-suave">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <Link to="/vender" className="botao botao-principal botao-grande"><Icone nome="vender" /> Nova venda</Link>
      </header>

      <section className="grade-metricas">
        <Metrica rotulo="Vendido hoje" valor={formatarMoeda(resumo.dia)} detalhe={`${resumo.qtdDia} ${resumo.qtdDia === 1 ? 'venda' : 'vendas'}`} />
        <Metrica rotulo={`Vendido em ${NOMES_MESES[mesAtual]}`} valor={formatarMoeda(resumo.mes)} detalhe={`${resumo.qtdMes} vendas`} />
        <Metrica rotulo="Ticket médio do mês" valor={formatarMoeda(resumo.ticket)} />
        {podeVerCustos && <Metrica rotulo="Lucro bruto do mês" valor={formatarMoeda(resumo.lucro)} detalhe="vendas menos custo das peças" />}
      </section>


      <div className="grade-blocos">
        <section className="cartao bloco">
          <header className="bloco-topo">
            <h2>Acabando</h2>
            <Link to="/estoque?filtro=minimo" className="botao-link">Ver tudo</Link>
          </header>
          {acabando.length === 0 ? <Vazio icone="confirmar" titulo="Nada abaixo do mínimo" /> : (
            <ul className="lista">
              {acabando.slice(0, 6).map((l) => (
                <li key={l.id}>
                  <Link to={`/produtos/${l.produto_id}`} className="linha-lista">
                    <span><strong>{l.produto.nome}</strong><small>{l.nomeVariacao}</small></span>
                    <Selo tom={l.saldo <= 0 ? 'vinho' : 'ambar'}>{l.saldo <= 0 ? 'Zerado' : `${l.saldo} un`}</Selo>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cartao bloco">
          <header className="bloco-topo">
            <h2>Vencendo</h2>
            <Link to="/estoque?filtro=vencendo" className="botao-link">Ver tudo</Link>
          </header>
          {vencendo.length === 0 ? <Vazio icone="confirmar" titulo="Nada vencendo em 90 dias" /> : (
            <ul className="lista">
              {vencendo.slice(0, 6).map((l) => {
                const v = linhaReal.get(l.variacao_id)
                return (
                  <li key={l.lote_id}>
                    <Link to={`/produtos/${v.produto_id}`} className="linha-lista">
                      <span><strong>{v.produto.nome}</strong><small>{v.nomeVariacao} · {textoLote(l)} · {l.saldo} un</small></span>
                      {seloValidade(l.validade)}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="cartao bloco">
          <header className="bloco-topo">
            <h2><Icone nome="presente" tamanho={18} /> Aniversariantes de {NOMES_MESES[mesAtual]}</h2>
            <Link to="/clientes?segmento=aniversario" className="botao-link">Ver tudo</Link>
          </header>
          {aniversariantes.length === 0 ? <Vazio icone="presente" titulo="Nenhuma aniversariante este mês" /> : (
            <ul className="lista">
              {aniversariantes.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link to={`/clientes/${c.id}`} className="linha-lista">
                    <span><strong>{c.nome}</strong><small>dia {Number(c.nascimento.slice(8))}</small></span>
                    <Icone nome="seguir" tamanho={16} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cartao bloco">
          <header className="bloco-topo">
            <h2><Icone nome="encomenda" tamanho={18} /> Encomendas</h2>
            <Link to="/encomendas" className="botao-link">Ver tudo</Link>
          </header>
          {encomendasAtencao.length === 0 ? <Vazio icone="confirmar" titulo="Nenhuma encomenda pedindo atenção" /> : (
            <ul className="lista">
              {encomendasAtencao.slice(0, 6).map((e) => {
                const sit = situacaoEncomenda(e, hoje)
                return (
                  <li key={e.id}>
                    <Link to="/encomendas" className="linha-lista">
                      <span><strong>{clientePorId.get(e.cliente_id)?.nome}</strong><small>{e.itens.map((i) => textoItem(i, linhaReal)).join(', ')}</small></span>
                      <Selo tom={sit.tom}>{sit.texto}</Selo>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {podeVerCustos && (
          <section className="cartao bloco">
            <header className="bloco-topo">
              <h2>Contas a vencer</h2>
              <Link to="/financeiro" className="botao-link">Financeiro</Link>
            </header>
            {contasProximas.length === 0 ? <Vazio icone="confirmar" titulo="Nada vencendo em 7 dias" /> : (
              <ul className="lista">
                {contasProximas.slice(0, 6).map((c) => {
                  const dias = diasAte(c.vencimento)
                  return (
                    <li key={c.id} className="linha-lista">
                      <span><strong>{c.descricao}</strong><small>{formatarMoeda(c.valor)}{c.fornecedor && ` · ${c.fornecedor}`}</small></span>
                      <Selo tom={dias <= 0 ? 'vinho' : 'ambar'}>{dias < 0 ? `Vencida há ${-dias} d` : dias === 0 ? 'Vence hoje' : `Vence em ${dias} d`}</Selo>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        <section className="cartao bloco">
          <header className="bloco-topo">
            <h2>Últimas vendas</h2>
            <Link to="/vendas" className="botao-link">Ver tudo</Link>
          </header>
          {ultimas.length === 0 ? <Vazio icone="vendas" titulo="Nenhuma venda este mês ainda" /> : <ul className="lista">
            {ultimas.map((v) => (
              <li key={v.id}>
                <Link to={`/vendas?venda=${v.id}`} className="linha-lista">
                  <span>
                    <strong>nº {v.numero} · {formatarMoeda(v.total)}</strong>
                    <small>{diaDe(v.criado_em) === hoje ? `hoje, ${formatarHora(v.criado_em)}` : new Date(v.criado_em).toLocaleDateString('pt-BR')} · {CANAIS[v.canal]}{v.clientes ? ` · ${v.clientes.nome.split(' ')[0]}` : ''}</small>
                  </span>
                  {v.status === 'cancelada' && <Selo tom="vinho">Cancelada</Selo>}
                </Link>
              </li>
            ))}
          </ul>}
        </section>
      </div>
    </div>
  )
}
