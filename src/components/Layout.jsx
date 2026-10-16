import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useDemo } from '../demo/DemoContext'
import { useTheme } from '../contexts/ThemeContext'
import Logo from './Logo'
import Icone from './Icone'

const ITENS = [
  { para: '/', nome: 'Início', icone: 'inicio', fim: true },
  { para: '/vender', nome: 'Nova venda', icone: 'vender' },
  { para: '/vendas', nome: 'Vendas', icone: 'vendas' },
  { para: '/produtos', nome: 'Produtos', icone: 'produtos' },
  { para: '/estoque', nome: 'Estoque', icone: 'estoque' },
  { para: '/clientes', nome: 'Clientes', icone: 'clientes' },
  { para: '/relatorios', nome: 'Relatórios', icone: 'relatorios' },
  { para: '/calculadora', nome: 'Calculadora', icone: 'calculadora', so: 'proprietaria' },
  { para: '/financeiro', nome: 'Financeiro', icone: 'financeiro', trancada: true, so: 'proprietaria' },
  { para: '/fiscal', nome: 'Nota fiscal', icone: 'fiscal', trancada: true, so: 'proprietaria' },
  { para: '/configuracoes', nome: 'Configurações', icone: 'configuracoes', so: 'proprietaria' },
]

export default function Layout({ aoSair }) {
  const { perfil, setPerfil, usuario } = useDemo()
  const { tema, alternarTema } = useTheme()
  const [menuAberto, setMenuAberto] = useState(false)
  const itens = ITENS.filter((i) => !i.so || i.so === perfil)

  const navegacao = (
    <nav className="navegacao">
      {itens.map((item) => (
        <NavLink key={item.para} to={item.para} end={item.fim} className="nav-item" onClick={() => setMenuAberto(false)}>
          <Icone nome={item.icone} />
          <span>{item.nome}</span>
          {item.trancada && <span className="nav-cadeado" title="Protegido por código"><Icone nome="cadeado" tamanho={14} /></span>}
        </NavLink>
      ))}
    </nav>
  )

  const rodape = (
    <div className="lateral-rodape">
      <div className="usuario">
        <span className="avatar">{usuario.charAt(0)}</span>
        <span className="usuario-info">
          <strong>{usuario}</strong>
          <small>demonstração</small>
        </span>
      </div>
      <div className="lateral-acoes">
        <button className="botao-icone" onClick={alternarTema} title={tema === 'escuro' ? 'Modo claro' : 'Modo escuro'} aria-label="Alternar tema">
          <Icone nome={tema === 'escuro' ? 'sol' : 'lua'} tamanho={19} />
        </button>
        <button className="botao-icone" onClick={aoSair} title="Sair" aria-label="Sair">
          <Icone nome="sair" tamanho={19} />
        </button>
      </div>
    </div>
  )

  return (
    <div className="app">
      <div className="faixa-demo" role="note">
        <span><strong>Demonstração</strong> · dados de exemplo, nada aqui é real</span>
        <span className="ver-como">
          Ver como
          <span className="alternador" role="group" aria-label="Ver como">
            <button className={perfil === 'proprietaria' ? 'ativo' : ''} onClick={() => setPerfil('proprietaria')}>Proprietária</button>
            <button className={perfil === 'vendedora' ? 'ativo' : ''} onClick={() => setPerfil('vendedora')}>Vendedora</button>
          </span>
        </span>
      </div>

      <aside className="lateral">
        <div className="lateral-logo"><Logo altura={38} /></div>
        {navegacao}
        {rodape}
      </aside>

      <header className="topo-mobile">
        <Logo altura={26} />
        <button className="botao-icone" onClick={alternarTema} aria-label="Alternar tema">
          <Icone nome={tema === 'escuro' ? 'sol' : 'lua'} />
        </button>
      </header>

      <main className="conteudo">
        <Outlet />
      </main>

      <nav className="barra-inferior" aria-label="Navegação principal">
        <NavLink to="/" end className="aba"><Icone nome="inicio" /><span>Início</span></NavLink>
        <NavLink to="/produtos" className="aba"><Icone nome="produtos" /><span>Produtos</span></NavLink>
        <NavLink to="/vender" className="aba aba-vender"><span className="aba-vender-circulo"><Icone nome="vender" tamanho={26} /></span><span>Vender</span></NavLink>
        <NavLink to="/clientes" className="aba"><Icone nome="clientes" /><span>Clientes</span></NavLink>
        <button className="aba" onClick={() => setMenuAberto(true)}><Icone nome="mais" /><span>Mais</span></button>
      </nav>

      {menuAberto && (
        <>
          <div className="veu" onClick={() => setMenuAberto(false)} />
          <div className="gaveta" role="dialog" aria-label="Menu">
            <div className="gaveta-topo">
              <Logo altura={28} />
              <button className="botao-icone" onClick={() => setMenuAberto(false)} aria-label="Fechar menu"><Icone nome="fechar" /></button>
            </div>
            {navegacao}
            {rodape}
          </div>
        </>
      )}
    </div>
  )
}
