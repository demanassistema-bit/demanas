import { useState } from 'react'
import { useDemo } from '../../demo/DemoContext'
import { arred, formatarMoeda, lerMoeda, FORMAS_PAGAMENTO } from '../../lib/moeda'
import { diaDe, formatarData, formatarHora, hojeISO } from '../../lib/datas'
import { saldoEsperadoCaixa } from '../../demo/regras'
import { filtroDinheiro, lerValor, limparTexto, TAMANHO } from '../../lib/limites'
import Icone from '../../components/Icone'
import { Aviso, Selo } from '../../components/ui'

// Vendas concluídas de um dia, somadas por forma de pagamento
function vendasDoDia(vendas, dia) {
  const porForma = {}
  for (const v of vendas) {
    if (v.status !== 'concluida' || diaDe(v.data) !== dia) continue
    for (const p of v.pagamentos) porForma[p.forma] = arred((porForma[p.forma] || 0) + p.valor)
  }
  return porForma
}

const seloDiferenca = (dif) => (dif === 0
  ? <Selo tom="oliva">Conferido</Selo>
  : <Selo tom={dif < 0 ? 'vinho' : 'ambar'}>{dif < 0 ? 'Faltou' : 'Sobrou'} {formatarMoeda(Math.abs(dif))}</Selo>)

export default function Caixa() {
  const { dados, abrirCaixa, lancarNoCaixa, fecharCaixa } = useDemo()
  const hoje = hojeISO()
  const caixa = dados.caixas.find((c) => c.dia === hoje)
  const porForma = vendasDoDia(dados.vendas, hoje)
  const dinheiro = porForma.dinheiro || 0
  const totalHoje = arred(Object.values(porForma).reduce((s, v) => s + v, 0))

  const [abertura, setAbertura] = useState('100,00')
  const [lancamento, setLancamento] = useState(null) // { tipo, valor, motivo }
  const [contado, setContado] = useState('')
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState('')

  const suprimentos = caixa ? arred(caixa.lancamentos.filter((l) => l.tipo === 'suprimento').reduce((s, l) => s + l.valor, 0)) : 0
  const sangrias = caixa ? arred(caixa.lancamentos.filter((l) => l.tipo === 'sangria').reduce((s, l) => s + l.valor, 0)) : 0
  const esperado = caixa ? saldoEsperadoCaixa({ abertura: caixa.abertura, vendasDinheiro: dinheiro, lancamentos: caixa.lancamentos }) : 0
  const contadoNum = lerMoeda(contado)
  const diferenca = contadoNum == null || Number.isNaN(contadoNum) ? null : arred(contadoNum - esperado)

  function abrir(e) {
    e.preventDefault()
    const lido = lerValor(abertura, { rotulo: 'o troco da abertura', min: 0, obrigatorio: false })
    if (lido.erro) return setErro(lido.erro)
    setErro('')
    abrirCaixa(hoje, lido.valor)
  }

  function salvarLancamento(e) {
    e.preventDefault()
    const lido = lerValor(lancamento.valor)
    if (lido.erro) return setErro(lido.erro)
    const valor = lido.valor
    const motivo = limparTexto(lancamento.motivo)
    if (motivo.length < 3) return setErro('Informe o motivo: fica registrado.')
    if (lancamento.tipo === 'sangria' && valor > esperado) return setErro(`A gaveta deveria ter só ${formatarMoeda(esperado)}.`)
    lancarNoCaixa(hoje, { tipo: lancamento.tipo, valor, motivo })
    setLancamento(null); setErro('')
  }

  function fechar(e) {
    e.preventDefault()
    const lido = lerValor(contado, { rotulo: 'quanto tem na gaveta', min: 0 })
    if (lido.erro) return setErro(contado.trim() ? lido.erro : 'Conte o dinheiro da gaveta e informe o valor.')
    if (diferenca !== 0 && limparTexto(observacao).length < 3) return setErro('Houve diferença: explique o motivo antes de fechar.')
    fecharCaixa(hoje, { contado: lido.valor, observacao: limparTexto(observacao) })
    setErro('')
  }

  const historico = dados.caixas
    .filter((c) => c.fechadoEm && c.dia !== hoje)
    .sort((a, b) => b.dia.localeCompare(a.dia))
    .slice(0, 10)
    .map((c) => {
      const esp = saldoEsperadoCaixa({ abertura: c.abertura, vendasDinheiro: vendasDoDia(dados.vendas, c.dia).dinheiro || 0, lancamentos: c.lancamentos })
      return { ...c, esperado: esp, diferenca: arred(c.contado - esp) }
    })

  return (
    <div className="calculadora">
      <section className="cartao secao">
        <header className="bloco-topo">
          <h2>Vendas de hoje</h2>
          <strong>{formatarMoeda(totalHoje)}</strong>
        </header>
        <div className="fichas">
          {Object.keys(porForma).length === 0 && <span className="texto-suave pequeno">Nenhuma venda ainda hoje.</span>}
          {Object.entries(porForma).map(([forma, valor]) => <Selo key={forma}>{FORMAS_PAGAMENTO[forma]}: {formatarMoeda(valor)}</Selo>)}
        </div>
        <p className="texto-suave pequeno">Só o dinheiro em espécie passa pela gaveta. Pix e cartão aparecem em "A receber".</p>
      </section>

      {!caixa && (
        <form className="cartao secao" onSubmit={abrir}>
          <h2>Abrir o caixa</h2>
          <label className="campo campo-estreito"><span>Dinheiro na gaveta para troco</span><input inputMode="decimal" value={abertura} onChange={(e) => setAbertura(filtroDinheiro(e.target.value))} /></label>
          {erro && <Aviso tom="vinho">{erro}</Aviso>}
          <button className="botao botao-principal botao-grande">Abrir caixa de hoje</button>
        </form>
      )}

      {caixa && (
        <section className="cartao secao">
          <header className="bloco-topo">
            <h2>Caixa de hoje</h2>
            {caixa.fechadoEm ? seloDiferenca(arred(caixa.contado - esperado)) : <Selo tom="oliva">Aberto</Selo>}
          </header>
          <dl className="totais">
            <div><dt>Abertura (troco)</dt><dd>{formatarMoeda(caixa.abertura)}</dd></div>
            <div><dt>+ Vendas em dinheiro</dt><dd>{formatarMoeda(dinheiro)}</dd></div>
            {suprimentos > 0 && <div><dt>+ Suprimentos</dt><dd>{formatarMoeda(suprimentos)}</dd></div>}
            {sangrias > 0 && <div><dt>− Sangrias</dt><dd>{formatarMoeda(sangrias)}</dd></div>}
            <div className="total"><dt>Deveria ter na gaveta</dt><dd>{formatarMoeda(esperado)}</dd></div>
            {caixa.fechadoEm && <div><dt>Contado no fechamento</dt><dd>{formatarMoeda(caixa.contado)}</dd></div>}
          </dl>

          {caixa.lancamentos.length > 0 && (
            <ul className="lista lista-compacta">
              {caixa.lancamentos.map((l) => (
                <li key={l.id} className="linha-lista">
                  <span><strong>{l.tipo === 'sangria' ? 'Sangria' : 'Suprimento'}</strong><small>{formatarHora(l.hora)} · {l.motivo}</small></span>
                  <strong className={l.tipo === 'sangria' ? 'texto-negativo' : 'texto-positivo'}>{l.tipo === 'sangria' ? '−' : '+'} {formatarMoeda(l.valor)}</strong>
                </li>
              ))}
            </ul>
          )}

          {!caixa.fechadoEm && !lancamento && (
            <div className="linha-campos">
              <button className="botao botao-secundario" onClick={() => setLancamento({ tipo: 'suprimento', valor: '', motivo: '' })}><Icone nome="somar" tamanho={18} /> Suprimento</button>
              <button className="botao botao-secundario" onClick={() => setLancamento({ tipo: 'sangria', valor: '', motivo: '' })}><Icone nome="subtrair" tamanho={18} /> Sangria</button>
            </div>
          )}
          {lancamento && (
            <form className="formulario secao-interna cartao secao" onSubmit={salvarLancamento}>
              <h3>{lancamento.tipo === 'sangria' ? 'Sangria: tirar dinheiro da gaveta' : 'Suprimento: colocar dinheiro na gaveta'}</h3>
              <div className="grade-campos">
                <label className="campo"><span>Valor</span><input inputMode="decimal" value={lancamento.valor} onChange={(e) => setLancamento({ ...lancamento, valor: filtroDinheiro(e.target.value) })} autoFocus /></label>
                <label className="campo"><span>Motivo</span><input value={lancamento.motivo} onChange={(e) => setLancamento({ ...lancamento, motivo: e.target.value })} maxLength={TAMANHO.motivo} placeholder={lancamento.tipo === 'sangria' ? 'Ex.: depósito no banco' : 'Ex.: mais troco'} /></label>
              </div>
              <div className="linha-campos">
                <button type="button" className="botao botao-fantasma" onClick={() => { setLancamento(null); setErro('') }}>Cancelar</button>
                <button className="botao botao-principal">Registrar</button>
              </div>
            </form>
          )}

          {!caixa.fechadoEm && (
            <form className="formulario" onSubmit={fechar}>
              <h3>Fechar o caixa</h3>
              <label className="campo campo-estreito"><span>Quanto tem na gaveta agora?</span><input inputMode="decimal" value={contado} onChange={(e) => setContado(filtroDinheiro(e.target.value))} placeholder="Conte as notas e moedas" /></label>
              {diferenca != null && (diferenca === 0
                ? <Aviso tom="oliva">Confere certinho com o sistema.</Aviso>
                : <Aviso tom={diferenca < 0 ? 'vinho' : 'ambar'}>{diferenca < 0 ? 'Está faltando' : 'Está sobrando'} {formatarMoeda(Math.abs(diferenca))}. Explique abaixo.</Aviso>)}
              {diferenca != null && diferenca !== 0 && (
                <label className="campo"><span>O que aconteceu?</span><input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={TAMANHO.observacao} placeholder="Ex.: troco errado" /></label>
              )}
              <button className="botao botao-principal botao-grande">Fechar caixa</button>
            </form>
          )}
          {caixa.fechadoEm && (
            <p className="texto-suave pequeno">Fechado às {formatarHora(caixa.fechadoEm)}{caixa.observacao && ` · ${caixa.observacao}`}. Amanhã é só abrir de novo.</p>
          )}
          {erro && <Aviso tom="vinho">{erro}</Aviso>}
        </section>
      )}

      <section className="cartao secao">
        <h2>Últimos fechamentos</h2>
        <ul className="lista">
          {historico.map((c) => (
            <li key={c.id} className="linha-lista">
              <span><strong>{formatarData(c.dia)}</strong><small>esperado {formatarMoeda(c.esperado)} · contado {formatarMoeda(c.contado)}{c.observacao && ` · ${c.observacao}`}</small></span>
              {seloDiferenca(c.diferenca)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
