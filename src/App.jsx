import { useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useDemo } from './demo/DemoContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Inicio from './pages/Inicio'
import NovaVenda from './pages/NovaVenda'
import Vendas from './pages/Vendas'
import Produtos from './pages/Produtos'
import FichaProduto from './pages/FichaProduto'
import Estoque from './pages/Estoque'
import Clientes, { FichaCliente } from './pages/Clientes'
import Relatorios from './pages/Relatorios'
import AreaFutura from './pages/AreaFutura'
import Configuracoes from './pages/Configuracoes'

const lerEntrada = () => { try { return sessionStorage.getItem('demanas-demo-entrou') === '1' } catch { return false } }

export default function App() {
  const { ehProprietaria } = useDemo()
  const [entrou, setEntrou] = useState(lerEntrada)
  const marcar = (v) => {
    setEntrou(v)
    try { sessionStorage.setItem('demanas-demo-entrou', v ? '1' : '0') } catch { /* sem armazenamento */ }
  }

  if (!entrou) return <Login aoEntrar={() => marcar(true)} />

  const soProprietaria = (elemento) => (ehProprietaria ? elemento : <Navigate to="/" replace />)

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout aoSair={() => marcar(false)} />}>
          <Route index element={<Inicio />} />
          <Route path="vender" element={<NovaVenda />} />
          <Route path="vendas" element={<Vendas />} />
          <Route path="produtos" element={<Produtos />} />
          <Route path="produtos/:produtoId" element={<FichaProduto />} />
          <Route path="estoque" element={<Estoque />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="clientes/:clienteId" element={<FichaCliente />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="financeiro" element={soProprietaria(<AreaFutura key="financeiro" area="financeiro" />)} />
          <Route path="fiscal" element={soProprietaria(<AreaFutura key="fiscal" area="fiscal" />)} />
          <Route path="configuracoes" element={soProprietaria(<Configuracoes />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
