import { useEffect, useRef, useState } from 'react'
import Icone from './Icone'

export default function Modal({ titulo, aoFechar, children, rodape, largura = 560 }) {
  const fechar = useRef(aoFechar)
  fechar.current = aoFechar
  useEffect(() => {
    const tecla = (e) => e.key === 'Escape' && fechar.current()
    document.addEventListener('keydown', tecla)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', tecla)
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="modal" style={{ maxWidth: largura }} role="dialog" aria-modal="true" aria-label={titulo}>
        <header className="modal-topo">
          <h2>{titulo}</h2>
          <button className="botao-icone" onClick={aoFechar} aria-label="Fechar">
            <Icone nome="fechar" tamanho={18} />
          </button>
        </header>
        <div className="modal-corpo">{children}</div>
        {rodape && <footer className="modal-rodape">{rodape}</footer>}
      </div>
    </div>
  )
}

// Ação destrutiva com confirmação em dois cliques (sem janelas do navegador)
export function BotaoPerigo({ aoConfirmar, texto, disabled }) {
  const [confirmando, setConfirmando] = useState(false)
  useEffect(() => {
    if (!confirmando) return
    const t = setTimeout(() => setConfirmando(false), 4000)
    return () => clearTimeout(t)
  }, [confirmando])
  return (
    <button
      type="button"
      disabled={disabled}
      className={`botao ${confirmando ? 'botao-perigo' : 'botao-fantasma perigo'}`}
      onClick={() => (confirmando ? aoConfirmar() : setConfirmando(true))}
    >
      {confirmando ? 'Toque de novo para confirmar' : texto}
    </button>
  )
}
