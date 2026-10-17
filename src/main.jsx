import React from 'react'
import ReactDOM from 'react-dom/client'
import { configurado } from './lib/supabase'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { DemoProvider } from './demo/DemoContext'
import App from './App'
import './styles.css'

const raiz = ReactDOM.createRoot(document.getElementById('root'))

if (!configurado) {
  // Sem o endereço do banco (arquivo .env) o sistema não tem como abrir
  raiz.render(
    <div className="tela-acesso">
      <div className="cartao cartao-acesso">
        <h1>Sistema sem conexão</h1>
        <p className="texto-suave">Falta configurar o endereço do banco (arquivo .env). Fale com quem cuida do sistema.</p>
      </div>
    </div>
  )
} else {
  raiz.render(
    <React.StrictMode>
      <AuthProvider>
        <ThemeProvider>
          <DemoProvider>
            <App />
          </DemoProvider>
        </ThemeProvider>
      </AuthProvider>
    </React.StrictMode>
  )
}
