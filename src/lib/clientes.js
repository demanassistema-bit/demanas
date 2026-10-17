// Regras de clientes e encomendas usadas pelas telas.
// Quem decide de verdade é o banco (supabase/migrations/06_clientes.sql); aqui é para mostrar antes.
import { arred } from './moeda.js'
import { diasDesde } from './datas.js'
import { erroData, erroWhatsApp, LIMITE, limparTexto, numeroWhatsApp, TAMANHO } from './limites.js'

export const ORIGENS = { loja: 'Na loja', instagram: 'Instagram', whatsapp: 'WhatsApp', indicacao: 'Indicação', outro: 'Outro' }
export const SEGMENTOS = { todas: 'Todas', aniversario: 'Aniversariantes do mês', sumidas: 'Sem comprar há 60 dias', melhores: 'Melhores clientes' }
export const DIAS_SUMIDA = 60
export const QTD_MELHORES = 5

export const aniversarioNoMes = (nascimento, mes) => Boolean(nascimento) && Number(nascimento.slice(5, 7)) === mes

// clientes: [{ nome, nascimento, total, ultima_compra }] → só as do segmento, já na ordem certa
export function segmentar(clientes, segmento, mes) {
  if (segmento === 'aniversario') {
    return clientes.filter((c) => aniversarioNoMes(c.nascimento, mes)).sort((a, b) => a.nascimento.slice(8).localeCompare(b.nascimento.slice(8)))
  }
  if (segmento === 'sumidas') {
    return clientes.filter((c) => c.ultima_compra && diasDesde(c.ultima_compra) > DIAS_SUMIDA)
      .sort((a, b) => a.ultima_compra.localeCompare(b.ultima_compra))
  }
  if (segmento === 'melhores') {
    return clientes.filter((c) => c.total > 0).sort((a, b) => b.total - a.total).slice(0, QTD_MELHORES)
  }
  return [...clientes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

export const MENSAGENS = {
  novidades: (nome) => `Oi, ${nome}! Chegou coleção nova na deMana's e lembrei de você. Posso te mostrar?`,
  aniversario: (nome) => `Oi, ${nome}! Feliz aniversário! 🌹 Preparamos um mimo especial para você aqui na deMana's. Passa para ver?`,
  saudade: (nome) => `Oi, ${nome}! Faz tempo que você não aparece por aqui. Chegaram novidades que têm a sua cara. Quer que eu mande fotos?`,
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Formulário da cliente → { cliente } pronto para o banco, ou { erro }
//   outras: as demais clientes (para avisar WhatsApp repetido)
export function montarCliente(f, { hoje, outras = [] }) {
  const nome = limparTexto(f.nome)
  if (nome.length < 2) return { erro: 'Informe o nome.' }
  if (nome.length > TAMANHO.nome) return { erro: `O nome passa de ${TAMANHO.nome} letras.` }
  const erroZap = erroWhatsApp(outras.filter((c) => !c.removida_em), f.whatsapp || '')
  if (erroZap) return { erro: erroZap }
  const email = limparTexto(f.email).toLowerCase()
  if (email && (!EMAIL.test(email) || email.length > TAMANHO.email)) return { erro: 'E-mail incompleto: confira o @ e o final (.com, .com.br).' }
  const erroNascimento = erroData(f.nascimento, { rotulo: 'o aniversário', max: hoje, obrigatoria: false })
  if (erroNascimento) return { erro: erroNascimento }
  const preferencias = Object.fromEntries(['sutia', 'calcinha', 'tom_pele', 'tipo_pele']
    .map((k) => [k, limparTexto(f[k]).slice(0, TAMANHO.preferencia)]).filter(([, v]) => v))
  return {
    cliente: {
      nome,
      whatsapp: numeroWhatsApp(f.whatsapp) || null,
      email: email || null,
      nascimento: f.nascimento || null,
      origem: f.origem || null,
      observacoes: limparTexto(f.observacoes).slice(0, TAMANHO.observacao) || null,
      preferencias,
      aceita_contato: Boolean(f.aceita_contato),
    },
  }
}

// ---------------- Encomendas ----------------
// Encomenda NÃO mexe no estoque: é um pedido da cliente esperando a peça chegar.
export const FILTROS_ENCOMENDA = { abertas: 'Em aberto', atrasadas: 'Atrasadas', chegou: 'Chegaram', entregue: 'Entregues', cancelada: 'Canceladas' }
export const emAberto = (e) => e.status === 'aguardando' || e.status === 'chegou'
export const atrasada = (e, hoje) => e.status === 'aguardando' && Boolean(e.previsao) && e.previsao < hoje

export function filtrarEncomendas(encomendas, filtro, hoje) {
  if (filtro === 'abertas') return encomendas.filter(emAberto)
  if (filtro === 'atrasadas') return encomendas.filter((e) => atrasada(e, hoje))
  return encomendas.filter((e) => e.status === filtro)
}

// As que chegaram (avisar a cliente) primeiro, depois pela data prevista
export const ordemEncomendas = (a, b) => (b.status === 'chegou') - (a.status === 'chegou')
  || (a.previsao || '9999').localeCompare(b.previsao || '9999')

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

// Encomendas esperando uma peça (para avisar quando ela entra no estoque)
export const encomendasDaVariacao = (encomendas, variacaoId) =>
  encomendas.filter((e) => e.status === 'aguardando' && e.itens.some((i) => i.variacao_id === variacaoId))

// Texto de um item da encomenda (do catálogo ou descrito à mão)
export function textoItem(item, linhaPorId) {
  if (item.descricao) return `${item.quantidade}x ${item.descricao}`
  const l = linhaPorId.get(item.variacao_id)
  return l ? `${item.quantidade}x ${l.produto.nome} (${l.nomeVariacao})` : `${item.quantidade}x peça`
}

export function mensagemChegou(cliente, encomenda, linhaPorId) {
  const nome = cliente?.nome.split(' ')[0] || ''
  const itens = encomenda.itens.map((i) => textoItem(i, linhaPorId)).join(', ')
  return `Oi, ${nome}! Sua encomenda chegou aqui na deMana's: ${itens}. 🌹 Quando quer vir buscar?`
}

// Peças da encomenda: soma a mesma peça do catálogo em vez de repetir a linha
export function juntarItem(itens, novo) {
  const igual = novo.variacao_id ? itens.findIndex((x) => x.variacao_id === novo.variacao_id) : -1
  if (igual >= 0) {
    return { itens: itens.map((x, j) => (j === igual ? { ...x, quantidade: Math.min(x.quantidade + novo.quantidade, LIMITE.quantidadeItem) } : x)) }
  }
  if (itens.length >= LIMITE.itensEncomenda) return { itens, erro: `Até ${LIMITE.itensEncomenda} peças diferentes por encomenda. Faça outra encomenda para o resto.` }
  return { itens: [...itens, novo] }
}

// Sinal na entrega: abate primeiro a primeira parte da venda, o que sobrar vai para a segunda.
// Se o sinal passar do total, a sobra é devolvida à cliente.
//   totais: [total de cada parte] → { usado: [sinal em cada parte], sobra }
export function sinalPorParte(totais, sinal) {
  let resta = arred(sinal || 0)
  const usado = totais.map((t) => {
    const v = arred(Math.min(resta, t))
    resta = arred(resta - v)
    return v
  })
  return { usado, sobra: resta }
}
