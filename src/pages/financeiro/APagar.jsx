import { useCallback, useEffect, useState } from 'react'
import { useCatalogo } from '../../contexts/CatalogoContext'
import { buscarTudo, supabase, traduzirErro } from '../../lib/supabase'
import { arred, formatarMoeda, lerMoeda } from '../../lib/moeda'
import { diasAte, formatarData, hojeISO } from '../../lib/datas'
import { erroData, filtroDinheiro, filtroInteiro, LIMITE, lerInteiro, lerValor, limparTexto, somarMeses, TAMANHO } from '../../lib/limites'
import { filtrarContas, FILTROS_CONTAS, situacaoConta, somar } from '../../lib/financeiro'
import { SeletorCategoria, useCategoriasDespesa } from './categorias'
import Modal, { BotaoPerigo } from '../../components/Modal'
import Icone from '../../components/Icone'
import { Aviso, Metrica, Selo, Vazio } from '../../components/ui'

export default function APagar() {
  const [filtro, setFiltro] = useState('abertas')
  const [nova, setNova] = useState(false)
  const [contas, setContas] = useState(null)
  const [erro, setErro] = useState('')
  const hoje = hojeISO()
  const categorias = useCategoriasDespesa()

  const carregar = useCallback(async () => {
    const { data, error } = await buscarTudo(() => supabase.from('contas_pagar').select('*').order('vencimento').order('id'))
    if (error) return setErro(traduzirErro(error))
    setContas(data.map((c) => ({ ...c, valor: Number(c.valor) })))
  }, [])
  // custos fixos do mês (e do seguinte) viram contas antes de mostrar
  useEffect(() => { supabase.rpc('gerar_contas_fixas').then(carregar) }, [carregar])

  async function executar(promessa) {
    setErro('')
    const { error } = await promessa
    if (error) return setErro(traduzirErro(error))
    carregar()
  }

  if (!contas) return <div className="calculadora">{erro ? <Aviso tom="vinho">{erro}</Aviso> : <p className="texto-suave">Carregando…</p>}</div>

  const abertas = contas.filter((c) => !c.pago_em)
  const vencidas = abertas.filter((c) => c.vencimento < hoje)
  const semana = abertas.filter((c) => c.vencimento >= hoje && diasAte(c.vencimento) <= 7)
  const lista = filtrarContas(contas, filtro, hoje)

  return (
    <div className="calculadora">
      <section className="grade-metricas">
        <Metrica rotulo="Vencidas" valor={formatarMoeda(somar(vencidas))} detalhe={`${vencidas.length} ${vencidas.length === 1 ? 'conta' : 'contas'}`} />
        <Metrica rotulo="Vencem em 7 dias" valor={formatarMoeda(somar(semana))} detalhe={`${semana.length} ${semana.length === 1 ? 'conta' : 'contas'}`} />
        <Metrica rotulo="Total em aberto" valor={formatarMoeda(somar(abertas))} />
      </section>

      {vencidas.length > 0 && <Aviso tom="vinho">Há {vencidas.length} {vencidas.length === 1 ? 'conta vencida' : 'contas vencidas'}. Pague ou combine um novo prazo com o fornecedor.</Aviso>}
      {erro && <Aviso tom="vinho">{erro}</Aviso>}

      <div className="pagina-topo">
        <div className="fichas">
          {Object.entries(FILTROS_CONTAS).map(([k, n]) => <button key={k} className={`ficha ${filtro === k ? 'ativo' : ''}`} onClick={() => setFiltro(k)}>{n}</button>)}
        </div>
        <button className="botao botao-principal" onClick={() => setNova(true)}><Icone nome="somar" /> Nova conta</button>
      </div>

      {lista.length === 0 ? <Vazio icone="confirmar" titulo="Nada aqui" /> : (
        <ul className="cartao lista">
          {lista.map((c) => {
            const sit = situacaoConta(c, hoje)
            return (
              <li key={c.id} className="linha-lista conta">
                <span>
                  <strong>{c.descricao}</strong>
                  <small>{[c.fornecedor, categorias.nomes[c.categoria], `vence ${formatarData(c.vencimento)}`, c.custo_fixo_id && 'custo fixo'].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="conta-direita">
                  <strong>{formatarMoeda(c.valor)}</strong>
                  <Selo tom={sit.tom}>{sit.texto}</Selo>
                  {c.pago_em
                    ? <button className="botao-link" onClick={() => executar(supabase.from('contas_pagar').update({ pago_em: null }).eq('id', c.id))}>Desfazer</button>
                    : <button className="botao-link" onClick={() => executar(supabase.from('contas_pagar').update({ pago_em: hoje }).eq('id', c.id))}><Icone nome="confirmar" tamanho={16} /> Marcar como paga</button>}
                  {!c.pago_em && <span className="excluir-discreto"><BotaoPerigo texto="Excluir" aoConfirmar={() => executar(supabase.from('contas_pagar').delete().eq('id', c.id))} /></span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="texto-suave pequeno">Os custos fixos da Calculadora viram contas no dia 10 de cada mês. Conta paga não se apaga: desfaça o pagamento antes. Compras de mercadoria aparecem aqui, mas no resultado do mês entram pelo custo das peças vendidas.</p>

      {nova && <NovaConta categorias={categorias} aoFechar={() => setNova(false)} aoSalvar={carregar} />}
    </div>
  )
}

function NovaConta({ categorias, aoFechar, aoSalvar }) {
  const { fornecedores } = useCatalogo()
  const [f, setF] = useState({ descricao: '', fornecedor: '', categoria: 'fornecedores', valor: '', vencimento: hojeISO(), vezes: '1' })
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar(e) {
    e.preventDefault()
    const descricao = limparTexto(f.descricao)
    if (descricao.length < 2) return setErro('Descreva a conta.')
    const lido = lerValor(f.valor, { rotulo: 'o valor' })
    if (lido.erro) return setErro(lido.erro)
    const parcelas = lerInteiro(f.vezes, { rotulo: 'o número de parcelas', max: LIMITE.parcelasConta, obrigatorio: false })
    if (parcelas.erro) return setErro(parcelas.erro)
    // contas atrasadas podem ser lançadas, mas só até um ano para trás
    const erroVenc = erroData(f.vencimento, { rotulo: 'o vencimento', min: somarMeses(hojeISO(), -12), max: somarMeses(hojeISO(), 60) })
    if (erroVenc) return setErro(`${erroVenc} Use uma data entre um ano atrás e cinco anos para a frente.`)
    if (lido.valor / parcelas.valor < 0.01) return setErro('O valor é pequeno demais para tantas parcelas.')
    setSalvando(true)
    const { error } = await supabase.rpc('criar_contas', {
      p: { descricao, fornecedor: limparTexto(f.fornecedor), categoria: f.categoria, valor: lido.valor, vencimento: f.vencimento, vezes: parcelas.valor },
    })
    setSalvando(false)
    if (error) return setErro(traduzirErro(error))
    aoSalvar()
    aoFechar()
  }

  return (
    <Modal titulo="Nova conta a pagar" aoFechar={aoFechar} rodape={<><button className="botao botao-fantasma" onClick={aoFechar}>Cancelar</button><button className="botao botao-principal" form="form-conta" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button></>}>
      <form id="form-conta" className="formulario" onSubmit={salvar}>
        <label className="campo"><span>Descrição</span><input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} maxLength={TAMANHO.descricao} placeholder="Ex.: compra de sutiãs" autoFocus /></label>
        <div className="grade-campos">
          <label className="campo"><span>Fornecedor (opcional)</span>
            <input list="fornecedores-conta" value={f.fornecedor} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} maxLength={TAMANHO.fornecedor} />
            <datalist id="fornecedores-conta">{fornecedores.map((x) => <option key={x.id} value={x.nome} />)}</datalist>
          </label>
          <div className="campo"><span>Categoria</span>
            <SeletorCategoria valor={f.categoria} categorias={categorias} aoMudar={(categoria) => setF((atual) => ({ ...atual, categoria }))} />
          </div>
          <label className="campo"><span>Valor total</span><input inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: filtroDinheiro(e.target.value) })} /></label>
          <label className="campo"><span>Primeiro vencimento</span><input type="date" min={somarMeses(hojeISO(), -12)} max={somarMeses(hojeISO(), 60)} value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} /></label>
          <label className="campo"><span>Dividir em quantas vezes</span><input inputMode="numeric" value={f.vezes} onChange={(e) => setF({ ...f, vezes: filtroInteiro(e.target.value, 2) })} /></label>
        </div>
        {Number(f.vezes) > 1 && Number(f.vezes) <= LIMITE.parcelasConta && lerMoeda(f.valor) > 0 && (
          <p className="texto-suave pequeno">{f.vezes} parcelas de {formatarMoeda(arred(lerMoeda(f.valor) / Number(f.vezes)))}, uma por mês.</p>
        )}
        {erro && <Aviso tom="vinho">{erro}</Aviso>}
      </form>
    </Modal>
  )
}
