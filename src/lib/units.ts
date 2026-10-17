import type { UnitOfMeasure, StorageUnit } from '@/types/database.types';
import { Decimal, type DecimalInput } from '@/lib/decimal';

/**
 * Regra de Ouro #3: estoque sempre em G / ML / UN.
 * Fator multiplicativo de cada unidade para sua unidade base de armazenamento.
 */
const TO_BASE: Record<UnitOfMeasure, { base: StorageUnit; factor: number }> = {
  G: { base: 'G', factor: 1 },
  KG: { base: 'G', factor: 1000 },
  ML: { base: 'ML', factor: 1 },
  L: { base: 'ML', factor: 1000 },
  UN: { base: 'UN', factor: 1 },
};

export function storageUnitOf(unit: UnitOfMeasure): StorageUnit {
  return TO_BASE[unit].base;
}

/** Converte uma quantidade para a unidade base. Ex.: (50, 'KG') → 50000 (G). */
export function toBaseUnit(value: DecimalInput, unit: UnitOfMeasure): { value: Decimal; unit: StorageUnit } {
  const { base, factor } = TO_BASE[unit];
  return { value: new Decimal(value).times(factor), unit: base };
}

/** Converte da unidade base para uma unidade de exibição compatível. */
export function fromBaseUnit(value: DecimalInput, target: UnitOfMeasure): Decimal {
  return new Decimal(value).dividedBy(TO_BASE[target].factor);
}

export function areCompatible(a: UnitOfMeasure, b: UnitOfMeasure): boolean {
  return TO_BASE[a].base === TO_BASE[b].base;
}

export const UNIT_LABEL: Record<UnitOfMeasure, string> = {
  G: 'gramas',
  KG: 'quilos',
  ML: 'mililitros',
  L: 'litros',
  UN: 'unidades',
};

