import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase, traduzirErro } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Aviso, Selo } from '../components/ui'
import { TAMANHO } from '../lib/limites'

const LINK_CONVITE = 'https://supabase.com/dashboard/project/kcrhewzxpklwevctqosx/auth/users'
const AREAS = { financeiro: 'Financeiro', fiscal: 'Nota fiscal' }

// Só as proprietárias: quem é da equipe, o que cada uma pode ver e os códigos das áreas protegidas
export default function Equipe() {
  const { session, permissoes, atualizarPermissoes } = useAuth()
  const [membros, setMembros] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    supabase.from('perfis').select('*').order('nome').then(({ data, error }) => {
      if (error) setErro(traduzirErro(error))
      setMembros(data || [])
    })
  }, [])

  if (!permissoes.admin) return <Navigate to="/" replace />

  async function alterar(membro, campos) {
    setErro('')
    const anterior = membros
    setMembros(membros.map((m) => (m.id === membro.id ? { ...m, ...campos } : m)))
    const { error } = await supabase.from('perfis').update(campos).eq('id', membro.id)
    if (error) {
      setMembros(anterior)
      setErro(traduzirErro(error))
    } else if (membro.id === session.user.id) {
      atualizarPermissoes()
    }
  }

  return (
    <div className="pagina pagina-estreita">
      <header className="pagina-topo">
        <div>
          <h1>Equipe</h1>
          <p className="texto-suave">Quem usa o sistema e o que cada pessoa pode ver. Mesmo com permissão, o Financeiro e a Nota fiscal pedem o código da área.</p>
        </div>
      </header>

      {erro && <Aviso tom="vinho">{erro}</Aviso>}

      <section className="cartao secao">
        <h2>Pessoas</h2>
        {membros === null && <p className="texto-suave">Carregando…</p>}
        <ul className="lista lista-equipe">
          {membros?.map((m) => {
            const souEu = m.id === session.user.id
            return (
              <li key={m.id} className={`membro ${m.ativo ? '' : 'inativo'}`}>
                <div className="membro-topo">
                  <span className="com-avatar">
                    <span className="avatar">{(m.nome || m.email).charAt(0).toUpperCase()}</span>
                    <span>
                      <strong>{m.nome || 'Sem nome'}{souEu && ' (você)'}</strong>
                      <small>{m.email}</small>
                    </span>
                  </span>
                  {!m.ativo && <Selo tom="vinho">Desativada</Selo>}
                </div>
                <div className="grade-campos">
                  <label className="campo">
                    <span>Papel</span>
                    <select value={m.papel} disabled={souEu} onChange={(e) => alterar(m, { papel: e.target.value })}>
                      <option value="membro">Vendedora</option>
                      <option value="admin">Proprietária</option>
                    </select>
                  </label>
                </div>
                <label className="interruptor-linha">
                  <span>Pode entrar no Financeiro</span>
                  <input type="checkbox" role="switch" className="interruptor" checked={m.pode_financeiro} onChange={(e) => alterar(m, { pode_financeiro: e.target.checked })} />
                </label>
                <label className="interruptor-linha">
                  <span>Pode entrar na Nota fiscal</span>
                  <input type="checkbox" role="switch" className="interruptor" checked={m.pode_fiscal} onChange={(e) => alterar(m, { pode_fiscal: e.target.checked })} />
                </label>
                <label className="interruptor-linha">
                  <span>Acesso ativo <small className="texto-suave">desligue quando a pessoa sair da loja</small></span>
                  <input type="checkbox" role="switch" className="interruptor" checked={m.ativo} disabled={souEu} onChange={(e) => alterar(m, { ativo: e.target.checked })} />
                </label>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="cartao secao">
        <h2>Convidar alguém</h2>
        <p className="texto-suave pequeno">
          O convite sai pelo painel do Supabase, com a conta da loja: <strong>Add user → Send invitation</strong>, e o e-mail da pessoa.
          Ela recebe um link, cria a senha e aparece nesta lista como vendedora. Aí é só mudar o papel aqui, se for o caso.
        </p>
        <a className="botao botao-secundario" href={LINK_CONVITE} target="_blank" rel="noreferrer">Abrir o painel de convites</a>
      </section>

      <section className="cartao secao">
        <h2>Códigos das áreas protegidas</h2>
        <p className="texto-suave pequeno">Cada área tem seu código. Trocar o código tranca a área para todo mundo que estava dentro.</p>
        {Object.entries(AREAS).map(([area, nome]) => (
          <DefinirCodigo key={area} area={area} nome={nome} criado={permissoes.codigos_criados?.includes(area)} aoSalvar={atualizarPermissoes} />
        ))}
      </section>
    </div>
  )
}

function DefinirCodigo({ area, nome, criado, aoSalvar }) {
  const [codigo, setCodigo] = useState('')
  const [repetido, setRepetido] = useState('')
  const [msg, setMsg] = useState(null)
  const [enviando, setEnviando] = useState(false)

  async function salvar(e) {
    e.preventDefault()
    if (codigo.trim().length < 4) return setMsg({ tom: 'vinho', texto: 'Use de 4 a 20 caracteres.' })
    if (codigo !== repetido) return setMsg({ tom: 'vinho', texto: 'Os dois códigos não estão iguais.' })
    setEnviando(true)
    const { error } = await supabase.rpc('definir_codigo_area', { p_area: area, p_codigo: codigo })
    setEnviando(false)
    if (error) return setMsg({ tom: 'vinho', texto: traduzirErro(error) })
    setCodigo(''); setRepetido('')
    setMsg({ tom: 'oliva', texto: `Código do ${nome} ${criado ? 'trocado' : 'criado'}. Guarde num lugar seguro: nem o sistema consegue mostrar ele depois.` })
    aoSalvar()
  }

  return (
    <form className="perfil-fiscal formulario" onSubmit={salvar}>
      <header className="bloco-topo">
        <strong>{nome}</strong>
        {criado ? <Selo tom="oliva">Código criado</Selo> : <Selo tom="ambar">Sem código</Selo>}
      </header>
      <div className="grade-campos">
        <label className="campo"><span>{criado ? 'Código novo' : 'Código'}</span><input type="password" autoComplete="new-password" maxLength={TAMANHO.codigo} value={codigo} onChange={(e) => setCodigo(e.target.value)} /></label>
        <label className="campo"><span>Repita o código</span><input type="password" autoComplete="new-password" maxLength={TAMANHO.codigo} value={repetido} onChange={(e) => setRepetido(e.target.value)} /></label>
      </div>
      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}
      <button className="botao botao-secundario" disabled={enviando || !codigo}>{enviando ? 'Salvando…' : criado ? 'Trocar código' : 'Criar código'}</button>
    </form>
  )
}
