import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, traduzirErro } from '../lib/supabase'
import { useAuth } from './AuthContext'

// Clientes de verdade (Etapa 5): ficha, resumo de compras e encomendas.
// O resumo (compras, total, última compra) vem da view resumo_clientes, calculada pelo banco.
export const ClientesContext = createContext(null)

export function ClientesProvider({ children }) {
  const { session } = useAuth()
  const [clientes, setClientes] = useState([])
  const [encomendas, setEncomendas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const recarregar = useCallback(async () => {
    if (!session) return
    const [cli, res, enc] = await Promise.all([
      supabase.from('clientes').select('*').order('nome'),
      supabase.from('resumo_clientes').select('*'),
      supabase.from('encomendas').select('*, encomenda_itens(*), vendas(id, numero)').order('criado_em', { ascending: false }).limit(2000),
    ])
    const falha = [cli, res, enc].find((r) => r.error)
    if (falha) {
      setErro(traduzirErro(falha.error))
      setCarregando(false)
      return
    }
    const resumo = new Map(res.data.map((r) => [r.cliente_id, r]))
    setErro('')
    setClientes(cli.data.map((c) => ({
      ...c,
      compras: resumo.get(c.id)?.compras || 0,
      total: Number(resumo.get(c.id)?.total || 0),
      ultima_compra: resumo.get(c.id)?.ultima_compra || null,
    })))
    setEncomendas(enc.data.map(({ encomenda_itens: itens, ...e }) => ({ ...e, itens, sinal_valor: e.sinal_valor == null ? null : Number(e.sinal_valor) })))
    setCarregando(false)
  }, [session])

  useEffect(() => { recarregar() }, [recarregar])

  // ao voltar para a aba, busca de novo (outra pessoa pode ter mudado algo)
  useEffect(() => {
    const aoVoltar = () => { if (document.visibilityState === 'visible') recarregar() }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => document.removeEventListener('visibilitychange', aoVoltar)
  }, [recarregar])

  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes])
  const ativas = useMemo(() => clientes.filter((c) => !c.removida_em), [clientes])

  // Executa uma ação no banco e recarrega. Devolve { erro } com a mensagem em português.
  const acao = useCallback(async (promessa, traduzir) => {
    const { data, error } = await promessa
    if (error) return { erro: (traduzir && traduzir(error)) || traduzirErro(error) }
    await recarregar()
    return { data }
  }, [recarregar])

  const zapRepetido = (error) => (error.code === '23505' ? 'Esse WhatsApp já é de uma cliente cadastrada. Busque por ela em vez de cadastrar de novo.' : null)

  const valor = {
    clientes, ativas, encomendas, carregando, erro, recarregar, clientePorId,

    criarCliente: (cliente) => acao(supabase.from('clientes').insert(cliente).select().single(), zapRepetido),
    atualizarCliente: (id, campos) => acao(supabase.from('clientes').update(campos).eq('id', id), zapRepetido),
    // 'apagada' (sem histórico) ou 'anonimizada' (com compras ou encomendas: LGPD)
    excluirCliente: (id) => acao(supabase.rpc('excluir_cliente', { p_cliente: id })),

    salvarEncomenda: (encomenda) => acao(supabase.rpc('salvar_encomenda', { p: encomenda })),
    atualizarEncomenda: (id, campos) => acao(supabase.from('encomendas').update(campos).eq('id', id)),
    excluirEncomenda: (id) => acao(supabase.from('encomendas').delete().eq('id', id)),
  }

  return <ClientesContext.Provider value={valor}>{children}</ClientesContext.Provider>
}

export const useClientes = () => useContext(ClientesContext)
