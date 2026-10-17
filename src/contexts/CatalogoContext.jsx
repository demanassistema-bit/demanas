import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { buscarTudo, supabase, traduzirErro } from '../lib/supabase'
import { descreverVariacao } from '../lib/catalogo'
import { saldoDoKit } from '../lib/estoque'
import { useAuth } from './AuthContext'

// Catálogo de verdade (Etapa 2): CNPJs, categorias, marcas, fornecedores, produtos e variações.
// O custo só vem para quem pode ver custos (o banco não entrega para os outros).
// Estoque (Etapa 3): os saldos vêm do livro do estoque, somados pelo banco.
// Vendas (Etapa 4): parâmetros de venda e, para quem vê custos, as taxas da maquininha.
export const CatalogoContext = createContext(null)

const vazio = { empresas: {}, categorias: [], marcas: [], fornecedores: [], perfisFiscais: {}, produtos: [], kitItens: [], custos: new Map(), baldes: [], parametros: {}, taxas: {} }

export function CatalogoProvider({ children }) {
  const { session, permissoes } = useAuth()
  const [dados, setDados] = useState(vazio)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const podeVerCustos = Boolean(permissoes.pode_ver_custos)

  const recarregar = useCallback(async () => {
    if (!session) return
    const [emp, cat, mar, forn, fisc, prod, kits, cust, est, par, tax] = await Promise.all([
      supabase.from('empresas').select('*').order('id'),
      // listas que crescem: em páginas de 1000 (limite do Supabase por pedido)
      buscarTudo(() => supabase.from('categorias').select('*').order('nome').order('id')),
      buscarTudo(() => supabase.from('marcas').select('*').order('nome').order('id')),
      buscarTudo(() => supabase.from('fornecedores').select('*').order('nome').order('id')),
      buscarTudo(() => supabase.from('perfis_fiscais').select('*').order('categoria_id')),
      buscarTudo(() => supabase.from('produtos').select('*, variacoes(*)').order('nome').order('id')),
      buscarTudo(() => supabase.from('kit_itens').select('*').order('kit_variacao_id').order('componente_variacao_id')),
      podeVerCustos ? buscarTudo(() => supabase.from('custos_variacao').select('variacao_id, custo_medio').order('variacao_id')) : Promise.resolve({ data: [] }),
      buscarTudo(() => supabase.from('estoque_por_lote').select('*').order('variacao_id').order('lote_id')),
      supabase.from('parametros').select('chave, valor'),
      podeVerCustos ? supabase.from('taxas_pagamento').select('empresa_id, tipo, percentual') : Promise.resolve({ data: [] }),
    ])
    const falha = [emp, cat, mar, forn, fisc, prod, kits, cust, est, par, tax].find((r) => r.error)
    if (falha) {
      setErro(traduzirErro(falha.error))
      setCarregando(false)
      return
    }
    setErro('')
    setDados({
      empresas: Object.fromEntries(emp.data.map((e) => [e.id, e])),
      categorias: cat.data,
      marcas: mar.data,
      fornecedores: forn.data,
      perfisFiscais: Object.fromEntries(fisc.data.map((p) => [p.categoria_id, p])),
      produtos: prod.data.map((p) => ({
        ...p,
        variacoes: [...(p.variacoes || [])].sort((a, b) => descreverVariacao(a).localeCompare(descreverVariacao(b), 'pt-BR', { numeric: true })),
      })),
      kitItens: kits.data,
      custos: new Map(cust.data.map((c) => [c.variacao_id, Number(c.custo_medio)])),
      baldes: est.data.filter((b) => b.saldo !== 0),
      parametros: Object.fromEntries(par.data.map((p) => [p.chave, p.valor])),
      // { day: { pix: 0, debito: 1.99, ... }, fe: {...} }
      taxas: tax.data.reduce((acc, x) => ({ ...acc, [x.empresa_id]: { ...acc[x.empresa_id], [x.tipo]: Number(x.percentual) } }), {}),
    })
    setCarregando(false)
  }, [session, podeVerCustos])

  useEffect(() => { recarregar() }, [recarregar])

  // ao voltar para a aba, busca de novo (outra pessoa pode ter mudado algo)
  useEffect(() => {
    const aoVoltar = () => { if (document.visibilityState === 'visible') recarregar() }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => document.removeEventListener('visibilitychange', aoVoltar)
  }, [recarregar])

  const categoriaPorId = useMemo(() => new Map(dados.categorias.map((c) => [c.id, c])), [dados.categorias])
  const marcaPorId = useMemo(() => new Map(dados.marcas.map((m) => [m.id, m])), [dados.marcas])
  const produtoPorId = useMemo(() => new Map(dados.produtos.map((p) => [p.id, p])), [dados.produtos])

  const saldoPorVariacao = useMemo(() => {
    const mapa = new Map()
    for (const b of dados.baldes) mapa.set(b.variacao_id, (mapa.get(b.variacao_id) || 0) + b.saldo)
    return mapa
  }, [dados.baldes])
  // Lotes com saldo, com validade (para os avisos de vencimento)
  const lotesComSaldo = useMemo(() => dados.baldes.filter((b) => b.lote_id && b.saldo > 0), [dados.baldes])

  // Cada variação pronta para busca e escolha (mesmo formato do seletor de peças)
  const linhas = useMemo(() => dados.produtos.flatMap((p) => p.variacoes.map((v) => ({
    ...v,
    produto: { ...p, marca: marcaPorId.get(p.marca_id)?.nome || '', categoria: categoriaPorId.get(p.categoria_id)?.nome || '' },
    nomeVariacao: descreverVariacao(v),
    sku: v.codigo_interno,
    preco: Number(v.preco_venda),
    custo: dados.custos.get(v.id),
    saldo: p.tipo === 'kit'
      ? saldoDoKit(dados.kitItens.filter((k) => k.kit_variacao_id === v.id), saldoPorVariacao)
      : saldoPorVariacao.get(v.id) || 0,
    variacao_ativa: v.ativo, // a variação em si (fora de linha ou não)
    ativo: v.ativo && p.ativo, // pode ser vendida agora
  }))), [dados.produtos, dados.custos, dados.kitItens, saldoPorVariacao, marcaPorId, categoriaPorId])

  // Executa uma ação no banco e recarrega. Devolve { erro } com a mensagem em português.
  const acao = useCallback(async (promessa) => {
    const { data, error } = await promessa
    if (error) return { erro: traduzirErro(error) }
    await recarregar()
    return { data }
  }, [recarregar])

  const valor = {
    ...dados, carregando, erro, recarregar, podeVerCustos, linhas, categoriaPorId, marcaPorId, produtoPorId,
    saldoPorVariacao, lotesComSaldo,
    baldesDa: (variacaoId) => dados.baldes.filter((b) => b.variacao_id === variacaoId),

    salvarProdutos: (lista) => acao(supabase.rpc('salvar_produtos', { p_produtos: lista })),
    atualizarProduto: (id, campos) => acao(supabase.from('produtos').update(campos).eq('id', id)),
    atualizarVariacao: (id, campos) => acao(supabase.from('variacoes').update(campos).eq('id', id)),
    atualizarCusto: (variacaoId, custo) => acao(supabase.from('custos_variacao').upsert({ variacao_id: variacaoId, custo_medio: custo })),
    async adicionarVariacoes(produtoId, variacoes) {
      const { data, error } = await supabase.from('variacoes')
        .insert(variacoes.map(({ custo, ...v }) => ({ ...v, produto_id: produtoId }))) // eslint-disable-line no-unused-vars
        .select('id')
      if (error) return { erro: traduzirErro(error) }
      if (podeVerCustos) {
        await supabase.from('custos_variacao').insert(data.map((d, i) => ({ variacao_id: d.id, custo_medio: variacoes[i].custo || 0 })))
      }
      await recarregar()
      return { data }
    },
    // Apaga de vez quando não há histórico; se o banco recusar por ter histórico, arquiva
    async excluirProduto(id) {
      const { error } = await supabase.from('produtos').delete().eq('id', id)
      if (!error) { await recarregar(); return { resultado: 'apagado' } }
      if (error.code !== '23503') return { erro: traduzirErro(error) }
      const r = await acao(supabase.from('produtos').update({ ativo: false, arquivado_em: new Date().toISOString() }).eq('id', id))
      return r.erro ? r : { resultado: 'arquivado' }
    },
    arquivarProduto: (id) => acao(supabase.from('produtos').update({ ativo: false, arquivado_em: new Date().toISOString() }).eq('id', id)),
    reativarProduto: (id) => acao(supabase.from('produtos').update({ ativo: true, arquivado_em: null }).eq('id', id)),

    salvarKitItem: (kitId, componenteId, quantidade) => acao(supabase.from('kit_itens').upsert({ kit_variacao_id: kitId, componente_variacao_id: componenteId, quantidade })),
    removerKitItem: (kitId, componenteId) => acao(supabase.from('kit_itens').delete().eq('kit_variacao_id', kitId).eq('componente_variacao_id', componenteId)),

    async garantirCategoria(nome) {
      const existente = dados.categorias.find((c) => c.nome.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'))
      if (existente) return { data: existente }
      const r = await supabase.from('categorias').insert({ nome }).select().single()
      if (r.error) return { erro: traduzirErro(r.error) }
      await recarregar()
      return { data: r.data }
    },
    async garantirMarca(nome) {
      const existente = dados.marcas.find((m) => m.nome.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'))
      if (existente) return { data: existente }
      const r = await supabase.from('marcas').insert({ nome }).select().single()
      if (r.error) return { erro: traduzirErro(r.error) }
      await recarregar()
      return { data: r.data }
    },

    salvarFornecedor: (f) => acao(f.id ? supabase.from('fornecedores').update(f).eq('id', f.id) : supabase.from('fornecedores').insert(f)),
    salvarPerfilFiscal: (categoriaId, campos) => acao(supabase.from('perfis_fiscais').upsert({ categoria_id: categoriaId, ...campos })),
    atualizarEmpresa: (id, campos) => acao(supabase.from('empresas').update(campos).eq('id', id)),

    // Estoque: tudo passa pelas funções do banco (o livro não aceita escrita direta)
    registrarEntrada: (entrada) => acao(supabase.rpc('registrar_entrada', { p: entrada })),
    registrarSaida: ({ variacaoId, tipo, quantidade, motivo, loteId }) => acao(supabase.rpc('registrar_saida', {
      p_variacao: variacaoId, p_tipo: tipo, p_quantidade: quantidade, p_motivo: motivo, p_lote: loteId || null,
    })),
    corrigirSaldo: (variacaoId, contado, motivo) => acao(supabase.rpc('corrigir_saldo', { p_variacao: variacaoId, p_contado: contado, p_motivo: motivo })),

    // Vendas: parâmetros, taxas e categoria de higiene (só proprietárias)
    salvarParametro: (chave, valor) => acao(supabase.from('parametros').upsert({ chave, valor })),
    salvarTaxa: (empresaId, tipo, percentual) => acao(supabase.from('taxas_pagamento').update({ percentual }).eq('empresa_id', empresaId).eq('tipo', tipo)),
    marcarHigiene: (categoriaId, naoVolta) => acao(supabase.from('categorias').update({ nao_volta_ao_estoque: naoVolta }).eq('id', categoriaId)),
  }

  return <CatalogoContext.Provider value={valor}>{children}</CatalogoContext.Provider>
}

export const useCatalogo = () => useContext(CatalogoContext)
