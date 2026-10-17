// Contas de preço (Calculadora) e o percentual usado nos relatórios.
import { arred } from './moeda.js'

// parte ÷ todo em %, com 2 casas (0 quando o todo é zero)
export const percentual = (parte, todo) => (todo > 0 ? arred((parte / todo) * 100) : 0)

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
