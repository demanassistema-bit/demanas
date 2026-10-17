import { useState } from 'react'
import { supabase, traduzirErro, linkDeAcesso } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import Logo from '../components/Logo'
import Icone from '../components/Icone'
import { Aviso } from '../components/ui'
import { TAMANHO } from '../lib/limites'

// Só entra quem foi convidada. Não existe "criar conta".
export default function Login() {
  const { tema, alternarTema } = useTheme()
  const [modo, setModo] = useState('entrar') // 'entrar' | 'recuperar'
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(linkDeAcesso.erro ? traduzirErro(linkDeAcesso.erro) : '')
  const [aviso, setAviso] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e) {
    e.preventDefault()
    setEnviando(true)
    setErro('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    setEnviando(false)
    if (error) setErro(traduzirErro(error))
  }

  async function recuperar(e) {
    e.preventDefault()
    setEnviando(true)
    setErro('')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + window.location.pathname,
    })
    setEnviando(false)
    if (error) setErro(traduzirErro(error))
    else setAviso('Pronto! Se este e-mail faz parte da equipe, chega um link para criar a senha nova.')
  }

  function trocarModo() {
    setModo(modo === 'entrar' ? 'recuperar' : 'entrar')
    setErro('')
    setAviso('')
  }

  return (
    <div className="tela-acesso">
      <button className="botao-icone tema-flutuante" onClick={alternarTema} aria-label="Alternar tema">
        <Icone nome={tema === 'escuro' ? 'sol' : 'lua'} tamanho={18} />
      </button>
      <form className="cartao cartao-acesso" onSubmit={modo === 'entrar' ? entrar : recuperar}>
        <Logo altura={64} className="logo-login" />
        <p className="texto-suave">{modo === 'entrar' ? 'Sistema de gestão e estoque' : 'Esqueceu a senha? Informe o e-mail e chega um link para criar outra.'}</p>
        <label className="campo">
          <span>E-mail</span>
          <input type="email" autoComplete="username" maxLength={TAMANHO.email} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        {modo === 'entrar' && (
          <label className="campo">
            <span>Senha</span>
            <input type="password" autoComplete="current-password" maxLength={TAMANHO.senha} value={senha} onChange={(e) => setSenha(e.target.value)} required />
          </label>
        )}
        {erro && <Aviso tom="vinho">{erro}</Aviso>}
        {aviso && <Aviso tom="oliva">{aviso}</Aviso>}
        <button className="botao botao-principal botao-grande" disabled={enviando}>
          {enviando ? 'Aguarde…' : modo === 'entrar' ? 'Entrar' : 'Enviar link'}
        </button>
        <button type="button" className="botao-link" onClick={trocarModo}>
          {modo === 'entrar' ? 'Esqueceu a senha?' : 'Voltar para o login'}
        </button>
        <p className="texto-suave pequeno centro">A equipe entra só por convite.</p>
      </form>
    </div>
  )
}
