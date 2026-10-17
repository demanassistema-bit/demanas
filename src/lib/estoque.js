// Regras do estoque usadas pelas telas. As mesmas regras valem no banco
// (supabase/migrations/04_estoque.sql); aqui é só para mostrar antes de lançar.
import { erroData } from './limites.js'
import { formatarData, hojeISO, paraISO, somarDias } from './datas.js'

export const TIPOS_MOVIMENTO = {
  estoque_inicial: 'Estoque inicial',
  entrada_compra: 'Entrada de mercadoria',
  saida_venda: 'Venda',
  cancelamento_venda: 'Estorno de venda cancelada',
  devolucao_cliente: 'Devolução de cliente',
  devolucao_fornecedor: 'Devolução ao fornecedor',
  ajuste_inventario: 'Acerto de contagem',
  perda: 'Perda ou avaria',
  brinde: 'Brinde',
  uso_interno: 'Uso interno',
}

export const TIPOS_SAIDA = ['perda', 'brinde', 'uso_interno', 'devolucao_fornecedor']

// Chave de um "balde" do estoque: a peça e o lote (ou a parte sem lote)
export const chaveBalde = (variacaoId, loteId) => `${variacaoId}|${loteId || ''}`

// Kit não tem estoque próprio: dá para montar quantos as peças permitirem
export function saldoDoKit(itens, saldoPorVariacao) {
  if (!itens.length) return 0
  return Math.min(...itens.map((i) => Math.floor(Math.max(saldoPorVariacao.get(i.componente_variacao_id) || 0, 0) / i.quantidade)))
}

// Lotes na ordem em que saem: validade mais próxima primeiro, sem validade e sem lote no fim
export function ordenarPorValidade(baldes) {
  return [...baldes].sort((a, b) => {
    if (a.validade && b.validade) return a.validade.localeCompare(b.validade)
    if (a.validade || b.validade) return a.validade ? -1 : 1
    return (a.lote_id ? 0 : 1) - (b.lote_id ? 0 : 1)
  })
}

// O que a conclusão do inventário vai lançar (espelha concluir_inventario)
//   itens: [{ variacao_id, lote_id, contado, saldo_sistema }]
//   baldes: saldos atuais [{ variacao_id, lote_id, saldo }]
//   escopo: variações que fazem parte da contagem [{ id, criado_em }]
export function planoInventario({ itens, baldes, escopo, abertoEm, zerar = false }) {
  const contadas = new Set(itens.map((i) => i.variacao_id))
  const contados = new Set(itens.map((i) => chaveBalde(i.variacao_id, i.lote_id)))
  const acertos = []

  for (const i of itens) {
    const diferenca = i.contado - i.saldo_sistema
    if (diferenca) acertos.push({ variacao_id: i.variacao_id, lote_id: i.lote_id, diferenca })
  }
  // lote com saldo que ninguém contou, numa peça que foi contada → vai a zero
  for (const b of baldes) {
    if (b.saldo && contadas.has(b.variacao_id) && !contados.has(chaveBalde(b.variacao_id, b.lote_id))) {
      acertos.push({ variacao_id: b.variacao_id, lote_id: b.lote_id, diferenca: -b.saldo })
    }
  }

  const saldoPorVariacao = new Map()
  for (const b of baldes) saldoPorVariacao.set(b.variacao_id, (saldoPorVariacao.get(b.variacao_id) || 0) + b.saldo)
  const naoContadas = escopo
    .filter((v) => !contadas.has(v.id) && (saldoPorVariacao.get(v.id) || 0) !== 0)
    .map((v) => ({ variacao_id: v.id, saldo: saldoPorVariacao.get(v.id), novaNaContagem: Boolean(abertoEm && v.criado_em >= abertoEm) }))
  if (zerar) {
    for (const n of naoContadas) {
      if (n.novaNaContagem) continue
      for (const b of baldes) {
        if (b.variacao_id === n.variacao_id && b.saldo) acertos.push({ variacao_id: b.variacao_id, lote_id: b.lote_id, diferenca: -b.saldo })
      }
    }
  }

  return {
    acertos,
    naoContadas,
    sobras: acertos.reduce((s, a) => s + Math.max(a.diferenca, 0), 0),
    faltas: acertos.reduce((s, a) => s + Math.max(-a.diferenca, 0), 0),
    pecasContadas: itens.reduce((s, i) => s + i.contado, 0),
  }
}

// Variações que entram numa contagem
export function noEscopo(linha, inventario) {
  if (linha.produto.tipo === 'kit') return false
  if (inventario.escopo === 'categoria') return linha.produto.categoria_id === inventario.categoria_id
  if (inventario.escopo === 'cnpj') return linha.produto.empresa_id === inventario.empresa_id
  return true
}

// Validade é opcional. Na entrada de compra precisa ser de hoje em diante;
// na contagem e no cadastro, aceita vencida (a peça vencida está na prateleira
// e precisa ser contada antes de virar perda).
export function erroValidade(iso, { aceitarVencida = false } = {}) {
  const max = paraISO(somarDias(new Date(), 3650))
  const erro = erroData(iso, { rotulo: 'a validade', min: aceitarVencida ? '2000-01-01' : hojeISO(), max, obrigatoria: false })
  if (!erro) return null
  return aceitarVencida ? `${erro} Ela vai até daqui a 10 anos.` : `${erro} Ela precisa ser de hoje em diante, em até 10 anos.`
}

// "lote 123 · validade 01/12/2027", ou "sem lote"
export const textoLote = (b) => (b.lote_id
  ? [b.numero_lote && `lote ${b.numero_lote}`, b.validade && `validade ${formatarData(b.validade)}`].filter(Boolean).join(' · ')
  : 'sem lote')
