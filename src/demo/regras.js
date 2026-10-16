// Regras de estoque e venda, sem tela e sem banco, para poderem ser testadas.
// Na versão real, as mesmas regras vivem também no banco (funções SQL).
import { arred } from '../lib/moeda.js'

export const TIPOS_MOVIMENTO = {
  entrada_compra: 'Entrada de compra',
  saida_venda: 'Venda',
  cancelamento_venda: 'Estorno de venda cancelada',
  devolucao_cliente: 'Devolução de cliente',
  devolucao_fornecedor: 'Devolução ao fornecedor',
  ajuste_inventario: 'Ajuste de inventário',
  perda: 'Perda ou avaria',
  brinde: 'Brinde',
  uso_interno: 'Uso interno',
}

// Regra de ouro: o saldo nunca é guardado, é a soma das movimentações.
export function calcularSaldos(movimentacoes) {
  const porVariacao = new Map()
  const porLote = new Map()
  for (const m of movimentacoes) {
    porVariacao.set(m.variacao_id, (porVariacao.get(m.variacao_id) || 0) + m.quantidade)
    if (m.lote_id) porLote.set(m.lote_id, (porLote.get(m.lote_id) || 0) + m.quantidade)
  }
  return { porVariacao, porLote }
}

// Saída pela validade mais próxima. Devolve as partes por lote e o que faltou.
export function alocarPorValidade(lotes, porLote, quantidade) {
  const comSaldo = lotes
    .filter((l) => (porLote.get(l.id) || 0) > 0)
    .sort((a, b) => a.validade.localeCompare(b.validade))
  const partes = []
  let falta = quantidade
  for (const lote of comSaldo) {
    if (falta <= 0) break
    const usa = Math.min(falta, porLote.get(lote.id))
    partes.push({ lote_id: lote.id, quantidade: usa })
    falta -= usa
  }
  return { partes, falta }
}

export function totaisVenda(itens, desconto = 0) {
  const subtotal = arred(itens.reduce((s, i) => s + i.preco * i.quantidade, 0))
  const descontoAplicado = Math.min(Math.max(arred(desconto || 0), 0), subtotal)
  return { subtotal, desconto: descontoAplicado, total: arred(subtotal - descontoAplicado) }
}

export const percentual = (parte, todo) => (todo > 0 ? arred((parte / todo) * 100) : 0)

// Custo médio ponderado depois de uma entrada
export function novoCustoMedio(saldoAtual, custoAtual, quantidadeEntrada, custoEntrada) {
  const saldo = Math.max(saldoAtual, 0)
  if (saldo + quantidadeEntrada <= 0) return custoAtual
  return arred((saldo * custoAtual + quantidadeEntrada * custoEntrada) / (saldo + quantidadeEntrada))
}

// Desconto acima do limite do perfil precisa da proprietária
export function descontoPrecisaAprovacao(subtotal, desconto, limitePercentual, ehProprietaria) {
  if (ehProprietaria) return false
  return percentual(desconto, subtotal) > limitePercentual
}

// Taxa estimada da maquininha para um pagamento
export function taxaPagamento(pagamento, taxas) {
  let perc = 0
  if (pagamento.forma === 'cartao_debito') perc = taxas.debito
  if (pagamento.forma === 'cartao_credito') perc = pagamento.parcelas > 1 ? taxas.credito_parcelado : taxas.credito
  if (pagamento.forma === 'pix') perc = taxas.pix
  return arred((pagamento.valor * (perc || 0)) / 100)
}

export const nomeVariacao = (v) =>
  [v.cor, v.tamanho, v.tonalidade, v.volume].filter(Boolean).join(' · ') || 'Única'

// Busca sem diferenciar acento e maiúscula
export const normalizar = (t) =>
  String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
