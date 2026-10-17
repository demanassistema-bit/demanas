// Chave de acesso da NFC-e (44 números) e o dígito verificador (módulo 11).
// Usada pelo serviço simulado e para conferir a chave que o serviço de verdade devolve.

// Código IBGE de cada estado (os 2 primeiros números da chave)
export const CODIGO_UF = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24',
  PB: '25', PE: '26', AL: '27', SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42',
  RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
}

// Dígito verificador: pesos 2 a 9 da direita para a esquerda; resto 0 ou 1 → 0
export function digitoChave(numeros43) {
  let soma = 0
  let peso = 2
  for (let i = numeros43.length - 1; i >= 0; i--) {
    soma += Number(numeros43[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

// uf (sigla), data (Date), cnpj (14 números), modelo 65, série, número, tipo de emissão 1 (normal), código de 8 números
export function montarChave({ uf, data, cnpj, modelo = 65, serie, numero, tipoEmissao = 1, codigo }) {
  const aamm = `${String(data.getFullYear()).slice(2)}${String(data.getMonth() + 1).padStart(2, '0')}`
  const base = [
    CODIGO_UF[uf], aamm, String(cnpj).replace(/\D/g, '').padStart(14, '0'), String(modelo).padStart(2, '0'),
    String(serie).padStart(3, '0'), String(numero).padStart(9, '0'), String(tipoEmissao), String(codigo).padStart(8, '0'),
  ].join('')
  if (base.length !== 43 || !/^\d+$/.test(base)) throw new Error('Dados insuficientes para a chave de acesso.')
  return base + digitoChave(base)
}

export const chaveValida = (chave) => /^\d{44}$/.test(chave || '') && digitoChave(chave.slice(0, 43)) === Number(chave[43])
