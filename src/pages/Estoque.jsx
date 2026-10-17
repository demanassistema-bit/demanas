import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useDemo } from '../demo/DemoContext'
import { formatarMoeda, paraCampoMoeda, arred } from '../lib/moeda'
import { erroData, filtroDinheiro, filtroInteiro, LIMITE, lerInteiro, lerValor, limparTexto, TAMANHO } from '../lib/limites'
import { diasAte, formatarDataHora, hojeISO, paraISO, somarDias } from '../lib/datas'
import { encomendasDaVariacao, normalizar, TIPOS_MOVIMENTO } from '../demo/regras'
import { Aviso, CampoBusca, Selo, SeletorVariacao, seloValidade, Vazio } from '../components/ui'

const ABAS = { situacao: 'Situação', entrada: 'Entrada', ajuste: 'Ajuste e perda', movimentacoes: 'Movimentações' }

export default function Estoque() {
  const { ehProprietaria } = useDemo()
  const [params, setParams] = useSearchParams()
  const aba = params.get('aba') || 'situacao'

  return (
    <div className="pagina">
      <header className="pagina-topo"><h1>Estoque</h1></header>
      <div className="abas" role="tablist">
        {Object.entries(ABAS).map(([chave, nome]) => (
          <button key={chave} role="tab" aria-selected={aba === chave} className={`aba-topo ${aba === chave ? 'ativo' : ''}`} onClick={() => setParams({ aba: chave }, { replace: true })}>{nome}</button>
        ))}
      </div>
      {aba === 'situacao' && <Situacao />}
      {(aba === 'entrada' || aba === 'ajuste') && !ehProprietaria && (
        <Aviso tom="ambar">Só a proprietária registra entradas, ajustes e perdas. Troque para "Proprietária" na faixa do topo para ver esta tela.</Aviso>
      )}
      {aba === 'entrada' && ehProprietaria && <Entrada />}
      {aba === 'ajuste' && ehProprietaria && <Ajuste />}
      {aba === 'movimentacoes' && <Movimentacoes />}
    </div>
  )
}

function Situacao() {
  const { linhas, lotesComSaldo, podeVerCustos } = useDemo()
  const [params, setParams] = useSearchParams()
  const filtro = params.get('filtro') || 'todos'
  const [busca, setBusca] = useState('')

  const vencendoPorVariacao = useMemo(() => {
    const mapa = new Map()
    for (const l of lotesComSaldo) {
      if (diasAte(l.validade) > 90) continue
      const atual = mapa.get(l.variacao_id)
      if (!atual || l.validade < atual.validade) mapa.set(l.variacao_id, l)
    }
    return mapa
  }, [lotesComSaldo])

  const lista = linhas
    .filter((l) => l.ativo)
    .filter((l) => {
      if (filtro === 'minimo') return l.saldo <= l.estoque_minimo
      if (filtro === 'zerados') return l.saldo <= 0
      if (filtro === 'vencendo') return vencendoPorVariacao.has(l.id)
      return true
    })
    .filter((l) => !busca.trim() || normalizar(`${l.produto.nome} ${l.nomeVariacao} ${l.sku}`).includes(normalizar(busca)))
    .sort((a, b) => a.produto.nome.localeCompare(b.produto.nome) || a.nomeVariacao.localeCompare(b.nomeVariacao))

  const pecas = linhas.reduce((s, l) => s + Math.max(l.saldo, 0), 0)
  const valorCusto = arred(linhas.reduce((s, l) => s + Math.max(l.saldo, 0) * l.custo, 0))
  const valorVenda = arred(linhas.reduce((s, l) => s + Math.max(l.saldo, 0) * l.preco, 0))
  const filtros = { todos: 'Tudo', minimo: 'Abaixo do mínimo', vencendo: 'Vencendo', zerados: 'Zerados' }

  return (
    <>
      <section className="grade-metricas">
        <div className="cartao metrica"><span className="metrica-rotulo">Peças em estoque</span><strong className="metrica-valor">{pecas}</strong></div>
        <div className="cartao metrica"><span className="metrica-rotulo">Valor a preço de venda</span><strong className="metrica-valor">{formatarMoeda(valorVenda)}</strong></div>
        {podeVerCustos && <div className="cartao metrica"><span className="metrica-rotulo">Valor a preço de custo</span><strong className="metrica-valor">{formatarMoeda(valorCusto)}</strong></div>}
      </section>
      <div className="filtros">
        <CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar no estoque" />
        <div className="fichas">
          {Object.entries(filtros).map(([chave, nome]) => (
            <button key={chave} className={`ficha ${filtro === chave ? 'ativo' : ''}`} onClick={() => setParams({ aba: 'situacao', filtro: chave }, { replace: true })}>{nome}</button>
          ))}
        </div>
      </div>
      {lista.length === 0 ? <Vazio icone="confirmar" titulo="Nada neste filtro" /> : (
        <ul className="cartao lista">
          {lista.map((l) => {
            const lote = vencendoPorVariacao.get(l.id)
            return (
              <li key={l.id}>
                <Link to={`/produtos/${l.produto_id}`} className="linha-lista">
                  <span><strong>{l.produto.nome}</strong><small>{l.nomeVariacao} · mínimo {l.estoque_minimo}</small></span>
                  <span className="selos">
                    {lote && seloValidade(lote.validade)}
                    <Selo tom={l.saldo <= 0 ? 'vinho' : l.saldo <= l.estoque_minimo ? 'ambar' : 'neutro'}>{l.saldo} un</Selo>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function Entrada() {
  const { dados, registrarEntrada, linhas, clientePorId } = useDemo()
  const validadeMax = paraISO(somarDias(new Date(), 365 * 10))
  const [escolhidaId, setEscolhidaId] = useState(null)
  const escolhida = linhas.find((l) => l.id === escolhidaId)
  const [f, setF] = useState({ quantidade: '', custo: '', lote: '', validade: paraISO(somarDias(new Date(), 365)), fornecedor: '' })
  const [feito, setFeito] = useState('')
  const [erro, setErro] = useState('')

  function escolher(l) {
    setEscolhidaId(l?.id || null)
    setFeito('')
    if (l) setF((x) => ({ ...x, custo: paraCampoMoeda(l.custo) }))
  }

  function salvar(e) {
    e.preventDefault()
    setErro('')
    if (!escolhida) return setErro('Escolha o produto.')
    const qtd = lerInteiro(f.quantidade)
    if (qtd.erro) return setErro(qtd.erro)
    const custoLido = lerValor(f.custo, { rotulo: 'o custo de cada peça', min: 0, max: LIMITE.preco })
    if (custoLido.erro) return setErro(custoLido.erro)
    if (escolhida.produto.controla_validade) {
      const erroValidade = erroData(f.validade, { rotulo: 'a validade', min: paraISO(somarDias(new Date(), 1)), max: validadeMax })
      if (erroValidade) return setErro(`${erroValidade} Ela precisa ser depois de hoje e em até 10 anos.`)
    }
    const quantidade = qtd.valor
    const custo = custoLido.valor
    const fornecedor = limparTexto(f.fornecedor)
    registrarEntrada({
      variacao_id: escolhida.id, quantidade, custo, numero_lote: limparTexto(f.lote), validade: f.validade,
      motivo: fornecedor ? `Compra de ${fornecedor}` : 'Entrada de mercadoria',
    })
    const esperando = encomendasDaVariacao(dados.encomendas || [], escolhida.id)
    const donas = esperando.map((e) => clientePorId.get(e.cliente_id)?.nome.split(' ')[0]).filter(Boolean)
    setFeito(`+${quantidade} de ${escolhida.produto.nome} (${escolhida.nomeVariacao}). Agora há ${escolhida.saldo + quantidade} em estoque.`
      + (donas.length ? ` Atenção: esta peça tem encomenda de ${donas.join(', ')}. Separe e marque "Chegou" em Encomendas.` : ''))
    setF({ ...f, quantidade: '', lote: '' })
  }

  return (
    <form className="cartao secao formulario" onSubmit={salvar}>
      <h2>Entrada de mercadoria</h2>
      <SeletorVariacao escolhida={escolhida} aoEscolher={escolher} />
      <div className="grade-campos">
        <label className="campo"><span>Quantidade</span><input inputMode="numeric" value={f.quantidade} onChange={(e) => setF({ ...f, quantidade: filtroInteiro(e.target.value) })} /></label>
        <label className="campo"><span>Custo de cada peça</span><input inputMode="decimal" value={f.custo} onChange={(e) => setF({ ...f, custo: filtroDinheiro(e.target.value) })} /></label>
        <label className="campo"><span>Fornecedor (opcional)</span><input value={f.fornecedor} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} maxLength={TAMANHO.fornecedor} /></label>
        {escolhida?.produto.controla_validade && (
          <>
            <label className="campo"><span>Número do lote</span><input value={f.lote} onChange={(e) => setF({ ...f, lote: e.target.value })} maxLength={TAMANHO.lote} /></label>
            <label className="campo"><span>Validade</span><input type="date" min={hojeISO()} max={validadeMax} value={f.validade} onChange={(e) => setF({ ...f, validade: e.target.value })} /></label>
          </>
        )}
      </div>
      <p className="texto-suave pequeno">O custo médio da peça é recalculado sozinho a cada entrada.</p>
      {erro && <Aviso tom="vinho">{erro}</Aviso>}
      {feito && <Aviso tom="oliva">{feito}</Aviso>}
      <button className="botao botao-principal botao-grande">Registrar entrada</button>
    </form>
  )
}

const TIPOS_AJUSTE = ['ajuste_inventario', 'perda', 'brinde', 'uso_interno', 'devolucao_fornecedor']

function Ajuste() {
  const { dados, registrarAjuste, linhas } = useDemo()
  const [escolhidaId, setEscolhidaId] = useState(null)
  const escolhida = linhas.find((l) => l.id === escolhidaId)
  const [tipo, setTipo] = useState('ajuste_inventario')
  const [numero, setNumero] = useState('')
  const [motivo, setMotivo] = useState('')
  const [feito, setFeito] = useState('')
  const [erro, setErro] = useState('')
  const contagem = tipo === 'ajuste_inventario'

  function salvar(e) {
    e.preventDefault()
    setErro(''); setFeito('')
    if (!escolhida) return setErro('Escolha o produto.')
    const lido = lerInteiro(numero, { rotulo: contagem ? 'quantas peças você contou' : 'a quantidade', min: contagem ? 0 : 1 })
    if (lido.erro) return setErro(lido.erro)
    const n = lido.valor
    // não deixa sair mais do que tem (o estoque ficaria negativo)
    if (!contagem && !dados.config.permitirEstoqueNegativo && n > Math.max(escolhida.saldo, 0)) {
      return setErro(`O sistema tem só ${Math.max(escolhida.saldo, 0)} em estoque desta peça. Se o número real é outro, faça antes uma Contagem.`)
    }
    const textoMotivo = limparTexto(motivo)
    if (textoMotivo.length < 3) return setErro('O motivo é obrigatório: fica registrado no histórico.')
    const r = registrarAjuste({ variacao_id: escolhida.id, tipo, quantidade: n, contado: n, motivo: textoMotivo })
    if (r?.semMudanca) setFeito('A contagem confere com o sistema. Nada a ajustar.')
    else setFeito(`${TIPOS_MOVIMENTO[tipo]} registrado: ${r.diferenca > 0 ? '+' : ''}${r.diferenca}.`)
    setNumero(''); setMotivo('')
  }

  return (
    <form className="cartao secao formulario" onSubmit={salvar}>
      <h2>Ajuste, perda ou saída sem venda</h2>
      <div className="fichas">
        {TIPOS_AJUSTE.map((t) => (
          <button type="button" key={t} className={`ficha ${tipo === t ? 'ativo' : ''}`} onClick={() => setTipo(t)}>{t === 'ajuste_inventario' ? 'Contagem' : TIPOS_MOVIMENTO[t]}</button>
        ))}
      </div>
      <SeletorVariacao escolhida={escolhida} aoEscolher={(l) => { setEscolhidaId(l?.id || null); setFeito('') }} />
      <div className="grade-campos">
        <label className="campo">
          <span>{contagem ? `Quantas peças você contou${escolhida ? ` (sistema diz ${escolhida.saldo})` : ''}` : 'Quantidade que saiu'}</span>
          <input inputMode="numeric" value={numero} onChange={(e) => setNumero(filtroInteiro(e.target.value))} />
        </label>
        <label className="campo"><span>Motivo</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={TAMANHO.motivo} placeholder={contagem ? 'Ex.: inventário de outubro' : 'Ex.: peça com defeito'} /></label>
      </div>
      <p className="texto-suave pequeno">O sistema nunca apaga nem edita o estoque: lança uma movimentação nova com a diferença.</p>
      {erro && <Aviso tom="vinho">{erro}</Aviso>}
      {feito && <Aviso tom="oliva">{feito}</Aviso>}
      <button className="botao botao-principal botao-grande">Registrar</button>
    </form>
  )
}

function Movimentacoes() {
  const { dados, variacaoPorId, produtoPorId } = useDemo()
  const [tipo, setTipo] = useState('todos')
  const lista = [...dados.movimentacoes].reverse().filter((m) => tipo === 'todos' || m.tipo === tipo).slice(0, 80)
  const nome = (id) => {
    const v = variacaoPorId.get(id)
    return `${produtoPorId.get(v.produto_id).nome} · ${[v.cor, v.tamanho, v.tonalidade].filter(Boolean).join(' ') || v.volume || ''}`
  }

  return (
    <>
      <p className="texto-suave">O livro do estoque: cada entrada e saída, em ordem. Nada aqui é editado ou apagado. Para corrigir, lança-se uma movimentação nova.</p>
      <label className="campo campo-estreito">
        <span>Tipo</span>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="todos">Todos</option>
          {Object.entries(TIPOS_MOVIMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <ul className="cartao lista">
        {lista.map((m) => (
          <li key={m.id} className="linha-lista">
            <span><strong>{nome(m.variacao_id)}</strong><small>{formatarDataHora(m.data)} · {TIPOS_MOVIMENTO[m.tipo]} · {m.usuario}{m.motivo && ` · ${m.motivo}`}</small></span>
            <strong className={m.quantidade > 0 ? 'texto-positivo' : 'texto-negativo'}>{m.quantidade > 0 ? `+${m.quantidade}` : m.quantidade}</strong>
          </li>
        ))}
      </ul>
    </>
  )
}
