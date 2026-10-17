/**
 * Parser de Etiquetas de Balança Brasileira (EAN-13 In-Store — Prefixo '2').
 *
 * Padrão Filizola / Toledo Prix / Urano:
 *   Formato 4 dígitos PLU: 2 + PPPP (4 dígitos PLU) + TTTTT (5 dígitos peso em g OU valor em centavos) + DV
 *     Nota: quando o PLU tem 4 dígitos, o 6º dígito costuma ser '0' separador (2 PPPP 0 VVVVV D)
 *   Formato 5 dígitos PLU: 2 + PPPPP (5 dígitos PLU) + VVVVV (5 dígitos peso em g OU valor em centavos) + DV
 */
import { Decimal } from '@/lib/decimal';

export type ScaleBarcodeEncoding = 'WEIGHT_GRAMS' | 'TOTAL_PRICE_CENTS';

export interface ParsedScaleBarcode {
  isScaleLabel: true;
  rawCode: string;
  plu4: string;
  plu5: string;
  payloadDigits: string;
  /** Peso em gramas se a etiqueta codifica peso; caso contrário calculado pelo preço/kg do item */
  resolveForItem: (params: {
    salePricePerKg: number;
    encoding?: ScaleBarcodeEncoding;
  }) => {
    weightGrams: number;
    totalPriceBrl: number;
  };
}

export interface ParsedStandardBarcode {
  isScaleLabel: false;
  rawCode: string;
}

export type BarcodeParseResult = ParsedScaleBarcode | ParsedStandardBarcode;

/** Calcula o dígito verificador oficial EAN-13 (módulo 10, pesos 1 e 3) */
export function computeEan13CheckDigit(first12Digits: string): number {
  if (!/^\d{12}$/.test(first12Digits)) {
    throw new Error('EAN-13 requer 12 dígitos base para cálculo do DV.');
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(first12Digits[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** Gera uma etiqueta EAN-13 válida de balança para testes ou impressão */
export function buildScaleEan13Label(params: {
  plu: string;
  payloadValue: number; // gramas (ex: 350) ou centavos (ex: 592)
}): string {
  const cleanPlu = params.plu.replace(/\D/g, '').padStart(4, '0').slice(-5);
  const plu5 = cleanPlu.length === 4 ? `${cleanPlu}0` : cleanPlu;
  const payload5 = String(Math.round(params.payloadValue)).padStart(5, '0').slice(-5);
  const base12 = `2${plu5}${payload5}`;
  const dv = computeEan13CheckDigit(base12);
  return `${base12}${dv}`;
}

export function parsePosBarcode(rawInput: string): BarcodeParseResult {
  const cleaned = rawInput.trim().replace(/\s+/g, '');

  if (/^2\d{12}$/.test(cleaned)) {
    const plu4 = cleaned.slice(1, 5);
    const plu5 = cleaned.slice(1, 6);
    const payloadDigits = cleaned.slice(6, 12);
    const numericPayload = Number(payloadDigits);

    return {
      isScaleLabel: true,
      rawCode: cleaned,
      plu4,
      plu5,
      payloadDigits,
      resolveForItem: ({ salePricePerKg, encoding = 'WEIGHT_GRAMS' }) => {
        const priceKg = Decimal.max(new Decimal(salePricePerKg || 1), 0.01);

        if (encoding === 'WEIGHT_GRAMS') {
          const weightGrams = numericPayload;
          const totalPriceBrl = new Decimal(weightGrams)
            .dividedBy(1000)
            .times(priceKg)
            .toDecimalPlaces(2)
            .toNumber();
          return { weightGrams, totalPriceBrl };
        }

        // Etiqueta codificada em valor total (centavos) -> converte inversamente para gramas
        const totalPriceBrl = new Decimal(numericPayload).dividedBy(100).toDecimalPlaces(2).toNumber();
        const weightGrams = new Decimal(totalPriceBrl)
          .dividedBy(priceKg)
          .times(1000)
          .toDecimalPlaces(0)
          .toNumber();
        return { weightGrams, totalPriceBrl };
      },
    };
  }

  return {
    isScaleLabel: false,
    rawCode: cleaned,
  };
}

