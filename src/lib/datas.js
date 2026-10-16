// Datas "puras" (validade, aniversário) circulam como texto AAAA-MM-DD, no horário local.
// Data e hora de registros (venda, movimentação) circulam como ISO completo.
export const FUSO = 'America/Sao_Paulo'

export function paraISO(data) {
  const a = data.getFullYear()
  const m = String(data.getMonth() + 1).padStart(2, '0')
  const d = String(data.getDate()).padStart(2, '0')
  return `${a}-${m}-${d}`
}

export function deISO(texto) {
  const [a, m, d] = texto.slice(0, 10).split('-').map(Number)
  return new Date(a, m - 1, d)
}

export const hojeISO = () => paraISO(new Date())

export function somarDias(data, dias) {
  const d = new Date(data)
  d.setDate(d.getDate() + dias)
  return d
}

// dd/mm/aaaa
export function formatarData(texto) {
  if (!texto) return ''
  return deISO(texto).toLocaleDateString('pt-BR')
}

export function formatarDataHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function formatarHora(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' })
}

// Dia (AAAA-MM-DD) de um registro com data e hora
export const diaDe = (iso) => paraISO(new Date(iso))

// Dias inteiros de hoje até a data (negativo = já passou)
export function diasAte(texto) {
  const hoje = deISO(hojeISO())
  return Math.round((deISO(texto) - hoje) / 86400000)
}

export function diasDesde(iso) {
  return -diasAte(diaDe(iso))
}

export const NOMES_MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]
