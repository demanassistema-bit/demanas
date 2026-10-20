import { useCallback, useEffect, useMemo, useState } from 'react'
import { buscarTudo, supabase, traduzirErro } from '../../lib/supabase'
import { limparTexto } from '../../lib/limites'

const TAMANHO_NOME = 40
const NOVA = '__nova'

// Categorias de despesa do banco (as irmãs criam novas). "mercadoria" = compra para revender.
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

  // Devolve { id } ou { erro }
  const criar = useCallback(async (nome, mercadoria) => {
    const limpo = limparTexto(nome)
    if (limpo.length < 2) return { erro: 'Dê um nome para a categoria.' }
    const { data, error } = await supabase.from('categorias_despesa').insert({ nome: limpo, mercadoria }).select().single()
    if (error) return { erro: error.code === '23505' ? 'Já existe uma categoria com esse nome.' : traduzirErro(error) }
    setLista((atual) => [...atual, data])
    return { id: data.id }
  }, [])

  return { lista, nomes, erro, criar }
}

// Campo "Categoria" com a opção de criar uma nova ali mesmo
export function SeletorCategoria({ valor, aoMudar, categorias, compacto = false }) {
  const [nova, setNova] = useState(null) // { nome, mercadoria }
  const [erro, setErro] = useState('')

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
    <select className={compacto ? 'campo-solto' : undefined} value={valor} aria-label="Categoria"
      onChange={(e) => (e.target.value === NOVA ? setNova({ nome: '', mercadoria: false }) : aoMudar(e.target.value))}>
      {!categorias.lista.some((c) => c.id === valor) && <option value={valor}>{valor}</option>}
      {categorias.lista.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
      <option value={NOVA}>+ Nova categoria…</option>
    </select>
  )
}
