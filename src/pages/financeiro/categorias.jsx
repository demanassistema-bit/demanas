import { useCallback, useEffect, useMemo, useState } from 'react'
import { buscarTudo, supabase, traduzirErro } from '../../lib/supabase'
import { limparTexto } from '../../lib/limites'
import Modal, { BotaoPerigo } from '../../components/Modal'
import { Aviso } from '../../components/ui'

const TAMANHO_NOME = 40
const NOVA = '__nova'
const EDITAR = '__editar'

// Categorias de despesa do banco: as irmãs criam, renomeiam e excluem.
// "mercadoria" = compra para revender (fica fora das despesas do resultado).
// Excluída continua no banco só para dar nome às contas antigas.
export function useCategoriasDespesa() {
  const [lista, setLista] = useState([])
  const [erro, setErro] = useState('')
  const carregar = useCallback(async () => {
    const { data, error } = await buscarTudo(() => supabase.from('categorias_despesa').select('*').order('ordem').order('nome').order('id'))
    if (error) return setErro(traduzirErro(error))
    setLista(data)
  }, [])
  useEffect(() => { carregar() }, [carregar])
  const nomes = useMemo(() => Object.fromEntries(lista.map((c) => [c.id, c.nome])), [lista])
  const ativas = useMemo(() => lista.filter((c) => !c.excluida_em), [lista])

  const repetido = (error) => (error.code === '23505' ? 'Já existe uma categoria com esse nome.' : traduzirErro(error))

  // Devolve { id } ou { erro }
  const criar = useCallback(async (nome, mercadoria) => {
    const limpo = limparTexto(nome)
    if (limpo.length < 2) return { erro: 'Dê um nome para a categoria.' }
    const { data, error } = await supabase.from('categorias_despesa').insert({ nome: limpo, mercadoria }).select().single()
    if (error) return { erro: repetido(error) }
    setLista((atual) => [...atual, data])
    return { id: data.id }
  }, [])

  const renomear = useCallback(async (id, nome) => {
    const limpo = limparTexto(nome)
    if (limpo.length < 2) return { erro: 'Dê um nome para a categoria.' }
    const { error } = await supabase.from('categorias_despesa').update({ nome: limpo }).eq('id', id)
    if (error) return { erro: repetido(error) }
    await carregar()
    return {}
  }, [carregar])

  // 'apagada' (nunca usada) ou 'excluida' (usada: sai da lista, as contas antigas guardam o nome)
  const excluir = useCallback(async (id) => {
    const { data, error } = await supabase.rpc('excluir_categoria_despesa', { p_categoria: id })
    if (error) return { erro: traduzirErro(error) }
    await carregar()
    return { resultado: data }
  }, [carregar])

  return { lista, ativas, nomes, erro, criar, renomear, excluir }
}

// Campo "Categoria": escolher, criar uma nova ali mesmo, ou abrir a edição (renomear e excluir)
export function SeletorCategoria({ valor, aoMudar, categorias, compacto = false }) {
  const [nova, setNova] = useState(null) // { nome, mercadoria }
  const [editando, setEditando] = useState(false)
  const [erro, setErro] = useState('')
  const atual = categorias.lista.find((c) => c.id === valor)

  async function adicionar() {
    setErro('')
    const r = await categorias.criar(nova.nome, nova.mercadoria)
    if (r.erro) return setErro(r.erro)
    setNova(null)
    aoMudar(r.id)
  }

  if (nova) {
    return (
      <div className="nova-categoria">
        <input className="campo-solto" value={nova.nome} maxLength={TAMANHO_NOME} placeholder="Nome da categoria" autoFocus
          onChange={(e) => setNova({ ...nova, nome: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionar() } if (e.key === 'Escape') setNova(null) }} />
        <label className="campo-check pequeno">
          <input type="checkbox" checked={nova.mercadoria} onChange={(e) => setNova({ ...nova, mercadoria: e.target.checked })} />
          É compra de mercadoria para revender
        </label>
        <div className="linha-campos">
          <button type="button" className="botao botao-secundario" onClick={adicionar}>Adicionar</button>
          <button type="button" className="botao-link" onClick={() => { setNova(null); setErro('') }}>Cancelar</button>
        </div>
        {erro && <small className="texto-alerta">{erro}</small>}
      </div>
    )
  }
  return (
    <>
      <select className={compacto ? 'campo-solto' : undefined} value={valor} aria-label="Categoria"
        onChange={(e) => {
          if (e.target.value === NOVA) return setNova({ nome: '', mercadoria: false })
          if (e.target.value === EDITAR) return setEditando(true)
          aoMudar(e.target.value)
        }}>
        {(!atual || atual.excluida_em) && <option value={valor}>{atual ? `${atual.nome} (excluída)` : valor}</option>}
        {categorias.ativas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        <option value={NOVA}>+ Nova categoria…</option>
        <option value={EDITAR}>Editar categorias…</option>
      </select>
      {editando && <EditarCategorias categorias={categorias} aoFechar={() => setEditando(false)} />}
    </>
  )
}

// Janela para renomear e excluir as categorias
function EditarCategorias({ categorias, aoFechar }) {
  const [aviso, setAviso] = useState(null)
  return (
    <Modal titulo="Categorias de despesa" aoFechar={aoFechar} rodape={<button className="botao botao-principal" onClick={aoFechar}>Pronto</button>}>
      <p className="texto-suave pequeno">Renomear vale também para as contas que já usam a categoria. Excluir tira da lista: se a categoria já foi usada, as contas antigas continuam com o nome dela.</p>
      {aviso && <Aviso tom={aviso.tom}>{aviso.texto}</Aviso>}
      <ul className="lista lista-categorias">
        {categorias.ativas.map((c) => <LinhaCategoria key={c.id} categoria={c} categorias={categorias} aoAvisar={setAviso} />)}
      </ul>
    </Modal>
  )
}

function LinhaCategoria({ categoria, categorias, aoAvisar }) {
  const [nome, setNome] = useState(categoria.nome)
  const mudou = limparTexto(nome) !== categoria.nome

  async function salvar() {
    const r = await categorias.renomear(categoria.id, nome)
    aoAvisar(r.erro ? { tom: 'vinho', texto: r.erro } : { tom: 'oliva', texto: `Renomeada para "${limparTexto(nome)}".` })
  }
  async function excluir() {
    const r = await categorias.excluir(categoria.id)
    if (r.erro) return aoAvisar({ tom: 'vinho', texto: r.erro })
    aoAvisar({ tom: 'oliva', texto: r.resultado === 'apagada' ? `"${categoria.nome}" foi apagada.` : `"${categoria.nome}" saiu da lista. As contas antigas continuam com esse nome.` })
  }

  return (
    <li className="linha-lista linha-categoria">
      <input className="campo-solto" value={nome} maxLength={TAMANHO_NOME} onChange={(e) => setNome(e.target.value)} aria-label={`Nome de ${categoria.nome}`}
        onKeyDown={(e) => { if (e.key === 'Enter' && mudou) { e.preventDefault(); salvar() } }} />
      {categoria.mercadoria && <small className="texto-suave">mercadoria</small>}
      {mudou && <button type="button" className="botao botao-secundario" onClick={salvar}>Salvar</button>}
      <BotaoPerigo texto="Excluir" aoConfirmar={excluir} />
    </li>
  )
}
