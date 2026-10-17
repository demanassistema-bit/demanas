import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { CONFIG_CALCULADORA, CONFIG_EMPRESAS, CONFIG_FISCAL, gerarDadosExemplo, gerarEncomendasExemplo, gerarFinanceiroExemplo, VERSAO_DADOS } from './dados'
import { alocarPorValidade, calcularSaldos, emiteNota, nomeVariacao, novoCustoMedio, podeApagarCliente, podeApagarProduto, totaisVenda } from './regras'
import { arred } from '../lib/moeda'

/*
  Estado da DEMONSTRAÇÃO. Fica só neste navegador (localStorage) e pode ser restaurado.
  Na versão real, cada ação abaixo vira uma função no banco (Supabase), com as mesmas regras.
*/
const DemoContext = createContext(null)
const CHAVE = 'demanas-demo-dados'
const CHAVE_PERFIL = 'demanas-demo-perfil'

function carregar() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE))
    // quem já tinha dados guardados ganha os valores novos da calculadora sem perder o resto
    if (salvo?.versao === VERSAO_DADOS) {
      const dados = { ...salvo, config: { ...CONFIG_EMPRESAS, ...CONFIG_CALCULADORA, ...CONFIG_FISCAL, ...salvo.config } }
      const comFinanceiro = dados.contasPagar ? dados : { ...dados, ...gerarFinanceiroExemplo(dados) }
      return comFinanceiro.encomendas ? comFinanceiro : { ...comFinanceiro, ...gerarEncomendasExemplo(comFinanceiro) }
    }
  } catch { /* sem armazenamento: começa do exemplo */ }
  return gerarDadosExemplo()
}

const NOMES_PERFIL = { proprietaria: 'Proprietária', vendedora: 'Vendedora' }

export function DemoProvider({ children }) {
  const [dados, setDados] = useState(carregar)
  const [perfil, setPerfilEstado] = useState(() => {
    try { return localStorage.getItem(CHAVE_PERFIL) || 'proprietaria' } catch { return 'proprietaria' }
  })
  const atual = useRef(dados)
  atual.current = dados

  useEffect(() => {
    try { localStorage.setItem(CHAVE, JSON.stringify(dados)) } catch { /* sem armazenamento */ }
  }, [dados])

  const setPerfil = (p) => {
    setPerfilEstado(p)
    try { localStorage.setItem(CHAVE_PERFIL, p) } catch { /* sem armazenamento */ }
  }

  const ehProprietaria = perfil === 'proprietaria'
  const usuario = NOMES_PERFIL[perfil]

  // ---------------- Leituras derivadas ----------------
  const saldos = useMemo(() => calcularSaldos(dados.movimentacoes), [dados.movimentacoes])
  const produtoPorId = useMemo(() => new Map(dados.produtos.map((p) => [p.id, p])), [dados.produtos])
  const variacaoPorId = useMemo(() => new Map(dados.variacoes.map((v) => [v.id, v])), [dados.variacoes])
  const clientePorId = useMemo(() => new Map(dados.clientes.map((c) => [c.id, c])), [dados.clientes])

  // Cada variação já com o produto, o nome legível e o saldo
  const linhas = useMemo(() => dados.variacoes.map((v) => {
    const produto = produtoPorId.get(v.produto_id)
    return {
      ...v, produto,
      nomeVariacao: nomeVariacao(v),
      saldo: saldos.porVariacao.get(v.id) || 0,
    }
  }), [dados.variacoes, produtoPorId, saldos])

  const lotesComSaldo = useMemo(() => dados.lotes
    .map((l) => ({ ...l, saldo: saldos.porLote.get(l.id) || 0 }))
    .filter((l) => l.saldo > 0), [dados.lotes, saldos])

  // ---------------- Ações ----------------
  const novoId = (d, prefixo) => { d.seq += 1; return `${prefixo}${d.seq}` }
  // código único mesmo quando vários registros nascem no mesmo milissegundo (parcelas de uma conta)
  const idUnico = (prefixo) => `${prefixo}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const agoraISO = () => new Date().toISOString()

  // Gera as saídas de uma variação (pela validade mais próxima, se for cosmético)
  function saidas(d, porLote, variacao, quantidade, campos) {
    const produto = d.produtos.find((p) => p.id === variacao.produto_id)
    const movs = []
    let falta = quantidade
    if (produto.controla_validade) {
      const alocado = alocarPorValidade(d.lotes.filter((l) => l.variacao_id === variacao.id), porLote, quantidade)
      for (const parte of alocado.partes) movs.push({ ...campos, lote_id: parte.lote_id, quantidade: -parte.quantidade })
      falta = alocado.falta
    }
    if (falta > 0) movs.push({ ...campos, lote_id: null, quantidade: -falta })
    return movs.map((m) => ({ id: novoId(d, 'm'), variacao_id: variacao.id, custo_unitario: variacao.custo, usuario, origem_id: null, ...m }))
  }

  // partes: uma por CNPJ → [{ empresa_id, itens, desconto, pagamentos }]
  // Se a cliente levou peças dos dois CNPJs, nascem duas vendas ligadas pelo mesmo grupo.
  const concluirVenda = useCallback(({ partes, cliente_id, canal }) => {
    const d = structuredClone(atual.current)
    const { porVariacao, porLote } = calcularSaldos(d.movimentacoes)
    for (const item of partes.flatMap((p) => p.itens)) {
      const saldo = porVariacao.get(item.variacao_id) || 0
      if (!d.config.permitirEstoqueNegativo && item.quantidade > saldo) {
        const v = d.variacoes.find((x) => x.id === item.variacao_id)
        return { erro: `Só há ${saldo} em estoque de ${nomeVariacao(v)}.` }
      }
    }
    const data = agoraISO()
    const grupo = partes.length > 1 ? novoId(d, 'grupo') : null
    const vendas = partes.map(({ empresa_id, itens, desconto, pagamentos }) => {
      const id = novoId(d, 'venda')
      d.numeroVenda += 1
      const numero = d.numeroVenda
      const itensVenda = itens.map((item) => {
        const v = d.variacoes.find((x) => x.id === item.variacao_id)
        d.movimentacoes.push(...saidas(d, porLote, v, item.quantidade, {
          tipo: 'saida_venda', motivo: `Venda nº ${numero}`, data, origem_id: id,
        }))
        // preço e custo copiados para o item no momento da venda
        return { variacao_id: v.id, quantidade: item.quantidade, preco_unitario: v.preco, custo_unitario: v.custo }
      })
      const totais = totaisVenda(itensVenda.map((i) => ({ preco: i.preco_unitario, quantidade: i.quantidade })), desconto)
      const venda = {
        id, numero, data, grupo, empresa_id, cliente_id: cliente_id || null, canal, vendedora: usuario,
        itens: itensVenda, pagamentos: pagamentos.map((p) => ({ ...p, valor: arred(p.valor) })),
        ...totais, status: 'concluida',
        nota: emiteNota(d.config, empresa_id) ? { status: 'enviando', ambiente: 'homologacao' } : null,
      }
      d.vendas.push(venda)
      return venda
    })
    setDados(d)

    // A nota sai em segundo plano: a venda não espera a SEFAZ
    const comNota = vendas.filter((v) => v.nota).map((v) => v.id)
    if (comNota.length) {
      setTimeout(() => {
        setDados((anterior) => ({
          ...anterior,
          vendas: anterior.vendas.map((v) => (comNota.includes(v.id) ? { ...v, nota: { status: 'autorizada', ambiente: 'homologacao' } } : v)),
        }))
      }, 2500)
    }
    return { vendas }
  }, [usuario]) // eslint-disable-line react-hooks/exhaustive-deps

  const atualizarProduto = useCallback((id, campos) => {
    setDados((d) => ({ ...d, produtos: d.produtos.map((p) => (p.id === id ? { ...p, ...campos } : p)) }))
  }, [])

  const cancelarVenda = useCallback((vendaId, motivo) => {
    const d = structuredClone(atual.current)
    const venda = d.vendas.find((v) => v.id === vendaId)
    if (!venda || venda.status === 'cancelada') return
    const data = agoraISO()
    // estorno: lança o contrário de cada saída; nada é apagado
    for (const m of d.movimentacoes.filter((x) => x.origem_id === vendaId && x.tipo === 'saida_venda')) {
      d.movimentacoes.push({
        id: novoId(d, 'm'), variacao_id: m.variacao_id, lote_id: m.lote_id, tipo: 'cancelamento_venda',
        quantidade: -m.quantidade, custo_unitario: m.custo_unitario, usuario, data,
        motivo: `Cancelamento da venda nº ${venda.numero}: ${motivo}`, origem_id: vendaId,
      })
    }
    venda.status = 'cancelada'
    venda.motivo_cancelamento = motivo
    venda.cancelada_em = data
    if (venda.nota) venda.nota = { ...venda.nota, status: 'cancelada' }
    setDados(d)
  }, [usuario]) // eslint-disable-line react-hooks/exhaustive-deps

  const reenviarNota = useCallback((vendaId) => {
    setDados((d) => ({ ...d, vendas: d.vendas.map((v) => (v.id === vendaId ? { ...v, nota: { status: 'enviando', ambiente: 'homologacao' } } : v)) }))
    setTimeout(() => {
      setDados((d) => ({ ...d, vendas: d.vendas.map((v) => (v.id === vendaId ? { ...v, nota: { status: 'autorizada', ambiente: 'homologacao' } } : v)) }))
    }, 2000)
  }, [])

  const registrarEntrada = useCallback(({ variacao_id, quantidade, custo, numero_lote, validade, motivo }) => {
    const d = structuredClone(atual.current)
    const v = d.variacoes.find((x) => x.id === variacao_id)
    const produto = d.produtos.find((p) => p.id === v.produto_id)
    const saldo = calcularSaldos(d.movimentacoes).porVariacao.get(v.id) || 0
    let lote_id = null
    if (produto.controla_validade) {
      const existente = d.lotes.find((l) => l.variacao_id === v.id && l.numero === numero_lote && l.validade === validade)
      if (existente) lote_id = existente.id
      else {
        lote_id = novoId(d, 'l')
        d.lotes.push({ id: lote_id, variacao_id: v.id, numero: numero_lote || 'Sem nº', validade })
      }
    }
    d.movimentacoes.push({
      id: novoId(d, 'm'), variacao_id: v.id, lote_id, tipo: 'entrada_compra', quantidade,
      custo_unitario: custo, usuario, data: agoraISO(), motivo: motivo || 'Entrada de mercadoria', origem_id: null,
    })
    v.custo = novoCustoMedio(saldo, v.custo, quantidade, custo)
    setDados(d)
  }, [usuario]) // eslint-disable-line react-hooks/exhaustive-deps

  // Perda, brinde, uso interno, devolução ao fornecedor (saem) ou contagem de inventário (acerta)
  const registrarAjuste = useCallback(({ variacao_id, tipo, quantidade, contado, motivo }) => {
    const d = structuredClone(atual.current)
    const { porVariacao, porLote } = calcularSaldos(d.movimentacoes)
    const v = d.variacoes.find((x) => x.id === variacao_id)
    const data = agoraISO()
    let diferenca = -quantidade
    if (tipo === 'ajuste_inventario') diferenca = contado - (porVariacao.get(v.id) || 0)
    if (diferenca === 0) return { semMudanca: true }
    if (diferenca < 0) {
      d.movimentacoes.push(...saidas(d, porLote, v, -diferenca, { tipo, motivo, data }))
    } else {
      const lotesDaVariacao = d.lotes.filter((l) => l.variacao_id === v.id).sort((a, b) => b.validade.localeCompare(a.validade))
      d.movimentacoes.push({
        id: novoId(d, 'm'), variacao_id: v.id, lote_id: lotesDaVariacao[0]?.id || null, tipo, quantidade: diferenca,
        custo_unitario: v.custo, usuario, data, motivo, origem_id: null,
      })
    }
    setDados(d)
    return { diferenca }
  }, [usuario]) // eslint-disable-line react-hooks/exhaustive-deps

  const criarProduto = useCallback(({ nome, tipo, categoria, marca, empresa_id, preco, custo, estoque_minimo, cores, tamanhos, tonalidades, volume, controla_validade }) => {
    const d = structuredClone(atual.current)
    const produto = { id: novoId(d, 'p'), nome, tipo, categoria, marca, empresa_id, controla_validade, ativo: true }
    d.produtos.push(produto)
    const combinacoes = []
    if (tipo === 'lingerie') {
      for (const cor of cores.length ? cores : [null]) {
        for (const tamanho of tamanhos.length ? tamanhos : [null]) combinacoes.push({ cor, tamanho })
      }
    } else {
      for (const tonalidade of tonalidades.length ? tonalidades : [null]) combinacoes.push({ tonalidade })
    }
    const base = nome.split(/\s+/).map((p) => p[0]).join('').toUpperCase().slice(0, 4)
    for (const c of combinacoes) {
      const id = novoId(d, 'v')
      d.variacoes.push({
        id, produto_id: produto.id,
        sku: [base, c.cor?.slice(0, 2).toUpperCase(), c.tamanho, c.tonalidade?.slice(0, 3).toUpperCase(), id.slice(1)].filter(Boolean).join('-'),
        codigo_barras: '', cor: c.cor || null, tamanho: c.tamanho || null, tonalidade: c.tonalidade || null,
        volume: volume || null, preco, custo, estoque_minimo, ativo: true,
      })
    }
    setDados(d)
    return produto.id
  }, [])

  const criarCliente = useCallback((campos) => {
    const d = structuredClone(atual.current)
    const id = novoId(d, 'c')
    d.clientes.push({
      id, email: '', nascimento: '', observacoes: '', aceita_contato: true,
      preferencias: {}, criado_em: agoraISO(), ...campos,
    })
    setDados(d)
    return id
  }, [])

  // ---------------- Financeiro ----------------
  const abrirCaixa = useCallback((dia, abertura) => {
    setDados((d) => (d.caixas.some((c) => c.dia === dia) ? d : {
      ...d,
      caixas: [...d.caixas, { id: `cx${dia}`, dia, abertura, abertoPor: usuario, lancamentos: [], fechadoEm: null, contado: null, observacao: '' }],
    }))
  }, [usuario])

  const lancarNoCaixa = useCallback((dia, { tipo, valor, motivo }) => {
    setDados((d) => ({
      ...d,
      caixas: d.caixas.map((c) => (c.dia === dia && !c.fechadoEm
        ? { ...c, lancamentos: [...c.lancamentos, { id: idUnico('l'), tipo, valor, motivo, hora: agoraISO(), usuario }] }
        : c)),
    }))
  }, [usuario]) // eslint-disable-line react-hooks/exhaustive-deps

  const fecharCaixa = useCallback((dia, { contado, observacao }) => {
    setDados((d) => ({
      ...d,
      caixas: d.caixas.map((c) => (c.dia === dia ? { ...c, contado, observacao, fechadoEm: agoraISO(), fechadoPor: usuario } : c)),
    }))
  }, [usuario]) // eslint-disable-line react-hooks/exhaustive-deps

  const criarConta = useCallback((campos) => {
    setDados((d) => ({
      ...d,
      contasPagar: [...d.contasPagar, { id: idUnico('cp'), fornecedor: '', observacao: '', pagoEm: null, ...campos }]
        .sort((a, b) => a.vencimento.localeCompare(b.vencimento)),
    }))
  }, [])

  const marcarPaga = useCallback((id, pagoEm) => {
    setDados((d) => ({ ...d, contasPagar: d.contasPagar.map((c) => (c.id === id ? { ...c, pagoEm } : c)) }))
  }, [])

  // ---------------- Excluir com segurança ----------------
  // Devolve 'apagado' ou 'arquivado'
  const excluirProduto = useCallback((id) => {
    const d = atual.current
    if (podeApagarProduto(id, d)) {
      setDados({ ...d, produtos: d.produtos.filter((p) => p.id !== id), variacoes: d.variacoes.filter((v) => v.produto_id !== id) })
      return 'apagado'
    }
    setDados({
      ...d,
      produtos: d.produtos.map((p) => (p.id === id ? { ...p, ativo: false, arquivado_em: agoraISO() } : p)),
      variacoes: d.variacoes.map((v) => (v.produto_id === id ? { ...v, ativo: false } : v)),
    })
    return 'arquivado'
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const reativarProduto = useCallback((id) => {
    setDados((d) => ({
      ...d,
      produtos: d.produtos.map((p) => (p.id === id ? { ...p, ativo: true, arquivado_em: null } : p)),
      variacoes: d.variacoes.map((v) => (v.produto_id === id ? { ...v, ativo: true } : v)),
    }))
  }, [])

  // Devolve 'apagado' ou 'anonimizado' (as compras ficam, sem os dados pessoais)
  const excluirCliente = useCallback((id) => {
    const d = atual.current
    if (podeApagarCliente(id, d)) {
      setDados({ ...d, clientes: d.clientes.filter((c) => c.id !== id) })
      return 'apagado'
    }
    setDados({
      ...d,
      clientes: d.clientes.map((c) => (c.id === id ? {
        ...c, nome: 'Cliente removida', whatsapp: '', email: '', nascimento: '', preferencias: {},
        observacoes: '', aceita_contato: false, removida: true, removida_em: agoraISO(),
      } : c)),
    })
    return 'anonimizado'
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const excluirEncomenda = useCallback((id) => {
    setDados((d) => ({ ...d, encomendas: d.encomendas.filter((e) => e.id !== id) }))
  }, [])

  const excluirConta = useCallback((id) => {
    setDados((d) => ({ ...d, contasPagar: d.contasPagar.filter((c) => c.id !== id) }))
  }, [])

  // ---------------- Encomendas (não mexem no estoque) ----------------
  const criarEncomenda = useCallback((campos) => {
    const id = idUnico('enc')
    setDados((d) => ({ ...d, encomendas: [...(d.encomendas || []), { id, status: 'aguardando', criado_em: agoraISO(), criado_por: usuario, ...campos }] }))
    return id
  }, [usuario]) // eslint-disable-line react-hooks/exhaustive-deps

  const atualizarEncomenda = useCallback((id, campos) => {
    setDados((d) => ({ ...d, encomendas: d.encomendas.map((e) => (e.id === id ? { ...e, ...campos } : e)) }))
  }, [])

  const atualizarConfig = useCallback((campos) => {
    setDados((d) => ({ ...d, config: { ...d.config, ...campos } }))
  }, [])

  const restaurar = useCallback(() => setDados(gerarDadosExemplo()), [])

  return (
    <DemoContext.Provider
      value={{
        dados, saldos, linhas, lotesComSaldo, produtoPorId, variacaoPorId, clientePorId,
        perfil, setPerfil, ehProprietaria, podeVerCustos: ehProprietaria, usuario,
        concluirVenda, cancelarVenda, reenviarNota, registrarEntrada, registrarAjuste,
        criarProduto, atualizarProduto, criarCliente, atualizarConfig, restaurar,
        abrirCaixa, lancarNoCaixa, fecharCaixa, criarConta, marcarPaga,
        criarEncomenda, atualizarEncomenda,
        excluirProduto, reativarProduto, excluirCliente, excluirEncomenda, excluirConta,
      }}
    >
      {children}
    </DemoContext.Provider>
  )
}

export const useDemo = () => useContext(DemoContext)
