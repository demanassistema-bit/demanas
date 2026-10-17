import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { Aviso } from './ui'

// Leitura de código de barras pela câmera, com o leitor do próprio navegador
// (BarcodeDetector: Chrome no Android). Sem ele, a tela avisa e segue pela busca.
export const temLeitorCamera = () =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia)

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf']

export default function LeitorCamera({ aoLer, aoFechar }) {
  const video = useRef(null)
  const aoLerAtual = useRef(aoLer)
  aoLerAtual.current = aoLer
  const [erro, setErro] = useState('')

  useEffect(() => {
    let parar = false
    let stream
    let timer
    ;(async () => {
      try {
        const suportados = await window.BarcodeDetector.getSupportedFormats()
        const detector = new window.BarcodeDetector({ formats: FORMATOS.filter((f) => suportados.includes(f)) })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (parar) return
        video.current.srcObject = stream
        await video.current.play()
        const ler = async () => {
          if (parar) return
          try {
            const achados = await detector.detect(video.current)
            if (achados[0]?.rawValue) { aoLerAtual.current(achados[0].rawValue); return }
          } catch { /* quadro ainda sem imagem: tenta de novo */ }
          timer = setTimeout(ler, 200)
        }
        ler()
      } catch (e) {
        setErro(e?.name === 'NotAllowedError'
          ? 'O celular não deixou usar a câmera. Permita a câmera para este site nas configurações do navegador.'
          : 'Não deu para abrir a câmera. Use o leitor de código ou digite o nome.')
      }
    })()
    return () => {
      parar = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <Modal titulo="Ler código de barras" aoFechar={aoFechar}>
      {erro ? <Aviso tom="vinho">{erro}</Aviso> : (
        <>
          <video ref={video} className="video-leitor" playsInline muted />
          <p className="texto-suave pequeno">Aponte para o código de barras da etiqueta. A leitura é automática.</p>
        </>
      )}
    </Modal>
  )
}
