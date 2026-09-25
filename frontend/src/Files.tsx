import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, apiBlob, ApiError } from './api'
import type { Account } from './Accounts'

export type Attachment = { id: string; filename: string; description: string | null; media_type: string; size: number;
  account_ids: string[]; created_at: string; preview_available: boolean }
type FileList = { items: Attachment[]; max_upload_bytes: number; accepted_extensions: string[] }
type Props = { recordId: string; onExpired: () => void; allowRemove?: boolean;
  onState?: (state: {count: number | null; editing: boolean}) => void }
const sizeLabel = (size: number) => `${(size / (size >= 1048576 ? 1048576 : 1024)).toLocaleString('es-PE', {maximumFractionDigits: 2})} ${size >= 1048576 ? 'MiB' : 'KiB'}`

function FileEditor({ recordId, onExpired, file, limits, onSaved, onCancel }: Props & {
  file?: Attachment; limits: FileList; onSaved: () => void; onCancel: () => void
}) {
  const [description, setDescription] = useState(file?.description ?? '')
  const [ids, setIds] = useState(file?.account_ids ?? [])
  const [selected, setSelected] = useState<File | null>(null)
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    setLoadError('')
    api<Account[]>(`/records/${recordId}/accounts`).then(data => { if (active) setAccounts(data) }).catch(e => {
      if (!active) return
      if (e instanceof ApiError && e.status === 401) onExpired()
      else setLoadError(e.message)
    })
    return () => { active = false }
  }, [recordId, onExpired, attempt])
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (!file && (!selected || selected.size === 0)) { setError('Selecciona un archivo que no esté vacío.'); return }
    if (selected && selected.size > limits.max_upload_bytes) { setError(`El archivo supera el límite de ${sizeLabel(limits.max_upload_bytes)}.`); return }
    if (selected && !limits.accepted_extensions.some(extension => selected.name.toLowerCase().endsWith(extension))) {
      setError('Formato no admitido. Usa PNG, JPEG, WebP o PDF.'); return
    }
    setBusy(true)
    try {
      if (file) {
        await api(`/records/${recordId}/files/${file.id}`, {method: 'PUT', body: JSON.stringify({description, account_ids: ids})})
      } else {
        const body = new FormData()
        body.append('file', selected!)
        body.append('description', description)
        body.append('account_ids', JSON.stringify(ids))
        await api(`/records/${recordId}/files`, {method: 'POST', body})
      }
      onSaved()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onExpired()
      else setError((e as Error).message)
    } finally { setBusy(false) }
  }
  return <section className="card"><h3>{file ? `Editar descripción y vínculos: ${file.filename}` : 'Cargar archivo privado'}</h3>
    <form onSubmit={save}><fieldset disabled={busy}>
      {!file && <><label htmlFor="attachment">Archivo</label><input id="attachment" type="file" accept={limits.accepted_extensions.join(',')} aria-required="true" onChange={e => setSelected(e.target.files?.[0] ?? null)} />
        <p className="small">PNG, JPEG, WebP o PDF. Máximo {sizeLabel(limits.max_upload_bytes)} por archivo. El servidor verificará el contenido real.</p></>}
      <label htmlFor="file-description">Descripción del archivo (opcional)</label><textarea id="file-description" maxLength={2000} rows={3} value={description} onChange={e => setDescription(e.target.value)} />
      <fieldset className="event-options"><legend>Vincular con relatos de hechos (opcional)</legend>
        {loadError ? <><p role="alert" className="error">{loadError}</p><button type="button" className="secondary" onClick={() => setAttempt(v => v + 1)}>Reintentar relatos disponibles</button></> :
          accounts === null ? <p role="status">Cargando relatos disponibles…</p> : accounts.length === 0 ? <p>No hay relatos todavía. Puedes vincular el archivo después.</p> :
            accounts.map((account, index) => <label key={account.id} className="check-label"><input type="checkbox" checked={ids.includes(account.id)}
              onChange={e => setIds(current => e.target.checked ? [...current, account.id] : current.filter(id => id !== account.id))} />
              Relato {index + 1}: {account.description.slice(0, 140)}</label>)}
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><button disabled={accounts === null || !!loadError}>{busy ? 'Guardando archivo…' : file ? 'Guardar vínculos y descripción' : 'Subir archivo'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancelar archivo</button></div>
    </fieldset></form>
  </section>
}

export function Preview({ recordId, file, onExpired, onClose }: Props & { file: Attachment; onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let objectUrl = ''
    apiBlob(`/records/${recordId}/files/${file.id}/preview`).then(blob => {
      if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) }
    }).catch(e => {
      if (!active) return
      if (e instanceof ApiError && e.status === 401) onExpired()
      else setError(e.message)
    })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [recordId, file.id, onExpired])
  return <div className="file-preview"><h4>Vista previa: {file.filename}</h4>
    {file.media_type === 'application/pdf' && <p className="small">Primera página del PDF.</p>}
    {error ? <p role="alert" className="error">{error}</p> : url ? <img src={url} alt={`Vista previa de ${file.filename}`} /> : <p role="status">Cargando vista previa…</p>}
    <button className="secondary" onClick={onClose}>Cerrar vista previa</button>
  </div>
}

export function Files({ recordId, onExpired, allowRemove = false, onState }: Props) {
  const [data, setData] = useState<FileList | null>(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState<Attachment | 'new' | null>(null)
  const [preview, setPreview] = useState<Attachment | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Attachment | null>(null)
  useEffect(() => { onState?.({count:data?.items.length ?? null, editing:!!editing || !!removing}) }, [data, editing, removing, onState])
  useEffect(() => {
    let active = true
    setData(null); setError('')
    api<FileList>(`/records/${recordId}/files`).then(value => { if (active) setData(value) }).catch(e => {
      if (!active) return
      if (e instanceof ApiError && e.status === 401) onExpired()
      else setError(e.message)
    })
    return () => { active = false }
  }, [recordId, onExpired, attempt])
  async function download(file: Attachment) {
    setActionError(''); setDownloading(file.id)
    try {
      const blob = await apiBlob(`/records/${recordId}/files/${file.id}/content`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = file.filename; document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onExpired()
      else setActionError((e as Error).message)
    } finally { setDownloading(null) }
  }
  async function remove(file: Attachment) {
    setRemoving(file.id); setActionError(''); setSaved(false)
    try {
      await api(`/records/${recordId}/files/${file.id}`, {method:'DELETE'})
      if (preview?.id === file.id) setPreview(null)
      setData(current => current ? {...current, items:current.items.filter(item => item.id !== file.id)} : current)
      setConfirmation(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onExpired()
      else setActionError('No pudimos quitar el archivo. Puedes volver a intentarlo.')
    } finally { setRemoving(null) }
  }
  return <section className="records" aria-labelledby="files-heading"><div className="record-heading"><h2 id="files-heading">Archivos privados</h2>
    {data && !editing && <button onClick={() => { setEditing('new'); setSaved(false) }}>Añadir archivo</button>}</div>
    <p>{allowRemove ? 'Puedes añadir capturas, fotos o PDF. Solo tú puedes acceder a estos archivos.' : 'Los originales se conservan por separado de las vistas previas. No se extrae texto ni se realiza análisis. Solo tú puedes acceder.'}</p>
    {saved && <p role="status">Archivo guardado.</p>}
    {error ? <><p role="alert" className="error">{error}</p><button className="secondary" onClick={() => setAttempt(v => v + 1)}>Reintentar archivos</button></> : !data ? <p role="status">Cargando archivos…</p> :
      editing ? <FileEditor recordId={recordId} onExpired={onExpired} limits={data} file={editing === 'new' ? undefined : editing}
        onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setSaved(true); setAttempt(v => v + 1) }} /> :
        data.items.length === 0 ? <p className="notice">Aún no hay archivos en este registro.</p> :
          <ul className="record-list">{data.items.map(file => <li key={file.id} className="card"><h3>{file.filename}</h3>
            <p>{file.media_type} · {sizeLabel(file.size)}</p><p className="record-description">{file.description ?? 'Sin descripción'}</p>
            <p>{file.account_ids.length ? `Vinculado a ${file.account_ids.length} relato(s). Usa «Editar vínculos» para consultarlos.` : 'Sin relatos vinculados'}</p>
            <div className="actions"><button className="secondary" onClick={() => setPreview(file)}>Ver vista previa</button>
              <button className="secondary" disabled={downloading !== null} onClick={() => download(file)}>{downloading === file.id ? 'Descargando…' : 'Descargar original'}</button>
              <button className="secondary" onClick={() => { setEditing(file); setSaved(false) }}>Editar vínculos</button>
              {allowRemove && <button className="secondary" disabled={!!removing} onClick={() => setConfirmation(file)}>Quitar archivo</button>}</div>
          </li>)}</ul>}
    {actionError && <p role="alert" className="error">{actionError}</p>}
    {confirmation && <div className="notice" role="group" aria-label="Confirmar quitar archivo"><p>¿Quitar {confirmation.filename}? Se eliminará de este registro. Puedes volver a cargarlo después.</p>
      <div className="actions"><button disabled={!!removing} onClick={() => remove(confirmation)}>{removing ? 'Quitando archivo…' : 'Sí, quitar archivo'}</button>
        <button className="secondary" disabled={!!removing} onClick={() => setConfirmation(null)}>Conservar archivo</button></div></div>}
    {preview && <Preview key={preview.id} recordId={recordId} file={preview} onExpired={onExpired} onClose={() => setPreview(null)} />}
  </section>
}
