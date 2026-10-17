import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useDemo } from '../demo/DemoContext'
import { useCatalogo } from '../contexts/CatalogoContext'
import { textoLote } from '../lib/estoque'
import { formatarMoeda, arred, CANAIS } from '../lib/moeda'
import { diaDe, hojeISO, formatarHora, NOMES_MESES, diasAte } from '../lib/datas'
import Icone from '../components/Icone'
import { Metrica, Selo, seloValidade, Vazio } from '../components/ui'
import { situacaoEncomenda } from '../demo/regras'
import { textoItem } from './Encomendas'

function saudacao() {
  const h = new Date().getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

export default function Inicio() {
  const { dados, linhas, clientePorId, podeVerCustos } = useDemo()
  const catalogo = useCatalogo()
  const linhaReal = useMemo(() => new Map(catalogo.linhas.map((l) => [l.id, l])), [catalogo.linhas])
  const hoje = hojeISO()
  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])
  const mes = hoje.slice(0, 7)
  const mesAtual = new Date().getMonth()

  const resumo = useMemo(() => {
    const validas = dados.vendas.filter((v) => v.status === 'concluida')
    const doDia = validas.filter((v) => diaDe(v.data) === hoje)
    const doMes = validas.filter((v) => diaDe(v.data).startsWith(mes))
    const soma = (lista) => arred(lista.reduce((s, v) => s + v.total, 0))
    const custo = arred(doMes.reduce((s, v) => s + v.itens.reduce((c, i) => c + i.custo_unitario * i.quantidade, 0), 0))
    return {
      dia: soma(doDia), qtdDia: doDia.length,
      mes: soma(doMes), qtdMes: doMes.length,
      ticket: doMes.length ? arred(soma(doMes) / doMes.length) : 0,
      lucro: arred(soma(doMes) - custo),
    }
  }, [dados.vendas, hoje, mes])

  const acabando = catalogo.linhas
    .filter((l) => l.ativo && l.produto.tipo !== 'kit' && l.saldo <= l.estoque_minimo)
    .sort((a, b) => a.saldo - b.saldo)
  const vencendo = catalogo.lotesComSaldo
    .filter((l) => l.validade && diasAte(l.validade) <= 90 && linhaReal.has(l.variacao_id))
    .sort((a, b) => a.validade.localeCompare(b.validade))
  const aniversariantes = dados.clientes
    .filter((c) => c.nascimento && Number(c.nascimento.slice(5, 7)) === mesAtual + 1)
    .sort((a, b) => a.nascimento.slice(8).localeCompare(b.nascimento.slice(8)))
  const pendentes = dados.vendas.filter((v) => v.nota?.status === 'pendente')
  const ultimas = [...dados.vendas].reverse().slice(0, 5)
  const contasProximas = (dados.contasPagar || []).filter((c) => !c.pagoEm && diasAte(c.vencimento) <= 7)
  // encomendas que pedem atenção: chegaram (avisar), atrasadas, chegando em até 7 dias
  const encomendasAtencao = (dados.encomendas || [])
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

      {pendentes.length > 0 && (
        <Link to="/vendas?filtro=pendentes" className="faixa-alerta">
          <Icone nome="alerta" />
          <span><strong>{pendentes.length} {pendentes.length === 1 ? 'nota pendente' : 'notas pendentes'}</strong> · a venda está feita, falta corrigir e reenviar a nota</span>
          <Icone nome="seguir" tamanho={18} />
        </Link>
      )}

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
                      <span><strong>{clientePorId.get(e.cliente_id)?.nome}</strong><small>{e.itens.map((i) => textoItem(i, linhaPorId)).join(', ')}</small></span>
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
          <ul className="lista">
            {ultimas.map((v) => (
              <li key={v.id}>
                <Link to={`/vendas?venda=${v.id}`} className="linha-lista">
                  <span>
                    <strong>{formatarMoeda(v.total)}</strong>
                    <small>{diaDe(v.data) === hoje ? `hoje, ${formatarHora(v.data)}` : new Date(v.data).toLocaleDateString('pt-BR')} · {CANAIS[v.canal]}{v.cliente_id ? ` · ${clientePorId.get(v.cliente_id)?.nome.split(' ')[0]}` : ''}</small>
                  </span>
                  {v.status === 'cancelada' && <Selo tom="vinho">Cancelada</Selo>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
