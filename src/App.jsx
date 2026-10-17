import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Logo from './components/Logo'
import Login from './pages/Login'
import DefinirSenha from './pages/DefinirSenha'
import Equipe from './pages/Equipe'
import ImportarProdutos from './pages/ImportarProdutos'
import Fornecedores from './pages/Fornecedores'
import Inicio from './pages/Inicio'
import NovaVenda from './pages/NovaVenda'
import Vendas from './pages/Vendas'
import Encomendas from './pages/Encomendas'
import Produtos from './pages/Produtos'
import FichaProduto from './pages/FichaProduto'
import Estoque from './pages/Estoque'
import Clientes, { FichaCliente } from './pages/Clientes'
import Relatorios from './pages/Relatorios'
import AreaFutura from './pages/AreaFutura'
import Configuracoes from './pages/Configuracoes'

export default function App() {
  const { session, perfil, permissoes, carregando, semConexao, precisaDefinirSenha, sair } = useAuth()

  if (carregando) return <div className="carregando"><Logo altura={56} /></div>
  if (!session) return <Login />
  // convite, "esqueci a senha" ou login criado com senha provisória
  if (precisaDefinirSenha || perfil?.senha_provisoria) return <DefinirSenha />

  if (semConexao) {
    return (
      <div className="tela-acesso">
        <div className="cartao cartao-acesso">
          <Logo altura={56} className="logo-login" />
          <h1>Sem conexão</h1>
          <p className="texto-suave">Não deu para falar com o sistema. Confira o Wi-Fi ou os dados do celular.</p>
          <button className="botao botao-principal" onClick={() => window.location.reload()}>Tentar de novo</button>
        </div>
      </div>
    )
  }

  if (!perfil?.ativo) {
    return (
      <div className="tela-acesso">
        <div className="cartao cartao-acesso">
          <Logo altura={56} className="logo-login" />
          <h1>Acesso desativado</h1>
          <p className="texto-suave">Seu acesso ao sistema da deManas está desligado. Fale com a Day ou a Fê.</p>
          <button className="botao botao-secundario" onClick={sair}>Sair</button>
        </div>
      </div>
    )
  }

  const soSe = (pode, elemento) => (pode ? elemento : <Navigate to="/" replace />)

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Inicio />} />
          <Route path="vender" element={<NovaVenda />} />
          <Route path="vendas" element={<Vendas />} />
          <Route path="encomendas" element={<Encomendas />} />
          <Route path="produtos" element={<Produtos />} />
          <Route path="produtos/importar" element={<ImportarProdutos />} />
          <Route path="produtos/:produtoId" element={<FichaProduto />} />
          <Route path="fornecedores" element={soSe(permissoes.admin, <Fornecedores />)} />
          <Route path="estoque" element={<Estoque />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="clientes/:clienteId" element={<FichaCliente />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="calculadora" element={<Navigate to="/financeiro" replace />} />
          <Route path="financeiro" element={soSe(permissoes.pode_financeiro, <AreaFutura key="financeiro" area="financeiro" />)} />
          <Route path="fiscal" element={soSe(permissoes.pode_fiscal, <AreaFutura key="fiscal" area="fiscal" />)} />
          <Route path="equipe" element={soSe(permissoes.admin, <Equipe />)} />
          <Route path="configuracoes" element={soSe(permissoes.admin, <Configuracoes />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
