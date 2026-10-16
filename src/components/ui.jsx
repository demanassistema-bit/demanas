import { useMemo, useState } from 'react'
import Icone from './Icone'
import { useDemo } from '../demo/DemoContext'
import { normalizar } from '../demo/regras'
import { formatarMoeda } from '../lib/moeda'
import { diasAte } from '../lib/datas'

// Selo de situação em tons terrosos: 'ambar' | 'vinho' | 'oliva' | 'neutro'
export function Selo({ tom = 'neutro', children }) {
  return <span className={`selo selo-${tom}`}>{children}</span>
}

// Tom do alerta de validade: 30, 60 e 90 dias
export function seloValidade(validade) {
  const dias = diasAte(validade)
  if (dias < 0) return <Selo tom="vinho">Vencido</Selo>
  if (dias <= 30) return <Selo tom="vinho">Vence em {dias} d</Selo>
  if (dias <= 60) return <Selo tom="ambar">Vence em {dias} d</Selo>
  if (dias <= 90) return <Selo tom="oliva">Vence em {dias} d</Selo>
  return null
}

export function Vazio({ icone = 'busca', titulo, children }) {
  return (
    <div className="vazio">
      <Icone nome={icone} tamanho={30} />
      <strong>{titulo}</strong>
      {children && <p>{children}</p>}
    </div>
  )
}

export function Metrica({ rotulo, valor, detalhe }) {
  return (
    <div className="cartao metrica">
      <span className="metrica-rotulo">{rotulo}</span>
      <strong className="metrica-valor">{valor}</strong>
      {detalhe && <span className="metrica-detalhe">{detalhe}</span>}
    </div>
  )
}

export function CampoBusca({ valor, aoMudar, placeholder = 'Buscar', autoFocus, grande }) {
  return (
    <label className={`campo-busca ${grande ? 'grande' : ''}`}>
      <Icone nome="busca" tamanho={grande ? 22 : 18} />
      <input
        type="search"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
      />
    </label>
  )
}

export function buscarVariacoes(linhas, texto, limite = 8) {
  const termos = normalizar(texto).split(/\s+/).filter(Boolean)
  if (!termos.length) return []
  return linhas
    .filter((l) => {
      const alvo = normalizar(`${l.produto.nome} ${l.nomeVariacao} ${l.sku} ${l.codigo_barras} ${l.produto.marca}`)
      return termos.every((t) => alvo.includes(t))
    })
    .slice(0, limite)
}

// Escolher uma variação digitando parte do nome, código ou cor
export function SeletorVariacao({ escolhida, aoEscolher }) {
  const { linhas } = useDemo()
  const [texto, setTexto] = useState('')
  const resultados = useMemo(() => buscarVariacoes(linhas, texto), [linhas, texto])

  if (escolhida) {
    return (
      <div className="seletor-escolhido">
        <div>
          <strong>{escolhida.produto.nome}</strong>
          <small>{escolhida.nomeVariacao} · em estoque: {escolhida.saldo}</small>
        </div>
        <button type="button" className="botao-link" onClick={() => aoEscolher(null)}>Trocar</button>
      </div>
    )
  }
  return (
    <div className="seletor">
      <CampoBusca valor={texto} aoMudar={setTexto} placeholder="Produto, cor, tamanho ou código" />
      {resultados.length > 0 && (
        <ul className="lista-opcoes">
          {resultados.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => { aoEscolher(l); setTexto('') }}>
                <span>
                  <strong>{l.produto.nome}</strong>
                  <small>{l.nomeVariacao}</small>
                </span>
                <span className="texto-suave">{l.saldo} un · {formatarMoeda(l.preco)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Aviso({ tom = 'oliva', children }) {
  return <p className={`aviso aviso-${tom}`} role="status">{children}</p>
}
