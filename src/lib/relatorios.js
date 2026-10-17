// Regras dos relatórios: curva ABC, cobertura do estoque, o que recomprar e peças paradas.
// O banco entrega as somas (supabase/migrations/08_relatorios.sql); aqui elas viram decisão.
import { arred } from './moeda.js'

const DIA = 86400000

// Curva ABC pelo faturamento: A = as peças que somam os primeiros 80%, B até 95%, C o resto.
// pecas: [{ variacao_id, valor }] → Map(variacao_id → 'A' | 'B' | 'C')
export function curvaABC(pecas) {
  const total = pecas.reduce((s, p) => s + Number(p.valor), 0)
  const classe = new Map()
  let antes = 0
  for (const p of [...pecas].sort((a, b) => b.valor - a.valor)) {
    const fatia = total > 0 ? antes / total : 1
    classe.set(p.variacao_id, fatia < 0.8 ? 'A' : fatia < 0.95 ? 'B' : 'C')
    antes += Number(p.valor)
  }
  return classe
}

// Cada peça com o ritmo de venda, quantos dias o estoque dura, se é para recomprar e se está parada.
//   linhas: peças do catálogo ({ id, saldo, ativo, criado_em, produto: { tipo } })
//   giro: [{ variacao_id, saiu, ultima_venda }] dos últimos `dias`
export function analisarEstoque({ linhas, giro, dias = 30, diasAlerta = 15, diasCobertura = 30, diasParada = 45, agora = Date.now() }) {
  const porPeca = new Map(giro.map((g) => [g.variacao_id, g]))
  return linhas
    .filter((l) => l.produto.tipo !== 'kit') // kit não tem estoque próprio: conta nas peças que o formam
    .map((l) => {
      const g = porPeca.get(l.id)
      const saiu = g?.saiu || 0
      const porDia = saiu / dias
      const cobertura = porDia > 0 ? Math.max(0, Math.floor(l.saldo / porDia)) : null // null = não vendeu no período
      const recomprar = Boolean(l.ativo) && porDia > 0 && cobertura < diasAlerta
      const pedir = recomprar ? Math.max(1, Math.ceil(porDia * diasCobertura - Math.max(l.saldo, 0))) : 0
      // parada: tem estoque e não vende há X dias (peça nova conta a partir do cadastro)
      const desde = g?.ultima_venda || l.criado_em
      const diasSemVender = desde ? Math.floor((agora - new Date(desde).getTime()) / DIA) : null
      const parada = l.saldo > 0 && diasSemVender != null && diasSemVender >= diasParada
      return { ...l, saiu, porDia: arred(porDia), cobertura, recomprar, pedir, parada, diasSemVender, nuncaVendeu: !g?.ultima_venda }
    })
}

// Valor do estoque pelo custo (só peças com custo conhecido e saldo positivo).
// Kit fica de fora: o estoque dele são as peças que o formam, que já entram na conta.
export const valorEstoque = (linhas) => arred(linhas.reduce((s, l) => s + (l.produto?.tipo !== 'kit' && l.saldo > 0 && l.custo != null ? l.custo * l.saldo : 0), 0))

// Margem de cada peça vendida no período: (valor − custo) ÷ valor
export const margem = (peca) => (peca.custo == null || !Number(peca.valor) ? null : arred(((peca.valor - peca.custo) / peca.valor) * 100))

// Planilha (CSV com ; e vírgula decimal, abre certo no Excel)
export function textoCSV(linhas) {
  const celula = (c) => `"${String(typeof c === 'number' ? String(c).replace('.', ',') : c ?? '').replace(/"/g, '""')}"`
  return linhas.map((l) => l.map(celula).join(';')).join('\n')
}
