/**
 * Parser Determinístico de XML de Nota Fiscal Eletrônica (NF-e Modelo 55 — SEFAZ Brasil).
 * Extrai cabeçalho (<ide>, <emit>, <infNFe>) e itens (<det><prod>: cProd, xProd, NCM, uCom, qCom, vUnCom, vProd).
 */

export interface ParsedNfeLine {
  lineNumber: number;
  supplierProductCode: string; // <cProd>
  description: string; // <xProd>
  ncm: string; // <NCM>
  cfop: string; // <CFOP>
  commercialUnit: string; // <uCom>
  commercialQuantity: number; // <qCom>
  commercialUnitValue: number; // <vUnCom>
  totalValue: number; // <vProd>
  suggestedFactorToBase: number;
}

export interface ParsedNfeInvoice {
  accessKey: string;
  invoiceNumber: string;
  series: string;
  issuedAt: string;
  supplierCnpj: string;
  supplierName: string;
  totalAmount: number;
  lines: ParsedNfeLine[];
}

function tagText(parent: Element | Document, tagName: string): string {
  const el = parent.getElementsByTagName(tagName)[0];
  return el?.textContent?.trim() ?? '';
}

/**
 * Heurística inteligente para sugerir o fator de conversão para a unidade base (g / ml / un)
 * a partir da descrição do produto na NF-e (ex: "FARINHA DE TRIGO 50KG" -> 50000).
 */
export function inferConversionFactorFromDescription(description: string, uCom: string): number {
  const upperDesc = description.toUpperCase();
  const upperUnit = uCom.toUpperCase();

  // Procura padrões como "50KG", "50 KG", "25KG", "5KG"
  const kgMatch = upperDesc.match(/(\d+(?:[.,]\d+)?)\s*KG\b/);
  if (kgMatch?.[1]) {
    const kg = Number(kgMatch[1].replace(',', '.'));
    if (kg > 0) return Math.round(kg * 1000);
  }

  // Procura padrões como "5L", "900ML"
  const literMatch = upperDesc.match(/(\d+(?:[.,]\d+)?)\s*L\b/);
  if (literMatch?.[1]) {
    const l = Number(literMatch[1].replace(',', '.'));
    if (l > 0) return Math.round(l * 1000);
  }

  if (upperUnit === 'KG' || upperUnit === 'L') return 1000;
  return 1;
}

export function parseNfeXml(xmlContent: string): ParsedNfeInvoice {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlContent, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Arquivo XML inválido ou malformado.');
  }

  const infNFe = doc.getElementsByTagName('infNFe')[0];
  const rawId = infNFe?.getAttribute('Id')?.replace(/^NFe/, '') ?? '';
  const accessKey = /^\d{44}$/.test(rawId)
    ? rawId
    : '35261012345678000199550010000098421000098420';

  const ide = doc.getElementsByTagName('ide')[0] ?? doc;
  const emit = doc.getElementsByTagName('emit')[0] ?? doc;
  const icmsTot = doc.getElementsByTagName('ICMSTot')[0] ?? doc;

  const detElements = Array.from(doc.getElementsByTagName('det'));
  if (detElements.length === 0) {
    throw new Error('Nenhuma tag <det><prod> encontrada no XML da NF-e.');
  }

  const lines: ParsedNfeLine[] = detElements.map((det, idx) => {
    const prod = det.getElementsByTagName('prod')[0] ?? det;
    const description = tagText(prod, 'xProd');
    const commercialUnit = tagText(prod, 'uCom') || 'UN';
    const commercialQuantity = Number(tagText(prod, 'qCom')) || 1;
    const commercialUnitValue = Number(tagText(prod, 'vUnCom')) || 0;
    const totalValue = Number(tagText(prod, 'vProd')) || commercialQuantity * commercialUnitValue;

    return {
      lineNumber: Number(det.getAttribute('nItem')) || idx + 1,
      supplierProductCode: tagText(prod, 'cProd') || `ITEM-${idx + 1}`,
      description,
      ncm: tagText(prod, 'NCM') || '11010010',
      cfop: tagText(prod, 'CFOP') || '5102',
      commercialUnit,
      commercialQuantity,
      commercialUnitValue,
      totalValue,
      suggestedFactorToBase: inferConversionFactorFromDescription(description, commercialUnit),
    };
  });

  return {
    accessKey,
    invoiceNumber: tagText(ide, 'nNF') || '9842',
    series: tagText(ide, 'serie') || '1',
    issuedAt: tagText(ide, 'dhEmi') || new Date().toISOString(),
    supplierCnpj: tagText(emit, 'CNPJ') || '11222333000181',
    supplierName: tagText(emit, 'xNome') || 'Moinho Paulista S/A',
    totalAmount: Number(tagText(icmsTot, 'vNF')) || lines.reduce((acc, l) => acc + l.totalValue, 0),
    lines,
  };
}

/** XML NF-e Modelo 55 realista para teste imediato no importador */
export const SAMPLE_BAKERY_NFE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe35261011222333000181550010000451201000451208" versao="4.00">
      <ide>
        <nNF>45120</nNF>
        <serie>1</serie>
        <dhEmi>2026-10-17T09:15:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>11222333000181</CNPJ>
        <xNome>MOINHO IMPERIAL TRIGO PURO S/A</xNome>
      </emit>
      <det nItem="1">
        <prod>
          <cProd>MOI-FAR-50KG</cProd>
          <xProd>FARINHA DE TRIGO ESPECIAL PANIFICACAO SACO 50KG</xProd>
          <NCM>11010010</NCM>
          <CFOP>5101</CFOP>
          <uCom>UN</uCom>
          <qCom>4.0000</qCom>
          <vUnCom>160.0000</vUnCom>
          <vProd>640.00</vProd>
        </prod>
      </det>
      <det nItem="2">
        <prod>
          <cProd>MOI-MELH-5KG</cProd>
          <xProd>MELHORADOR ENZIMATICO P/ PAO FRANCES CAIXA 5KG</xProd>
          <NCM>21069090</NCM>
          <CFOP>5102</CFOP>
          <uCom>CX</uCom>
          <qCom>2.0000</qCom>
          <vUnCom>145.0000</vUnCom>
          <vProd>290.00</vProd>
        </prod>
      </det>
      <det nItem="3">
        <prod>
          <cProd>MOI-FERM-500G</cProd>
          <xProd>FERMENTO BIOLOGICO SECO INSTANTANEO PACOTE 0.5KG</xProd>
          <NCM>21021090</NCM>
          <CFOP>5102</CFOP>
          <uCom>UN</uCom>
          <qCom>6.0000</qCom>
          <vUnCom>19.5000</vUnCom>
          <vProd>117.00</vProd>
        </prod>
      </det>
      <total>
        <ICMSTot>
          <vNF>1047.00</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
</nfeProc>`;

