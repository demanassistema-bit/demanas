import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase, linkDeAcesso } from '../lib/supabase'

// Quem entrou, o perfil dela e o que ela pode ver. A proteção de verdade fica no banco (RLS).
export const AuthContext = createContext(null)

const semPermissoes = {
  admin: false,
  pode_financeiro: false,
  pode_fiscal: false,
  financeiro_liberado: false,
  fiscal_liberado: false,
  codigos_criados: [],
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [perfil, setPerfil] = useState(null)
  const [permissoes, setPermissoes] = useState(semPermissoes)
  const [carregando, setCarregando] = useState(true)
  const [precisaDefinirSenha, setPrecisaDefinirSenha] = useState(
    linkDeAcesso.tipo === 'invite' || linkDeAcesso.tipo === 'recovery'
  )

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setCarregando(false)
    })
    const { data } = supabase.auth.onAuthStateChange((evento, novaSessao) => {
      if (evento === 'PASSWORD_RECOVERY') setPrecisaDefinirSenha(true)
      setSession(novaSessao)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const atualizarPermissoes = useCallback(async () => {
    const { data } = await supabase.rpc('minhas_permissoes')
    setPermissoes(data || semPermissoes)
    return data || semPermissoes
  }, [])

  const usuarioId = session?.user?.id
  useEffect(() => {
    if (!usuarioId) {
      setPerfil(null)
      setPermissoes(semPermissoes)
      return
    }
    let ativo = true
    ;(async () => {
      const [{ data: p }] = await Promise.all([
        supabase.from('perfis').select('*').eq('id', usuarioId).maybeSingle(),
        atualizarPermissoes(),
      ])
      if (ativo) {
        setPerfil(p)
        setCarregando(false)
      }
    })()
    return () => { ativo = false }
  }, [usuarioId, atualizarPermissoes])

  const atualizarPerfil = useCallback(async (campos) => {
    const { data, error } = await supabase
      .from('perfis').update(campos).eq('id', usuarioId).select().single()
    if (!error) setPerfil(data)
    return { error }
  }, [usuarioId])

  const sair = useCallback(async () => {
    await supabase.rpc('bloquear_area', { p_area: null })
    await supabase.auth.signOut()
  }, [])

  return (
    <AuthContext.Provider
      value={{
        session,
        perfil,
        permissoes,
        carregando,
        precisaDefinirSenha,
        concluirDefinicaoSenha: () => setPrecisaDefinirSenha(false),
        atualizarPermissoes,
        atualizarPerfil,
        sair,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
