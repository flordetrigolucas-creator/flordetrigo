/**
 * Aritmética decimal exata para dinheiro e pesos (Regra de Ouro #1 no frontend).
 *
 * NUNCA faça `price * qty` com `number` nativo: 0.1 + 0.2 !== 0.3.
 * Todas as operações de valor/peso passam por Decimal e só são convertidas
 * para `number` na borda (envio ao Supabase) já arredondadas na escala do banco.
 */
import Decimal from 'decimal.js';
import type { StorageUnit } from '@/types/database.types';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = Decimal.Value;

/** Escalas idênticas às colunas do banco. */
export const SCALE = {
  money: 2, // NUMERIC(10,2)
  quantity: 4, // NUMERIC(12,4)
  unitCost: 4, // NUMERIC(12,4)
  percentage: 2, // NUMERIC(5,2) / NUMERIC(6,2)
  scalingFactor: 4, // NUMERIC(8,4)
} as const;

export const dec = (value: DecimalInput): Decimal => new Decimal(value);

/** Arredonda para a escala do banco e devolve `number` pronto para o PostgREST. */
export const toDb = (value: DecimalInput, scale: number): number =>
  new Decimal(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toNumber();

export const money = (value: DecimalInput): number => toDb(value, SCALE.money);
export const quantity = (value: DecimalInput): number => toDb(value, SCALE.quantity);

export const sum = (values: readonly DecimalInput[]): Decimal =>
  values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));

/**
 * Valor de linha de venda. Itens pesados têm preço por KG e quantidade em gramas.
 * Ex.: 0,350 kg de pão a R$ 16,90/kg → 350 g → R$ 5,92 (arredondamento ABNT/HALF_UP).
 */
export function lineTotal(params: { quantityBase: DecimalInput; unitPrice: DecimalInput; isWeighed: boolean }): Decimal {
  const qty = new Decimal(params.quantityBase);
  const priced = params.isWeighed ? qty.dividedBy(1000) : qty;
  return priced.times(params.unitPrice).toDecimalPlaces(SCALE.money);
}

/* ---------------------------------------------------------------------------
 * Formatação pt-BR
 * ------------------------------------------------------------------------- */
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const formatBRL = (value: DecimalInput): string => brl.format(new Decimal(value).toDecimalPlaces(2).toNumber());

/** Custo unitário com 4 casas (R$/g, R$/ml). */
export const formatUnitCost = (value: DecimalInput): string =>
  `R$ ${new Decimal(value).toDecimalPlaces(4).toNumber().toLocaleString('pt-BR', { minimumFractionDigits: 4 })}`;

export const formatPercent = (value: DecimalInput, digits = 2): string =>
  `${new Decimal(value).toDecimalPlaces(digits).toNumber().toLocaleString('pt-BR', { minimumFractionDigits: digits })}%`;

/**
 * Exibe quantidades na unidade mais legível, mantendo o armazenamento em base.
 * 27500 ML → "27,5 L" · 250 G → "250 g" · 1200 UN → "1.200 un"
 */
export function formatQuantity(value: DecimalInput, unit: StorageUnit): string {
  const v = new Decimal(value);
  const fmt = (n: Decimal, max = 3) =>
    n.toNumber().toLocaleString('pt-BR', { maximumFractionDigits: max });

  switch (unit) {
    case 'G':
      return v.abs().gte(1000) ? `${fmt(v.dividedBy(1000))} kg` : `${fmt(v, 1)} g`;
    case 'ML':
      return v.abs().gte(1000) ? `${fmt(v.dividedBy(1000))} L` : `${fmt(v, 1)} ml`;
    case 'UN':
      return `${fmt(v, 2)} un`;
  }
}

export { Decimal };

