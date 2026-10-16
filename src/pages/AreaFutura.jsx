import { useState } from 'react'
import Icone from '../components/Icone'
import { Aviso } from '../components/ui'

const AREAS = {
  financeiro: {
    titulo: 'Financeiro',
    etapa: 6,
    itens: [
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
  const [aberta, setAberta] = useState(false)

  if (!aberta) {
    return (
      <div className="tela-codigo">
        <form className="cartao cartao-codigo" onSubmit={(e) => { e.preventDefault(); setAberta(true) }}>
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

  return (
    <div className="pagina pagina-estreita">
      <header className="pagina-topo"><h1>{info.titulo}</h1></header>
      <Aviso tom="ambar">Esta área chega na <strong>Etapa {info.etapa}</strong>. Aqui está o que ela vai ter:</Aviso>
      <ul className="cartao lista lista-marcada">
        {info.itens.map((t) => <li key={t}><Icone nome="confirmar" tamanho={18} /> {t}</li>)}
      </ul>
    </div>
  )
}
