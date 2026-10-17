import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, traduzirErro } from '../lib/supabase'
import { descreverVariacao } from '../lib/catalogo'
import { useAuth } from './AuthContext'

// Catálogo de verdade (Etapa 2): CNPJs, categorias, marcas, fornecedores, produtos e variações.
// O custo só vem para quem pode ver custos (o banco não entrega para os outros).
export const CatalogoContext = createContext(null)

const vazio = { empresas: {}, categorias: [], marcas: [], fornecedores: [], perfisFiscais: {}, produtos: [], kitItens: [], custos: new Map() }

export function CatalogoProvider({ children }) {
  const { session, permissoes } = useAuth()
  const [dados, setDados] = useState(vazio)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const podeVerCustos = Boolean(permissoes.pode_ver_custos)

  const recarregar = useCallback(async () => {
    if (!session) return
    const [emp, cat, mar, forn, fisc, prod, kits, cust] = await Promise.all([
      supabase.from('empresas').select('*').order('id'),
      supabase.from('categorias').select('*').order('nome'),
      supabase.from('marcas').select('*').order('nome'),
      supabase.from('fornecedores').select('*').order('nome'),
      supabase.from('perfis_fiscais').select('*'),
      supabase.from('produtos').select('*, variacoes(*)').order('nome'),
      supabase.from('kit_itens').select('*'),
      podeVerCustos ? supabase.from('custos_variacao').select('variacao_id, custo_medio') : Promise.resolve({ data: [] }),
    ])
    const falha = [emp, cat, mar, forn, fisc, prod, kits, cust].find((r) => r.error)
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

  // Cada variação pronta para busca e escolha (mesmo formato do seletor de peças)
  const linhas = useMemo(() => dados.produtos.flatMap((p) => p.variacoes.map((v) => ({
    ...v,
    produto: { ...p, marca: marcaPorId.get(p.marca_id)?.nome || '', categoria: categoriaPorId.get(p.categoria_id)?.nome || '' },
    nomeVariacao: descreverVariacao(v),
    sku: v.codigo_interno,
    preco: Number(v.preco_venda),
    custo: dados.custos.get(v.id),
    saldo: null, // o estoque de verdade chega na Etapa 3
    variacao_ativa: v.ativo, // a variação em si (fora de linha ou não)
    ativo: v.ativo && p.ativo, // pode ser vendida agora
  }))), [dados.produtos, dados.custos, marcaPorId, categoriaPorId])

  // Executa uma ação no banco e recarrega. Devolve { erro } com a mensagem em português.
  const acao = useCallback(async (promessa) => {
    const { data, error } = await promessa
    if (error) return { erro: traduzirErro(error) }
    await recarregar()
    return { data }
  }, [recarregar])

  const valor = {
    ...dados, carregando, erro, recarregar, podeVerCustos, linhas, categoriaPorId, marcaPorId, produtoPorId,

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
  }

  return <CatalogoContext.Provider value={valor}>{children}</CatalogoContext.Provider>
}

export const useCatalogo = () => useContext(CatalogoContext)
