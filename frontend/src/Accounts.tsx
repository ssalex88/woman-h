import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from './api'

type DateKind = 'exact' | 'approximate' | 'unknown'
export type Account = { id: string; description: string; date_kind: DateKind; event_date: string | null;
  approximate_date: string | null; place: string | null; mentioned_people: string | null; created_at: string; updated_at: string }
type Props = { recordId: string; onExpired: () => void }

function AccountForm({ recordId, account, onSaved, onCancel, onExpired }: Props & {
  account?: Account; onSaved: () => void; onCancel: () => void
}) {
  const [description, setDescription] = useState(account?.description ?? '')
  const [kind, setKind] = useState<DateKind>(account?.date_kind ?? 'unknown')
  const [date, setDate] = useState(account?.event_date ?? '')
  const [approximate, setApproximate] = useState(account?.approximate_date ?? '')
  const [place, setPlace] = useState(account?.place ?? '')
  const [people, setPeople] = useState(account?.mentioned_people ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!description.trim() || kind === 'approximate' && !approximate.trim()) {
      setError('Completa la descripción y, si corresponde, la referencia de fecha aproximada.'); return
    }
    setBusy(true); setError('')
    try {
      await api(`/records/${recordId}/accounts${account ? `/${account.id}` : ''}`, {
        method: account ? 'PUT' : 'POST', body: JSON.stringify({description, date_kind: kind,
          event_date: kind === 'exact' ? date : null, approximate_date: kind === 'approximate' ? approximate : null,
          place: place.trim() || null, mentioned_people: people.trim() || null})
      })
      onSaved()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onExpired()
      else setError((e as Error).message)
    } finally { setBusy(false) }
  }
  return <section className="card"><h3>{account ? 'Editar relato' : 'Añadir relato'}</h3>
    <p>No necesitas archivos ni una fecha exacta. Utiliza solo datos ficticios durante el desarrollo.</p>
    <form onSubmit={save}><fieldset disabled={busy}>
      <label htmlFor="account-description">Descripción del hecho</label>
      <textarea id="account-description" required maxLength={10000} rows={6} value={description} onChange={e => setDescription(e.target.value)} />
      <label htmlFor="date-kind">Fecha del hecho</label>
      <select id="date-kind" value={kind} onChange={e => setKind(e.target.value as DateKind)}>
        <option value="unknown">Desconocida</option><option value="approximate">Aproximada</option><option value="exact">Exacta</option>
      </select>
      {kind === 'exact' && <><label htmlFor="event-date">Fecha exacta</label><input id="event-date" type="date" required value={date} onChange={e => setDate(e.target.value)} /></>}
      {kind === 'approximate' && <><label htmlFor="approximate-date">Referencia de fecha aproximada</label>
        <input id="approximate-date" required maxLength={200} value={approximate} onChange={e => setApproximate(e.target.value)} aria-describedby="approximate-hint" />
        <p id="approximate-hint" className="small">Por ejemplo: «a mediados de marzo de 2025». Se conservará tu referencia sin asignar un día exacto.</p></>}
      {kind === 'unknown' && <p className="small">Se guardará como fecha desconocida, sin asignar una fecha al hecho.</p>}
      <label htmlFor="account-place">Lugar (opcional)</label><input id="account-place" maxLength={500} value={place} onChange={e => setPlace(e.target.value)} />
      <label htmlFor="account-people">Personas mencionadas (opcional)</label><textarea id="account-people" rows={3} maxLength={2000} value={people} onChange={e => setPeople(e.target.value)} />
      <p className="small">La fecha de registro se guarda automáticamente y es distinta de la fecha del hecho.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="actions"><button type="submit">{busy ? 'Guardando relato…' : account ? 'Guardar cambios del relato' : 'Guardar relato'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancelar relato</button></div>
    </fieldset></form>
  </section>
}

export function Accounts({ recordId, onExpired, onEditing }: Props & {onEditing?: (value:boolean) => void}) {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { onEditing?.(!!editing) }, [editing, onEditing])
  useEffect(() => {
    let active = true
    setAccounts(null); setError('')
    api<Account[]>(`/records/${recordId}/accounts`).then(data => { if (active) setAccounts(data) }).catch(e => {
      if (!active) return
      if (e instanceof ApiError && e.status === 401) onExpired()
      else setError(e.message)
    })
    return () => { active = false }
  }, [recordId, onExpired, attempt])
  return <section className="records" aria-labelledby="accounts-heading"><div className="record-heading"><h2 id="accounts-heading">Relatos de hechos</h2>
    {!editing && <button onClick={() => { setEditing('new'); setSaved(false) }}>Añadir relato</button>}</div>
    {editing ? <AccountForm key={editing === 'new' ? 'new' : editing.id} recordId={recordId} onExpired={onExpired}
      account={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)}
      onSaved={() => { setEditing(null); setSaved(true); setAttempt(value => value + 1) }} /> : <>
      {saved && <p role="status">Relato guardado.</p>}
      {error ? <div><p role="alert" className="error">{error}</p><button className="secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar relatos</button></div> :
        accounts === null ? <p role="status">Cargando relatos…</p> : accounts.length === 0 ? <p className="notice">Aún no hay relatos en este registro.</p> :
          <ul className="record-list">{accounts.map((account, index) => <li className="card" key={account.id}>
            <h3>Relato {index + 1}</h3>
            <span className={`badge date-${account.date_kind}`}>{account.date_kind === 'exact' ? 'Fecha exacta' : account.date_kind === 'approximate' ? 'Fecha aproximada' : 'Fecha desconocida'}</span>
            <p><strong>Fecha del hecho: </strong>{account.date_kind === 'exact' ? account.event_date!.split('-').reverse().join('/') : account.date_kind === 'approximate' ? account.approximate_date : 'Desconocida'}</p>
            <p className="record-description">{account.description}</p>
            <p className="record-description"><strong>Lugar: </strong>{account.place ?? 'No indicado'}</p>
            <p className="record-description"><strong>Personas mencionadas: </strong>{account.mentioned_people ?? 'No indicadas'}</p>
            <p className="small">Fecha de registro: {new Date(account.created_at).toLocaleString('es-PE')}</p>
            <button className="secondary" aria-label={`Editar relato ${index + 1}`} onClick={() => { setEditing(account); setSaved(false) }}>Editar relato</button>
          </li>)}</ul>}
    </>}
  </section>
}
