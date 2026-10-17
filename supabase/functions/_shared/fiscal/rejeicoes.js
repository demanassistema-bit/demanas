// Motivos de rejeição da SEFAZ em linguagem simples (os mais comuns na NFC-e de varejo).
// O texto original fica guardado junto, para a contadora.

const TRADUCOES = {
  204: 'Esta nota já tinha sido enviada antes (número repetido). O sistema vai consultar a nota em vez de enviar de novo.',
  213: 'O CNPJ do emitente não confere com o certificado digital. Confira o CNPJ em Dados fiscais.',
  215: 'A nota saiu com um erro de formato. Avise quem cuida do sistema.',
  225: 'A nota saiu com um erro de formato. Avise quem cuida do sistema.',
  280: 'O certificado digital não é válido. Confira com a contadora.',
  281: 'O certificado digital venceu. Renove o certificado A1 e informe a nova validade em Dados fiscais.',
  301: 'A situação do CNPJ na SEFAZ não permite emitir (irregularidade do emitente). Fale com a contadora.',
  386: 'A forma de pagamento informada não é aceita para este tipo de nota. Fale com a contadora.',
  539: 'Já existe outra nota com este número, com dados diferentes. Avise quem cuida do sistema.',
  704: 'A data da nota está atrasada demais para a SEFAZ. Reenvie hoje; se repetir, fale com a contadora.',
  717: 'Nota de consumidor não pode ter CNPJ de empresa como compradora. Para empresa, é NF-e: fale com a contadora.',
  778: 'O NCM de algum produto não existe na tabela oficial. Corrija o NCM da categoria em Dados fiscais.',
  805: 'A SEFAZ recusou o CPF da consumidora. Confira os números ou emita sem CPF.',
  868: 'Faltou informar dados do pagamento com cartão. Avise quem cuida do sistema.',
  999: 'Erro interno na SEFAZ. O sistema tenta de novo sozinho.',
}

export function traduzirRejeicao(codigo, mensagem = '') {
  const n = Number(String(codigo || '').replace(/\D/g, '')) || null
  if (n && TRADUCOES[n]) return TRADUCOES[n]
  return mensagem
    ? `A SEFAZ recusou a nota: "${mensagem}". Mostre esta mensagem para a contadora.`
    : 'A nota não foi autorizada e a SEFAZ não disse o motivo. O sistema tenta de novo; se repetir, fale com a contadora.'
}

// Códigos que valem tentar de novo sozinho (instabilidade, não erro de dado)
export const tentarDeNovo = (codigo) => [108, 109, 999].includes(Number(codigo))
