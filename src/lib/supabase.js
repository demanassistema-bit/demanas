import { createClient } from '@supabase/supabase-js'

// Endereço e chave pública do projeto deManas (a chave pública pode ir para o navegador:
// quem protege os dados são as regras do banco, RLS). A chave secreta nunca entra aqui.
const url = import.meta.env.VITE_SUPABASE_URL
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configurado = Boolean(url && chave)

// Links de convite e de nova senha chegam como #access_token=...&type=invite.
// Guardamos o tipo ANTES do Supabase limpar o endereço.
const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
export const linkDeAcesso = {
  tipo: hash.get('type'), // 'invite' | 'recovery' | null
  erro: hash.get('error_description')?.replace(/\+/g, ' ') || null,
}
if (linkDeAcesso.erro) history.replaceState(null, '', window.location.pathname)

export const supabase = configurado
  ? createClient(url, chave, { auth: { persistSession: true, detectSessionInUrl: true } })
  : null

const traducoes = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'Email not confirmed': 'Seu e-mail ainda não foi confirmado. Use o link do convite.',
  'New password should be different from the old password.': 'A nova senha precisa ser diferente da anterior.',
  'Password should be at least': 'A senha precisa ter pelo menos 8 caracteres.',
  'For security purposes, you can only request this after': 'Por segurança, espere alguns segundos antes de pedir de novo.',
  'Email link is invalid or has expired': 'Este link expirou ou já foi usado. Peça um novo.',
  'Email rate limit exceeded': 'Muitos e-mails enviados em pouco tempo. Espere uma hora e tente de novo.',
  'Failed to fetch': 'Não consegui falar com o sistema agora. Se a sua internet está funcionando, avise a Bruna.',
  'Somente': null, // mensagens do nosso banco já vêm em português
  'new row for relation': 'Algum valor está fora do limite permitido. Confira os números e o tamanho dos textos.',
  'duplicate key value': 'Isso já está cadastrado (nome ou código repetido).',
  'update or delete on table': 'Não dá para apagar: já tem histórico ligado a isso.'
}

// O Supabase devolve no máximo 1000 linhas por pedido. Para listas que crescem (estoque, clientes,
// contas), busca página por página até acabar. `consulta` cria a consulta de novo a cada página
// e precisa de uma ordem fixa (por id), senão uma página pode repetir ou pular linhas.
export async function buscarTudo(consulta, porPagina = 1000) {
  const todas = []
  for (let de = 0; ; de += porPagina) {
    const { data, error } = await consulta().range(de, de + porPagina - 1)
    if (error) return { data: null, error }
    todas.push(...data)
    if (data.length < porPagina) return { data: todas, error: null }
  }
}

export function traduzirErro(erro) {
  const msg = erro?.message || String(erro || '')
  const encontrada = Object.keys(traducoes).find((k) => msg.startsWith(k))
  return (encontrada && traducoes[encontrada]) || msg || 'Algo deu errado. Tente de novo.'
}
