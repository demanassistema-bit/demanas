import { useState } from 'react'
import Logo from '../components/Logo'
import { TAMANHO } from '../lib/limites'

// Na demonstração, qualquer e-mail entra. Na versão real: Supabase Auth, só por convite.
export default function Login({ aoEntrar }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  return (
    <div className="tela-acesso">
      <form className="cartao cartao-acesso" onSubmit={(e) => { e.preventDefault(); aoEntrar() }}>
        <Logo altura={64} className="logo-login" />
        <p className="texto-suave">Sistema de gestão e estoque</p>
        <label className="campo"><span>E-mail</span><input type="email" autoComplete="username" maxLength={TAMANHO.email} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="campo"><span>Senha</span><input type="password" autoComplete="current-password" maxLength={TAMANHO.senha} value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
        <button className="botao botao-principal botao-grande">Entrar</button>
        <p className="texto-suave pequeno centro">Demonstração: pode entrar sem preencher. A equipe entra só por convite.</p>
      </form>
    </div>
  )
}
