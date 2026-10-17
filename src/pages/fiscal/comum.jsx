import { useCallback, useEffect, useState } from 'react'
import { useCatalogo } from '../../contexts/CatalogoContext'
import { supabase, traduzirErro } from '../../lib/supabase'
import { hojeISO } from '../../lib/datas'
import { faltasPerfilFiscal, situacaoCertificado } from '../../lib/fiscal'
import { processarFila } from '../../../supabase/functions/_shared/fiscal/processar.js'
import { criarSimulado } from '../../../supabase/functions/_shared/fiscal/simulado.js'
import { Aviso, Selo } from '../../components/ui'

export const NOMES_STATUS = {
  na_fila: 'Na fila', enviando: 'Emitindo…', autorizada: 'Autorizada', pendente: 'Pendente',
  a_cancelar: 'Cancelando…', cancelando: 'Cancelando…', cancelada: 'Cancelada', descartada: 'Não emitida',
}
const TOM_STATUS = { autorizada: 'oliva', pendente: 'vinho', na_fila: 'ambar', enviando: 'ambar', a_cancelar: 'ambar', cancelando: 'ambar', cancelada: 'neutro', descartada: 'neutro' }

export function SeloNota({ status }) {
  return <Selo tom={TOM_STATUS[status]}>{NOMES_STATUS[status] || status}</Selo>
}

export const numeroNota = (n) => (n ? String(n).padStart(6, '0') : '—')

// No modo SIMULADO quem processa a fila é esta tela (o serviço simulado não tem segredo).
// Com o serviço de verdade, quem processa é a Edge Function no servidor.
const simulado = criarSimulado()
export function processarSimulado() {
  return processarFila({
    pegar: async (limite) => {
      const { data, error } = await supabase.rpc('pegar_fila_fiscal', { p_limite: limite })
      if (error) throw error
      return data
    },
    registrar: async (id, retorno) => {
      const { error } = await supabase.rpc('registrar_retorno_fiscal', { p_doc: id, p: retorno })
      if (error) throw error
    },
    provedorPara: (nome) => {
      if (nome !== 'simulado') throw new Error('Esta nota é do serviço de verdade: quem envia é o servidor.')
      return simulado
    },
    limite: 20,
  })
}

// Notas (as mais recentes primeiro). Ao abrir, processa a fila do simulado.
export function useNotas() {
  const [notas, setNotas] = useState(null)
  const [erro, setErro] = useState('')
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('documentos_fiscais')
      .select('*, vendas(numero, status, criado_em, clientes(nome))')
      .order('criado_em', { ascending: false }).limit(1000)
    if (error) return setErro(traduzirErro(error))
    setNotas(data.map((n) => ({ ...n, valor_total: Number(n.valor_total) })))
  }, [])
  const processar = useCallback(async () => {
    try { await processarSimulado() } catch (e) { setErro(traduzirErro(e)) }
    await carregar()
  }, [carregar])
  useEffect(() => { processar() }, [processar])
  return { notas, erro, carregar, processar }
}

// Faixa de ambiente (regra 16) e alertas do painel fiscal
export function AlertasFiscais() {
  const { empresas, produtos, perfisFiscais } = useCatalogo()
  const [pendentesAntigas, setPendentesAntigas] = useState(0)
  const emissora = Object.values(empresas).find((e) => e.tipo === 'me')
  useEffect(() => {
    const ontem = new Date(Date.now() - 86400000).toISOString()
    supabase.from('documentos_fiscais').select('id', { count: 'exact', head: true }).eq('status', 'pendente').lt('criado_em', ontem)
      .then(({ count }) => setPendentesAntigas(count || 0))
  }, [])
  if (!emissora) return null
  const certificado = situacaoCertificado(emissora.certificado_validade, hojeISO())
  const categorias = new Set(produtos.filter((p) => p.ativo && p.empresa_id === emissora.id && p.categoria_id).map((p) => p.categoria_id))
  const semPerfil = [...categorias].filter((id) => faltasPerfilFiscal(perfisFiscais[id]).length > 0)
  const simuladoLigado = emissora.fiscal_provedor === 'simulado'

  return (
    <>
      <div className="faixa-ambiente" role="note">
        AMBIENTE DE TESTE (homologação) · notas sem valor fiscal{simuladoLigado && ' · serviço SIMULADO'}
      </div>
      {simuladoLigado && <Aviso tom="ambar">Nenhum serviço de emissão contratado: as notas são simuladas aqui mesmo, para testar o caminho todo. Quando as irmãs aprovarem o serviço, é só trocar em "Dados fiscais".</Aviso>}
      {certificado.tom && !simuladoLigado && <Aviso tom={certificado.tom}>{certificado.texto}. Informe ou renove em "Dados fiscais".</Aviso>}
      {pendentesAntigas > 0 && (
        <Aviso tom="vinho">{pendentesAntigas} {pendentesAntigas === 1 ? 'nota pendente' : 'notas pendentes'} há mais de um dia. A venda está feita: corrija e reenvie.</Aviso>
      )}
      {semPerfil.length > 0 && (
        <Aviso tom="ambar">{semPerfil.length} de {categorias.size} categorias do {emissora.apelido} ainda sem dados fiscais completos e validados pela contadora. As vendas dessas peças ficam com a nota pendente até isso ser preenchido.</Aviso>
      )}
    </>
  )
}
