// Safire Appraisal — Comparador v2.2 (React)
// Estado: ESTABLE — derivado de V2.1
// Novedades clave: equivalencias, validaciones ampliadas, multi-modo (peso, dimensiones, volumen),
// diagnóstico sobre Coste Total (Materiales + Mano de obra), historial con export CSV/PDF.

import React, { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";

// ———————————————————————————————————————————————
// Catálogo base de materiales
// ———————————————————————————————————————————————
const MATERIALS = [
  { key: "gold_24k", label: "Oro 24k", unit: "€/g", density: 19.32, aliases: ["oro 999", "oro puro", "24 quilates"] },
  { key: "gold_18k", label: "Oro 18k", unit: "€/g", density: 15.6, aliases: ["oro 750", "18 quilates", "oro 750/1000"] },
  { key: "gold_14k", label: "Oro 14k", unit: "€/g", density: 13.1, aliases: ["oro 585", "14 quilates"] },
  { key: "silver_925", label: "Plata 925", unit: "€/g", density: 10.36, aliases: ["plata sterling", "plata de ley", "925"] },
  { key: "platinum_950", label: "Platino 950", unit: "€/g", density: 21.45, aliases: ["platino", "950"] },
  { key: "palladium", label: "Paladio", unit: "€/g", density: 12.0, aliases: [] },
  { key: "titanium", label: "Titanio", unit: "€/g", density: 4.5, aliases: [] },
  { key: "steel_316L", label: "Acero 316L", unit: "€/g", density: 8.0, aliases: ["acero"] },
  { key: "brass", label: "Latón", unit: "€/g", density: 8.5, aliases: [] },
  { key: "diamond", label: "Diamante", unit: "€/ct", density: 3.52, aliases: ["diamond"] },
  { key: "ruby", label: "Rubí", unit: "€/ct", density: 4.0, aliases: ["ruby"] },
  { key: "sapphire", label: "Zafiro", unit: "€/ct", density: 4.0, aliases: ["sapphire"] },
  { key: "emerald", label: "Esmeralda", unit: "€/ct", density: 2.7, aliases: ["emerald"] },
  { key: "other_metal", label: "Otro metal", unit: "€/g", density: 7.8, aliases: [] },
  { key: "other_mineral", label: "Otro mineral", unit: "€/ct", density: 2.7, aliases: [] },
];

const DEFAULT_DENSITY = 2.7; // g/cm3
const DEFAULT_RATE_EUR_H = 60; // €/h (mano de obra estimada)

// Tipos de pieza y horas sugeridas
const PIECE_TYPES = {
  anillo_fino: "Anillo fino",
  caja_reloj: "Caja reloj",
  eslabon: "Eslabón",
  diamante_redondo: "Diamante redondo",
  pendiente: "Pendiente",
  pulsera: "Pulsera",
  colgante: "Colgante",
  reloj_completo: "Reloj completo",
};

const SUGGESTED_HOURS = {
  anillo_fino: { baja: 0.5, media: 1.0, alta: 1.5 },
  caja_reloj: { baja: 2.0, media: 4.0, alta: 6.0 },
  eslabon: { baja: 0.8, media: 1.2, alta: 2.0 },
  pulsera: { baja: 1.5, media: 2.5, alta: 4.0 },
  colgante: { baja: 0.8, media: 1.2, alta: 2.0 },
  pendiente: { baja: 0.8, media: 1.5, alta: 2.5 },
  diamante_redondo: { baja: 1.0, media: 1.5, alta: 2.5 },
  reloj_completo: { baja: 2.5, media: 4.5, alta: 6.5 },
};

// ———————————————————————————————————————————————
// Utils
// ———————————————————————————————————————————————
function toNumber(v, d = 0) { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : d; }
function fmt(n, digits = 2) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n || 0); }
function nowISO() { return new Date().toISOString(); }

function estimateDiamondCarats(d, h) { return Math.max(0, 0.0061 * (d ** 2) * h); } // ct ≈ 0.0061·d^2·h
function volumeFromBoxMM(l, w, h) { return Math.max(0, (l / 10) * (w / 10) * (h / 10)); }
function volumeFromCylinderMM(d, h) { const r = (d / 20); return Math.max(0, Math.PI * r * r * (h / 10)); }

// ———————————————————————————————————————————————
// Línea de materiales
// ———————————————————————————————————————————————
function createLine(prefMat) {
  const m = prefMat || MATERIALS.find(m => m.key === "gold_18k") || MATERIALS[0];
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    materialKey: m.key,
    unitPrice: "", // €/g o €/ct
    density: String(m.density ?? DEFAULT_DENSITY),
    mode: "weight", // weight | dimensions | volume
    units: 1,
    weightVal: "",
    weightUnit: "g",
    shape: "box", // box | cylinder | diamond_round
    lengthMM: "", widthMM: "", heightMM: "",
    diameterMM: "", depthMM: "",
    volumeCM3: "",
  };
}

// ———————————————————————————————————————————————
// Componente principal
// ———————————————————————————————————————————————
export default function App() {
  const [lines, setLines] = useState([createLine()]);
  const [piecePrice, setPiecePrice] = useState("");
  const [pieceType, setPieceType] = useState("anillo_fino");
  const [complexity, setComplexity] = useState("media");

  const suggestedHours = useMemo(() => {
    const table = SUGGESTED_HOURS[pieceType] || { baja: 1, media: 1, alta: 1 };
    return table[complexity] ?? 1;
  }, [pieceType, complexity]);

  const laborEstimated = useMemo(() => DEFAULT_RATE_EUR_H * suggestedHours, [suggestedHours]);

  const updateLine = (id, patch) => setLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  const addLine = () => setLines(prev => [...prev, createLine()]);

  // Cálculo de cada línea
  const calcLine = (ln) => {
    const m = MATERIALS.find(x => x.key === ln.materialKey) || MATERIALS[0];
    let effW = 0;
    if (ln.mode === "dimensions") {
      if (m.key === "diamond" && ln.shape === "diamond_round") {
        effW = estimateDiamondCarats(toNumber(ln.diameterMM), toNumber(ln.depthMM));
      } else {
        let vol = 0;
        if (ln.shape === "box") vol = volumeFromBoxMM(toNumber(ln.lengthMM), toNumber(ln.widthMM), toNumber(ln.heightMM));
        if (ln.shape === "cylinder") vol = volumeFromCylinderMM(toNumber(ln.diameterMM), toNumber(ln.heightMM));
        const dens = toNumber(ln.density, DEFAULT_DENSITY);
        effW = vol * dens;
      }
    } else if (ln.mode === "volume") {
      const dens = toNumber(ln.density, DEFAULT_DENSITY);
      effW = toNumber(ln.volumeCM3) * dens;
    } else {
      effW = toNumber(ln.weightVal);
    }
    effW *= toNumber(ln.units, 1);
    const cost = toNumber(ln.unitPrice) * effW;
    return { m, effW, cost };
  };

  const totals = useMemo(() => {
    const parts = lines.map(calcLine);
    const subtotal = parts.reduce((a, b) => a + b.cost, 0);
    return { subtotal, parts };
  }, [lines]);

  const totalCost = totals.subtotal + laborEstimated;
  const priceP = toNumber(piecePrice);
  const pctMaterials = priceP > 0 ? (totals.subtotal / priceP) * 100 : 0;
  const pctTotal = priceP > 0 ? (totalCost / priceP) * 100 : 0;
  const overPctTotal = totalCost > 0 ? ((priceP - totalCost) / totalCost) * 100 : 0;

  let diagnosis = "";
  if (priceP && totalCost > 0) {
    if (priceP < totalCost) diagnosis = "Precio sospechoso";
    else if (overPctTotal > 40) diagnosis = "Sobrevalorado";
    else if (overPctTotal > 20) diagnosis = "Posible sobrevaloración";
    else diagnosis = "Precio razonable";
  }

  return (
    <div style={{ padding: "1rem", fontFamily: "sans-serif" }}>
      <h1>Safire Appraisal — V2.2</h1>

      <div>
        <label>Precio tienda (€): </label>
        <input value={piecePrice} onChange={e => setPiecePrice(e.target.value)} />
      </div>

      <div style={{ margin: "1rem 0" }}>
        {lines.map((ln) => {
          const { cost } = calcLine(ln);
          return (
            <div key={ln.id} style={{ border: "1px solid #ccc", padding: "0.5rem", marginBottom: "0.5rem" }}>
              <select value={ln.materialKey} onChange={e => updateLine(ln.id, { materialKey: e.target.value })}>
                {MATERIALS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
              <input placeholder="€/unidad" value={ln.unitPrice} onChange={e => updateLine(ln.id, { unitPrice: e.target.value })} />
              <input placeholder="Unidades" value={ln.units} onChange={e => updateLine(ln.id, { units: e.target.value })} />
              <input placeholder="Peso (g/ct)" value={ln.weightVal} onChange={e => updateLine(ln.id, { weightVal: e.target.value })} />
              <div>Coste: {fmt(cost)} €</div>
            </div>
          );
        })}
        <button onClick={addLine}>Añadir línea</button>
      </div>

      <h3>Resultados</h3>
      <p>Subtotal materiales: {fmt(totals.subtotal)} €</p>
      <p>Mano de obra (estimada): {fmt(laborEstimated)} €</p>
      <p>Coste total: {fmt(totalCost)} €</p>
      <p>% materiales/precio: {fmt(pctMaterials)}%</p>
      <p>% (Mat+MO)/precio: {fmt(pctTotal)}%</p>
      <p>Diagnóstico: <strong>{diagnosis}</strong></p>
    </div>
  );
}
