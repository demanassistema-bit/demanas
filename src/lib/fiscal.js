// Regras de tela da nota fiscal: dados fiscais por categoria e o aviso do certificado.
// O envio e a conferência da nota ficam em supabase/functions/_shared/fiscal (mesmo código do servidor).

export const CAMPOS_PERFIL_FISCAL = {
  ncm: { nome: 'NCM', ajuda: '8 números', digitos: 8, valido: (v) => /^\d{8}$/.test(v) },
  cest: { nome: 'CEST', ajuda: '7 números, quando houver', digitos: 7, valido: (v) => !v || /^\d{7}$/.test(v), opcional: true },
  origem: { nome: 'Origem', ajuda: '1 número (0 a 8)', digitos: 1, valido: (v) => /^[0-8]$/.test(v) },
  cfop: { nome: 'CFOP', ajuda: '4 números', digitos: 4, valido: (v) => /^\d{4}$/.test(v) },
  csosn: { nome: 'CSOSN ou CST', ajuda: '2 ou 3 números', digitos: 3, valido: (v) => /^\d{2,3}$/.test(v) },
}

// O banco guarda CSOSN/CST na coluna csosn_ou_cst; a tela chama de csosn
const DO_BANCO = { ncm: 'ncm', cest: 'cest', origem: 'origem', cfop: 'cfop', csosn: 'csosn_ou_cst' }

// Lista do que falta (ou está em formato errado) num perfil fiscal (aceita o formato da tela ou do banco)
export function faltasPerfilFiscal(perfil = {}) {
  const faltas = []
  for (const [chave, campo] of Object.entries(CAMPOS_PERFIL_FISCAL)) {
    const valor = String(perfil[chave] ?? perfil[DO_BANCO[chave]] ?? '').replace(/\D/g, '')
    if (!valor && campo.opcional) continue
    if (!campo.valido(valor)) faltas.push(campo.nome)
  }
  if (!perfil.validado) faltas.push('validação da contadora')
  return faltas
}

// Alerta do certificado A1: 60, 30 e 15 dias
export function situacaoCertificado(validade, hoje) {
  if (!validade) return { tom: 'vinho', texto: 'Validade do certificado não informada' }
  const dias = Math.round((new Date(`${validade}T00:00:00`) - new Date(`${hoje}T00:00:00`)) / 86400000)
  if (dias < 0) return { dias, tom: 'vinho', texto: `Certificado vencido há ${-dias} dias` }
  if (dias <= 15) return { dias, tom: 'vinho', texto: `Certificado vence em ${dias} dias` }
  if (dias <= 30) return { dias, tom: 'ambar', texto: `Certificado vence em ${dias} dias` }
  if (dias <= 60) return { dias, tom: 'oliva', texto: `Certificado vence em ${dias} dias` }
  return { dias, tom: null, texto: `Certificado válido por mais ${dias} dias` }
}

// Texto do cupom para mandar por WhatsApp
export function textoCupom(nota) {
  const d = nota.documento
  const linhas = [
    `deMana's · NFC-e nº ${String(nota.numero).padStart(6, '0')} série ${nota.serie}${nota.provedor === 'simulado' ? ' (TESTE, sem valor fiscal)' : ''}`,
    ...d.itens.map((i) => `${i.quantidade}x ${i.descricao}`),
    `Total: R$ ${Number(d.venda.total).toFixed(2).replace('.', ',')}`,
    nota.chave ? `Chave de acesso: ${nota.chave.replace(/(\d{4})/g, '$1 ').trim()}` : null,
    nota.qrcode_url ? `Consulte: ${nota.qrcode_url}` : null,
  ]
  return linhas.filter(Boolean).join('\n')
}
