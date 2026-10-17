// Regras da venda usadas pela tela. A conta que vale é a do banco
// (supabase/migrations/05_vendas.sql, concluir_venda); aqui é para mostrar antes.
import { arred, formatarMoeda } from './moeda.js'

export const FORMAS = { pix: 'Pix', cartao_debito: 'Débito', cartao_credito: 'Crédito', dinheiro: 'Dinheiro' }
export const COMO_DEVOLVEU = { pix: 'Pix', dinheiro: 'Dinheiro', estorno_cartao: 'Estorno no cartão', credito_loja: 'Crédito na loja', troca: 'Troca por outra peça' }
export const TIPOS_TAXA = { pix: 'Pix', debito: 'Débito', credito: 'Crédito à vista', credito_parcelado: 'Crédito parcelado' }
export const MAX_PARCELAS = 12

// Desconto dividido na proporção do valor de cada parte; a última fica com o resto
export function ratear(partes, desconto) {
  const total = partes.reduce((s, p) => s + p.subtotal, 0)
  let usado = 0
  return partes.map((p, i) => {
    const valor = i === partes.length - 1 ? arred(desconto - usado) : arred(total > 0 ? (desconto * p.subtotal) / total : 0)
    usado = arred(usado + valor)
    return valor
  })
}

// Carrinho → uma parte por CNPJ (cada CNPJ cobra na sua maquininha)
//   itens: [{ variacao_id, quantidade, preco, empresa_id }]
export function partesDaVenda(itens, desconto = 0) {
  const ordem = []
  const por = new Map()
  for (const i of itens) {
    if (!por.has(i.empresa_id)) { por.set(i.empresa_id, []); ordem.push(i.empresa_id) }
    por.get(i.empresa_id).push(i)
  }
  const lista = ordem.map((empresa_id) => {
    const doCNPJ = por.get(empresa_id)
    return { empresa_id, itens: doCNPJ, subtotal: arred(doCNPJ.reduce((s, i) => s + i.preco * i.quantidade, 0)) }
  })
  const descontos = ratear(lista, desconto)
  return lista.map((p, i) => ({ ...p, desconto: descontos[i], total: arred(p.subtotal - descontos[i]) }))
}

// Qual taxa da maquininha vale para um pagamento
export function tipoTaxa(forma, parcelas = 1) {
  if (forma === 'pix') return 'pix'
  if (forma === 'cartao_debito') return 'debito'
  if (forma === 'cartao_credito') return parcelas > 1 ? 'credito_parcelado' : 'credito'
  return null
}

// taxas: { pix: 0, debito: 1.99, ... } (percentuais)
export function taxaEstimada(pagamentos, taxas = {}) {
  return arred(pagamentos.reduce((s, p) => s + (p.valor * (taxas[tipoTaxa(p.forma, p.parcelas)] || 0)) / 100, 0))
}

// Desconto da vendedora acima do limite (em % do valor da compra)
export const passaDoLimite = (subtotal, desconto, limite) => subtotal > 0 && desconto > 0 && desconto * 100 > limite * subtotal

// Valor a devolver de parte de um item (o desconto do item entra na conta)
export function valorDevolucao(item, quantidade) {
  return arred(((item.preco_unitario * item.quantidade - item.desconto) * quantidade) / item.quantidade)
}

// Pagamentos fecham com o total? (diferença em centavos exatos)
export function falta(total, pagamentos) {
  return arred(total - pagamentos.reduce((s, p) => s + (p.valor || 0), 0))
}

// Texto do recibo para mandar por WhatsApp
export function textoRecibo({ vendas, itens }) {
  const total = arred(vendas.reduce((s, v) => s + Number(v.total), 0))
  const desconto = arred(vendas.reduce((s, v) => s + Number(v.desconto), 0))
  return [
    "deMana's · recibo da sua compra",
    ...itens.map((i) => `${i.quantidade}x ${i.descricao} ${formatarMoeda(arred(i.preco_unitario * i.quantidade))}`),
    desconto > 0 ? `Desconto: ${formatarMoeda(desconto)}` : null,
    `Total: ${formatarMoeda(total)}`,
    'Obrigada pela preferência! 🌹',
  ].filter(Boolean).join('\n')
}
