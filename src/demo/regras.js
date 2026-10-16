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

// ---------------- Financeiro ----------------
export const CATEGORIAS_DESPESA = {
  aluguel: 'Aluguel',
  contas_loja: 'Contas da loja',
  fornecedores: 'Fornecedores (mercadoria)',
  contadora: 'Contadora',
  marketing: 'Marketing',
  taxas_tarifas: 'Taxas e tarifas',
  pro_labore: 'Pró-labore',
  outros: 'Outros',
}

const somarDiasISO = (iso, dias) => {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number)
  const data = new Date(a, m - 1, d + dias)
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}

// Quando e quanto cai na conta de cada pagamento com cartão.
// Débito: no dia seguinte. Crédito: 30 dias por parcela. Pix e dinheiro entram na hora (não viram recebível).
// A taxa sai de cada parcela; a última parcela absorve a sobra dos centavos.
export function recebiveisDaVenda(venda, taxas, dia) {
  const lista = []
  venda.pagamentos.forEach((p, indice) => {
    if (p.forma !== 'cartao_debito' && p.forma !== 'cartao_credito') return
    const parcelas = p.forma === 'cartao_credito' ? Math.max(p.parcelas || 1, 1) : 1
    const perc = p.forma === 'cartao_debito' ? taxas.debito : parcelas > 1 ? taxas.credito_parcelado : taxas.credito
    const brutoParcela = arred(p.valor / parcelas)
    for (let n = 1; n <= parcelas; n++) {
      const bruto = n === parcelas ? arred(p.valor - brutoParcela * (parcelas - 1)) : brutoParcela
      const taxa = arred((bruto * (perc || 0)) / 100)
      lista.push({
        id: `${venda.id}-${indice}-${n}`, venda_id: venda.id, numero: venda.numero, forma: p.forma,
        parcela: n, parcelas, data: somarDiasISO(dia, p.forma === 'cartao_debito' ? 1 : 30 * n),
        bruto, taxa, liquido: arred(bruto - taxa),
      })
    }
  })
  return lista
}

// Dinheiro que deveria estar na gaveta
export function saldoEsperadoCaixa({ abertura, vendasDinheiro, lancamentos }) {
  const mov = lancamentos.reduce((s, l) => s + (l.tipo === 'suprimento' ? l.valor : -l.valor), 0)
  return arred(abertura + vendasDinheiro + mov)
}

// Resultado simples do mês (competência): vendas − taxas − imposto − custo das peças − despesas.
// Compras de mercadoria não entram como despesa: o custo da peça já entra quando ela é vendida.
export function resultadoDoMes({ vendas, contas, taxas, imposto = 0 }) {
  const faturamento = arred(vendas.reduce((s, v) => s + v.total, 0))
  // taxas pode ser fixa ou uma função (venda → taxas da maquininha daquele CNPJ)
  const taxasDaVenda = (v) => (typeof taxas === 'function' ? taxas(v) : taxas)
  const valorTaxas = arred(vendas.reduce((s, v) => s + v.pagamentos.reduce((t, p) => t + taxaPagamento(p, taxasDaVenda(v)), 0), 0))
  const valorImposto = arred((faturamento * imposto) / 100)
  const custoPecas = arred(vendas.reduce((s, v) => s + v.itens.reduce((c, i) => c + i.custo_unitario * i.quantidade, 0), 0))
  const porCategoria = {}
  for (const c of contas) {
    if (c.categoria === 'fornecedores') continue
    porCategoria[c.categoria] = arred((porCategoria[c.categoria] || 0) + c.valor)
  }
  const despesas = arred(Object.values(porCategoria).reduce((s, v) => s + v, 0))
  const lucroBruto = arred(faturamento - valorTaxas - valorImposto - custoPecas)
  return { faturamento, valorTaxas, valorImposto, custoPecas, lucroBruto, porCategoria, despesas, resultado: arred(lucroBruto - despesas) }
}

// ---------------- Encomendas ----------------
// Encomenda NÃO mexe no estoque: é um pedido da cliente esperando a peça chegar.
export const STATUS_ENCOMENDA = { aguardando: 'Aguardando', chegou: 'Chegou · avisar', entregue: 'Entregue', cancelada: 'Cancelada' }

export function situacaoEncomenda({ status, previsao }, hoje) {
  if (status === 'chegou') return { tom: 'oliva', texto: 'Chegou: avisar a cliente' }
  if (status === 'entregue') return { tom: 'neutro', texto: 'Entregue' }
  if (status === 'cancelada') return { tom: 'neutro', texto: 'Cancelada' }
  if (!previsao) return { tom: 'neutro', texto: 'Sem data prevista' }
  const dias = Math.round((new Date(`${previsao}T00:00:00`) - new Date(`${hoje}T00:00:00`)) / 86400000)
  if (dias < 0) return { tom: 'vinho', texto: `Atrasada há ${-dias} ${-dias === 1 ? 'dia' : 'dias'}`, dias }
  if (dias === 0) return { tom: 'ambar', texto: 'Chega hoje', dias }
  if (dias <= 7) return { tom: 'ambar', texto: `Chega em ${dias} ${dias === 1 ? 'dia' : 'dias'}`, dias }
  return { tom: 'neutro', texto: `Chega em ${dias} dias`, dias }
}

// Encomendas em aberto que esperam uma variação (para avisar quando a peça entra no estoque)
export const encomendasDaVariacao = (encomendas, variacaoId) =>
  encomendas.filter((e) => e.status === 'aguardando' && e.itens.some((i) => i.variacao_id === variacaoId))

// ---------------- Dois CNPJs (Day e Fê) ----------------
// Cada produto pertence a um CNPJ; cada CNPJ tem sua maquininha (suas taxas). Só a ME emite nota.
export const taxasDe = (config, empresaId) => config.empresas?.[empresaId]?.taxas || {}
export const emiteNota = (config, empresaId) => config.empresas?.[empresaId]?.tipo === 'me'
export const empresaEmissora = (config) => Object.keys(config.empresas || {}).find((id) => emiteNota(config, id)) || null

// Desconto da venda dividido entre os CNPJs na proporção do subtotal de cada um
export function dividirDesconto(partes, desconto) {
  const total = partes.reduce((s, p) => s + p.subtotal, 0)
  const resultado = {}
  let usado = 0
  partes.forEach((p, i) => {
    const valor = i === partes.length - 1 ? arred(desconto - usado) : arred(total > 0 ? (desconto * p.subtotal) / total : 0)
    resultado[p.chave] = valor
    usado = arred(usado + valor)
  })
  return resultado
}

// ---------------- Nota fiscal ----------------
// O sistema só confere o FORMATO. Os códigos de verdade quem define é a contadora.
export const CAMPOS_PERFIL_FISCAL = {
  ncm: { nome: 'NCM', ajuda: '8 números', valido: (v) => /^\d{8}$/.test(v) },
  cest: { nome: 'CEST', ajuda: '7 números, quando houver', valido: (v) => !v || /^\d{7}$/.test(v), opcional: true },
  origem: { nome: 'Origem', ajuda: '1 número (0 a 8)', valido: (v) => /^[0-8]$/.test(v) },
  cfop: { nome: 'CFOP', ajuda: '4 números', valido: (v) => /^\d{4}$/.test(v) },
  csosn: { nome: 'CSOSN ou CST', ajuda: '2 ou 3 números', valido: (v) => /^\d{2,3}$/.test(v) },
}

// Lista do que falta (ou está em formato errado) num perfil fiscal
export function faltasPerfilFiscal(perfil = {}) {
  const faltas = []
  for (const [chave, campo] of Object.entries(CAMPOS_PERFIL_FISCAL)) {
    const valor = String(perfil[chave] || '').replace(/\D/g, '')
    if (!valor && campo.opcional) continue
    if (!campo.valido(valor)) faltas.push(campo.nome)
  }
  if (!perfil.validado) faltas.push('validação da contadora')
  return faltas
}

// Alerta do certificado A1: 60, 30 e 15 dias
export function situacaoCertificado(validade, hoje) {
  if (!validade) return { tom: 'vinho', texto: 'Validade do certificado não informada' }
  const dias = Math.round((new Date(`${validade}T00:00:00`) - new Date(`${hoje}T00:00:00`)) / 86400000)
  if (dias < 0) return { dias, tom: 'vinho', texto: `Certificado vencido há ${-dias} dias` }
  if (dias <= 15) return { dias, tom: 'vinho', texto: `Certificado vence em ${dias} dias` }
  if (dias <= 30) return { dias, tom: 'ambar', texto: `Certificado vence em ${dias} dias` }
  if (dias <= 60) return { dias, tom: 'oliva', texto: `Certificado vence em ${dias} dias` }
  return { dias, tom: null, texto: `Certificado válido por mais ${dias} dias` }
}

export const nomeVariacao = (v) =>
  [v.cor, v.tamanho, v.tonalidade, v.volume].filter(Boolean).join(' · ') || 'Única'

// Busca sem diferenciar acento e maiúscula
export const normalizar = (t) =>
  String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
