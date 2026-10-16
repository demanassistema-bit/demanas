import { createContext, useContext, useEffect, useState } from 'react'

// Na versão real, a escolha também fica salva no perfil (vale em qualquer aparelho)
const ThemeContext = createContext(null)

function lerTemaSalvo() {
  try { return localStorage.getItem('demanas-tema') || 'claro' } catch { return 'claro' }
}

export function ThemeProvider({ children }) {
  const [tema, setTema] = useState(lerTemaSalvo)

  useEffect(() => {
    document.documentElement.dataset.theme = tema
    try { localStorage.setItem('demanas-tema', tema) } catch { /* navegador sem armazenamento */ }
  }, [tema])

  const alternarTema = () => setTema(tema === 'escuro' ? 'claro' : 'escuro')

  return <ThemeContext.Provider value={{ tema, alternarTema }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
