// Regras do Financeiro usadas pelas telas.
// As contas que valem são as do banco (supabase/migrations/07_financeiro.sql); aqui é para mostrar.
import { arred } from './moeda.js'
import { paraISO, somarDias } from './datas.js'

export const CATEGORIAS_DESPESA = {
  aluguel: 'Aluguel',
  contas_loja: 'Contas da loja',
  fornecedores: 'Fornecedores (mercadoria)',
  contadora: 'Contadora',
  marketing: 'Marketing',
  taxas_tarifas: 'Taxas e tarifas',
  impostos: 'Impostos (DAS)',
  pro_labore: 'Pró-labore',
  outros: 'Outros',
}

export const FILTROS_CONTAS = { abertas: 'Em aberto', vencidas: 'Vencidas', pagas: 'Pagas', todas: 'Todas' }

export const somar = (lista, campo = 'valor') => arred(lista.reduce((s, x) => s + Number(x[campo] || 0), 0))

const diasEntre = (de, ate) => Math.round((new Date(`${ate}T00:00:00`) - new Date(`${de}T00:00:00`)) / 86400000)

// Selo da conta: paga, vencida, vence hoje, vence em X dias
export function situacaoConta(conta, hoje) {
  if (conta.pago_em) return { tom: 'oliva', texto: `Paga em ${conta.pago_em.slice(8, 10)}/${conta.pago_em.slice(5, 7)}` }
  const dias = diasEntre(hoje, conta.vencimento)
  if (dias < 0) return { tom: 'vinho', texto: `Vencida há ${-dias} d` }
  if (dias === 0) return { tom: 'vinho', texto: 'Vence hoje' }
  if (dias <= 7) return { tom: 'ambar', texto: `Vence em ${dias} d` }
  return { tom: 'neutro', texto: `${conta.vencimento.slice(8, 10)}/${conta.vencimento.slice(5, 7)}` }
}

// "Em aberto" mostra o que vence em até 45 dias (e as vencidas); o resto aparece em "Todas"
export function filtrarContas(contas, filtro, hoje) {
  if (filtro === 'abertas') return contas.filter((c) => !c.pago_em && diasEntre(hoje, c.vencimento) <= 45)
  if (filtro === 'vencidas') return contas.filter((c) => !c.pago_em && c.vencimento < hoje)
  if (filtro === 'pagas') return contas.filter((c) => c.pago_em).sort((a, b) => b.pago_em.localeCompare(a.pago_em))
  return contas
}

// A receber agrupado por dia (e CNPJ): o que a maquininha deposita junto
export function agruparPorDia(recebiveis) {
  const mapa = new Map()
  for (const r of recebiveis) {
    const chave = `${r.data_prevista}|${r.empresa_id}`
    if (!mapa.has(chave)) mapa.set(chave, { data: r.data_prevista, empresa_id: r.empresa_id, itens: [] })
    mapa.get(chave).itens.push(r)
  }
  return [...mapa.values()]
    .map((g) => ({ ...g, bruto: somar(g.itens, 'bruto'), taxa: somar(g.itens, 'taxa'), liquido: somar(g.itens, 'liquido') }))
    .sort((a, b) => a.data.localeCompare(b.data) || a.empresa_id.localeCompare(b.empresa_id))
}

// Fluxo das próximas 4 semanas: o que cai do cartão × contas em aberto.
// A primeira semana leva também o que está atrasado (a receber e a pagar).
export function fluxoSemanas({ recebiveis, contas, hoje }) {
  const base = new Date(`${hoje}T00:00:00`)
  return [0, 1, 2, 3].map((s) => {
    const inicio = s === 0 ? '0000-01-01' : paraISO(somarDias(base, s * 7))
    const fim = paraISO(somarDias(base, s * 7 + 6))
    const dentro = (data) => data >= inicio && data <= fim
    const entradas = somar(recebiveis.filter((r) => r.status === 'a_receber' && dentro(r.data_prevista)), 'liquido')
    const saidas = somar(contas.filter((c) => !c.pago_em && dentro(c.vencimento)))
    return { s, fim, entradas, saidas, saldo: arred(entradas - saidas) }
  })
}
