import {useEffect, useState} from 'react'
import {api, apiBlob, ApiError} from './api'
import {Preview} from './Files'
import type {Attachment} from './Files'
import {navigate} from './Home'

type Content = {description:string; date_kind:'exact'|'approximate'|'unknown'; event_date:string|null; approximate_date:string|null}
type Source = {id:string; kind:'account'|'record'|'file'; source_id:string; label:string; quote:string; page:number|null}
type Event = Content & {id:string; status:'proposed'|'accepted'|'discarded'; edited:boolean; reviewed:boolean; mode:string; original:Content; source:Source}
type State = {revision:number; confirmed:boolean; mode:string; configured_mode:string; events:Event[]; warnings:string[]; processed_at:string|null}
type Props = {recordId:string; onExpired:()=>void}
const dateLabel = (e:Content) => e.date_kind === 'exact' ? `Fecha exacta · ${e.event_date?.split('-').reverse().join('/')}` : e.date_kind === 'approximate' ? `Fecha aproximada · ${e.approximate_date}` : 'Fecha desconocida'

function SourceView({recordId, event, onExpired, onClose}:Props & {event:Event; onClose:()=>void}) {
  const [data, setData] = useState<(Source & {current_text:string|null; changed:boolean})|null>(null)
  const [file, setFile] = useState<Attachment|null>(null)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError(''); setData(null); setFile(null)
    api<Source & {current_text:string|null; changed:boolean}>(`/records/${recordId}/timeline/events/${event.id}/source`).then(async source => {
      if (!active) return
      setData(source)
      if (source.kind === 'file') {
        const metadata = await api<Attachment>(`/records/${recordId}/files/${source.source_id}`)
        if (active) setFile(metadata)
      }
    }).catch(e => {
      if (!active) return
      if (e instanceof ApiError && e.status === 401) onExpired()
      else setError('No pudimos abrir la fuente. Puede haberse quitado o no estar disponible ahora.')
    })
    return () => {active = false}
  }, [recordId,event.id,onExpired,attempt])
  async function download() {
    if (!file) return
    setDownloading(true)
    try {
      const blob = await apiBlob(`/records/${recordId}/files/${file.id}/content`)
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = url; link.download = file.filename; link.click()
      setTimeout(() => URL.revokeObjectURL(url),1000)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onExpired()
      else setError('No pudimos descargar el original. Intenta nuevamente.')
    } finally {setDownloading(false)}
  }
  return <section className="source-panel" aria-label="Fuente del evento">
    <div className="record-heading"><h3>Fuente: {event.source.label}{event.source.page ? ` · página ${event.source.page}` : ''}</h3><button className="secondary" onClick={onClose}>Cerrar fuente</button></div>
    {error ? <><p role="alert" className="error">{error}</p><button onClick={() => setAttempt(v => v+1)}>Reintentar fuente</button></> : !data ? <p role="status">Cargando fuente…</p> : <>
      <p className="eyebrow">FRAGMENTO ORIGINAL UTILIZADO</p><blockquote>{data.quote}</blockquote>
      {data.changed && <p className="notice">Esta fuente cambió después de la propuesta. Compara el fragmento con el relato actual.</p>}
      {data.current_text && <details><summary>Leer el relato actual completo</summary><p className="record-description">{data.current_text}</p></details>}
      {file && <><p>La vista previa muestra la primera página. Descarga el PDF para consultar la página citada.</p>
        <button className="secondary" disabled={downloading} onClick={download}>{downloading ? 'Descargando…' : 'Descargar fuente original'}</button>
        <Preview recordId={recordId} file={file} onExpired={onExpired} onClose={onClose} /></>}
    </>}
  </section>
}

function Editor({event, busy, onSave, onCancel}: {event:Event; busy:boolean; onSave:(content:Content)=>void; onCancel:()=>void}) {
  const [description,setDescription] = useState(event.description)
  const [kind,setKind] = useState(event.date_kind)
  const [exact,setExact] = useState(event.event_date ?? '')
  const [approx,setApprox] = useState(event.approximate_date ?? '')
  return <form onSubmit={e => {e.preventDefault(); if(description.trim()) onSave({description,date_kind:kind,event_date:kind==='exact'?exact:null,approximate_date:kind==='approximate'?approx:null})}}>
    <fieldset disabled={busy}><label htmlFor="event-description">Descripción del evento</label>
      <textarea id="event-description" required maxLength={10000} rows={4} value={description} onChange={e => setDescription(e.target.value)} />
      <label htmlFor="event-date-kind">Precisión de la fecha</label><select id="event-date-kind" value={kind} onChange={e => setKind(e.target.value as Content['date_kind'])}>
        <option value="exact">Fecha exacta</option><option value="approximate">Fecha aproximada</option><option value="unknown">Fecha desconocida</option></select>
      {kind==='exact' && <><label htmlFor="event-date">Fecha del evento</label><input id="event-date" type="date" required value={exact} onChange={e => setExact(e.target.value)} /></>}
      {kind==='approximate' && <><label htmlFor="event-approx">Referencia aproximada</label><input id="event-approx" required maxLength={200} value={approx} onChange={e => setApprox(e.target.value)} /></>}
      <p className="small">Esta será tu corrección. La propuesta original y su fuente se conservan para compararlas.</p>
      <div className="actions"><button>Guardar corrección</button><button type="button" className="secondary" onClick={onCancel}>Cancelar corrección</button></div>
    </fieldset>
  </form>
}

export function Timeline({recordId,onExpired}:Props) {
  const [data,setData] = useState<State|null>(null)
  const [error,setError] = useState('')
  const [attempt,setAttempt] = useState(0)
  const [busy,setBusy] = useState('')
  const [editing,setEditing] = useState<string|null>(null)
  const [source,setSource] = useState<string|null>(null)
  const [confirm,setConfirm] = useState(false)
  useEffect(() => {
    let active = true
    setError(''); setData(null)
    api<State>(`/records/${recordId}/timeline`).then(value => {if(active)setData(value)}).catch(e => {
      if(!active)return
      if(e instanceof ApiError && e.status===401)onExpired()
      else setError(e.message)
    })
    return () => {active=false}
  },[recordId,onExpired,attempt])
  async function mutate(path:string, body:object, method='POST') {
    if(busy || !data)return
    setBusy(path);setError('');setConfirm(false)
    try {
      const next = await api<State>(`/records/${recordId}/timeline${path}`,{method,body:JSON.stringify({revision:data.revision,...body})})
      setData(next);setEditing(null)
      if(path==='/analyze')setSource(null)
    } catch(e) {
      if(e instanceof ApiError && e.status===401)onExpired()
      else setError((e as Error).message)
    } finally {setBusy('')}
  }
  function review(event:Event,status:Event['status'],content:Content=event) {
    return mutate(`/events/${event.id}`,{status,description:content.description,date_kind:content.date_kind,event_date:content.event_date,approximate_date:content.approximate_date},'PUT')
  }
  const events = data?.events ?? []
  const accepted = events.filter(e=>e.status==='accepted').length
  const pending = events.some(e=>e.status==='proposed')
  const sorted = [...events].sort((a,b) => {
    const rank = (e:Event) => e.status==='discarded'?3:e.date_kind==='exact'?0:e.date_kind==='approximate'?1:2
    return rank(a)-rank(b) || (a.date_kind==='exact'&&b.date_kind==='exact'?(a.event_date??'').localeCompare(b.event_date??''):0)
  })
  return <div className="home-page timeline-page">
    <section className="home-intro"><p className="eyebrow">TU CRONOLOGÍA PRIVADA</p><h1>Así organicé lo que me contaste</h1>
      <p>Es una propuesta. Revisa las fuentes y decide qué conservar.</p></section>
    {error && <div className="notice"><p className="error" role="alert">{error}</p><button className="secondary" disabled={!!busy} onClick={()=>{setEditing(null);setAttempt(v=>v+1)}}>Recargar cronología</button></div>}
    {!data ? !error && <p role="status">Cargando cronología…</p> : <>
      <p className="notice">{data.configured_mode==='demo' ? 'Modo demostración · Sin IA conectada. Se seleccionan fragmentos literales mediante reglas locales; no es una interpretación automática fiable.' : 'IA configurada · Al generar la propuesta, se enviarán fragmentos de tus relatos y PDF compatibles al proveedor configurado. No se envían originales.'}</p>
      <div className="actions"><button disabled={!!busy || !!editing} onClick={()=>mutate('/analyze',{})}>{busy==='/analyze'?'Organizando…':data.processed_at?'Volver a procesar':'Proponer cronología'}</button>
        <button className="secondary" disabled={!!busy || !!editing} onClick={()=>navigate(`registros/${recordId}`)}>Ver mi registro</button>
        <button className="secondary" disabled={!!busy || !!editing} onClick={()=>navigate(`registros/${recordId}/archivos`)}>Volver a archivos</button></div>
      <p className="small">Volver a procesar conserva tus correcciones, aceptaciones y descartes. No se evalúa culpabilidad, credibilidad ni sanciones. Nada se envía a la institución.</p>
      {busy==='/analyze' && <p role="status" className="notice">Procesando relatos y archivos compatibles. Tus revisiones anteriores siguen guardadas.</p>}
      {!!data.warnings.length && <details className="notice" open><summary>Fuentes y límites del análisis</summary><ul>{data.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></details>}
      {data.processed_at && events.length===0 && <div className="home-empty"><h2>No hay eventos propuestos</h2><p>Puedes completar tus relatos o continuar en tu registro. No necesitas analizar todos los archivos.</p></div>}
      {events.length>0 && <>
        <p className="timeline-order">Fechas exactas en orden cronológico. Las aproximadas y desconocidas se muestran aparte, sin asignarles un día.</p>
        <ol className="timeline-list">{sorted.map(event=><li className={`timeline-event ${event.status}`} key={event.id}>
          <span className={`badge date-${event.date_kind}`}>{dateLabel(event)}</span>
          <p className="event-origin">{event.edited?'Corregido por ti':event.mode==='demo'?'Propuesta de demostración':'Propuesto por IA'} · {event.status==='accepted'?'Aceptado por ti':event.status==='discarded'?'Descartado por ti':'Pendiente de revisión'}</p>
          {editing===event.id?<Editor event={event} busy={!!busy} onCancel={()=>setEditing(null)} onSave={content=>review(event,'proposed',content)} />:<>
            <p className="record-description">{event.description}</p>
            <p className="source-label">Fuente: {event.source.label}{event.source.page?` · página ${event.source.page}`:''}</p>
            <div className="actions"><button className="secondary" onClick={()=>setSource(source===event.id?null:event.id)}>Ver fuente</button>
              <button className="secondary" disabled={!!busy||!!editing} onClick={()=>setEditing(event.id)}>Corregir evento</button>
              {event.status!=='accepted' && <button disabled={!!busy||!!editing} onClick={()=>review(event,'accepted')}>Aceptar evento</button>}
              {event.status!=='discarded' && <button className="secondary" disabled={!!busy||!!editing} onClick={()=>review(event,'discarded')}>Descartar evento</button>}</div>
          </>}
          {event.edited && <details><summary>Comparar con la propuesta original</summary><p>{event.original.description}</p><p>{dateLabel(event.original)}</p></details>}
          {source===event.id && <SourceView recordId={recordId} event={event} onExpired={onExpired} onClose={()=>setSource(null)} />}
        </li>)}</ol>
        <section className="card timeline-confirm"><h2>Tu revisión</h2>
          {data.confirmed?<p role="status">Cronología confirmada por ti · Versión {data.revision}. Sigue siendo privada.</p>:<>
            <p>{accepted} evento(s) aceptado(s). {pending?'Acepta o descarta cada propuesta antes de confirmar.':'Puedes confirmar esta versión cuando termines de revisarla.'}</p>
            <label className="check-label"><input type="checkbox" checked={confirm} disabled={!!busy||!!editing||pending||!accepted} onChange={e=>setConfirm(e.target.checked)} />He revisado los eventos y sus fuentes.</label>
            <button disabled={!confirm||pending||!accepted||!!busy||!!editing} onClick={()=>mutate('/confirm',{})}>Confirmar cronología revisada</button>
          </>}
          <p className="small">Confirmar refleja tu revisión, no verifica que los hechos hayan ocurrido.</p>
        </section>
      </>}
    </>}
  </div>
}
