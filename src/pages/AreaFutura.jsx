import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Aviso } from '../components/ui'
import Icone from '../components/Icone'
import { TAMANHO } from '../lib/limites'
import Calculadora from './Calculadora'
import Caixa from './financeiro/Caixa'
import AReceber from './financeiro/AReceber'
import APagar from './financeiro/APagar'
import Resultado from './financeiro/Resultado'
import Notas from './fiscal/Notas'
import Pacote from './fiscal/Pacote'
import DadosFiscais from './fiscal/DadosFiscais'
import { AlertasFiscais } from './fiscal/comum'

// Áreas protegidas por código: cada uma com suas abas
const AREAS = {
  financeiro: {
    titulo: 'Financeiro',
    abas: {
      caixa: { nome: 'Caixa do dia', Tela: Caixa },
      receber: { nome: 'A receber', Tela: AReceber },
      pagar: { nome: 'A pagar', Tela: APagar },
      resultado: { nome: 'Resultado do mês', Tela: Resultado },
      calculadora: { nome: 'Calculadora', Tela: Calculadora },
    },
  },
  fiscal: {
    titulo: 'Nota fiscal',
    Topo: AlertasFiscais,
    abas: {
      notas: { nome: 'Notas', Tela: Notas },
      pacote: { nome: 'Pacote da contadora', Tela: Pacote },
      dados: { nome: 'Dados fiscais', Tela: DadosFiscais },
    },
  },
}

const ler = (chave) => { try { return sessionStorage.getItem(chave) } catch { return null } }
const gravar = (chave, valor) => { try { sessionStorage.setItem(chave, valor) } catch { /* sem armazenamento */ } }

// Porta de entrada das áreas protegidas: permissão dada pela proprietária + código conferido no banco.
// A proteção de verdade fica no banco (RLS); esta tela é só a porta.
export default function AreaFutura({ area }) {
  const info = AREAS[area]
  const primeira = Object.keys(info.abas)[0]
  const { permissoes, atualizarPermissoes } = useAuth()
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [expiraEm, setExpiraEm] = useState(null)
  const [aba, setAba] = useState(() => {
    const salva = ler(`demanas-aba-${area}`)
    return info.abas[salva] ? salva : primeira
  })
  const mudarAba = (a) => { setAba(a); gravar(`demanas-aba-${area}`, a) }

  const pode = permissoes[`pode_${area}`]
  const liberada = permissoes[`${area}_liberado`]

  // até quando vale o desbloqueio; tranca sozinho quando acaba
  useEffect(() => {
    if (!liberada) return undefined
    let timer
    supabase.from('desbloqueios').select('expira_em').eq('area', area).maybeSingle().then(({ data }) => {
      if (!data) return
      const fim = new Date(data.expira_em)
      setExpiraEm(fim)
      timer = setTimeout(atualizarPermissoes, Math.max(fim - Date.now(), 0) + 1000)
    })
    return () => clearTimeout(timer)
  }, [liberada, area, atualizarPermissoes])

  if (!pode) return <Navigate to="/" replace />

  async function desbloquear(e) {
    e.preventDefault()
    setEnviando(true)
    setErro('')
    const { data, error } = await supabase.rpc('desbloquear_area', { p_area: area, p_codigo: codigo })
    setEnviando(false)
    setCodigo('')
    if (error || !data?.ok) return setErro(data?.erro || 'Não foi possível conferir o código. Confira a internet.')
    await atualizarPermissoes()
  }

  async function trancar() {
    await supabase.rpc('bloquear_area', { p_area: area })
    setExpiraEm(null)
    await atualizarPermissoes()
  }

  if (!liberada) {
    return (
      <div className="tela-codigo">
        <form className="cartao cartao-codigo" onSubmit={desbloquear}>
          <span className="selo-cadeado"><Icone nome="cadeado" tamanho={26} /></span>
          <h1>{info.titulo}</h1>
          <p className="texto-suave">Área protegida. Digite o código de acesso para continuar.</p>
          <label className="campo">
            <span>Código de acesso</span>
            <input type="password" autoComplete="off" maxLength={TAMANHO.codigo} value={codigo} onChange={(e) => setCodigo(e.target.value)} required autoFocus />
          </label>
          {erro && <Aviso tom="vinho">{erro}</Aviso>}
          <button className="botao botao-principal" disabled={enviando || !codigo}>{enviando ? 'Conferindo…' : 'Entrar'}</button>
          <p className="texto-suave pequeno">Libera por 4 horas. 5 erros seguidos bloqueiam por 15 minutos.</p>
        </form>
      </div>
    )
  }

  const Tela = info.abas[aba].Tela
  const Topo = info.Topo
  return (
    <div className="pagina pagina-estreita">
      <header className="pagina-topo"><h1>{info.titulo}</h1></header>
      <div className="faixa-protegida">
        <span><Icone nome="cadeado" tamanho={15} /> Liberado{expiraEm && ` até ${expiraEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}</span>
        <button className="botao-link" onClick={trancar}>Trancar agora</button>
      </div>
      {Topo && <Topo />}
      <div className="abas" role="tablist">
        {Object.entries(info.abas).map(([chave, { nome }]) => (
          <button key={chave} role="tab" aria-selected={aba === chave} className={`aba-topo ${aba === chave ? 'ativo' : ''}`} onClick={() => mudarAba(chave)}>{nome}</button>
        ))}
      </div>
      <Tela />
    </div>
  )
}
