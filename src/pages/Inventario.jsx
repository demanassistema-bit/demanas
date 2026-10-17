import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCatalogo } from '../contexts/CatalogoContext'
import { buscarTudo, supabase, traduzirErro } from '../lib/supabase'
import { filtroInteiro, LIMITE, lerInteiro, limparTexto, TAMANHO } from '../lib/limites'
import { formatarDataHora } from '../lib/datas'
import { chaveBalde, erroValidade, noEscopo, ordenarPorValidade, planoInventario, textoLote } from '../lib/estoque'
import Icone from '../components/Icone'
import { BotaoPerigo } from '../components/Modal'
import { Aviso, Selo, SeletorVariacao, Vazio } from '../components/ui'
import { NovoProduto } from './Produtos'

// Contagem física (inventário). Também serve para lançar o estoque da loja
// pela primeira vez: abre uma contagem de tudo e conta prateleira por prateleira.
export default function Inventario() {
  const cat = useCatalogo()
  const [inventarios, setInventarios] = useState(null)
  const [itens, setItens] = useState([])
  const [erro, setErro] = useState('')
  const aberto = inventarios?.find((i) => i.status === 'aberto')

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('inventarios').select('*').order('aberto_em', { ascending: false }).limit(10)
    if (error) return setErro(traduzirErro(error))
    setInventarios(data)
    const atual = data.find((i) => i.status === 'aberto')
    if (!atual) return setItens([])
    // contagem da loja toda pode passar de 1000 linhas: busca em páginas, na ordem fixa do id
    const r = await buscarTudo(() => supabase.from('inventario_itens')
      .select('id, variacao_id, lote_id, contado, saldo_sistema, atualizado_em, lotes(numero_lote, validade)')
      .eq('inventario_id', atual.id)
      .order('id'))
    if (r.error) return setErro(traduzirErro(r.error))
    setErro('')
    setItens(r.data.sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em)))
  }, [])

  useEffect(() => { carregar() }, [carregar])

  // depois de mexer na contagem: busca a contagem e os saldos de novo
  const atualizar = useCallback(async () => { await Promise.all([carregar(), cat.recarregar()]) }, [carregar, cat])

  if (inventarios === null) return erro ? <Aviso tom="vinho">{erro}</Aviso> : <p className="texto-suave">Carregando…</p>
  return (
    <div className="pilha">
      {erro && <Aviso tom="vinho">{erro}</Aviso>}
      {aberto
        ? <ContagemAberta inventario={aberto} itens={itens} atualizar={atualizar} />
        : <NovaContagem aoAbrir={atualizar} />}
      <Anteriores inventarios={inventarios.filter((i) => i.status !== 'aberto')} />
    </div>
  )
}

const NOMES_ESCOPO = { tudo: 'A loja toda', categoria: 'Uma categoria', cnpj: 'Um CNPJ' }

function descreverEscopo(inv, cat) {
  if (inv.escopo === 'categoria') return `Categoria ${cat.categoriaPorId.get(inv.categoria_id)?.nome || '(apagada)'}`
  if (inv.escopo === 'cnpj') return cat.empresas[inv.empresa_id]?.apelido || inv.empresa_id
  return 'A loja toda'
}

function NovaContagem({ aoAbrir }) {
  const { categorias, empresas, linhas } = useCatalogo()
  const [escopo, setEscopo] = useState('tudo')
  const [categoriaId, setCategoriaId] = useState('')
  const [empresaId, setEmpresaId] = useState('day')
  const [observacao, setObservacao] = useState(linhas.length ? '' : 'Contagem inicial')
  const [erro, setErro] = useState('')
  const [abrindo, setAbrindo] = useState(false)

  async function abrir(e) {
    e.preventDefault()
    setErro('')
    if (escopo === 'categoria' && !categoriaId) return setErro('Escolha a categoria.')
    setAbrindo(true)
    const { error } = await supabase.rpc('abrir_inventario', {
      p_escopo: escopo, p_categoria: categoriaId || null, p_empresa: empresaId, p_observacao: limparTexto(observacao),
    })
    setAbrindo(false)
    if (error) return setErro(traduzirErro(error))
    aoAbrir()
  }

  return (
    <form className="cartao secao formulario" onSubmit={abrir}>
      <h2>Nova contagem</h2>
      <p className="texto-suave pequeno">
        Conte as peças da prateleira e digite (ou leia o código de barras). No fim, o sistema mostra o que bateu, o que sobrou e o que faltou, e lança os acertos.
        {' '}<strong>Primeira vez?</strong> Comece uma contagem da loja toda: a peça que ainda não estiver cadastrada, você cadastra na hora, sem sair da contagem.
      </p>
      <div className="segmentado">
        {Object.entries(NOMES_ESCOPO).map(([k, n]) => (
          <button type="button" key={k} className={escopo === k ? 'ativo' : ''} onClick={() => setEscopo(k)}>{n}</button>
        ))}
      </div>
      {escopo === 'categoria' && (
        <label className="campo">
          <span>Categoria</span>
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">Escolha</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
      )}
      {escopo === 'cnpj' && (
        <div className="segmentado">
          {Object.values(empresas).map((x) => (
            <button type="button" key={x.id} className={empresaId === x.id ? 'ativo' : ''} onClick={() => setEmpresaId(x.id)}>{x.apelido}</button>
          ))}
        </div>
      )}
      <label className="campo"><span>Nome da contagem (opcional)</span><input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={TAMANHO.motivo} placeholder="Ex.: contagem de outubro" /></label>
      {erro && <Aviso tom="vinho">{erro}</Aviso>}
      <button className="botao botao-principal botao-grande" disabled={abrindo}>{abrindo ? 'Abrindo…' : 'Começar contagem'}</button>
    </form>
  )
}

function ContagemAberta({ inventario, itens, atualizar }) {
  const cat = useCatalogo()
  const { linhas, baldes } = cat
  const [novoProduto, setNovoProduto] = useState(false)
  const [zerar, setZerar] = useState(false)
  const [msg, setMsg] = useState(null)
  const [mostrarTodas, setMostrarTodas] = useState(false)
  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])

  // no escopo: peças ativas, e também as fora de linha que ainda têm saldo
  const doEscopo = useMemo(
    () => linhas.filter((l) => noEscopo(l, inventario) && (l.ativo || l.saldo !== 0)),
    [linhas, inventario],
  )
  const plano = useMemo(() => planoInventario({
    itens, baldes, abertoEm: inventario.aberto_em, zerar,
    escopo: doEscopo.map((l) => ({ id: l.id, criado_em: l.criado_em })),
  }), [itens, baldes, inventario.aberto_em, zerar, doEscopo])
  const naoContadasVelhas = plano.naoContadas.filter((n) => !n.novaNaContagem)

  // contagem agrupada por peça
  const porPeca = useMemo(() => {
    const mapa = new Map()
    for (const i of itens) {
      const g = mapa.get(i.variacao_id) || { variacao_id: i.variacao_id, contado: 0, sistema: 0, lotes: [] }
      g.contado += i.contado
      g.sistema += i.saldo_sistema
      g.lotes.push(i)
      mapa.set(i.variacao_id, g)
    }
    return [...mapa.values()]
  }, [itens])

  async function concluir() {
    setMsg(null)
    const { data, error } = await supabase.rpc('concluir_inventario', { p_inventario: inventario.id, p_zerar_nao_contadas: zerar })
    if (error) return setMsg({ tom: 'vinho', texto: traduzirErro(error) })
    await atualizar()
    setMsg({ tom: 'oliva', texto: `Contagem concluída: ${data.pecas_contadas} peças contadas. Sobraram ${data.sobras}, faltaram ${data.faltas}. Os acertos já estão no Histórico.` })
  }

  async function cancelar() {
    const { error } = await supabase.rpc('cancelar_inventario', { p_inventario: inventario.id })
    if (error) return setMsg({ tom: 'vinho', texto: traduzirErro(error) })
    atualizar()
  }

  return (
    <>
      <section className="cartao secao">
        <header className="bloco-topo">
          <div>
            <h2>Contagem aberta · {descreverEscopo(inventario, cat)}</h2>
            <p className="texto-suave pequeno">{inventario.observacao && `${inventario.observacao} · `}começou {formatarDataHora(inventario.aberto_em)}</p>
          </div>
          <Selo tom="ambar">{porPeca.length} de {doEscopo.length} peças</Selo>
        </header>
        <p className="texto-suave pequeno">Pode contar aos poucos, em mais de um celular e em mais de um dia. Nada muda no estoque até você concluir.</p>
      </section>

      <Contar inventario={inventario} doEscopo={doEscopo} itens={itens} atualizar={atualizar} aoCadastrar={() => setNovoProduto(true)} />

      <section className="cartao secao">
        <h2>Já contadas</h2>
        {porPeca.length === 0 ? <Vazio icone="estoque" titulo="Nenhuma peça contada ainda" /> : (
          <ul className="lista">
            {(mostrarTodas ? porPeca : porPeca.slice(0, 30)).map((g) => {
              const l = linhaPorId.get(g.variacao_id)
              const dif = g.contado - g.sistema
              return (
                <li key={g.variacao_id} className="linha-lista">
                  <span>
                    <strong>{l ? l.produto.nome : 'Peça apagada'}</strong>
                    <small>{l?.nomeVariacao} · contou {g.contado} · sistema tinha {g.sistema}</small>
                    {g.lotes.some((i) => i.lote_id) && (
                      <span className="lotes-variacao">
                        {g.lotes.map((i) => (
                          <span key={i.id} className="selo selo-neutro">
                            {textoLote({ lote_id: i.lote_id, ...(i.lotes || {}) })}: {i.contado}
                            {' '}<button type="button" className="botao-link" onClick={() => supabase.rpc('remover_contagem', { p_item: i.id }).then(atualizar)} aria-label="Tirar este lote da contagem">×</button>
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="selos">
                    <Selo tom={dif === 0 ? 'oliva' : dif > 0 ? 'ambar' : 'vinho'}>{dif === 0 ? 'Confere' : dif > 0 ? `Sobra ${dif}` : `Falta ${-dif}`}</Selo>
                    {!g.lotes.some((i) => i.lote_id) && (
                      <button type="button" className="botao-link" onClick={() => supabase.rpc('remover_contagem', { p_item: g.lotes[0].id }).then(atualizar)}>Tirar</button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {porPeca.length > 30 && !mostrarTodas && <button className="botao-link" onClick={() => setMostrarTodas(true)}>Ver as {porPeca.length}</button>}
      </section>

      {naoContadasVelhas.length > 0 && (
        <section className="cartao secao">
          <details>
            <summary><strong>{naoContadasVelhas.length} {naoContadasVelhas.length === 1 ? 'peça tem' : 'peças têm'} saldo e não {naoContadasVelhas.length === 1 ? 'foi contada' : 'foram contadas'}</strong></summary>
            <ul className="lista">
              {naoContadasVelhas.slice(0, 100).map((n) => {
                const l = linhaPorId.get(n.variacao_id)
                return <li key={n.variacao_id} className="linha-lista"><span><strong>{l?.produto.nome}</strong><small>{l?.nomeVariacao}</small></span><Selo>{n.saldo} un</Selo></li>
              })}
            </ul>
          </details>
        </section>
      )}

      <section className="cartao secao formulario">
        <h2>Concluir</h2>
        <p className="texto-suave pequeno">
          Ao concluir, cada peça contada fica com o número contado. Se algum lote dela não foi contado, ele vai a zero.
          {' '}Se vendeu durante a contagem, o sistema desconta: o acerto usa o saldo do momento em que a peça foi contada.
        </p>
        {naoContadasVelhas.length > 0 && (
          <label className="campo-check">
            <input type="checkbox" checked={zerar} onChange={(e) => setZerar(e.target.checked)} />
            Zerar as {naoContadasVelhas.length} peças não contadas (use só se contou tudo e elas não estão na loja)
          </label>
        )}
        <Aviso tom={plano.acertos.length ? 'ambar' : 'oliva'}>
          {plano.acertos.length
            ? <>Vai lançar <strong>{plano.sobras} a mais</strong> e <strong>{plano.faltas} a menos</strong> no estoque.</>
            : 'Tudo o que foi contado confere com o sistema.'}
        </Aviso>
        {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}
        <div className="linha-campos">
          <BotaoConcluir disabled={!itens.length && !zerar} aoConfirmar={concluir} />
          <BotaoPerigo texto="Cancelar contagem" aoConfirmar={cancelar} />
        </div>
      </section>

      {novoProduto && (
        <NovoProduto
          aoFechar={() => setNovoProduto(false)}
          aoCriar={async () => { setNovoProduto(false); await atualizar(); setMsg({ tom: 'oliva', texto: 'Produto cadastrado, já com a quantidade que você digitou. Ele não precisa ser contado de novo.' }) }}
        />
      )}
    </>
  )
}

function BotaoConcluir({ aoConfirmar, disabled }) {
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  useEffect(() => {
    if (!confirmando) return
    const t = setTimeout(() => setConfirmando(false), 4000)
    return () => clearTimeout(t)
  }, [confirmando])
  return (
    <button
      type="button"
      className="botao botao-principal"
      disabled={disabled || enviando}
      onClick={async () => {
        if (!confirmando) return setConfirmando(true)
        setEnviando(true)
        await aoConfirmar()
        setEnviando(false)
        setConfirmando(false)
      }}
    >
      {enviando ? 'Lançando…' : confirmando ? 'Toque de novo para lançar os acertos' : 'Concluir contagem'}
    </button>
  )
}

// Contar uma peça: só o número, ou lote por lote quando a peça tem lote
function Contar({ inventario, doEscopo, itens, atualizar, aoCadastrar }) {
  const { baldesDa, linhas } = useCatalogo()
  const [escolhidaId, setEscolhidaId] = useState(null)
  const escolhida = linhas.find((l) => l.id === escolhidaId)
  const [somar, setSomar] = useState(true)
  const [leitura, setLeitura] = useState(false)
  const [numeros, setNumeros] = useState({}) // por lote: { [lote_id ou 'sem']: '3' }
  const [novoLote, setNovoLote] = useState({ numero_lote: '', validade: '', quantidade: '' })
  const [msg, setMsg] = useState(null)
  const [enviando, setEnviando] = useState(false)

  // lotes conhecidos desta peça: os que têm saldo e os que já foram contados
  const lotes = useMemo(() => {
    if (!escolhida) return []
    const mapa = new Map()
    for (const b of baldesDa(escolhida.id)) if (b.lote_id && b.saldo > 0) mapa.set(b.lote_id, b)
    for (const i of itens) if (i.variacao_id === escolhida.id && i.lote_id && !mapa.has(i.lote_id)) mapa.set(i.lote_id, { lote_id: i.lote_id, ...(i.lotes || {}) })
    return ordenarPorValidade([...mapa.values()])
  }, [escolhida, baldesDa, itens])
  const porLote = escolhida && (lotes.length > 0 || escolhida.produto.controla_validade)
  const jaContado = (loteId) => itens.find((i) => i.variacao_id === escolhida?.id && chaveBalde(i.variacao_id, i.lote_id) === chaveBalde(escolhida.id, loteId))?.contado

  async function contar(variacao, quantidade, extra = {}) {
    const { data, error } = await supabase.rpc('contar_item', {
      p_inventario: inventario.id, p_variacao: variacao.id, p_quantidade: quantidade, p_somar: somar,
      p_numero_lote: extra.numero_lote || null, p_validade: extra.validade || null, p_lote: extra.lote_id || null,
    })
    if (error) throw new Error(traduzirErro(error))
    return data
  }

  async function escolher(l) {
    setMsg(null)
    setNumeros({})
    setNovoLote({ numero_lote: '', validade: '', quantidade: '' })
    // modo leitura: cada código lido conta +1 (peça sem lote)
    const temLote = l && (l.produto.controla_validade || baldesDa(l.id).some((b) => b.lote_id && b.saldo > 0))
    if (l && leitura && !temLote) {
      try {
        const total = await contar(l, 1)
        setMsg({ tom: 'oliva', texto: `+1 ${l.produto.nome} (${l.nomeVariacao}) · ${somar ? `${total} contadas` : 'contada 1'}` })
        await atualizar()
      } catch (e) { setMsg({ tom: 'vinho', texto: e.message }) }
      return
    }
    setEscolhidaId(l?.id || null)
  }

  async function salvar(e) {
    e.preventDefault()
    setMsg(null)
    const pedidos = []
    const campos = porLote ? [...lotes.map((b) => b.lote_id), 'sem'] : ['sem']
    for (const chave of campos) {
      const texto = numeros[chave] ?? ''
      if (texto === '') continue
      const lido = lerInteiro(texto, { rotulo: 'a quantidade', min: 0, max: LIMITE.quantidade })
      if (lido.erro) return setMsg({ tom: 'vinho', texto: lido.erro })
      pedidos.push({ quantidade: lido.valor, extra: chave === 'sem' ? {} : { lote_id: chave } })
    }
    if (porLote && novoLote.quantidade !== '') {
      const lido = lerInteiro(novoLote.quantidade, { rotulo: 'a quantidade do lote novo', min: 0, max: LIMITE.quantidade })
      if (lido.erro) return setMsg({ tom: 'vinho', texto: lido.erro })
      if (!limparTexto(novoLote.numero_lote) && !novoLote.validade) return setMsg({ tom: 'vinho', texto: 'No lote novo, preencha o número do lote ou a validade. Sem nenhum dos dois, use "Sem lote".' })
      const erroVal = erroValidade(novoLote.validade, { aceitarVencida: true })
      if (erroVal) return setMsg({ tom: 'vinho', texto: erroVal })
      pedidos.push({ quantidade: lido.valor, extra: { numero_lote: limparTexto(novoLote.numero_lote), validade: novoLote.validade } })
    }
    if (!pedidos.length) return setMsg({ tom: 'vinho', texto: 'Digite quantas peças você contou.' })
    setEnviando(true)
    try {
      for (const p of pedidos) await contar(escolhida, p.quantidade, p.extra)
      setMsg({ tom: 'oliva', texto: `Contado: ${escolhida.produto.nome} (${escolhida.nomeVariacao}).` })
      setEscolhidaId(null)
      await atualizar()
    } catch (erro) {
      setMsg({ tom: 'vinho', texto: erro.message })
      await atualizar()
    }
    setEnviando(false)
  }

  const campoNumero = (chave, rotulo) => {
    const antes = jaContado(chave === 'sem' ? null : chave)
    return (
      <label key={chave} className="contagem-lote">
        <span>{rotulo}{antes != null && <small className="texto-suave"> · já contou {antes}</small>}</span>
        <input inputMode="numeric" value={numeros[chave] ?? ''} onChange={(e) => setNumeros({ ...numeros, [chave]: filtroInteiro(e.target.value) })} aria-label={`Quantidade: ${rotulo}`} />
      </label>
    )
  }

  return (
    <form className="cartao secao formulario" onSubmit={salvar}>
      <header className="bloco-topo">
        <h2>Contar</h2>
        <button type="button" className="botao-link" onClick={aoCadastrar}><Icone nome="somar" tamanho={16} /> Peça não cadastrada</button>
      </header>
      <SeletorVariacao escolhida={escolhida} aoEscolher={escolher} opcoes={doEscopo} />
      {!escolhida && (
        <label className="campo-check">
          <input type="checkbox" checked={leitura} onChange={(e) => setLeitura(e.target.checked)} />
          Modo leitor: cada código lido soma 1 (para passar peça por peça no leitor)
        </label>
      )}
      {escolhida && (
        <>
          {porLote ? (
            <div className="contagem-lotes">
              {lotes.map((b) => campoNumero(b.lote_id, textoLote(b)))}
              {campoNumero('sem', 'Sem lote')}
              <div className="grade-campos">
                <label className="campo"><span>Lote novo (opcional)</span><input value={novoLote.numero_lote} onChange={(e) => setNovoLote({ ...novoLote, numero_lote: e.target.value })} maxLength={TAMANHO.lote} /></label>
                <label className="campo"><span>Validade</span><input type="date" value={novoLote.validade} onChange={(e) => setNovoLote({ ...novoLote, validade: e.target.value })} /></label>
                <label className="campo"><span>Quantidade</span><input inputMode="numeric" value={novoLote.quantidade} onChange={(e) => setNovoLote({ ...novoLote, quantidade: filtroInteiro(e.target.value) })} /></label>
              </div>
            </div>
          ) : (
            <div className="grade-campos">
              <label className="campo">
                <span>Quantas você contou{jaContado(null) != null && ` (já contou ${jaContado(null)})`}</span>
                <input inputMode="numeric" value={numeros.sem ?? ''} onChange={(e) => setNumeros({ sem: filtroInteiro(e.target.value) })} autoFocus />
              </label>
            </div>
          )}
          <label className="campo-check">
            <input type="checkbox" checked={!somar} onChange={(e) => setSomar(!e.target.checked)} />
            Trocar o número que já foi contado (em vez de somar)
          </label>
          <button className="botao botao-principal" disabled={enviando}>{enviando ? 'Salvando…' : 'Contar'}</button>
        </>
      )}
      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}
    </form>
  )
}

function Anteriores({ inventarios }) {
  const cat = useCatalogo()
  if (!inventarios.length) return null
  return (
    <section className="cartao secao">
      <h2>Contagens anteriores</h2>
      <ul className="lista">
        {inventarios.map((i) => (
          <li key={i.id} className="linha-lista">
            <span>
              <strong>{descreverEscopo(i, cat)}{i.observacao && ` · ${i.observacao}`}</strong>
              <small>
                {formatarDataHora(i.concluido_em || i.aberto_em)}
                {i.resumo && ` · ${i.resumo.pecas_contadas} contadas · sobraram ${i.resumo.sobras} · faltaram ${i.resumo.faltas}`}
              </small>
            </span>
            <Selo tom={i.status === 'concluido' ? 'oliva' : 'neutro'}>{i.status === 'concluido' ? 'Concluída' : 'Cancelada'}</Selo>
          </li>
        ))}
      </ul>
    </section>
  )
}
