import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import { Files } from './Files'
import { Accounts } from './Accounts'
import type { PrivateRecord } from './Records'
import { navigate } from './Home'

export function AttachmentStep({recordId, relato, onExpired}: {recordId:string; relato:boolean; onExpired:()=>void}) {
  const [record, setRecord] = useState<PrivateRecord | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [editingRelato, setEditingRelato] = useState(false)
  const [files, setFiles] = useState<{count:number | null; editing:boolean}>({count:null,editing:false})
  useEffect(() => {
    let active = true
    setRecord(null); setError('')
    api<PrivateRecord>(`/records/${recordId}`).then(value => {if (active) setRecord(value)}).catch(e => {
      if (!active) return
      if (e instanceof ApiError && e.status === 401) onExpired()
      else setError('No pudimos abrir este registro. Comprueba que pertenece a tu cuenta e intenta nuevamente.')
    })
    return () => {active = false}
  }, [recordId, onExpired, attempt])
  if (error) return <section className="card"><p role="alert" className="error">{error}</p><button onClick={() => setAttempt(value => value + 1)}>Reintentar</button></section>
  if (!record) return <p role="status">Cargando tu registro privado…</p>
  return <div className="home-page attachment-step">
    <section className="home-intro"><p className="eyebrow">TU REGISTRO PRIVADO</p>
      <h1>{relato ? 'Tu relato' : '¿Tienes algún archivo relacionado con lo ocurrido?'}</h1>
      <p>{relato ? 'Puedes revisarlo y editarlo. Los archivos que añadiste siguen guardados.' : 'No es obligatorio. Puedes añadirlo ahora o más adelante.'}</p>
    </section>
    <p className="notice">Tu relato ya está guardado. Todo permanece privado; no se envía nada a la institución.</p>
    {relato ? <>
      <Accounts recordId={recordId} onExpired={onExpired} onEditing={setEditingRelato} />
      <p className="small">Guarda los cambios del relato antes de volver a los archivos.</p>
      <button disabled={editingRelato} onClick={() => navigate(`registros/${recordId}/archivos`)}>Volver a los archivos</button>
    </> : <>
      <Files recordId={recordId} onExpired={onExpired} allowRemove onState={setFiles} />
      <div className="actions step-navigation">
        <button className="secondary" disabled={files.editing} onClick={() => navigate(`registros/${recordId}/relato`)}>Volver al relato</button>
        <button disabled={files.editing} onClick={() => navigate(`registros/${recordId}/cronologia`)}>{files.count === 0 ? 'Continuar sin archivos' : files.count === null ? 'Continuar' : 'Continuar con archivos'}</button>
      </div>
      {files.editing && <p className="small">Sube el archivo o cancela su selección antes de continuar.</p>}
    </>}
  </div>
}
