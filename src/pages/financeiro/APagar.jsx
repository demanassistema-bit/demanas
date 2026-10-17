import { useState } from 'react'
import { useDemo } from '../../demo/DemoContext'
import { arred, formatarMoeda, lerMoeda } from '../../lib/moeda'
import { diasAte, formatarData, hojeISO } from '../../lib/datas'
import { erroData, filtroDinheiro, filtroInteiro, LIMITE, lerInteiro, lerValor, limparTexto, somarMeses, TAMANHO } from '../../lib/limites'
import { CATEGORIAS_DESPESA } from '../../demo/regras'
import Modal, { BotaoPerigo } from '../../components/Modal'
import Icone from '../../components/Icone'
import { Aviso, Metrica, Selo, Vazio } from '../../components/ui'

const FILTROS = { abertas: 'Em aberto', vencidas: 'Vencidas', pagas: 'Pagas', todas: 'Todas' }

function seloVencimento(conta) {
  if (conta.pagoEm) return <Selo tom="oliva">Paga em {formatarData(conta.pagoEm).slice(0, 5)}</Selo>
  const dias = diasAte(conta.vencimento)
  if (dias < 0) return <Selo tom="vinho">Vencida há {-dias} d</Selo>
  if (dias === 0) return <Selo tom="vinho">Vence hoje</Selo>
  if (dias <= 7) return <Selo tom="ambar">Vence em {dias} d</Selo>
  return <Selo>{formatarData(conta.vencimento)}</Selo>
}

export default function APagar() {
  const { dados, marcarPaga, excluirConta } = useDemo()
  const [filtro, setFiltro] = useState('abertas')
  const [nova, setNova] = useState(false)
  const hoje = hojeISO()
  const contas = dados.contasPagar

  const abertas = contas.filter((c) => !c.pagoEm)
  const vencidas = abertas.filter((c) => c.vencimento < hoje)
  const semana = abertas.filter((c) => c.vencimento >= hoje && diasAte(c.vencimento) <= 7)
  const soma = (lista) => arred(lista.reduce((s, c) => s + c.valor, 0))

  const lista = contas.filter((c) => {
    if (filtro === 'abertas') return !c.pagoEm && diasAte(c.vencimento) <= 45
    if (filtro === 'vencidas') return !c.pagoEm && c.vencimento < hoje
    if (filtro === 'pagas') return Boolean(c.pagoEm)
    return true
  })
  const ordenada = filtro === 'pagas' ? [...lista].sort((a, b) => b.pagoEm.localeCompare(a.pagoEm)) : lista

  return (
    <div className="calculadora">
      <section className="grade-metricas">
        <Metrica rotulo="Vencidas" valor={formatarMoeda(soma(vencidas))} detalhe={`${vencidas.length} ${vencidas.length === 1 ? 'conta' : 'contas'}`} />
        <Metrica rotulo="Vencem em 7 dias" valor={formatarMoeda(soma(semana))} detalhe={`${semana.length} ${semana.length === 1 ? 'conta' : 'contas'}`} />
        <Metrica rotulo="Total em aberto" valor={formatarMoeda(soma(abertas))} />
      </section>

      {vencidas.length > 0 && <Aviso tom="vinho">Há {vencidas.length} {vencidas.length === 1 ? 'conta vencida' : 'contas vencidas'}. Pague ou combine um novo prazo com o fornecedor.</Aviso>}

      <div className="pagina-topo">
        <div className="fichas">
          {Object.entries(FILTROS).map(([k, n]) => <button key={k} className={`ficha ${filtro === k ? 'ativo' : ''}`} onClick={() => setFiltro(k)}>{n}</button>)}
        </div>
        <button className="botao botao-principal" onClick={() => setNova(true)}><Icone nome="somar" /> Nova conta</button>
      </div>

      {ordenada.length === 0 ? <Vazio icone="confirmar" titulo="Nada aqui" /> : (
        <ul className="cartao lista">
          {ordenada.map((c) => (
            <li key={c.id} className="linha-lista conta">
              <span>
                <strong>{c.descricao}</strong>
                <small>{[c.fornecedor, CATEGORIAS_DESPESA[c.categoria], `vence ${formatarData(c.vencimento)}`].filter(Boolean).join(' · ')}</small>
              </span>
              <span className="conta-direita">
                <strong>{formatarMoeda(c.valor)}</strong>
                {seloVencimento(c)}
                {c.pagoEm
                  ? <button className="botao-link" onClick={() => marcarPaga(c.id, null)}>Desfazer</button>
                  : <button className="botao-link" onClick={() => marcarPaga(c.id, hoje)}><Icone nome="confirmar" tamanho={16} /> Marcar como paga</button>}
                <span className="excluir-discreto"><BotaoPerigo texto="Excluir" aoConfirmar={() => excluirConta(c.id)} /></span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="texto-suave pequeno">Os custos fixos da Calculadora viram contas todo mês, no dia 10. Compras de mercadoria aparecem aqui, mas no resultado do mês entram pelo custo das peças vendidas.</p>

      {nova && <NovaConta aoFechar={() => setNova(false)} />}
    </div>
  )
}

function NovaConta({ aoFechar }) {
  const { criarConta } = useDemo()
  const [f, setF] = useState({ descricao: '', fornecedor: '', categoria: 'fornecedores', valor: '', vencimento: hojeISO(), vezes: '1' })
  const [erro, setErro] = useState('')

  function salvar(e) {
    e.preventDefault()
    const descricao = limparTexto(f.descricao)
    if (descricao.length < 2) return setErro('Descreva a conta.')
    const lido = lerValor(f.valor, { rotulo: 'o valor' })
    if (lido.erro) return setErro(lido.erro)
    const parcelas = lerInteiro(f.vezes, { rotulo: 'o número de parcelas', max: LIMITE.parcelasConta, obrigatorio: false })
    if (parcelas.erro) return setErro(parcelas.erro)
    const valor = lido.valor
    const vezes = parcelas.valor
    // contas atrasadas podem ser lançadas, mas só até um ano para trás
    const erroVenc = erroData(f.vencimento, { rotulo: 'o vencimento', min: somarMeses(hojeISO(), -12), max: somarMeses(hojeISO(), 60) })
    if (erroVenc) return setErro(`${erroVenc} Use uma data entre um ano atrás e cinco anos para a frente.`)
    if (valor / vezes < 0.01) return setErro('O valor é pequeno demais para tantas parcelas.')
    const valorParcela = arred(valor / vezes)
    for (let i = 0; i < vezes; i++) {
      criarConta({
        descricao: vezes > 1 ? `${descricao} (${i + 1}/${vezes})` : descricao,
        fornecedor: limparTexto(f.fornecedor), categoria: f.categoria,
        valor: i === vezes - 1 ? arred(valor - valorParcela * (vezes - 1)) : valorParcela,
        vencimento: somarMeses(f.vencimento, i),
      })
    }
    aoFechar()
  }

  return (
    <Modal titulo="Nova conta a pagar" aoFechar={aoFechar} rodape={<><button className="botao botao-fantasma" onClick={aoFechar}>Cancelar</button><button className="botao botao-principal" form="form-conta">Salvar</button></>}>
      <form id="form-conta" className="formulario" onSubmit={salvar}>
        <label className="campo"><span>Descrição</span><input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} maxLength={TAMANHO.descricao} placeholder="Ex.: compra de sutiãs" autoFocus /></label>
        <div className="grade-campos">
          <label className="campo"><span>Fornecedor (opcional)</span><input value={f.fornecedor} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} maxLength={TAMANHO.fornecedor} /></label>
          <label className="campo"><span>Categoria</span>
            <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}>
              {Object.entries(CATEGORIAS_DESPESA).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
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
