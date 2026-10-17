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
  'Failed to fetch': 'Sem conexão com a internet. Confira o Wi-Fi ou os dados do celular.',
  'Somente': null, // mensagens do nosso banco já vêm em português
  'new row for relation': 'Algum valor está fora do limite permitido. Confira os números e o tamanho dos textos.',
  'duplicate key value': 'Isso já está cadastrado (nome ou código repetido).',
  'update or delete on table': 'Não dá para apagar: já tem histórico ligado a isso.'
}

export function traduzirErro(erro) {
  const msg = erro?.message || String(erro || '')
  const encontrada = Object.keys(traducoes).find((k) => msg.startsWith(k))
  return (encontrada && traducoes[encontrada]) || msg || 'Algo deu errado. Tente de novo.'
}
