import { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'

// Tema claro ou escuro. Fica no aparelho e, depois do login, no perfil (vale em qualquer aparelho).
const ThemeContext = createContext(null)

function lerTemaSalvo() {
  try { return localStorage.getItem('demanas-tema') || 'claro' } catch { return 'claro' }
}

export function ThemeProvider({ children }) {
  const { perfil, atualizarPerfil } = useAuth()
  const [tema, setTema] = useState(lerTemaSalvo)

  // ao entrar, vale o tema escolhido no perfil
  useEffect(() => {
    if (perfil?.tema) setTema(perfil.tema)
  }, [perfil?.tema])

  useEffect(() => {
    document.documentElement.dataset.theme = tema
    try { localStorage.setItem('demanas-tema', tema) } catch { /* navegador sem armazenamento */ }
  }, [tema])

  const alternarTema = () => {
    const novo = tema === 'escuro' ? 'claro' : 'escuro'
    setTema(novo)
    if (perfil) atualizarPerfil({ tema: novo })
  }

  return <ThemeContext.Provider value={{ tema, alternarTema }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
