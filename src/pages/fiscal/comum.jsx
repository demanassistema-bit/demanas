import { useMemo } from 'react'
import { useDemo } from '../../demo/DemoContext'
import { diasDesde, hojeISO } from '../../lib/datas'
import { emiteNota, faltasPerfilFiscal, situacaoCertificado } from '../../demo/regras'
import { Aviso, Selo } from '../../components/ui'

// Notas a partir das vendas, numeradas em ordem (série 1). Na versão real, o número vem do provedor.
export function useNotas() {
  const { dados } = useDemo()
  return useMemo(() => dados.vendas
    .filter((v) => v.nota)
    .map((v, i) => ({ numero: i + 1, serie: 1, venda: v, status: v.nota.status, motivo: v.nota.motivo }))
    .reverse(), [dados.vendas])
}

export const NOMES_STATUS = { autorizada: 'Autorizada', pendente: 'Pendente', enviando: 'Emitindo…', cancelada: 'Cancelada' }

export function SeloNota({ status }) {
  const tom = { autorizada: 'oliva', pendente: 'vinho', enviando: 'ambar', cancelada: 'neutro' }[status]
  return <Selo tom={tom}>{NOMES_STATUS[status]}</Selo>
}

export const numeroNota = (n) => String(n).padStart(6, '0')

// Faixa de ambiente (regra 16) e alertas do painel fiscal
export function AlertasFiscais() {
  const { dados } = useDemo()
  const notas = useNotas()
  const fiscal = dados.config.fiscal
  const certificado = situacaoCertificado(fiscal.certificadoValidade, hojeISO())
  const pendentesAntigas = notas.filter((n) => n.status === 'pendente' && diasDesde(n.venda.data) >= 1)
  const categorias = [...new Set(dados.produtos.filter((p) => p.ativo && emiteNota(dados.config, p.empresa_id)).map((p) => p.categoria))]
  const semPerfil = categorias.filter((c) => faltasPerfilFiscal(fiscal.perfis[c]).length > 0)

  return (
    <>
      <div className="faixa-ambiente" role="note">AMBIENTE DE TESTE (homologação) · notas sem valor fiscal</div>
      {certificado.tom && <Aviso tom={certificado.tom}>{certificado.texto}. Informe ou renove em "Dados fiscais".</Aviso>}
      {pendentesAntigas.length > 0 && (
        <Aviso tom="vinho">{pendentesAntigas.length} {pendentesAntigas.length === 1 ? 'nota pendente' : 'notas pendentes'} há mais de um dia. A venda está feita: corrija e reenvie.</Aviso>
      )}
      {semPerfil.length > 0 && (
        <Aviso tom="ambar">
          {semPerfil.length} de {categorias.length} categorias ainda sem dados fiscais validados pela contadora. Na versão real, produtos dessas categorias não saem com nota até isso ser preenchido.
        </Aviso>
      )}
    </>
  )
}
