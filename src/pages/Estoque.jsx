import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCatalogo } from '../contexts/CatalogoContext'
import { useClientes } from '../contexts/ClientesContext'
import { supabase, traduzirErro } from '../lib/supabase'
import { formatarMoeda, paraCampoMoeda, arred } from '../lib/moeda'
import { filtroDinheiro, filtroInteiro, LIMITE, lerInteiro, lerValor, limparTexto, TAMANHO } from '../lib/limites'
import { diasAte, formatarDataHora } from '../lib/datas'
import { erroValidade, ordenarPorValidade, textoLote, TIPOS_MOVIMENTO } from '../lib/estoque'
import { encomendasDaVariacao } from '../lib/clientes'
import { normalizar } from '../demo/regras'
import Icone from '../components/Icone'
import { Aviso, CampoBusca, Selo, SeletorVariacao, seloValidade, Vazio } from '../components/ui'
import Inventario from './Inventario'

const ABAS = { situacao: 'Situação', entrada: 'Entrada', saida: 'Saída e correção', inventario: 'Contagem', movimentacoes: 'Histórico' }
const SO_PROPRIETARIA = new Set(['entrada', 'saida', 'inventario'])

// Peças que têm estoque próprio (kit não tem: é feito de outras peças)
export const usePecasComEstoque = () => {
  const { linhas } = useCatalogo()
  return useMemo(() => linhas.filter((l) => l.ativo && l.produto.tipo !== 'kit'), [linhas])
}

export default function Estoque() {
  const { permissoes } = useAuth()
  const { erro } = useCatalogo()
  const [params, setParams] = useSearchParams()
  const aba = ABAS[params.get('aba')] ? params.get('aba') : 'situacao'

  return (
    <div className="pagina">
      <header className="pagina-topo"><h1>Estoque</h1></header>
      <div className="abas" role="tablist">
        {Object.entries(ABAS).map(([chave, nome]) => (
          <button key={chave} role="tab" aria-selected={aba === chave} className={`aba-topo ${aba === chave ? 'ativo' : ''}`} onClick={() => setParams({ aba: chave }, { replace: true })}>{nome}</button>
        ))}
      </div>
      {erro && <Aviso tom="vinho">{erro}</Aviso>}
      {SO_PROPRIETARIA.has(aba) && !permissoes.admin ? (
        <Aviso tom="ambar">Só as proprietárias lançam entradas, saídas e contagens. Você pode consultar a Situação e o Histórico.</Aviso>
      ) : (
        <>
          {aba === 'situacao' && <Situacao />}
          {aba === 'entrada' && <Entrada />}
          {aba === 'saida' && <Saida />}
          {aba === 'inventario' && <Inventario />}
          {aba === 'movimentacoes' && <Movimentacoes />}
        </>
      )}
    </div>
  )
}

function Situacao() {
  const { lotesComSaldo, podeVerCustos, carregando } = useCatalogo()
  const pecas = usePecasComEstoque()
  const [params, setParams] = useSearchParams()
  const filtro = params.get('filtro') || 'todos'
  const [busca, setBusca] = useState('')

  const vencendoPorVariacao = useMemo(() => {
    const mapa = new Map()
    for (const l of lotesComSaldo) {
      if (!l.validade || diasAte(l.validade) > 90) continue
      const atual = mapa.get(l.variacao_id)
      if (!atual || l.validade < atual.validade) mapa.set(l.variacao_id, l)
    }
    return mapa
  }, [lotesComSaldo])

  const lista = pecas
    .filter((l) => {
      if (filtro === 'minimo') return l.saldo <= l.estoque_minimo
      if (filtro === 'zerados') return l.saldo <= 0
      if (filtro === 'vencendo') return vencendoPorVariacao.has(l.id)
      return true
    })
    .filter((l) => !busca.trim() || normalizar(`${l.produto.nome} ${l.nomeVariacao} ${l.sku} ${l.codigo_barras || ''}`).includes(normalizar(busca)))
    .sort((a, b) => a.produto.nome.localeCompare(b.produto.nome, 'pt-BR') || a.nomeVariacao.localeCompare(b.nomeVariacao, 'pt-BR', { numeric: true }))

  const total = pecas.reduce((s, l) => s + Math.max(l.saldo, 0), 0)
  const valorCusto = arred(pecas.reduce((s, l) => s + Math.max(l.saldo, 0) * (l.custo || 0), 0))
  const valorVenda = arred(pecas.reduce((s, l) => s + Math.max(l.saldo, 0) * l.preco, 0))
  const filtros = { todos: 'Tudo', minimo: 'Abaixo do mínimo', vencendo: 'Vencendo', zerados: 'Zerados' }

  if (carregando) return <p className="texto-suave">Carregando…</p>
  if (!pecas.length) {
    return (
      <Vazio icone="estoque" titulo="Nenhum produto cadastrado ainda">
        Cadastre os produtos em <Link to="/produtos">Produtos</Link> (dá para dizer quantos tem já no cadastro), ou comece uma <Link to="/estoque?aba=inventario">Contagem</Link>.
      </Vazio>
    )
  }

  return (
    <>
      <section className="grade-metricas">
        <div className="cartao metrica"><span className="metrica-rotulo">Peças em estoque</span><strong className="metrica-valor">{total}</strong></div>
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

// ---------------------------------------------------------------------
// Entrada de mercadoria: várias peças de uma vez, de um fornecedor
// ---------------------------------------------------------------------
const itemVazio = { quantidade: '', custo: '', numero_lote: '', validade: '', comLote: false }

function Entrada() {
  const { fornecedores, podeVerCustos, registrarEntrada } = useCatalogo()
  const { encomendas, clientePorId } = useClientes()
  const pecas = usePecasComEstoque()
  const [fornecedorId, setFornecedorId] = useState('')
  const [nota, setNota] = useState('')
  const [itens, setItens] = useState([])
  const [escolhida, setEscolhida] = useState(null)
  const [f, setF] = useState(itemVazio)
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState('')
  const [salvando, setSalvando] = useState(false)
  const mostraLote = escolhida && (escolhida.produto.controla_validade || f.comLote)
  // peça que tem dona: encomendas esperando por ela
  const esperando = escolhida ? encomendasDaVariacao(encomendas, escolhida.id) : []
  const [comDona, setComDona] = useState(0)

  function escolher(l) {
    setEscolhida(l)
    setErro(''); setFeito('')
    setF({ ...itemVazio, custo: l && podeVerCustos && l.custo ? paraCampoMoeda(l.custo) : '' })
  }

  function adicionar(e) {
    e.preventDefault()
    setErro('')
    if (!escolhida) return setErro('Escolha a peça: digite o nome ou leia o código de barras.')
    const qtd = lerInteiro(f.quantidade, { rotulo: 'a quantidade', min: 1, max: LIMITE.quantidade })
    if (qtd.erro) return setErro(qtd.erro)
    const custo = lerValor(f.custo, { rotulo: 'o custo de cada peça', min: 0, max: LIMITE.preco, obrigatorio: false })
    if (custo.erro) return setErro(custo.erro)
    if (custo.valor != null && custo.valor > escolhida.preco && escolhida.preco > 0) {
      return setErro(`O custo (${formatarMoeda(custo.valor)}) está maior que o preço de venda (${formatarMoeda(escolhida.preco)}). Confira, ou mude o preço na ficha do produto.`)
    }
    const numeroLote = mostraLote ? limparTexto(f.numero_lote) : ''
    const validade = mostraLote ? f.validade : ''
    const erroVal = erroValidade(validade)
    if (erroVal) return setErro(erroVal)
    if (itens.length >= 200) return setErro('Uma entrada vai até 200 linhas. Registre esta e comece outra.')

    const novo = { variacao_id: escolhida.id, linha: escolhida, quantidade: qtd.valor, custo: f.custo.trim() ? custo.valor : null, numero_lote: numeroLote, validade }
    const igual = itens.find((i) => i.variacao_id === novo.variacao_id && i.numero_lote === numeroLote && i.validade === validade && i.custo === novo.custo)
    if (igual && igual.quantidade + novo.quantidade > LIMITE.quantidade) return setErro(`Passa de ${LIMITE.quantidade} peças nesta linha.`)
    setItens(igual
      ? itens.map((i) => (i === igual ? { ...i, quantidade: i.quantidade + novo.quantidade } : i))
      : [...itens, novo])
    setEscolhida(null)
    setF(itemVazio)
  }

  async function registrar() {
    setErro('')
    setSalvando(true)
    const r = await registrarEntrada({
      fornecedor_id: fornecedorId || null,
      numero_nota: limparTexto(nota),
      itens: itens.map(({ linha, ...i }) => ({ ...i, numero_lote: i.numero_lote || null, validade: i.validade || null })), // eslint-disable-line no-unused-vars
    })
    setSalvando(false)
    if (r.erro) return setErro(r.erro)
    const pecasTotal = itens.reduce((s, i) => s + i.quantidade, 0)
    setComDona(encomendas.filter((e) => e.status === 'aguardando' && e.itens.some((i) => itens.some((x) => x.variacao_id === i.variacao_id))).length)
    setFeito(`Entrada registrada: ${pecasTotal} ${pecasTotal === 1 ? 'peça' : 'peças'}. O saldo e o custo médio já foram atualizados.`)
    setItens([]); setNota('')
  }

  const totalCusto = arred(itens.reduce((s, i) => s + (i.custo ?? i.linha.custo ?? 0) * i.quantidade, 0))

  return (
    <div className="pilha">
      <section className="cartao secao formulario">
        <h2>De onde veio</h2>
        <div className="grade-campos">
          <label className="campo">
            <span>Fornecedor (opcional)</span>
            <select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
              <option value="">Sem fornecedor</option>
              {fornecedores.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          </label>
          <label className="campo"><span>Número da nota do fornecedor (opcional)</span><input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={TAMANHO.nota} /></label>
        </div>
        {!fornecedores.length && <p className="texto-suave pequeno">Nenhum fornecedor cadastrado. Dá para cadastrar em <Link to="/fornecedores">Fornecedores</Link>.</p>}
      </section>

      <form className="cartao secao formulario" onSubmit={adicionar}>
        <h2>Peças que chegaram</h2>
        <SeletorVariacao escolhida={escolhida} aoEscolher={escolher} opcoes={pecas} />
        {esperando.length > 0 && (
          <Aviso tom="oliva">
            <Icone nome="encomenda" tamanho={16} /> Esta peça tem dona: {esperando.map((e) => clientePorId.get(e.cliente_id)?.nome).filter(Boolean).join(', ')} {esperando.length === 1 ? 'está esperando' : 'estão esperando'}. Depois da entrada, marque "Chegou" em <Link to="/encomendas">Encomendas</Link> e avise.
          </Aviso>
        )}
        {escolhida && (
          <>
            <div className="grade-campos">
              <label className="campo"><span>Quantidade</span><input inputMode="numeric" value={f.quantidade} onChange={(e) => setF({ ...f, quantidade: filtroInteiro(e.target.value) })} autoFocus /></label>
              {podeVerCustos && <label className="campo"><span>Custo de cada peça (opcional)</span><input inputMode="decimal" value={f.custo} onChange={(e) => setF({ ...f, custo: filtroDinheiro(e.target.value) })} placeholder="0,00" /></label>}
              {mostraLote && (
                <>
                  <label className="campo"><span>Lote (opcional)</span><input value={f.numero_lote} onChange={(e) => setF({ ...f, numero_lote: e.target.value })} maxLength={TAMANHO.lote} /></label>
                  <label className="campo"><span>Validade (opcional)</span><input type="date" value={f.validade} onChange={(e) => setF({ ...f, validade: e.target.value })} /></label>
                </>
              )}
            </div>
            {!escolhida.produto.controla_validade && (
              <label className="campo-check"><input type="checkbox" checked={f.comLote} onChange={(e) => setF({ ...f, comLote: e.target.checked })} /> Anotar lote e validade</label>
            )}
            <button className="botao botao-secundario"><Icone nome="somar" /> Pôr na lista</button>
          </>
        )}
        {erro && <Aviso tom="vinho">{erro}</Aviso>}
        {feito && <Aviso tom="oliva">{feito}{comDona > 0 && <> Chegaram peças de {comDona} {comDona === 1 ? 'encomenda' : 'encomendas'}: <Link to="/encomendas">marque "Chegou" e avise a cliente</Link>.</>}</Aviso>}
      </form>

      {itens.length > 0 && (
        <section className="cartao secao">
          <h2>Conferir e registrar</h2>
          <ul className="lista">
            {itens.map((i, n) => (
              <li key={n} className="linha-lista">
                <span>
                  <strong>{i.quantidade} × {i.linha.produto.nome}</strong>
                  <small>{[i.linha.nomeVariacao, (i.numero_lote || i.validade) && textoLote({ lote_id: 1, numero_lote: i.numero_lote, validade: i.validade }), podeVerCustos && (i.custo != null ? `${formatarMoeda(i.custo)} cada` : 'custo médio mantido')].filter(Boolean).join(' · ')}</small>
                </span>
                <button className="botao-link" onClick={() => setItens(itens.filter((_, k) => k !== n))}>Tirar</button>
              </li>
            ))}
          </ul>
          <p className="texto-suave pequeno">
            {itens.reduce((s, i) => s + i.quantidade, 0)} peças{podeVerCustos && ` · ${formatarMoeda(totalCusto)} a preço de custo`}.
            {' '}Depois de registrada, a entrada não se apaga: para corrigir, lance uma saída ou uma correção.
          </p>
          <button className="botao botao-principal botao-grande" onClick={registrar} disabled={salvando}>{salvando ? 'Registrando…' : 'Registrar entrada'}</button>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Saída sem venda e correção rápida de saldo
// ---------------------------------------------------------------------
const OPCOES_SAIDA = { corrigir: 'Corrigir saldo', perda: 'Perda ou avaria', brinde: 'Brinde', uso_interno: 'Uso interno', devolucao_fornecedor: 'Devolução ao fornecedor' }

function Saida() {
  const { registrarSaida, corrigirSaldo, baldesDa, linhas } = useCatalogo()
  const pecas = usePecasComEstoque()
  const [tipo, setTipo] = useState('perda')
  const [escolhidaId, setEscolhidaId] = useState(null)
  const escolhida = linhas.find((l) => l.id === escolhidaId) // sempre com o saldo mais novo
  const [loteId, setLoteId] = useState('')
  const [numero, setNumero] = useState('')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState('')
  const [salvando, setSalvando] = useState(false)
  const corrigir = tipo === 'corrigir'
  const lotes = escolhida ? ordenarPorValidade(baldesDa(escolhida.id).filter((b) => b.saldo > 0)) : []
  const temLotes = lotes.some((b) => b.lote_id)
  const disponivel = loteId ? (lotes.find((b) => (b.lote_id || 'sem') === loteId)?.saldo || 0) : Math.max(escolhida?.saldo || 0, 0)

  async function salvar(e) {
    e.preventDefault()
    setErro(''); setFeito('')
    if (!escolhida) return setErro('Escolha a peça.')
    const lido = lerInteiro(numero, { rotulo: corrigir ? 'quantas peças você contou' : 'a quantidade', min: corrigir ? 0 : 1, max: LIMITE.quantidade })
    if (lido.erro) return setErro(lido.erro)
    const n = lido.valor
    if (!corrigir && n > disponivel) {
      return setErro(`O sistema tem só ${disponivel} desta peça${loteId ? ' neste lote' : ''}. Se o número real é outro, use antes "Corrigir saldo".`)
    }
    if (corrigir && n === escolhida.saldo) return setFeito('A contagem confere com o sistema. Nada a corrigir.')
    const textoMotivo = limparTexto(motivo)
    if (textoMotivo.length < 3) return setErro('O motivo é obrigatório: fica registrado no histórico.')
    setSalvando(true)
    const r = corrigir
      ? await corrigirSaldo(escolhida.id, n, textoMotivo)
      : await registrarSaida({ variacaoId: escolhida.id, tipo, quantidade: n, motivo: textoMotivo, loteId: loteId === 'sem' ? null : loteId })
    setSalvando(false)
    if (r.erro) return setErro(r.erro)
    setFeito(corrigir
      ? `Saldo corrigido para ${n} (${r.data > 0 ? '+' : ''}${r.data}).`
      : `${OPCOES_SAIDA[tipo]}: −${n}. Agora há ${r.data} em estoque.`)
    setNumero(''); setMotivo(''); setLoteId('')
  }

  return (
    <form className="cartao secao formulario" onSubmit={salvar}>
      <h2>Saída sem venda ou correção</h2>
      <div className="fichas">
        {Object.entries(OPCOES_SAIDA).map(([t, nome]) => (
          <button type="button" key={t} className={`ficha ${tipo === t ? 'ativo' : ''}`} onClick={() => { setTipo(t); setFeito(''); setErro('') }}>{nome}</button>
        ))}
      </div>
      <SeletorVariacao escolhida={escolhida} aoEscolher={(l) => { setEscolhidaId(l?.id || null); setLoteId(''); setFeito('') }} opcoes={pecas} />
      {escolhida && !corrigir && temLotes && (
        <label className="campo">
          <span>De qual lote</span>
          <select value={loteId} onChange={(e) => setLoteId(e.target.value)}>
            <option value="">Pela validade mais próxima</option>
            {lotes.map((b) => <option key={b.lote_id || 'sem'} value={b.lote_id || 'sem'}>{textoLote(b)} · {b.saldo} un</option>)}
          </select>
        </label>
      )}
      <div className="grade-campos">
        <label className="campo">
          <span>{corrigir ? `Quantas peças você contou${escolhida ? ` (o sistema diz ${escolhida.saldo})` : ''}` : 'Quantidade que saiu'}</span>
          <input inputMode="numeric" value={numero} onChange={(e) => setNumero(filtroInteiro(e.target.value))} />
        </label>
        <label className="campo"><span>Motivo</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={TAMANHO.motivo} placeholder={corrigir ? 'Ex.: conferência da prateleira' : 'Ex.: peça com defeito'} /></label>
      </div>
      <p className="texto-suave pequeno">
        {corrigir
          ? 'Lança só a diferença. Para conferir muitas peças de uma vez, use a Contagem.'
          : 'O sistema nunca apaga nem edita o estoque: lança uma saída nova, com o seu nome e o motivo.'}
      </p>
      {erro && <Aviso tom="vinho">{erro}</Aviso>}
      {feito && <Aviso tom="oliva">{feito}</Aviso>}
      <button className="botao botao-principal botao-grande" disabled={salvando}>{salvando ? 'Registrando…' : 'Registrar'}</button>
    </form>
  )
}

// ---------------------------------------------------------------------
// Histórico: o livro do estoque, do mais novo para o mais antigo
// ---------------------------------------------------------------------
const POR_PAGINA = 100

function Movimentacoes() {
  const { linhas } = useCatalogo()
  const [params, setParams] = useSearchParams()
  const variacaoId = params.get('variacao')
  const [tipo, setTipo] = useState('todos')
  const [lista, setLista] = useState(null)
  const [fim, setFim] = useState(false)
  const [erro, setErro] = useState('')
  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])
  const escolhida = variacaoId && linhaPorId.get(variacaoId)

  const buscar = useCallback(async (desde) => {
    let q = supabase.from('movimentacoes_estoque')
      .select('id, variacao_id, tipo, quantidade, motivo, usuario_nome, criado_em, lotes(numero_lote, validade)')
      .order('id', { ascending: false })
      .range(desde, desde + POR_PAGINA - 1)
    if (tipo !== 'todos') q = q.eq('tipo', tipo)
    if (variacaoId) q = q.eq('variacao_id', variacaoId)
    const { data, error } = await q
    if (error) { setErro(traduzirErro(error)); return }
    setErro('')
    setFim(data.length < POR_PAGINA)
    setLista((atual) => (desde === 0 ? data : [...(atual || []), ...data]))
  }, [tipo, variacaoId])

  useEffect(() => { setLista(null); buscar(0) }, [buscar])

  const nome = (id) => {
    const l = linhaPorId.get(id)
    return l ? `${l.produto.nome} · ${l.nomeVariacao}` : 'Peça apagada'
  }

  return (
    <>
      <p className="texto-suave">O livro do estoque: cada entrada e saída, com quem fez e por quê. Nada aqui é editado nem apagado. Para corrigir, lança-se uma movimentação nova.</p>
      <div className="linha-campos">
        <label className="campo campo-estreito">
          <span>Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="todos">Todos</option>
            {Object.entries(TIPOS_MOVIMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {variacaoId && (
          <div className="seletor-escolhido">
            <div><strong>{escolhida ? escolhida.produto.nome : 'Uma peça'}</strong><small>{escolhida?.nomeVariacao}</small></div>
            <button type="button" className="botao-link" onClick={() => setParams({ aba: 'movimentacoes' }, { replace: true })}>Ver todas</button>
          </div>
        )}
      </div>
      {erro && <Aviso tom="vinho">{erro}</Aviso>}
      {lista === null ? <p className="texto-suave">Carregando…</p> : lista.length === 0 ? <Vazio icone="estoque" titulo="Nenhuma movimentação ainda" /> : (
        <>
          <ul className="cartao lista">
            {lista.map((m) => (
              <li key={m.id} className="linha-lista">
                <span>
                  <strong>{nome(m.variacao_id)}</strong>
                  <small>{[formatarDataHora(m.criado_em), TIPOS_MOVIMENTO[m.tipo], m.lotes && textoLote({ lote_id: 1, ...m.lotes }), m.usuario_nome, m.motivo].filter(Boolean).join(' · ')}</small>
                </span>
                <strong className={m.quantidade > 0 ? 'texto-positivo' : 'texto-negativo'}>{m.quantidade > 0 ? `+${m.quantidade}` : m.quantidade}</strong>
              </li>
            ))}
          </ul>
          {!fim && <button className="botao botao-secundario" onClick={() => buscar(lista.length)}>Ver mais antigas</button>}
        </>
      )}
    </>
  )
}

