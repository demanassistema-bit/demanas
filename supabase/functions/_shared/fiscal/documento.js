// Conferência do documento montado pelo banco (instantâneo da venda) antes de enviar.
// O banco já aponta o que falta no cadastro; aqui conferimos também as contas.
import { CODIGO_UF } from './chave.js'

const centavos = (v) => Math.round(Number(v) * 100)

export function conferirDocumento(d) {
  const problemas = [...(d.faltas || [])]
  if (!d.emitente || !/^\d{14}$/.test(d.emitente.cnpj || '')) problemas.push('Falta o CNPJ do emitente em Dados fiscais.')
  if (d.emitente && !CODIGO_UF[d.emitente.uf]) problemas.push('Falta o estado (UF) do emitente em Dados fiscais.')
  if (!d.itens?.length) problemas.push('A nota está sem itens.')
  if (!d.pagamentos?.length) problemas.push('A nota está sem forma de pagamento.')
  if (d.consumidor?.cpf && !cpfValido(d.consumidor.cpf)) problemas.push('O CPF da consumidora está com número errado.')

  const itens = (d.itens || []).reduce((s, i) => s + centavos(i.valor_bruto) - centavos(i.desconto || 0), 0)
  const pagos = (d.pagamentos || []).reduce((s, p) => s + centavos(p.valor), 0)
  if (d.itens?.length && itens !== centavos(d.venda.total)) problemas.push('A soma dos itens não fecha com o total da venda.')
  if (d.pagamentos?.length && pagos !== centavos(d.venda.total)) problemas.push('A soma dos pagamentos não fecha com o total da venda.')
  return [...new Set(problemas)]
}

// CPF com os dois dígitos verificadores
export function cpfValido(texto) {
  const c = String(texto || '').replace(/\D/g, '')
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false
  const dv = (n) => {
    const soma = [...c.slice(0, n)].reduce((s, d, i) => s + Number(d) * (n + 1 - i), 0)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10])
}
