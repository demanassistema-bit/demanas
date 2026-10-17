// Regras do catálogo que rodam na tela: códigos de barras, nome das variações e a planilha de importação.
// O banco confere tudo de novo (limites, códigos repetidos, permissões).
import { LIMITE, TAMANHO, lerInteiro, lerValor, limparTexto, separarLista } from './limites.js'

export const TIPOS_PRODUTO = { lingerie: 'Lingerie', cosmetico: 'Cosmético', outro: 'Outro', kit: 'Kit ou promoção' }
export const CAMPOS_VARIACAO = ['modelo', 'cor', 'tamanho', 'tonalidade', 'volume']

const normal = (t) => limparTexto(t).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '')

// "Balconete · Preto · 42" (ou "Único" quando o produto não tem variação)
export function descreverVariacao(v) {
  return CAMPOS_VARIACAO.map((c) => v[c]).filter(Boolean).join(' · ') || 'Único'
}

// ---------------- Código de barras ----------------
// Dígito verificador EAN/UPC: peso 3 nas posições pares a partir da direita
export function digitoEAN(base) {
  const soma = [...base].reverse().reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (soma % 10)) % 10
}

// Erro do código digitado, ou null. Códigos só com números de 8, 12, 13 ou 14 dígitos
// (EAN-8, UPC, EAN-13, DUN-14) têm dígito verificador: um número trocado é pego aqui.
export function erroCodigoBarras(codigo) {
  const c = String(codigo ?? '').trim()
  if (!c) return null
  if (!/^[0-9A-Za-z-]{4,30}$/.test(c)) return 'O código de barras aceita só números (e letras), de 4 a 30.'
  if (/^\d+$/.test(c) && [8, 12, 13, 14].includes(c.length) && digitoEAN(c.slice(0, -1)) !== Number(c.at(-1))) {
    return `O código ${c} não confere: deve ter um número trocado. Leia de novo com o leitor ou confira na etiqueta.`
  }
  return null
}

// ---------------- Variações de um produto novo ----------------
// Lingerie: modelos × cores × tamanhos · Cosmético: tonalidades × volumes · Kit/outro: uma só
export function combinarVariacoes(tipo, listas) {
  const de = (chave) => (listas[chave]?.length ? listas[chave] : [null])
  const chaves = tipo === 'lingerie' ? ['modelo', 'cor', 'tamanho'] : tipo === 'cosmetico' ? ['tonalidade', 'volume'] : []
  let combinacoes = [{}]
  for (const chave of chaves) {
    combinacoes = combinacoes.flatMap((c) => de(chave).map((valor) => (valor ? { ...c, [chave]: valor } : c)))
  }
  return combinacoes
}

// ---------------- Planilha ----------------
// Colunas do modelo, na ordem. A primeira linha da planilha tem esses nomes.
export const COLUNAS_PLANILHA = [
  ['produto', 'Nome do produto (repita em cada linha da mesma peça)'],
  ['tipo', 'lingerie, cosmetico, kit ou outro'],
  ['categoria', 'Ex.: Sutiãs'],
  ['marca', 'Ex.: Dália'],
  ['cnpj', 'Day ou Fê'],
  ['modelo', 'Lingerie: modelo'],
  ['cor', 'Lingerie: cor'],
  ['tamanho', 'Lingerie: tamanho'],
  ['tonalidade', 'Cosmético: tom ou fragrância'],
  ['volume', 'Cosmético: ml ou g'],
  ['codigo_barras', 'Deixe vazio se não tiver'],
  ['preco', 'Preço de venda, ex.: 89,90'],
  ['custo', 'Custo da peça, ex.: 38,00'],
  ['estoque_minimo', 'Número inteiro'],
  ['validade', 'sim para controlar lote e validade'],
]

const EXEMPLOS = [
  ['Sutiã renda Aurora', 'lingerie', 'Sutiãs', 'Dália', 'Day', 'Balconete', 'Preto', '42', '', '', '7891234567895', '89,90', '38,00', '2', 'não'],
  ['Sutiã renda Aurora', 'lingerie', 'Sutiãs', 'Dália', 'Day', 'Balconete', 'Nude', '42', '', '', '', '89,90', '38,00', '2', 'não'],
  ['Batom matte Veludo', 'cosmetico', 'Maquiagem', 'Bella', 'Fê', '', '', '', 'Marsala', '', '', '39,90', '14,50', '3', 'sim'],
]

// Texto do arquivo modelo (separado por ponto e vírgula, que o Excel em português abre certinho)
export function textoModeloPlanilha() {
  const linha = (cols) => cols.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')
  return '﻿' + [linha(COLUNAS_PLANILHA.map(([c]) => c)), ...EXEMPLOS.map(linha)].join('\r\n') + '\r\n'
}

// CSV → lista de linhas (cada linha uma lista de células). Aceita ; , ou tabulação e aspas.
export function lerCSV(texto) {
  const t = String(texto ?? '').replace(/^﻿/, '')
  const primeira = t.split(/\r?\n/, 1)[0] || ''
  const separador = ['\t', ';', ','].map((s) => [s, primeira.split(s).length]).sort((a, b) => b[1] - a[1])[0][0]
  const linhas = []
  let linha = []
  let celula = ''
  let aspas = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (aspas) {
      if (ch === '"' && t[i + 1] === '"') { celula += '"'; i++ }
      else if (ch === '"') aspas = false
      else celula += ch
    } else if (ch === '"') aspas = true
    else if (ch === separador) { linha.push(celula); celula = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++
      linha.push(celula); linhas.push(linha); linha = []; celula = ''
    } else celula += ch
  }
  if (celula || linha.length) { linha.push(celula); linhas.push(linha) }
  return linhas.filter((l) => l.some((c) => c.trim()))
}

const TIPOS_ACEITOS = { lingerie: 'lingerie', cosmetico: 'cosmetico', cosmeticos: 'cosmetico', kit: 'kit', promocao: 'kit', outro: 'outro', outros: 'outro' }
const SIM = new Set(['sim', 's', 'x', '1', 'true', 'verdadeiro'])

// Linhas da planilha → produtos prontos para salvar, com os erros por linha.
// existentes: { nomes: Set (normalizados), codigos: Set } do que já está no sistema.
// empresas: { day: { apelido, dona }, fe: {...} }
export function planilhaParaProdutos(linhas, { empresas = {}, existentes = { nomes: new Set(), codigos: new Set() } } = {}) {
  const erros = []
  if (linhas.length < 2) return { produtos: [], erros: [{ linha: 1, mensagem: 'A planilha está vazia: falta a linha dos títulos e pelo menos um produto.' }], linhasLidas: 0 }
  if (linhas.length - 1 > 3000) return { produtos: [], erros: [{ linha: 1, mensagem: 'A planilha passa de 3.000 linhas. Divida em partes.' }], linhasLidas: 0 }

  const titulos = linhas[0].map((c) => normal(c).replace(/\s+/g, '_'))
  const posicao = Object.fromEntries(COLUNAS_PLANILHA.map(([c]) => [c, titulos.indexOf(c)]))
  const faltando = ['produto', 'preco'].filter((c) => posicao[c] < 0)
  if (faltando.length) {
    return { produtos: [], erros: [{ linha: 1, mensagem: `Faltam as colunas: ${faltando.join(', ')}. Use o modelo da planilha.` }], linhasLidas: 0 }
  }

  const empresaPorNome = new Map()
  for (const [id, e] of Object.entries(empresas)) {
    for (const nome of [id, e.apelido, e.dona, `cnpj ${e.dona}`]) if (nome) empresaPorNome.set(normal(nome), id)
  }

  const porProduto = new Map()
  const codigosNaPlanilha = new Map()

  linhas.slice(1).forEach((cels, i) => {
    const n = i + 2 // número da linha como aparece no Excel
    const pega = (c) => (posicao[c] >= 0 ? limparTexto(cels[posicao[c]]) : '')
    const erro = (mensagem) => erros.push({ linha: n, mensagem })

    const nome = pega('produto')
    if (nome.length < 2) return erro('Falta o nome do produto.')
    if (nome.length > TAMANHO.nome) return erro(`Nome com mais de ${TAMANHO.nome} letras.`)
    if (existentes.nomes.has(normal(nome))) return erro(`"${nome}" já está cadastrado no sistema.`)

    const tipoTexto = normal(pega('tipo'))
    const tipo = tipoTexto ? TIPOS_ACEITOS[tipoTexto] : 'outro'
    if (!tipo) return erro(`Tipo "${pega('tipo')}" não existe. Use lingerie, cosmetico, kit ou outro.`)

    const cnpjTexto = normal(pega('cnpj'))
    const empresa_id = cnpjTexto ? empresaPorNome.get(cnpjTexto) : 'day'
    if (!empresa_id) return erro(`CNPJ "${pega('cnpj')}" não existe. Use Day ou Fê.`)

    const categoria = pega('categoria')
    const marca = pega('marca')
    if (categoria.length > TAMANHO.categoria) return erro(`Categoria com mais de ${TAMANHO.categoria} letras.`)
    if (marca.length > TAMANHO.marca) return erro(`Marca com mais de ${TAMANHO.marca} letras.`)

    const variacao = {}
    for (const c of CAMPOS_VARIACAO) {
      const valor = pega(c)
      if (valor.length > TAMANHO.variacao) return erro(`${c} "${valor}" passa de ${TAMANHO.variacao} letras.`)
      variacao[c] = valor || null
    }

    const preco = lerValor(pega('preco'), { rotulo: 'o preço', max: LIMITE.preco })
    if (preco.erro) return erro(preco.erro)
    const custo = lerValor(pega('custo'), { rotulo: 'o custo', min: 0, max: LIMITE.preco, obrigatorio: false })
    if (custo.erro) return erro(custo.erro)
    const minimo = lerInteiro(pega('estoque_minimo'), { rotulo: 'o estoque mínimo', min: 0, max: LIMITE.estoqueMinimo, obrigatorio: false })
    if (minimo.erro) return erro(minimo.erro)

    const codigo = pega('codigo_barras').replace(/\s/g, '')
    const erroCodigo = erroCodigoBarras(codigo)
    if (erroCodigo) return erro(erroCodigo)
    if (codigo && existentes.codigos.has(codigo)) return erro(`O código ${codigo} já é de outro produto no sistema.`)
    if (codigo && codigosNaPlanilha.has(codigo)) return erro(`O código ${codigo} também está na linha ${codigosNaPlanilha.get(codigo)}.`)
    if (codigo) codigosNaPlanilha.set(codigo, n)

    const chave = normal(nome)
    if (!porProduto.has(chave)) {
      porProduto.set(chave, {
        linha: n, nome, tipo, categoria, marca, empresa_id,
        controla_validade: SIM.has(normal(pega('validade'))), variacoes: [], combinacoes: new Map(),
      })
    }
    const produto = porProduto.get(chave)
    if (produto.tipo !== tipo) return erro(`"${nome}" aparece como ${produto.tipo} na linha ${produto.linha} e como ${tipo} aqui.`)
    if (produto.empresa_id !== empresa_id) return erro(`"${nome}" está em CNPJs diferentes (linha ${produto.linha}). Uma peça vende por um CNPJ só.`)

    const combinacao = CAMPOS_VARIACAO.map((c) => normal(variacao[c] || '')).join('|')
    if (produto.combinacoes.has(combinacao)) return erro(`Variação repetida de "${nome}" (igual à linha ${produto.combinacoes.get(combinacao)}).`)
    produto.combinacoes.set(combinacao, n)
    if (produto.variacoes.length >= LIMITE.variacoes) return erro(`"${nome}" passa de ${LIMITE.variacoes} variações.`)

    produto.variacoes.push({
      ...variacao, codigo_barras: codigo || null, codigo_proprio: false,
      preco_venda: preco.valor, custo: custo.valor, estoque_minimo: minimo.valor,
    })
  })

  const produtos = [...porProduto.values()].map(({ combinacoes, linha, ...p }) => p) // eslint-disable-line no-unused-vars
  return { produtos, erros, linhasLidas: linhas.length - 1 }
}

// Listas digitadas no cadastro ("Preto, Nude") → sem repetidas, sem vazias
export { separarLista }
