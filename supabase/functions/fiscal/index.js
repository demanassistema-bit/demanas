// Edge Function "fiscal": processa a fila de notas com o serviço de emissão de verdade.
// Ainda NÃO publicada: só depois que as irmãs aprovarem o serviço (Focus NFe).
//
//   POST /fiscal/processar   → chamada a cada minuto pelo agendador (cabeçalho x-chave-fiscal)
//   POST /fiscal/retorno     → aviso da Focus quando uma nota muda (?chave=...); consulta e grava
//
// Segredos (supabase secrets set ...), nunca no código nem no GitHub:
//   FOCUS_TOKEN          token de homologação da Focus NFe
//   FISCAL_CHAVE         senha combinada com o agendador e o aviso da Focus
//   SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem em toda Edge Function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { processarFila } from '../_shared/fiscal/processar.js'
import { criarSimulado } from '../_shared/fiscal/simulado.js'
import { criarFocus } from '../_shared/fiscal/focus.js'

const banco = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const CHAVE = Deno.env.get('FISCAL_CHAVE')

const provedores = {}
function provedorPara(nome) {
  if (!provedores[nome]) {
    provedores[nome] = nome === 'focus'
      ? criarFocus({ token: Deno.env.get('FOCUS_TOKEN'), ambiente: 'homologacao' })
      : criarSimulado()
  }
  return provedores[nome]
}

const pegar = async (limite) => {
  const { data, error } = await banco.rpc('pegar_fila_fiscal', { p_limite: limite })
  if (error) throw error
  return data
}
const registrar = async (id, retorno) => {
  const { error } = await banco.rpc('registrar_retorno_fiscal', { p_doc: id, p: retorno })
  if (error) console.error('registrar', id, error.message)
}

const resposta = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const chave = req.headers.get('x-chave-fiscal') || url.searchParams.get('chave')
  if (!CHAVE || chave !== CHAVE) return resposta({ erro: 'não autorizado' }, 401)

  try {
    if (url.pathname.endsWith('/processar')) {
      return resposta(await processarFila({ pegar, registrar, provedorPara, limite: 20 }))
    }
    if (url.pathname.endsWith('/retorno')) {
      // o aviso só diz que algo mudou: a nota volta para a fila e é consultada no próximo ciclo
      return resposta(await processarFila({ pegar, registrar, provedorPara, limite: 20 }))
    }
    return resposta({ erro: 'caminho desconhecido' }, 404)
  } catch (erro) {
    console.error(erro)
    return resposta({ erro: 'falha ao processar' }, 500)
  }
})
