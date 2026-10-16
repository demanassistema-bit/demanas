import { useState } from 'react'
import Icone from '../components/Icone'
import { Aviso } from '../components/ui'
import Calculadora from './Calculadora'

const AREAS = {
  financeiro: {
    titulo: 'Financeiro',
    etapa: 6,
    itens: [
      'Calculadora de preço ligada aos custos fixos reais do mês (já disponível na outra aba)',
      'Contas a receber (crediário e parcelas do cartão) e contas a pagar',
      'Caixa do dia: abertura, sangria, suprimento e fechamento com conferência',
      'Despesas por categoria, fluxo de caixa e resultado do mês',
      'Taxas da maquininha conferidas contra o que caiu na conta',
    ],
  },
  fiscal: {
    titulo: 'Nota fiscal',
    etapa: 7,
    itens: [
      'NFC-e emitida sozinha a cada venda, sem a cliente esperar',
      'Notas autorizadas, pendentes, rejeitadas e canceladas num só lugar',
      'Motivo da rejeição em linguagem simples, com botão de reenviar',
      'Aviso de certificado vencendo (60, 30 e 15 dias)',
      'Pacote do mês para a contadora (todos os XMLs) em um clique',
    ],
  },
}

// Mostra como será a porta de entrada das áreas protegidas por código
export default function AreaFutura({ area }) {
  const info = AREAS[area]
  const [codigo, setCodigo] = useState('')
  // na demonstração, o desbloqueio vale enquanto a aba estiver aberta
  const [aberta, setAberta] = useState(() => {
    try { return sessionStorage.getItem(`demanas-demo-${area}`) === '1' } catch { return false }
  })
  const [aba, setAba] = useState('calculadora')
  const abrir = () => {
    setAberta(true)
    try { sessionStorage.setItem(`demanas-demo-${area}`, '1') } catch { /* sem armazenamento */ }
  }

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

  const emBreve = (
    <>
      <Aviso tom="ambar">Esta parte chega na <strong>Etapa {info.etapa}</strong>. Aqui está o que ela vai ter:</Aviso>
      <ul className="cartao lista lista-marcada">
        {info.itens.map((t) => <li key={t}><Icone nome="confirmar" tamanho={18} /> {t}</li>)}
      </ul>
    </>
  )

  return (
    <div className="pagina pagina-estreita">
      <header className="pagina-topo"><h1>{info.titulo}</h1></header>
      {area === 'financeiro' ? (
        <>
          <div className="abas" role="tablist">
            <button role="tab" aria-selected={aba === 'calculadora'} className={`aba-topo ${aba === 'calculadora' ? 'ativo' : ''}`} onClick={() => setAba('calculadora')}>Calculadora de preço</button>
            <button role="tab" aria-selected={aba === 'em-breve'} className={`aba-topo ${aba === 'em-breve' ? 'ativo' : ''}`} onClick={() => setAba('em-breve')}>Em breve</button>
          </div>
          {aba === 'calculadora' ? <Calculadora /> : emBreve}
        </>
      ) : emBreve}
    </div>
  )
}
