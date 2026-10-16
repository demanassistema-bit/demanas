import { useState } from 'react'
import Icone from '../components/Icone'
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

// Porta de entrada das áreas protegidas (na demonstração, qualquer código abre)
export default function AreaFutura({ area }) {
  const info = AREAS[area]
  const primeira = Object.keys(info.abas)[0]
  const [codigo, setCodigo] = useState('')
  // o desbloqueio vale enquanto a aba do navegador estiver aberta
  const [aberta, setAberta] = useState(() => ler(`demanas-demo-${area}`) === '1')
  const [aba, setAba] = useState(() => {
    const salva = ler(`demanas-demo-aba-${area}`)
    return info.abas[salva] ? salva : primeira
  })
  const mudarAba = (a) => { setAba(a); gravar(`demanas-demo-aba-${area}`, a) }
  const abrir = () => { setAberta(true); gravar(`demanas-demo-${area}`, '1') }

  if (!aberta) {
    return (
      <div className="tela-codigo">
        <form className="cartao cartao-codigo" onSubmit={(e) => { e.preventDefault(); abrir() }}>
          <span className="selo-cadeado"><Icone nome="cadeado" tamanho={26} /></span>
          <h1>{info.titulo}</h1>
          <p className="texto-suave">Área protegida. Digite o código de acesso para continuar.</p>
          <label className="campo">
            <span>Código de acesso</span>
            <input type="password" autoComplete="off" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          </label>
          <button className="botao botao-principal">Entrar</button>
          <p className="texto-suave pequeno">Na demonstração, qualquer código abre. Na versão real, o código fica protegido no banco e 5 erros bloqueiam por 15 minutos.</p>
        </form>
      </div>
    )
  }

  const Tela = info.abas[aba].Tela
  const Topo = info.Topo
  return (
    <div className="pagina pagina-estreita">
      <header className="pagina-topo"><h1>{info.titulo}</h1></header>
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
