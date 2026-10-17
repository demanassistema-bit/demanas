import { useState } from 'react'
import { supabase, traduzirErro, linkDeAcesso } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import Logo from '../components/Logo'
import { Aviso } from '../components/ui'
import { limparTexto, TAMANHO } from '../lib/limites'

// Aberta pelo link do convite ou de "esqueci a senha"
export default function DefinirSenha() {
  const { session, perfil, atualizarPerfil, concluirDefinicaoSenha } = useAuth()
  const [nome, setNome] = useState(perfil?.nome || '')
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function salvar(e) {
    e.preventDefault()
    if (limparTexto(nome).length < 2) return setErro('Diga como quer ser chamada.')
    if (senha.length < 8) return setErro('Use pelo menos 8 caracteres na senha.')
    if (senha !== confirmacao) return setErro('As duas senhas não estão iguais.')
    setEnviando(true)
    setErro('')
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (!error) await atualizarPerfil({ nome: limparTexto(nome), senha_provisoria: false })
    setEnviando(false)
    if (error) setErro(traduzirErro(error))
    else concluirDefinicaoSenha()
  }

  return (
    <div className="tela-acesso">
      <form className="cartao cartao-acesso" onSubmit={salvar}>
        <Logo altura={64} className="logo-login" />
        <h1>Crie sua senha</h1>
        {perfil?.senha_provisoria && linkDeAcesso.tipo !== 'invite' && <p className="texto-suave pequeno">Você entrou com uma senha provisória. Crie agora a sua: só você vai saber.</p>}
        <p className="texto-suave">{session?.user?.email}</p>
        <label className="campo">
          <span>Como quer ser chamada?</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={TAMANHO.nome} autoComplete="name" required />
        </label>
        <label className="campo">
          <span>Senha nova (pelo menos 8 caracteres)</span>
          <input type="password" autoComplete="new-password" maxLength={TAMANHO.senha} value={senha} onChange={(e) => setSenha(e.target.value)} required autoFocus />
        </label>
        <label className="campo">
          <span>Repita a senha</span>
          <input type="password" autoComplete="new-password" maxLength={TAMANHO.senha} value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} required />
        </label>
        {erro && <Aviso tom="vinho">{erro}</Aviso>}
        <button className="botao botao-principal botao-grande" disabled={enviando}>
          {enviando ? 'Salvando…' : 'Salvar e entrar'}
        </button>
      </form>
    </div>
  )
}
