import { useCallback, useEffect, useState } from 'react'
import { supabase, traduzirErro } from '../../lib/supabase'
import { arred, formatarMoeda, lerMoeda } from '../../lib/moeda'
import { formatarData, formatarHora } from '../../lib/datas'
import { filtroDinheiro, lerValor, limparTexto, TAMANHO } from '../../lib/limites'
import { NOMES_FORMAS } from '../../lib/vendas'
import Icone from '../../components/Icone'
import { Aviso, Selo } from '../../components/ui'

const seloDiferenca = (dif) => (dif === 0
  ? <Selo tom="oliva">Conferido</Selo>
  : <Selo tom={dif < 0 ? 'vinho' : 'ambar'}>{dif < 0 ? 'Faltou' : 'Sobrou'} {formatarMoeda(Math.abs(dif))}</Selo>)

// Caixa do dia: só o dinheiro em espécie passa pela gaveta. O banco calcula quanto deveria ter.
export default function Caixa() {
  const [resumo, setResumo] = useState(null)
  const [historico, setHistorico] = useState([])
  const [abertura, setAbertura] = useState('100,00')
  const [lancamento, setLancamento] = useState(null) // { tipo, valor, motivo }
  const [contado, setContado] = useState('')
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  const carregar = useCallback(async () => {
    const [r, h] = await Promise.all([
      supabase.rpc('resumo_caixa'),
      supabase.from('caixas').select('*').not('fechado_em', 'is', null).order('dia', { ascending: false }).limit(11),
    ])
    if (r.error) return setErro(traduzirErro(r.error))
    setResumo(r.data)
    setHistorico((h.data || []).filter((c) => c.dia !== r.data.dia).slice(0, 10))
  }, [])
  useEffect(() => { carregar() }, [carregar])

  // Executa e recarrega; devolve true se deu certo
  async function executar(promessa) {
    setErro('')
    setEnviando(true)
    const { error } = await promessa
    setEnviando(false)
    if (error) { setErro(traduzirErro(error)); return false }
    await carregar()
    return true
  }

  if (!resumo) return <div className="calculadora">{erro ? <Aviso tom="vinho">{erro}</Aviso> : <p className="texto-suave">Carregando…</p>}</div>

  const caixa = resumo.caixa
  const esperado = Number(resumo.esperado || 0)
  const porForma = Object.entries(resumo.vendas_por_forma || {})
  const totalHoje = arred(porForma.reduce((s, [, v]) => s + Number(v), 0))
  const contadoNum = lerMoeda(contado)
  const diferenca = contadoNum == null || Number.isNaN(contadoNum) ? null : arred(contadoNum - esperado)

  function abrir(e) {
    e.preventDefault()
    const lido = lerValor(abertura, { rotulo: 'o troco da abertura', min: 0, obrigatorio: false })
    if (lido.erro) return setErro(lido.erro)
    executar(supabase.rpc('abrir_caixa', { p_abertura: lido.valor }))
  }

  async function salvarLancamento(e) {
    e.preventDefault()
    const lido = lerValor(lancamento.valor)
    if (lido.erro) return setErro(lido.erro)
    const motivo = limparTexto(lancamento.motivo)
    if (motivo.length < 3) return setErro('Informe o motivo: fica registrado.')
    if (lancamento.tipo === 'sangria' && lido.valor > esperado) return setErro(`A gaveta deveria ter só ${formatarMoeda(esperado)}.`)
    if (await executar(supabase.rpc('lancar_caixa', { p_tipo: lancamento.tipo, p_valor: lido.valor, p_motivo: motivo }))) setLancamento(null)
  }

  function fechar(e) {
    e.preventDefault()
    const lido = lerValor(contado, { rotulo: 'quanto tem na gaveta', min: 0 })
    if (lido.erro) return setErro(contado.trim() ? lido.erro : 'Conte o dinheiro da gaveta e informe o valor.')
    if (diferenca !== 0 && limparTexto(observacao).length < 3) return setErro('Houve diferença: explique o motivo antes de fechar.')
    executar(supabase.rpc('fechar_caixa', { p_contado: lido.valor, p_observacao: limparTexto(observacao) }))
  }

  return (
    <div className="calculadora">
      <section className="cartao secao">
        <header className="bloco-topo">
          <h2>Vendas de hoje</h2>
          <strong>{formatarMoeda(totalHoje)}</strong>
        </header>
        <div className="fichas">
          {porForma.length === 0 && <span className="texto-suave pequeno">Nenhuma venda ainda hoje.</span>}
          {porForma.map(([forma, valor]) => <Selo key={forma}>{NOMES_FORMAS[forma] || forma}: {formatarMoeda(valor)}</Selo>)}
        </div>
        <p className="texto-suave pequeno">Só o dinheiro em espécie passa pela gaveta. Cartão aparece em "A receber"; Pix cai direto na conta.</p>
      </section>

      {!caixa && (
        <form className="cartao secao" onSubmit={abrir}>
          <h2>Abrir o caixa</h2>
          {Number(resumo.dinheiro) > 0 && <Aviso tom="ambar">Já houve venda em dinheiro hoje ({formatarMoeda(resumo.dinheiro)}). Ela entra na conta da gaveta quando o caixa for aberto.</Aviso>}
          <label className="campo campo-estreito"><span>Dinheiro na gaveta para troco</span><input inputMode="decimal" value={abertura} onChange={(e) => setAbertura(filtroDinheiro(e.target.value))} /></label>
          {erro && <Aviso tom="vinho">{erro}</Aviso>}
          <button className="botao botao-principal botao-grande" disabled={enviando}>Abrir caixa de hoje</button>
        </form>
      )}

      {caixa && (
        <section className="cartao secao">
          <header className="bloco-topo">
            <h2>Caixa de hoje</h2>
            {caixa.fechado_em ? seloDiferenca(arred(caixa.contado - caixa.esperado)) : <Selo tom="oliva">Aberto</Selo>}
          </header>
          <dl className="totais">
            <div><dt>Abertura (troco)</dt><dd>{formatarMoeda(caixa.abertura)}</dd></div>
            <div><dt>+ Vendas em dinheiro</dt><dd>{formatarMoeda(resumo.dinheiro)}</dd></div>
            {Number(resumo.sinais) > 0 && <div><dt>+ Sinais de encomenda</dt><dd>{formatarMoeda(resumo.sinais)}</dd></div>}
            {Number(resumo.devolucoes) > 0 && <div><dt>− Devoluções em dinheiro</dt><dd>{formatarMoeda(resumo.devolucoes)}</dd></div>}
            {Number(resumo.suprimentos) > 0 && <div><dt>+ Suprimentos</dt><dd>{formatarMoeda(resumo.suprimentos)}</dd></div>}
            {Number(resumo.sangrias) > 0 && <div><dt>− Sangrias</dt><dd>{formatarMoeda(resumo.sangrias)}</dd></div>}
            <div className="total"><dt>Deveria ter na gaveta</dt><dd>{formatarMoeda(caixa.fechado_em ? caixa.esperado : esperado)}</dd></div>
            {caixa.fechado_em && <div><dt>Contado no fechamento</dt><dd>{formatarMoeda(caixa.contado)}</dd></div>}
          </dl>

          {resumo.lancamentos.length > 0 && (
            <ul className="lista lista-compacta">
              {resumo.lancamentos.map((l) => (
                <li key={l.id} className="linha-lista">
                  <span><strong>{l.tipo === 'sangria' ? 'Sangria' : 'Suprimento'}</strong><small>{formatarHora(l.criado_em)} · {l.motivo}{l.usuario_nome && ` · ${l.usuario_nome}`}</small></span>
                  <strong className={l.tipo === 'sangria' ? 'texto-negativo' : 'texto-positivo'}>{l.tipo === 'sangria' ? '−' : '+'} {formatarMoeda(l.valor)}</strong>
                </li>
              ))}
            </ul>
          )}

          {!caixa.fechado_em && !lancamento && (
            <div className="linha-campos">
              <button className="botao botao-secundario" onClick={() => { setErro(''); setLancamento({ tipo: 'suprimento', valor: '', motivo: '' }) }}><Icone nome="somar" tamanho={18} /> Suprimento</button>
              <button className="botao botao-secundario" onClick={() => { setErro(''); setLancamento({ tipo: 'sangria', valor: '', motivo: '' }) }}><Icone nome="subtrair" tamanho={18} /> Sangria</button>
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
                <button className="botao botao-principal" disabled={enviando}>Registrar</button>
              </div>
            </form>
          )}

          {!caixa.fechado_em && (
            <form className="formulario" onSubmit={fechar}>
              <h3>Fechar o caixa</h3>
              <label className="campo campo-estreito"><span>Quanto tem na gaveta agora?</span><input inputMode="decimal" value={contado} onChange={(e) => setContado(filtroDinheiro(e.target.value))} placeholder="Conte as notas e moedas" /></label>
              {diferenca != null && (diferenca === 0
                ? <Aviso tom="oliva">Confere certinho com o sistema.</Aviso>
                : <Aviso tom={diferenca < 0 ? 'vinho' : 'ambar'}>{diferenca < 0 ? 'Está faltando' : 'Está sobrando'} {formatarMoeda(Math.abs(diferenca))}. Explique abaixo.</Aviso>)}
              {diferenca != null && diferenca !== 0 && (
                <label className="campo"><span>O que aconteceu?</span><input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={TAMANHO.observacao} placeholder="Ex.: troco errado" /></label>
              )}
              <button className="botao botao-principal botao-grande" disabled={enviando}>Fechar caixa</button>
            </form>
          )}
          {caixa.fechado_em && (
            <p className="texto-suave pequeno">Fechado às {formatarHora(caixa.fechado_em)}{caixa.observacao && ` · ${caixa.observacao}`}. Amanhã é só abrir de novo.</p>
          )}
          {erro && <Aviso tom="vinho">{erro}</Aviso>}
        </section>
      )}

      <section className="cartao secao">
        <h2>Últimos fechamentos</h2>
        {historico.length === 0 ? <p className="texto-suave pequeno">Os fechamentos aparecem aqui.</p> : (
          <ul className="lista">
            {historico.map((c) => (
              <li key={c.id} className="linha-lista">
                <span><strong>{formatarData(c.dia)}</strong><small>esperado {formatarMoeda(c.esperado)} · contado {formatarMoeda(c.contado)}{c.observacao && ` · ${c.observacao}`}</small></span>
                {seloDiferenca(arred(c.contado - c.esperado))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
