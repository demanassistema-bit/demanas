// Limites dos campos: quantos caracteres cabem em cada texto e a faixa de cada número.
// Ficam num lugar só para valerem igual em todas as telas e, na Etapa 1, nas colunas do banco.
import { formatarMoeda, lerMoeda } from './moeda.js'

export const TAMANHO = {
  nome: 80,          // produto e cliente
  categoria: 40,
  marca: 40,
  variacoes: 200,    // lista de cores, tamanhos ou tonalidades, separadas por vírgula
  variacao: 20,      // cada cor, tamanho ou tonalidade
  volume: 20,
  whatsapp: 20,
  preferencia: 20,   // tamanho de sutiã, calcinha, tom de pele
  descricao: 100,    // conta a pagar, peça encomendada à mão
  fornecedor: 60,
  motivo: 120,       // ajuste, sangria, cancelamento
  observacao: 200,
  lote: 30,
  custoFixo: 40,     // nome de um custo fixo
  apelido: 20,       // "CNPJ Day"
  razaoSocial: 120,
  endereco: 150,
  municipio: 60,
  busca: 60,
  email: 120,
  senha: 72,
  codigo: 20,
}

export const LIMITE = {
  preco: 99999.99,      // preço ou custo de uma peça
  valor: 999999.99,     // conta, caixa, sinal, faturamento, custo fixo
  quantidade: 9999,     // peças numa entrada, perda ou contagem
  quantidadeItem: 999,  // da mesma peça numa venda ou encomenda
  estoqueMinimo: 999,
  variacoes: 100,       // por produto (cores × tamanhos)
  parcelasConta: 24,
  itensEncomenda: 20,
  custosFixos: 30,
  percentual: 100,
}

// Datas aceitas: nada antes de 1900 nem depois de 2100 (evita o ano 20266 digitado por engano)
export const DATA_MIN = '1900-01-01'
export const DATA_MAX = '2100-12-31'

const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1)

// ---------------- O que pode ser digitado ----------------
// Dinheiro e percentual: só números, vírgula e ponto (sem sinal de menos)
export const filtroDinheiro = (t) => String(t ?? '').replace(/[^\d.,]/g, '').slice(0, 13)
// Quantidade: só números
export const filtroInteiro = (t, digitos = 4) => String(t ?? '').replace(/\D/g, '').slice(0, digitos)
// Telefone: números e ( ) + - espaço
export const filtroTelefone = (t) => String(t ?? '').replace(/[^\d()+\-\s]/g, '').slice(0, TAMANHO.whatsapp)
// Percentual: como dinheiro, mas nunca passa de 100
export function filtroPercentual(t, max = LIMITE.percentual) {
  const limpo = filtroDinheiro(t).slice(0, 6)
  const n = lerMoeda(limpo)
  return n != null && !Number.isNaN(n) && n > max ? String(max) : limpo
}

// Tira espaços das pontas e espaços repetidos no meio
export const limparTexto = (t) => String(t ?? '').replace(/\s+/g, ' ').trim()

// ---------------- Leitura com mensagem de erro ----------------
// Valor em reais → { valor } ou { erro }
export function lerValor(texto, { rotulo = 'o valor', min = 0.01, max = LIMITE.valor, obrigatorio = true } = {}) {
  const n = lerMoeda(texto)
  if (n == null) return obrigatorio ? { erro: `Informe ${rotulo}.` } : { valor: 0 }
  if (Number.isNaN(n)) return { erro: `${maiuscula(rotulo)} não é um número válido. Use só números e vírgula, como 49,90.` }
  if (n < min) return { erro: min > 0 ? `${maiuscula(rotulo)} precisa ser maior que zero.` : `${maiuscula(rotulo)} não pode ser negativo.` }
  if (n > max) return { erro: `${maiuscula(rotulo)} passa do limite de ${formatarMoeda(max)}. Confira se não sobrou um número.` }
  return { valor: n }
}

// Número inteiro (peças, parcelas) → { valor } ou { erro }
export function lerInteiro(texto, { rotulo = 'a quantidade', min = 1, max = LIMITE.quantidade, obrigatorio = true } = {}) {
  const t = String(texto ?? '').trim()
  if (!t) return obrigatorio ? { erro: `Informe ${rotulo}.` } : { valor: min }
  if (!/^\d+$/.test(t)) return { erro: `${maiuscula(rotulo)} precisa ser um número inteiro.` }
  const n = Number(t)
  if (n < min) return { erro: min === 1 ? `${maiuscula(rotulo)} precisa ser pelo menos 1.` : `${maiuscula(rotulo)} precisa ser pelo menos ${min}.` }
  if (n > max) return { erro: `${maiuscula(rotulo)} passa do limite de ${max.toLocaleString('pt-BR')}.` }
  return { valor: n }
}

// Data AAAA-MM-DD dentro de uma faixa → mensagem de erro ou null
export function erroData(iso, { rotulo = 'a data', min = DATA_MIN, max = DATA_MAX, obrigatoria = true } = {}) {
  if (!iso) return obrigatoria ? `Informe ${rotulo}.` : null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${maiuscula(rotulo)} está incompleta.`
  const [a, m, d] = iso.split('-').map(Number)
  const data = new Date(a, m - 1, d)
  if (data.getFullYear() !== a || data.getMonth() !== m - 1 || data.getDate() !== d) return `${maiuscula(rotulo)} não existe no calendário.`
  if (iso < min || iso > max) return `${maiuscula(rotulo)} está fora do esperado. Confira o ano.`
  return null
}

// Soma meses mantendo o dia; se o mês não tem esse dia (31 em fevereiro), usa o último dia do mês
export function somarMeses(iso, meses) {
  const [a, m, d] = iso.split('-').map(Number)
  const ultimo = new Date(a, m - 1 + meses + 1, 0).getDate()
  const data = new Date(a, m - 1 + meses, Math.min(d, ultimo))
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}

// ---------------- Listas (cores, tamanhos) ----------------
// "Preto, preto , Nude,," → ['Preto', 'Nude'] (sem repetidas, sem vazias)
export function separarLista(texto) {
  const vistos = new Set()
  const lista = []
  for (const parte of String(texto ?? '').split(',')) {
    const item = limparTexto(parte)
    const chave = item.toLocaleLowerCase('pt-BR')
    if (!item || vistos.has(chave)) continue
    vistos.add(chave)
    lista.push(item)
  }
  return lista
}

// ---------------- WhatsApp ----------------
// Só os números, sem o 55 do Brasil: "+55 (11) 98888-7777" → "11988887777"
export function numeroWhatsApp(texto) {
  let n = String(texto ?? '').replace(/\D/g, '')
  if ((n.length === 12 || n.length === 13) && n.startsWith('55')) n = n.slice(2)
  if (n.length === 11 && n.startsWith('0')) n = n.slice(1) // 0 da operadora/DDD antigo
  return n
}

// DDD + número: 10 dígitos (fixo) ou 11 (celular, começa com 9). Vazio vale (é opcional).
export function whatsappValido(texto) {
  const n = numeroWhatsApp(texto)
  if (!n) return true
  if (!/^[1-9][1-9]/.test(n)) return false
  return n.length === 10 || (n.length === 11 && n[2] === '9')
}

// "11988887777" → "(11) 98888-7777"
export function formatarWhatsApp(texto) {
  const n = numeroWhatsApp(texto)
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`
  return limparTexto(texto)
}

// Link do WhatsApp: só põe o número se ele for válido; senão abre para escolher o contato
export function linkWhatsApp(telefone, texto) {
  const n = numeroWhatsApp(telefone)
  const numero = n && whatsappValido(n) ? `55${n}` : ''
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
}

// WhatsApp é opcional, mas se vier precisa ter DDD e não pode ser de outra cliente
export function erroWhatsApp(clientes, whatsapp) {
  if (!whatsappValido(whatsapp)) return 'WhatsApp incompleto: coloque o DDD e o número, como (11) 98888-7777.'
  const numero = numeroWhatsApp(whatsapp)
  const outra = numero && clientes.find((c) => !c.removida && numeroWhatsApp(c.whatsapp) === numero)
  if (outra) return `Esse WhatsApp já é da cliente ${outra.nome}. Busque por ela em vez de cadastrar de novo.`
  return null
}

// ---------------- CNPJ ----------------
// Aceita o CNPJ de números e o novo alfanumérico (Receita, a partir de julho de 2026):
// 12 letras ou números + 2 dígitos verificadores.
export const limparCNPJ = (t) => String(t ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14)

export function cnpjValido(texto) {
  const c = limparCNPJ(texto)
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c)) return false
  if (/^(\d)\1{13}$/.test(c)) return false // 00000000000000, 11111111111111...
  const valores = [...c].map((ch) => ch.charCodeAt(0) - 48)
  const digito = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = pesos.reduce((s, p, i) => s + p * valores[i], 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  return digito(12) === valores[12] && digito(13) === valores[13]
}

// "12345678000195" → "12.345.678/0001-95"
export function formatarCNPJ(texto) {
  const c = limparCNPJ(texto)
  if (c.length !== 14) return c
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
}

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB',
  'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
