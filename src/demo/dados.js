// Dados de EXEMPLO para a demonstração. Nomes, marcas, telefones e números são fictícios.
// Tudo é gerado a partir de movimentações, como será no sistema real (regra de ouro).
import { arred } from '../lib/moeda.js'
import { paraISO, somarDias } from '../lib/datas.js'
import { calcularSaldos, alocarPorValidade, totaisVenda } from './regras.js'

export const VERSAO_DADOS = 2

// Gerador pseudoaleatório com semente: a demonstração sai sempre igual
function sorteador(semente) {
  let a = semente
  const r = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  r.entre = (min, max) => min + Math.floor(r() * (max - min + 1))
  r.um = (lista) => lista[Math.floor(r() * lista.length)]
  return r
}

const CATALOGO = [
  { nome: 'Sutiã renda Aurora', tipo: 'lingerie', categoria: 'Sutiãs', marca: 'Dália Íntima', sigla: 'AUR-SUT', preco: 89.9, custo: 38, cores: ['Preto', 'Nude', 'Vinho'], tamanhos: ['40', '42', '44', '46'], minimo: 1 },
  { nome: 'Calcinha fio renda Aurora', tipo: 'lingerie', categoria: 'Calcinhas', marca: 'Dália Íntima', sigla: 'AUR-CAL', preco: 39.9, custo: 14, cores: ['Preto', 'Nude', 'Vinho'], tamanhos: ['P', 'M', 'G', 'GG'], minimo: 1 },
  { nome: 'Conjunto Lívia', tipo: 'lingerie', categoria: 'Conjuntos', marca: 'Dália Íntima', sigla: 'LIV-CJ', preco: 129.9, custo: 55, cores: ['Branco', 'Preto'], tamanhos: ['P', 'M', 'G'], minimo: 1 },
  { nome: 'Body rendado Bella', tipo: 'lingerie', categoria: 'Bodies', marca: 'Dália Íntima', sigla: 'BEL-BOD', preco: 119.9, custo: 48, cores: ['Preto', 'Vermelho'], tamanhos: ['P', 'M', 'G'], minimo: 1 },
  { nome: 'Camisola cetim Serena', tipo: 'lingerie', categoria: 'Noite', marca: 'Lua de Cetim', sigla: 'SER-CAM', preco: 99.9, custo: 40, cores: ['Champanhe', 'Rosé'], tamanhos: ['P', 'M', 'G'], minimo: 1 },
  { nome: 'Pijama short doll Flor', tipo: 'lingerie', categoria: 'Noite', marca: 'Lua de Cetim', sigla: 'FLO-PIJ', preco: 79.9, custo: 30, cores: ['Rosa', 'Azul'], tamanhos: ['P', 'M', 'G'], minimo: 1 },
  { nome: 'Batom matte Veludo', tipo: 'cosmetico', categoria: 'Maquiagem', marca: 'Ametista Cosméticos', sigla: 'VEL-BAT', preco: 34.9, custo: 13, tonalidades: ['Nude Rosado', 'Vermelho Clássico', 'Marsala'], volume: '3,5 g', minimo: 2 },
  { nome: 'Base líquida Pele Leve', tipo: 'cosmetico', categoria: 'Maquiagem', marca: 'Ametista Cosméticos', sigla: 'PLV-BAS', preco: 59.9, custo: 24, tonalidades: ['01 Claro', '02 Médio', '03 Morena', '04 Escura'], volume: '30 ml', minimo: 2 },
  { nome: 'Máscara de cílios Volume', tipo: 'cosmetico', categoria: 'Maquiagem', marca: 'Ametista Cosméticos', sigla: 'VOL-MAS', preco: 39.9, custo: 15, volume: '8 g', minimo: 2 },
  { nome: 'Hidratante corporal Baunilha', tipo: 'cosmetico', categoria: 'Corpo e banho', marca: 'Flor de Sal', sigla: 'BAU-HID', preco: 44.9, custo: 17, volume: '200 ml', minimo: 3 },
  { nome: 'Body splash Flor de Cerejeira', tipo: 'cosmetico', categoria: 'Perfumaria', marca: 'Flor de Sal', sigla: 'CER-SPL', preco: 49.9, custo: 19, volume: '200 ml', minimo: 3 },
  { nome: 'Óleo corporal Cetim', tipo: 'cosmetico', categoria: 'Corpo e banho', marca: 'Flor de Sal', sigla: 'CET-OLE', preco: 54.9, custo: 22, volume: '100 ml', minimo: 2 },
]

const NOMES_CLIENTES = [
  'Ana Paula Moreira', 'Beatriz Lima', 'Camila Rocha', 'Daniela Souza', 'Eduarda Martins', 'Fernanda Alves',
  'Gabriela Costa', 'Helena Duarte', 'Isabela Freitas', 'Juliana Ramos', 'Larissa Teixeira', 'Mariana Pires',
  'Natália Gomes', 'Patrícia Nunes', 'Renata Barros', 'Sabrina Melo', 'Tatiane Cardoso', 'Vanessa Lopes',
  'Yasmin Fonseca', 'Aline Castro', 'Carla Mendes', 'Débora Vieira', 'Elaine Prado', 'Priscila Antunes',
]

const sigla = (t) => String(t).normalize('NFD').replace(/[^\w]/g, '').slice(0, 3).toUpperCase()

export function gerarDadosExemplo(agora = new Date()) {
  const r = sorteador(20261015)
  const hoje = new Date(agora)
  let seq = 0
  const novoId = (prefixo) => `${prefixo}${++seq}`
  const quando = (diasAtras, hora = 10, minuto = 0) => {
    const d = somarDias(hoje, -diasAtras)
    d.setHours(hora, minuto, 0, 0)
    return d.toISOString()
  }

  // ---------------- Catálogo ----------------
  const produtos = []
  const variacoes = []
  let codigo = 1000
  for (const p of CATALOGO) {
    const produto = {
      id: novoId('p'), nome: p.nome, tipo: p.tipo, categoria: p.categoria, marca: p.marca,
      controla_validade: p.tipo === 'cosmetico', ativo: true,
    }
    produtos.push(produto)
    const combinacoes = p.tipo === 'lingerie'
      ? p.cores.flatMap((cor) => p.tamanhos.map((tamanho) => ({ cor, tamanho })))
      : (p.tonalidades || [null]).map((tonalidade) => ({ tonalidade }))
    for (const c of combinacoes) {
      codigo += 1
      variacoes.push({
        id: novoId('v'), produto_id: produto.id,
        sku: [p.sigla, c.cor && sigla(c.cor), c.tamanho, c.tonalidade && sigla(c.tonalidade)].filter(Boolean).join('-'),
        codigo_barras: `7890000${String(codigo).padStart(6, '0')}`,
        cor: c.cor || null, tamanho: c.tamanho || null, tonalidade: c.tonalidade || null, volume: p.volume || null,
        preco: p.preco, custo: p.custo, estoque_minimo: p.minimo, ativo: true,
      })
    }
  }
  const produtoDe = new Map(produtos.map((p) => [p.id, p]))

  // ---------------- Estoque inicial e reposição ----------------
  const lotes = []
  const movimentacoes = []
  const mov = (campos) => movimentacoes.push({ id: novoId('m'), usuario: 'Proprietária', motivo: '', lote_id: null, origem_id: null, ...campos })

  for (const v of variacoes) {
    const produto = produtoDe.get(v.produto_id)
    const qtd = produto.tipo === 'lingerie' ? r.entre(4, 8) : r.entre(9, 14)
    let lote_id = null
    if (produto.controla_validade) {
      lote_id = novoId('l')
      // alguns lotes vencem logo, para mostrar os alertas de 30, 60 e 90 dias
      lotes.push({ id: lote_id, variacao_id: v.id, numero: `L${r.entre(2400, 2499)}`, validade: paraISO(somarDias(hoje, r.entre(12, 160))) })
    }
    mov({ variacao_id: v.id, lote_id, tipo: 'entrada_compra', quantidade: qtd, custo_unitario: v.custo, motivo: 'Estoque inicial', data: quando(95, 9) })

    if (r() < 0.8) {
      let lote2 = null
      if (produto.controla_validade) {
        lote2 = novoId('l')
        lotes.push({ id: lote2, variacao_id: v.id, numero: `L${r.entre(2600, 2699)}`, validade: paraISO(somarDias(hoje, r.entre(220, 520))) })
      }
      mov({ variacao_id: v.id, lote_id: lote2, tipo: 'entrada_compra', quantidade: r.entre(3, 7), custo_unitario: v.custo, motivo: 'Reposição do fornecedor', data: quando(45, 9) })
    }
  }

  // ---------------- Clientes ----------------
  const mesAtual = hoje.getMonth()
  const clientes = NOMES_CLIENTES.map((nome, i) => {
    const mes = i < 4 ? mesAtual : r.entre(0, 11)
    const dia = r.entre(1, 28)
    return {
      id: novoId('c'), nome,
      whatsapp: `(00) 9${r.entre(1000, 9999)}-${r.entre(1000, 9999)}`,
      email: '',
      nascimento: `${r.entre(1975, 2004)}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
      preferencias: {
        sutia: r.um(['40', '42', '44', '46']),
        calcinha: r.um(['P', 'M', 'G', 'GG']),
        tom_pele: r.um(['Claro', 'Médio', 'Morena', 'Escura']),
      },
      aceita_contato: r() < 0.85,
      observacoes: '',
      criado_em: quando(95),
    }
  })
  const sumidas = new Set(clientes.slice(20).map((c) => c.id)) // não compram há mais de 60 dias
  const fieis = clientes.slice(4, 9).map((c) => c.id)          // compram mais vezes

  // ---------------- Vendas dos últimos 90 dias ----------------
  const vendas = []
  let numero = 0
  const variacaoDe = new Map(variacoes.map((v) => [v.id, v]))

  for (let diasAtras = 90; diasAtras >= 0; diasAtras--) {
    const diaSemana = somarDias(hoje, -diasAtras).getDay()
    if (diaSemana === 0) continue // domingo fechado
    let quantas = r.entre(1, diaSemana === 6 ? 6 : 4)
    if (diasAtras === 0) quantas = 3
    for (let n = 0; n < quantas; n++) {
      const { porVariacao, porLote } = calcularSaldos(movimentacoes)
      const disponiveis = variacoes.filter((v) => (porVariacao.get(v.id) || 0) > 0)
      if (!disponiveis.length) break

      let data
      if (diasAtras === 0) {
        const d = new Date(hoje.getTime() - (n + 1) * 47 * 60000)
        data = d.toISOString()
      } else {
        data = quando(diasAtras, r.entre(9, 18), r.entre(0, 59))
      }

      const itens = []
      // ticket médio da loja perto de R$ 50: quase sempre uma peça só, mais cosméticos
      const sorteioItens = r()
      const qtdItens = sorteioItens < 0.72 ? 1 : sorteioItens < 0.92 ? 2 : 3
      const cosmeticos = disponiveis.filter((v) => produtoDe.get(v.produto_id).tipo === 'cosmetico')
      for (let k = 0; k < qtdItens; k++) {
        const v = cosmeticos.length && r() < 0.6 ? r.um(cosmeticos) : r.um(disponiveis)
        if (itens.some((i) => i.variacao_id === v.id)) continue
        itens.push({ variacao_id: v.id, quantidade: 1, preco: v.preco })
      }
      let desconto = 0
      const parcial = totaisVenda(itens)
      if (r() < 0.12) desconto = arred(parcial.subtotal * 0.05)
      const { subtotal, total } = totaisVenda(itens, desconto)

      const formaSorteio = r()
      const forma = formaSorteio < 0.4 ? 'pix' : formaSorteio < 0.75 ? 'cartao_credito' : formaSorteio < 0.9 ? 'cartao_debito' : 'dinheiro'
      const parcelas = forma === 'cartao_credito' && total > 100 ? r.entre(1, 3) : 1
      const pagamentos = [{ forma, valor: total, parcelas }]

      let cliente_id = null
      if (r() < 0.7) {
        const pool = diasAtras > 70
          ? clientes
          : clientes.filter((c) => !sumidas.has(c.id))
        cliente_id = r() < 0.35 ? r.um(fieis) : r.um(pool).id
      }
      const canalSorteio = r()
      const canal = canalSorteio < 0.6 ? 'loja' : canalSorteio < 0.85 ? 'instagram' : 'whatsapp'

      const id = novoId('venda')
      numero += 1
      const itensVenda = []
      for (const item of itens) {
        const v = variacaoDe.get(item.variacao_id)
        const produto = produtoDe.get(v.produto_id)
        if (produto.controla_validade) {
          const { partes } = alocarPorValidade(lotes.filter((l) => l.variacao_id === v.id), porLote, item.quantidade)
          for (const parte of partes) {
            mov({ variacao_id: v.id, lote_id: parte.lote_id, tipo: 'saida_venda', quantidade: -parte.quantidade, custo_unitario: v.custo, motivo: `Venda nº ${numero}`, data, origem_id: id, usuario: r() < 0.5 ? 'Proprietária' : 'Vendedora' })
          }
        } else {
          mov({ variacao_id: v.id, tipo: 'saida_venda', quantidade: -item.quantidade, custo_unitario: v.custo, motivo: `Venda nº ${numero}`, data, origem_id: id })
        }
        itensVenda.push({ variacao_id: v.id, quantidade: item.quantidade, preco_unitario: v.preco, custo_unitario: v.custo })
      }

      vendas.push({
        id, numero, data, cliente_id, canal, vendedora: r() < 0.55 ? 'Proprietária' : 'Vendedora',
        itens: itensVenda, pagamentos, subtotal, desconto, total, status: 'concluida',
        nota: { status: 'autorizada', ambiente: 'homologacao' },
      })
    }
  }

  // Lotes comprados ontem com validade curta, para os alertas de 30, 60 e 90 dias aparecerem
  const cosmeticosComLote = variacoes.filter((v) => produtoDe.get(v.produto_id).controla_validade)
  for (const [i, v] of cosmeticosComLote.slice(0, 6).entries()) {
    const lote_id = novoId('l')
    lotes.push({ id: lote_id, variacao_id: v.id, numero: `P${r.entre(100, 199)}`, validade: paraISO(somarDias(hoje, [18, 27, 44, 58, 75, 86][i])) })
    mov({ variacao_id: v.id, lote_id, tipo: 'entrada_compra', quantidade: r.entre(2, 4), custo_unitario: v.custo, motivo: 'Compra com desconto (validade curta)', data: quando(1, 9) })
  }

  // Uma venda cancelada (estorno) e duas notas pendentes, para mostrar os casos
  const cancelada = vendas[vendas.length - 12]
  if (cancelada) {
    cancelada.status = 'cancelada'
    cancelada.motivo_cancelamento = 'Cliente desistiu na hora (exemplo)'
    for (const m of movimentacoes.filter((x) => x.origem_id === cancelada.id)) {
      mov({ variacao_id: m.variacao_id, lote_id: m.lote_id, tipo: 'cancelamento_venda', quantidade: -m.quantidade, custo_unitario: m.custo_unitario, motivo: `Cancelamento da venda nº ${cancelada.numero}`, data: cancelada.data, origem_id: cancelada.id })
    }
    cancelada.nota = { status: 'cancelada', ambiente: 'homologacao' }
  }
  for (const v of vendas.slice(-5, -3)) {
    v.nota = { status: 'pendente', ambiente: 'homologacao', motivo: 'O produto está sem NCM no cadastro fiscal (exemplo). Corrija e reenvie.' }
  }

  movimentacoes.sort((a, b) => a.data.localeCompare(b.data))

  const resultado = {
    versao: VERSAO_DADOS,
    seq,
    numeroVenda: numero,
    produtos, variacoes, lotes, movimentacoes, clientes, vendas,
    config: {
      limiteDescontoVendedora: 10,
      permitirEstoqueNegativo: false,
      aceitaCrediario: false,
      intimaNaoRetorna: true,
      taxas: { pix: 0, debito: 1.99, credito: 3.49, credito_parcelado: 4.99 },
      ...CONFIG_CALCULADORA,
      ...CONFIG_FISCAL,
    },
  }
  return { ...resultado, ...gerarFinanceiroExemplo(resultado, agora) }
}

// ---------------- Financeiro de EXEMPLO ----------------
const CATEGORIA_DO_FIXO = { f1: 'aluguel', f2: 'contas_loja', f3: 'contas_loja', f4: 'contadora', f5: 'taxas_tarifas', f6: 'outros', f7: 'pro_labore' }

export function gerarFinanceiroExemplo(dados, agora = new Date()) {
  const hoje = new Date(agora)
  const hojeISO = paraISO(hoje)
  let n = 0
  const contasPagar = []
  const conta = (campos) => {
    const vencida = campos.vencimento < hojeISO
    contasPagar.push({ id: `cp${++n}`, fornecedor: '', observacao: '', pagoEm: vencida && campos.pago !== false ? campos.vencimento : null, ...campos })
  }

  // custos fixos: dia 10 de cada mês, dos 2 meses passados até o próximo
  for (let m = -2; m <= 1; m++) {
    const venc = paraISO(new Date(hoje.getFullYear(), hoje.getMonth() + m, 10))
    for (const f of dados.config.custosFixos || CONFIG_CALCULADORA.custosFixos) {
      if (!f.valor) continue
      conta({ descricao: f.nome, categoria: CATEGORIA_DO_FIXO[f.id] || 'outros', valor: f.valor, vencimento: venc })
    }
  }
  // fornecedores e outras despesas
  conta({ descricao: 'Reposição de lingerie', fornecedor: 'Dália Íntima', categoria: 'fornecedores', valor: 1480, vencimento: paraISO(somarDias(hoje, -15)) })
  conta({ descricao: 'Compra de maquiagem (1/2)', fornecedor: 'Ametista Cosméticos', categoria: 'fornecedores', valor: 640, vencimento: paraISO(somarDias(hoje, 5)) })
  conta({ descricao: 'Compra de maquiagem (2/2)', fornecedor: 'Ametista Cosméticos', categoria: 'fornecedores', valor: 640, vencimento: paraISO(somarDias(hoje, 35)) })
  conta({ descricao: 'Hidratantes e body splash', fornecedor: 'Flor de Sal', categoria: 'fornecedores', valor: 395, vencimento: paraISO(somarDias(hoje, -2)), pago: false })
  conta({ descricao: 'Impulsionamento no Instagram', categoria: 'marketing', valor: 150, vencimento: paraISO(somarDias(hoje, 12)) })
  contasPagar.sort((a, b) => a.vencimento.localeCompare(b.vencimento))
  for (const c of contasPagar) delete c.pago

  // caixa: os últimos 6 dias abertos, já fechados
  const caixas = []
  const dinheiroDoDia = (dia) => dados.vendas
    .filter((v) => v.status === 'concluida' && paraISO(new Date(v.data)) === dia)
    .reduce((s, v) => s + v.pagamentos.filter((p) => p.forma === 'dinheiro').reduce((t, p) => t + p.valor, 0), 0)
  for (let d = 1, feitos = 0; feitos < 6 && d < 15; d++) {
    const data = somarDias(hoje, -d)
    if (data.getDay() === 0) continue
    feitos++
    const dia = paraISO(data)
    const dinheiro = arred(dinheiroDoDia(dia))
    // sangria de exemplo: leva ao banco o que entrou em dinheiro, deixando o troco
    const lancamentos = dinheiro > 0 && feitos !== 2
      ? [{ id: `l${dia}`, tipo: 'sangria', valor: dinheiro, motivo: 'Depósito no banco', hora: `${dia}T16:00:00` }]
      : []
    const esperado = arred(100 + dinheiro + lancamentos.reduce((s, l) => s - l.valor, 0))
    caixas.push({
      id: `cx${dia}`, dia, abertura: 100, abertoPor: 'Proprietária', lancamentos,
      fechadoEm: `${dia}T18:30:00`, contado: feitos === 2 ? arred(esperado - 5) : esperado,
      observacao: feitos === 2 ? 'Faltaram R$ 5,00: troco errado (exemplo)' : '',
    })
  }
  return { contasPagar, caixas }
}

// Dados fiscais começam EM BRANCO de propósito: quem preenche é a contadora (nada inventado)
export const CONFIG_FISCAL = {
  fiscal: {
    empresa: { razao_social: '', cnpj: '', inscricao_estadual: '', regime: '', endereco: '', municipio: '', uf: '' },
    provedor: '',
    certificadoValidade: '',
    emitir: 'sempre',
    perfis: {}, // por categoria: { ncm, cest, origem, cfop, csosn, validado }
  },
}

// Valores de EXEMPLO da calculadora de preço (as irmãs trocam pelos reais)
export const CONFIG_CALCULADORA = {
  custosFixos: [
    { id: 'f1', nome: 'Aluguel', valor: 1200 },
    { id: 'f2', nome: 'Energia', valor: 180 },
    { id: 'f3', nome: 'Internet e telefone', valor: 120 },
    { id: 'f4', nome: 'Contadora', valor: 350 },
    { id: 'f5', nome: 'Tarifa do banco e da maquininha', valor: 60 },
    { id: 'f6', nome: 'Sistema e aplicativos', valor: 50 },
    { id: 'f7', nome: 'Pró-labore das sócias', valor: 0 },
  ],
  calculadora: {
    embalagem: 2, entrega: 0, entregaQuemPaga: 'loja', comEntrega: false,
    margem: 20, imposto: 0, formaBase: 'credito', final90: true, faturamento: null,
  },
}
