import React, { useEffect, useMemo, useState } from 'react'
import jsPDF from 'jspdf'

// ———————————————————————————————————————————————
// Catálogo base de materiales
// ———————————————————————————————————————————————
const MATERIALS = [
  { key: 'gold_24k', label: 'Oro 24k', unit: '€/g', density: 19.32 },
  { key: 'gold_18k', label: 'Oro 18k', unit: '€/g', density: 15.6 },
  { key: 'gold_14k', label: 'Oro 14k', unit: '€/g', density: 13.1 },
  { key: 'silver_925', label: 'Plata 925', unit: '€/g', density: 10.36 },
  { key: 'platinum_950', label: 'Platino 950', unit: '€/g', density: 21.45 },
  { key: 'palladium', label: 'Paladio', unit: '€/g', density: 12.0 },
  { key: 'titanium', label: 'Titanio', unit: '€/g', density: 4.5 },
  { key: 'steel_316L', label: 'Acero 316L', unit: '€/g', density: 8.0 },
  { key: 'brass', label: 'Latón', unit: '€/g', density: 8.5 },
  { key: 'diamond', label: 'Diamante', unit: '€/ct', density: 3.52 },
  { key: 'ruby', label: 'Rubí', unit: '€/ct', density: 4.0 },
  { key: 'sapphire', label: 'Zafiro', unit: '€/ct', density: 4.0 },
  { key: 'emerald', label: 'Esmeralda', unit: '€/ct', density: 2.7 },
  { key: 'other_metal', label: 'Otro metal', unit: '€/g', density: 7.8 },
  { key: 'other_mineral', label: 'Otro mineral', unit: '€/ct', density: 2.7 },
]

const DEFAULT_DENSITY = 2.7 // g/cm3
const DEFAULT_RATE_EUR_H = 60 // €/h (mano de obra estimada)
const CURRENCIES = ['EUR', 'USD']
const WEIGHT_UNITS = { g: 1, dwt: 1.555, ozt: 31.103 } // normaliza a g

// Equivalencias conocidas → material.key (case-insensitive)
const EQUIVALENCE_RULES = [
  { test: /(^|\b)(750(\/1000)?|18\s?k(arat)?|oro\s*18k)\b/i, key: 'gold_18k' },
  { test: /(^|\b)(585(\/1000)?|14\s?k(arat)?|oro\s*14k)\b/i, key: 'gold_14k' },
  { test: /(^|\b)(999(\/1000)?|24\s?k(arat)?|oro\s*24k)\b/i, key: 'gold_24k' },
  { test: /(^|\b)(925(\/1000)?|plata\s*de\s*ley|sterling)\b/i, key: 'silver_925' },
  { test: /(^|\b)(950(\/1000)?\s*pt|platino\s*950|pt\s*950)\b/i, key: 'platinum_950' },
]

// Tipos de pieza y horas sugeridas
const PIECE_TYPES = {
  anillo_fino: 'Anillo fino',
  caja_reloj: 'Caja reloj',
  eslabon: 'Eslabón',
  diamante_redondo: 'Diamante redondo',
  pendiente: 'Pendiente',
  pulsera: 'Pulsera',
  colgante: 'Colgante',
  reloj_completo: 'Reloj completo',
}
const SUGGESTED_HOURS = {
  anillo_fino: { baja: 0.5, media: 1.0, alta: 1.5 },
  caja_reloj: { baja: 2.0, media: 4.0, alta: 6.0 },
  eslabon: { baja: 0.8, media: 1.2, alta: 2.0 },
  pulsera: { baja: 1.5, media: 2.5, alta: 4.0 },
  colgante: { baja: 0.8, media: 1.2, alta: 2.0 },
  pendiente: { baja: 0.8, media: 1.5, alta: 2.5 },
  diamante_redondo: { baja: 1.0, media: 1.5, alta: 2.5 },
  reloj_completo: { baja: 2.5, media: 4.5, alta: 6.5 },
}

// Utils
const toNumber = (v, d=0) => { const n = parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : d }
const fmt = (n, digits=2) => (new Intl.NumberFormat(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n||0))
const nowISO = () => new Date().toISOString()
const estimateDiamondCarats = (d, h) => Math.max(0, 0.0061 * (d ** 2) * h)
const volumeFromBoxMM = (l, w, h) => Math.max(0, (l/10)*(w/10)*(h/10))
const volumeFromCylinderMM = (d, h) => { const r=(d/20); return Math.max(0, Math.PI*r*r*(h/10)) }
const unitFor = (mat) => mat?.unit === '€/ct' ? 'ct' : (mat?.unit === '€/cm3' ? 'cm3' : 'g')
const toGrams = (val, unit) => toNumber(val) * (WEIGHT_UNITS[unit] || 1)

const toCSV = (rows) => {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const esc = (s) => `"${String(s).replace(/"/g,'""')}"`
  const body = rows.map(r => headers.map(h => esc(r[h] ?? '')).join(',')).join('\n')
  return [headers.join(','), body].join('\n')
}
const detectMaterialFromAlias = (txt) => {
  const s = String(txt || '').trim()
  if (!s) return null
  for (const rule of EQUIVALENCE_RULES) if (rule.test.test(s)) return rule.key
  return null
}
const createLine = (prefMat) => {
  const m = prefMat || MATERIALS.find(m=>m.key==='gold_18k') || MATERIALS[0]
  const baseUnit = unitFor(m)
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    materialKey: m.key,
    unitPrice: '',
    density: String(m.density ?? DEFAULT_DENSITY),
    mode: 'weight',                 // weight | dimensions
    qty: '1',                       // multiplicador
    alias: '',                      // alias/grabado
    weightVal: '',
    weightUnit: baseUnit === 'g' ? 'g' : baseUnit, // g/dwt/ozt | ct | cm3
    shape: 'box',                   // box | cylinder | volume | diamond_round
    lengthMM: '', widthMM: '', heightMM: '',
    diameterMM: '', depthMM: '',
    volumeCM3: '',
  }
}

export default function App(){
  // Catálogo extendido (base + custom)
  const [customMaterials, setCustomMaterials] = useState([])
  const allMaterials = useMemo(()=>[...MATERIALS, ...customMaterials],[customMaterials])

  const [currency, setCurrency] = useState('EUR')
  const [pieceType, setPieceType] = useState('anillo_fino')
  const [complexity, setComplexity] = useState('media')

  const suggestedHours = useMemo(()=>{
    const table = SUGGESTED_HOURS[pieceType] || {baja:1, media:1, alta:1}
    return table[complexity] ?? 1
  },[pieceType, complexity])
  const [laborOverride, setLaborOverride] = useState('')
  const laborEstimated = useMemo(()=> DEFAULT_RATE_EUR_H * suggestedHours, [suggestedHours])
  const laborCost = toNumber(laborOverride, laborEstimated)

  const [lines, setLines] = useState([createLine()])

  const [piecePrice, setPiecePrice] = useState('')
  const priceP = toNumber(piecePrice)
  const [diagnosis, setDiagnosis] = useState('')

  const [history, setHistory] = useState([])
  useEffect(()=>{
    try{
      const raw = localStorage.getItem('safire_history_v1'); if(raw) setHistory(JSON.parse(raw))
      const mats = localStorage.getItem('safire_custom_materials_v1'); if(mats) setCustomMaterials(JSON.parse(mats))
      const cur = localStorage.getItem('safire_currency_v1'); if(cur) setCurrency(JSON.parse(cur))
    }catch{}
  },[])
  useEffect(()=>{ try{ localStorage.setItem('safire_currency_v1', JSON.stringify(currency)) }catch{} },[currency])
  useEffect(()=>{ try{ localStorage.setItem('safire_custom_materials_v1', JSON.stringify(customMaterials)) }catch{} },[customMaterials])

  const saveHistory = (entry)=>{
    const next = [entry, ...history].slice(0,500)
    setHistory(next)
    try{ localStorage.setItem('safire_history_v1', JSON.stringify(next)) }catch{}
  }

  const calcLine = (ln)=>{
    const m = allMaterials.find(x=>x.key===ln.materialKey) || MATERIALS[0]
    const matUnit = unitFor(m)
    let effW = 0

    if (ln.mode === 'dimensions'){
      if (m.key === 'diamond' && ln.shape === 'diamond_round'){
        effW = estimateDiamondCarats(toNumber(ln.diameterMM), toNumber(ln.depthMM)) // ct
      } else {
        let vol = 0
        if (ln.shape === 'box') vol = volumeFromBoxMM(toNumber(ln.lengthMM), toNumber(ln.widthMM), toNumber(ln.heightMM))
        if (ln.shape === 'cylinder') vol = volumeFromCylinderMM(toNumber(ln.diameterMM), toNumber(ln.heightMM))
        if (ln.shape === 'volume') vol = toNumber(ln.volumeCM3)
        const dens = toNumber(ln.density, DEFAULT_DENSITY)
        if (m.unit === '€/ct') effW = (vol * dens) / 0.2 // ct
        else if (m.unit === '€/g') effW = vol * dens     // g
        else effW = vol                                   // cm3
      }
    } else {
      if (m.unit === '€/g'){
        effW = toGrams(ln.weightVal, ln.weightUnit || 'g')
      } else {
        effW = toNumber(ln.weightVal)
      }
    }

    const qty = Math.max(1, Math.floor(toNumber(ln.qty,1)))
    const cost = toNumber(ln.unitPrice) * effW * qty
    return { m, matUnit, effW, qty, cost }
  }

  const totals = useMemo(()=>{
    const parts = lines.map(calcLine)
    const subtotal = parts.reduce((a,b)=>a+b.cost, 0)
    const totalWeightG = parts.reduce((a,b,i)=>{
      const m = (lines[i] && (allMaterials.find(x=>x.key===lines[i].materialKey) || MATERIALS[0])) || MATERIALS[0]
      const matUnit = unitFor(m)
      if (matUnit === 'g') return a + (b.effW * b.qty)
      return a
    },0)
    return { subtotal, totalWeightG, parts }
  },[lines, allMaterials])

  const totalCost = totals.subtotal + laborCost
  const pctMaterials = priceP > 0 ? (totals.subtotal / priceP) * 100 : 0
  const pctTotal = priceP > 0 ? (totalCost / priceP) * 100 : 0
  const overPctTotal = totalCost > 0 ? ((priceP - totalCost) / totalCost) * 100 : 0

  useEffect(()=>{
    if (!priceP || totalCost <= 0) { setDiagnosis(''); return }
    if (priceP < totalCost) setDiagnosis('Precio sospechoso')
    else if (overPctTotal > 40) setDiagnosis('Sobrevalorado')
    else if (overPctTotal > 20) setDiagnosis('Posible sobrevaloración')
    else setDiagnosis('Precio razonable')
  },[priceP, totalCost, overPctTotal])

  // Validaciones
  const alerts = []
  const pushAlert = (msg) => { if (!alerts.includes(msg)) alerts.push(msg) }
  lines.forEach((ln, idx)=>{
    const m = allMaterials.find(x=>x.key===ln.materialKey) || MATERIALS[0]
    const dens = toNumber(ln.density)
    const isGem = m.unit === '€/ct'
    if (dens < (isGem ? 2.0 : 3.5) || dens > (isGem ? 5.5 : 22)) pushAlert(`Línea ${idx+1}: densidad fuera de rango`)
    const { effW } = calcLine(ln)
    if (effW * Math.max(1, Math.floor(toNumber(ln.qty,1))) > 100000) pushAlert(`Línea ${idx+1}: cantidad muy elevada (revise unidades)`)
    const qty = toNumber(ln.qty,1); if (qty < 1) pushAlert(`Línea ${idx+1}: unidades debe ser ≥ 1`)
  })
  if (priceP && priceP < totalCost) pushAlert('Precio de la pieza menor que el coste total (precio sospechoso)')
  if (overPctTotal > 1000) pushAlert('Sobreprecio extremadamente alto (vs coste total), verifique datos')
  if (laborCost < 0) pushAlert('La mano de obra no puede ser negativa')

  // Acciones
  const addCustomMaterial = ()=>{
    const name = prompt('Nombre del material:'); if(!name) return
    const unit = window.confirm('¿Precio por quilate? (Aceptar = €/ct, Cancelar = €/g)') ? '€/ct' : '€/g'
    const densStr = prompt('Densidad g/cm³ (opcional)', String(DEFAULT_DENSITY)) || String(DEFAULT_DENSITY)
    const key = `custom_${Date.now()}`
    const newMat = { key, label: name, unit, density: toNumber(densStr, DEFAULT_DENSITY) }
    setCustomMaterials(prev => [...prev, newMat])
  }
  const addLine = ()=> setLines(prev => {
    const last = prev[prev.length-1]
    const prefMat = allMaterials.find(m=>m.key===(last?.materialKey)) || allMaterials[0]
    return [...prev, createLine(prefMat)]
  })
  const dupLine = (id)=> setLines(prev => {
    const i = prev.findIndex(l=>l.id===id); if(i<0) return prev
    const clone = { ...prev[i], id: `${Date.now()}_${Math.random().toString(36).slice(2,7)}` }
    return [...prev.slice(0,i+1), clone, ...prev.slice(i+1)]
  })
  const delLine = (id)=> setLines(prev => prev.length>1 ? prev.filter(l=>l.id!==id) : prev)
  const updateLine = (id, patch)=> setLines(prev => prev.map(l => l.id===id ? { ...l, ...patch } : l))
  const applyAliasDetection = (ln)=>{
    const key = detectMaterialFromAlias(ln.alias)
    if (!key) return
    const newMat = MATERIALS.concat(customMaterials).find(m=>m.key===key) || MATERIALS[0]
    const baseUnit = unitFor(newMat)
    updateLine(ln.id, { materialKey: key, weightUnit: baseUnit === 'g' ? (ln.weightUnit in WEIGHT_UNITS ? ln.weightUnit : 'g') : baseUnit })
  }

  const exportCSV = ()=>{
    const rows = history.map(h=> ({
      Fecha: h.ts,
      Divisa: h.currency || currency,
      Descripcion: h.desc || '—',
      SubtotalMateriales: h.subtotalMaterials ?? h.subtotal ?? 0,
      ManoObra: h.laborCost ?? 0,
      CosteTotal: h.totalCost ?? 0,
      PrecioPieza: h.piecePrice ?? 0,
      PctMateriales: h.pctMaterials ?? 0,
      PctTotal: h.pctTotal ?? 0,
      Diagnostico: h.diagnosis || '',
    }))
    const csv = toCSV(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `safire_history_${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url)
  }
  const exportPDF = ()=>{
    const doc = new jsPDF({ unit: 'pt' })
    doc.setFontSize(16); doc.text('Safire Appraisal — Historial', 40, 40)
    doc.setFontSize(11); doc.text(`Divisa: ${currency}`, 40, 58)
    const headers = ['Fecha','Divisa','Subt.','MO','Coste','%Mat','%Total','Precio','Diag.']
    const rows = history.slice(0,80).map(h => [
      new Date(h.ts).toLocaleString(),
      h.currency || currency,
      fmt(h.subtotalMaterials ?? h.subtotal ?? 0),
      fmt(h.laborCost ?? 0),
      fmt(h.totalCost ?? 0),
      fmt(h.pctMaterials ?? 0),
      fmt(h.pctTotal ?? 0),
      fmt(h.piecePrice ?? 0),
      h.diagnosis || '',
    ])
    let x = 40, y = 80
    doc.setFont(undefined,'bold')
    headers.forEach((hd,i)=> doc.text(hd, x + i*64, y))
    doc.setFont(undefined,'normal'); y+=18
    rows.forEach(r => { r.forEach((c,i)=> doc.text(String(c), x + i*64, y)); y += 16 })
    doc.save(`safire_history_${Date.now()}.pdf`)
  }
  const saveCurrentToHistory = ()=>{
    const entry = {
      ts: nowISO(),
      currency,
      desc: `Pieza multi-material (${lines.length} líneas)`,
      subtotalMaterials: totals.subtotal,
      laborCost,
      totalCost,
      piecePrice: priceP,
      pctMaterials,
      pctTotal,
      diagnosis,
      pieceType,
      complexity,
      lineUnits: lines.map(ln => ({ id: ln.id, materialKey: ln.materialKey, weightUnit: ln.weightUnit, qty: ln.qty, alias: ln.alias })),
    }
    saveHistory(entry)
  }
  const resetAll = ()=>{ setLines([createLine()]); setPiecePrice(''); setDiagnosis(''); setLaborOverride('') }

  // —— UI helpers
  const Pill = ({tone='default', children}) => {
    const style = {
      display:'inline-block', padding:'2px 8px', borderRadius:999, fontSize:12, marginRight:6,
      background: tone==='bad' ? '#3b1620' : tone==='warn' ? '#3c2f10' : tone==='ok' ? '#14351f' : '#2a3043',
      color: tone==='bad' ? '#ff9cac' : tone==='warn' ? '#ffd48a' : tone==='ok' ? '#9be7aa' : '#c8cde0'
    }
    return <span style={style}>{children}</span>
  }

  // —— estilos mínimos internos (sin dependencias externas)
  const container = { maxWidth:1100, margin:'0 auto', padding:'24px 16px', color:'#e8ebf4', fontFamily:'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial' }
  const card = { background:'#151821', border:'1px solid #242836', borderRadius:14, padding:16, boxShadow:'0 8px 24px rgba(0,0,0,.25)', marginTop:12 }
  const input = { width:'100%', background:'#0f1320', border:'1px solid #2b3145', color:'#e8ebf4', borderRadius:10, padding:'8px 10px' }
  const select = input
  const btn = (variant='solid') => ({
    background: variant==='outline' ? 'transparent' : '#222633',
    border:'1px solid ' + (variant==='outline' ? '#3a415a' : '#2e3346'),
    color:'#e8ebf4', borderRadius:10, padding:'8px 12px', cursor:'pointer'
  })
  const row = { display:'grid', gridTemplateColumns:'repeat(12, 1fr)', gap:12 }
  const col = (n) => ({ gridColumn:`span ${n}` })
  const muted = { color:'#8b91a1', fontSize:12 }

  return (
    <div style={container}>
      <h1 style={{fontSize:28, margin:'0 0 12px'}}>Safire Appraisal — Comparador (V2.2)</h1>

      <div style={{display:'flex', flexWrap:'wrap', gap:8, alignItems:'center', marginBottom:12}}>
        <label>Divisa</label>
        <select style={{...select, width:120}} value={currency} onChange={e=>setCurrency(e.target.value)}>
          {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button style={btn()} onClick={addCustomMaterial}>Añadir material (catálogo)</button>
        <div style={{border:'1px dashed #39415b', padding:'6px 8px', borderRadius:8, fontSize:12, color:'#aeb6ca'}}>
          Tips: Alias “750/1000”, “18k”, “925”, “platino 950” → Detectar. Usa Unidades para múltiplos.
        </div>
      </div>

      <div style={card}>
        {/* Presets */}
        <div style={{display:'grid', gridTemplateColumns:'repeat(8, minmax(0,1fr))', gap:8}}>
          {Object.entries(PIECE_TYPES).map(([key, label]) => (
            <button key={key} style={btn('outline')} onClick={()=>{
              setPieceType(key)
              setLines(prev => {
                const i = prev.length-1; const ln = prev[i]
                const patch = (()=>{
                  if (key==='anillo_fino') return { mode:'dimensions', shape:'cylinder', diameterMM:'20', heightMM:'2' }
                  if (key==='caja_reloj') return { mode:'dimensions', shape:'box', lengthMM:'40', widthMM:'30', heightMM:'10' }
                  if (key==='eslabon') return { mode:'dimensions', shape:'cylinder', diameterMM:'5', heightMM:'20' }
                  if (key==='diamante_redondo') return { materialKey:'diamond', mode:'dimensions', shape:'diamond_round', diameterMM:'6.5', depthMM:'4' }
                  if (key==='pendiente') return { mode:'dimensions', shape:'box', lengthMM:'10', widthMM:'10', heightMM:'5' }
                  if (key==='pulsera') return { mode:'dimensions', shape:'cylinder', diameterMM:'60', heightMM:'5' }
                  if (key==='colgante') return { mode:'dimensions', shape:'box', lengthMM:'20', widthMM:'15', heightMM:'5' }
                  if (key==='reloj_completo') return { mode:'dimensions', shape:'box', lengthMM:'45', widthMM:'40', heightMM:'10' }
                  return {}
                })()
                return prev.map((l, idx) => idx!==i? l : { ...ln, ...patch })
              })
            }}>{label}</button>
          ))}
        </div>

        {/* Líneas */}
        <div style={{display:'grid', gap:12, marginTop:12}}>
          {lines.map((ln) => {
            const { m, matUnit, effW, qty, cost } = calcLine(ln)
            const baseUnit = matUnit
            const displayUnit = ln.mode === 'weight' ? (m.unit === '€/g' ? (ln.weightUnit || 'g') : baseUnit) : baseUnit
            let displayQty = 0
            if (ln.mode === 'weight') displayQty = (m.unit === '€/g') ? toNumber(ln.weightVal) : effW
            else displayQty = effW

            return (
              <div key={ln.id} style={{border:'1px solid #2a3043', borderRadius:12, padding:12, background:'#0f1220'}}>
                <div style={row}>
                  <div style={col(3)}>
                    <label style={muted}>Material</label>
                    <select style={select} value={ln.materialKey} onChange={e=>{
                      const v = e.target.value
                      const newMat = allMaterials.find(x=>x.key===v) || MATERIALS[0]
                      const u = unitFor(newMat)
                      updateLine(ln.id, { materialKey: v, weightUnit: u === 'g' ? (ln.weightUnit in WEIGHT_UNITS ? ln.weightUnit : 'g') : u })
                    }}>
                      {allMaterials.map(mat => <option key={mat.key} value={mat.key}>{mat.label}</option>)}
                    </select>
                  </div>

                  <div style={col(2)}>
                    <label style={muted}>Precio ({m.unit}) [{currency}]</label>
                    <input style={input} value={ln.unitPrice} onChange={e=>updateLine(ln.id,{unitPrice:e.target.value})} />
                  </div>

                  <div style={col(2)}>
                    <label style={muted}>Modo</label>
                    <select style={select} value={ln.mode} onChange={e=>updateLine(ln.id,{mode:e.target.value})}>
                      <option value="weight">Peso conocido</option>
                      <option value="dimensions">Por dimensiones</option>
                    </select>
                  </div>

                  <div style={col(3)}>
                    <label style={muted}>Alias / Grabado (ej. 750/1000, 18k, 925)</label>
                    <div style={{display:'flex', gap:8}}>
                      <input style={input} value={ln.alias} onChange={e=>updateLine(ln.id,{alias:e.target.value})} placeholder="Ej. 750/1000" />
                      <button style={btn()} onClick={()=>applyAliasDetection(ln)}>Detectar</button>
                    </div>
                  </div>

                  <div style={col(2)}>
                    <label style={muted}>Unidades</label>
                    <input style={input} value={ln.qty} onChange={e=>updateLine(ln.id,{qty:e.target.value})} />
                    <div style={muted}>Multiplica el coste por este número.</div>
                  </div>

                  {ln.mode === 'weight' ? (<>
                    <div style={col(2)}>
                      <label style={muted}>Peso</label>
                      <input style={input} value={ln.weightVal} onChange={e=>updateLine(ln.id,{weightVal:e.target.value})} />
                    </div>
                    <div style={col(1)}>
                      <label style={muted}>Unidad</label>
                      {m.unit === '€/g' ? (
                        <select style={select} value={ln.weightUnit} onChange={e=>updateLine(ln.id,{weightUnit:e.target.value})}>
                          <option value="g">g</option>
                          <option value="dwt">dwt</option>
                          <option value="ozt">ozt</option>
                        </select>
                      ) : (<div style={{marginTop:8}}>{baseUnit}</div>)}
                    </div>
                  </>) : (
                    <div style={col(5)}>
                      <div style={{display:'grid', gridTemplateColumns:'repeat(12, 1fr)', gap:12}}>
                        <div style={{gridColumn:'span 12'}}>
                          <label style={muted}>Tipo</label>
                          <select style={select} value={ln.shape} onChange={e=>updateLine(ln.id,{shape:e.target.value})}>
                            {m.key === 'diamond' && <option value="diamond_round">Diamante — redondo</option>}
                            <option value="box">Prisma rectangular</option>
                            <option value="cylinder">Cilindro</option>
                            <option value="volume">Volumen conocido</option>
                          </select>
                        </div>

                        {ln.shape === 'diamond_round' && (<>
                          <div style={{gridColumn:'span 3'}}>
                            <label style={muted}>Diámetro (mm)</label>
                            <input style={input} value={ln.diameterMM} onChange={e=>updateLine(ln.id,{diameterMM:e.target.value})} />
                          </div>
                          <div style={{gridColumn:'span 3'}}>
                            <label style={muted}>Altura/Prof. (mm)</label>
                            <input style={input} value={ln.depthMM} onChange={e=>updateLine(ln.id,{depthMM:e.target.value})} />
                          </div>
                          <div style={{gridColumn:'span 6'}}>
                            <div style={{border:'1px dashed #39415b', padding:'6px 8px', borderRadius:8, fontSize:12, color:'#aeb6ca'}}>
                              Diamante: ct ≈ 0.0061·d²·h · 1 ct = 0.2 g
                            </div>
                          </div>
                        </>)}

                        {ln.shape === 'box' && (<>
                          <div style={{gridColumn:'span 3'}}>
                            <label style={muted}>Largo (mm)</label>
                            <input style={input} value={ln.lengthMM} onChange={e=>updateLine(ln.id,{lengthMM:e.target.value})} />
                          </div>
                          <div style={{gridColumn:'span 3'}}>
                            <label style={muted}>Ancho (mm)</label>
                            <input style={input} value={ln.widthMM} onChange={e=>updateLine(ln.id,{widthMM:e.target.value})} />
                          </div>
                          <div style={{gridColumn:'span 3'}}>
                            <label style={muted}>Alto (mm)</label>
                            <input style={input} value={ln.heightMM} onChange={e=>updateLine(ln.id,{heightMM:e.target.value})} />
                          </div>
                        </>)}

                        {ln.shape === 'cylinder' && (<>
                          <div style={{gridColumn:'span 3'}}>
                            <label style={muted}>Diámetro (mm)</label>
                            <input style={input} value={ln.diameterMM} onChange={e=>updateLine(ln.id,{diameterMM:e.target.value})} />
                          </div>
                          <div style={{gridColumn:'span 3'}}>
                            <label style={muted}>Altura (mm)</label>
                            <input style={input} value={ln.heightMM} onChange={e=>updateLine(ln.id,{heightMM:e.target.value})} />
                          </div>
                          <div style={{gridColumn:'span 3'}}>
                            <label style={muted}>Volumen (cm³)</label>
                            <input style={input} value={ln.volumeCM3} onChange={e=>updateLine(ln.id,{volumeCM3:e.target.value})} />
                          </div>
                        </>)}

                        {ln.shape === 'volume' && (<div style={{gridColumn:'span 3'}}>
                          <label style={muted}>Volumen (cm³)</label>
                          <input style={input} value={ln.volumeCM3} onChange={e=>updateLine(ln.id,{volumeCM3:e.target.value})} />
                        </div>)}
                      </div>
                    </div>
                  )}

                  <div style={col(2)}>
                    <label style={muted}>Densidad (g/cm³)</label>
                    <input style={input} value={ln.density} onChange={e=>updateLine(ln.id,{density:e.target.value})} />
                  </div>

                  <div style={{...col(5), display:'flex', justifyContent:'flex-end', gap:8, alignItems:'center'}}>
                    <div>
                      <div><small style={muted}>Cantidad unitaria:</small> <b>{fmt(displayQty,3)} {displayUnit}</b></div>
                      <div><small style={muted}>× Unidades:</small> <b>{qty}</b></div>
                      <div><small style={muted}>Coste línea:</small> <b>{fmt(cost)} {currency}</b></div>
                    </div>
                    <button style={btn('outline')} onClick={()=>dupLine(ln.id)}>Duplicar</button>
                    <button style={btn('outline')} onClick={()=>delLine(ln.id)}>Eliminar</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:8}}>
          <button style={btn()} onClick={addLine}>+ Añadir línea</button>
        </div>

        {/* Totales */}
        <div style={{...row, marginTop:12, alignItems:'end'}}>
          <div style={col(3)}>
            <label style={muted}>Subtotal materiales</label>
            <div style={{fontSize:24, fontWeight:700}}>{fmt(totals.subtotal)} {currency}</div>
          </div>
          <div style={col(3)}>
            <label style={muted}>Complejidad (mano de obra)</label>
            <select style={select} value={complexity} onChange={e=>setComplexity(e.target.value)}>
              <option value="baja">Baja</option>
              <option value="media">Media</option>
              <option value="alta">Alta</option>
            </select>
            <div style={muted}>Tipo: <b>{PIECE_TYPES[pieceType]}</b> · Horas sugeridas: {fmt(suggestedHours,2)} h · Tarifa: {DEFAULT_RATE_EUR_H} €/h</div>
          </div>
          <div style={col(2)}>
            <label style={muted}>Mano de obra (estimada)</label>
            <div style={{fontSize:18, fontWeight:600}}>{fmt(laborEstimated)} {currency}</div>
            <div style={muted}>Override (€):
              <input style={{...input, marginTop:6}} value={laborOverride} onChange={e=>setLaborOverride(e.target.value)} placeholder={fmt(laborEstimated)} />
            </div>
          </div>
          <div style={col(2)}>
            <label style={muted}>Precio de la pieza (tienda)</label>
            <input style={input} value={piecePrice} onChange={e=>setPiecePrice(e.target.value)} placeholder={`${currency}`} />
          </div>
          <div style={col(2)}>
            <label style={muted}>Diagnóstico</label>
            <div>
              {diagnosis === 'Sobrevalorado' ? <Pill tone="bad">{diagnosis}</Pill> :
               diagnosis === 'Posible sobrevaloración' ? <Pill tone="warn">{diagnosis}</Pill> :
               diagnosis === 'Precio sospechoso' ? <Pill tone="bad">{diagnosis}</Pill> :
               diagnosis ? <Pill tone="ok">{diagnosis}</Pill> : <Pill>—</Pill>}
            </div>
            <div style={muted}>Umbrales sobre <b>coste total</b>: ≤20% razonable · 20–40% posible · &gt;40% sobrevalorado. Precio &lt; coste total: sospechoso.</div>
            <div style={muted}>Sobreprecio (vs coste total): <b>{fmt(overPctTotal)}%</b></div>
          </div>
        </div>

        {/* Desglose y % */}
        <div style={{...row, marginTop:8, alignItems:'end'}}>
          <div style={col(3)}>
            <label style={muted}>Coste total (Mat.+MO)</label>
            <div style={{fontSize:18, fontWeight:600}}>{fmt(totalCost)} {currency}</div>
          </div>
          <div style={col(2)}>
            <label style={muted}>% materiales / precio</label>
            <div style={{fontSize:18, fontWeight:600}}>{fmt(pctMaterials)}%</div>
          </div>
          <div style={col(2)}>
            <label style={muted}>% (Mat.+MO) / precio</label>
            <div style={{fontSize:18, fontWeight:600}}>{fmt(pctTotal)}%</div>
          </div>
          <div style={{...col(5), display:'flex', justifyContent:'flex-end', gap:8}}>
            <button style={btn()} onClick={exportCSV}>CSV</button>
            <button style={btn()} onClick={exportPDF}>PDF</button>
            <button style={btn()} onClick={saveCurrentToHistory}>Guardar</button>
            <button style={btn('outline')} onClick={resetAll}>Reset</button>
          </div>
        </div>
      </div>

      {/* Historial */}
      <div style={card}>
        <h2 style={{fontSize:18, margin:0}}>Historial</h2>
        {history.length === 0 ? (
          <div style={muted}>Aún no hay registros.</div>
        ) : (
          <div style={{marginTop:8, display:'grid', gap:8, fontSize:13}}>
            {history.slice(0,20).map((h,i) => (
              <div key={i} style={{display:'grid', gridTemplateColumns:'repeat(10, minmax(0,1fr))', gap:8, border:'1px solid #2b3145', borderRadius:10, padding:8}}>
                <div style={{gridColumn:'span 3'}}>
                  <div style={{fontWeight:600}}>{new Date(h.ts).toLocaleString()}</div>
                  <div style={muted}>{h.desc}</div>
                </div>
                <div>Divisa: {h.currency || currency}</div>
                <div>Subt.: {fmt(h.subtotalMaterials ?? h.subtotal ?? 0)} {h.currency || currency}</div>
                <div>MO: {fmt(h.laborCost ?? 0)} {h.currency || currency}</div>
                <div>Coste: {fmt(h.totalCost ?? 0)} {h.currency || currency}</div>
                <div>%Mat: {fmt(h.pctMaterials ?? 0)}%</div>
                <div>%Total: {fmt(h.pctTotal ?? 0)}%</div>
                <div>Precio: {fmt(h.piecePrice ?? 0)} {h.currency || currency}</div>
                <div style={{fontWeight:700, textAlign:'right'}}>{h.diagnosis}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:8}}>
          <button style={btn()} onClick={exportCSV}>CSV</button>
          <button style={btn()} onClick={exportPDF}>PDF</button>
        </div>
        <div style={{...muted, marginTop:8}}>* Ayudas: densidades gemas ~2–5.5 g/cm³; metales ~3.5–22 g/cm³. 1 ct = 0.2 g. 1 dwt = 1.555 g. 1 ozt = 31.103 g.</div>
      </div>
    </div>
  )
}

// ———————————————————————————————————————————————
// TESTS LIGEROS (no bloqueantes) — 1 vez por sesión
// ———————————————————————————————————————————————
try {
  if (typeof window !== 'undefined' && !window.__SAFIRE_TESTS_V22__) {
    window.__SAFIRE_TESTS_V22__ = true;
    console.assert(Math.abs(volumeFromBoxMM(10,10,10) - 1) < 1e-9, 'volumeFromBoxMM 1 cm³');
    console.assert(Math.abs(volumeFromCylinderMM(10,10) - Math.PI*0.25) < 1e-6, 'volumeFromCylinderMM ~0.7854 cm³');
    console.assert(Math.abs(estimateDiamondCarats(6.5,4) - 1.0309) < 1e-3, 'Diamante ct estimado');
    console.assert(Math.abs(toGrams(1, 'ozt') - 31.103) < 1e-6, '1 ozt == 31.103 g');
    console.assert(Math.abs(toGrams(10, 'dwt') - 15.55) < 1e-2, '10 dwt ≈ 15.55 g');
    const subtotal = 1000, labor = 90, total = subtotal + labor, price = 1400;
    const pctM = (subtotal/price)*100; const pctT = (total/price)*100; const over = ((price-total)/total)*100;
    console.assert(Math.round(pctM) === 71, '% materiales / precio ~71%');
    console.assert(Math.round(pctT) === Math.round(((1090/1400)*100)), '% total / precio calc');
    console.assert(Math.round(over) === Math.round(((1400-1090)/1090)*100), 'Sobreprecio vs total');
    const diag = (price, total) => { if (price < total) return 'Precio sospechoso'; const ov = ((price-total)/total)*100; if (ov > 40) return 'Sobrevalorado'; if (ov > 20) return 'Posible sobrevaloración'; return 'Precio razonable'; };
    console.assert(diag(1100,1000) === 'Precio razonable', 'Diag ≤20 razonable');
    console.assert(diag(1300,1000) === 'Posible sobrevaloración', 'Diag 20–40');
    console.assert(diag(2000,1000) === 'Sobrevalorado', 'Diag >40');
    console.assert(diag(900,1000) === 'Precio sospechoso', 'Diag sospechoso');
    const key = detectMaterialFromAlias('750/1000');
    console.assert(key === 'gold_18k', 'Equivalencia 750 → 18k');
  }
} catch (e) { /* no-op */ }


  
