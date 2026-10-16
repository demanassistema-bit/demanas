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

// ---------------- Calculadora de preço ----------------
// custo  = o que se paga por peça vendida (peça, embalagem, entrega paga pela loja)
// fixo   = custos fixos do mês como % do faturamento (aluguel, luz, contadora…)
// margem = quanto do preço de venda sobra como lucro, depois de tudo
// preço  = custo ÷ (1 − margem − taxa − imposto − fixo). Devolve null se a soma passar de 100%.
export function precoPelaMargem({ custo, margem, taxa = 0, imposto = 0, fixo = 0 }) {
  const resto = 1 - (margem + taxa + imposto + fixo) / 100
  if (custo <= 0 || resto <= 0) return null
  return arred(custo / resto)
}

// Custos fixos do mês viram um percentual de cada venda
export function percentualFixo(custosFixos, faturamentoMensal) {
  const total = arred(custosFixos.reduce((s, c) => s + (Number(c.valor) || 0), 0))
  return { total, percentual: faturamentoMensal > 0 ? percentual(total, faturamentoMensal) : 0 }
}

// Final ,90 sempre para cima: 87,30 → 87,90 · 87,95 → 88,90
export function arredondarPara90(valor) {
  if (valor == null) return null
  return arred(Math.ceil(arred(valor - 0.9)) + 0.9)
}

// O que sobra de verdade numa venda, para uma taxa de pagamento
export function lucroDaVenda({ preco, custo, taxa = 0, imposto = 0, fixo = 0 }) {
  const valorTaxa = arred((preco * taxa) / 100)
  const valorImposto = arred((preco * imposto) / 100)
  const valorFixo = arred((preco * fixo) / 100)
  const lucro = arred(preco - valorTaxa - valorImposto - valorFixo - custo)
  return { valorTaxa, valorImposto, valorFixo, recebe: arred(preco - valorTaxa), lucro, margem: percentual(lucro, preco) }
}

// Menor preço sem prejuízo (lucro zero)
export const precoMinimo = ({ custo, taxa = 0, imposto = 0, fixo = 0 }) => precoPelaMargem({ custo, margem: 0, taxa, imposto, fixo })

export const nomeVariacao = (v) =>
  [v.cor, v.tamanho, v.tonalidade, v.volume].filter(Boolean).join(' · ') || 'Única'

// Busca sem diferenciar acento e maiúscula
export const normalizar = (t) =>
  String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
