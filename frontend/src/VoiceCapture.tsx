import { useEffect, useRef, useState } from 'react'
import { browserSpeech, speechErrors } from './speech'
import type { SpeechSession } from './speech'

type Props = {text: string; onText: (text: string) => void; onBusy: (busy: boolean) => void; onWrite: () => void}
type Phase = 'idle' | 'permission' | 'listening' | 'transcribing'

export function VoiceCapture(props: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [seconds, setSeconds] = useState(0)
  const current = useRef<SpeechSession | null>(null)
  const stopping = useRef(false)
  const callbacks = useRef(props)
  callbacks.current = props
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null)
  const supported = !!browserSpeech()

  function clearTimers() {
    timers.current.forEach(clearTimeout); timers.current = []
    if (ticker.current) clearInterval(ticker.current)
    ticker.current = null
  }
  function release(abort = true) {
    const session = current.current
    current.current = null
    clearTimers()
    if (session) {
      session.onstart = null; session.onresult = null; session.onerror = null; session.onend = null
      if (abort) { try { session.abort() } catch { /* Ya estaba detenido. */ } }
    }
  }
  function finish(message?: string) {
    release()
    setPhase('idle'); callbacks.current.onBusy(false)
    if (message) setError(message)
  }
  function stop() {
    const session = current.current
    if (!session) return
    stopping.current = true
    clearTimers(); setPhase('transcribing')
    timers.current.push(setTimeout(() => {
      if (current.current === session) finish('El servicio de voz tardó demasiado. Revisa el texto disponible o continúa escribiendo.')
    }, 8000))
    try { session.stop() } catch { finish('No pudimos finalizar la transcripción. Puedes revisar el texto disponible y escribir.') }
  }
  useEffect(() => {
    const leave = () => { if (document.hidden && current.current) stop() }
    document.addEventListener('visibilitychange', leave)
    return () => {
      document.removeEventListener('visibilitychange', leave)
      release(); callbacks.current.onBusy(false)
    }
  }, [])

  function start() {
    if (current.current) return
    const Constructor = browserSpeech()
    if (!Constructor) return
    setError(''); setNotice(''); setSeconds(0)
    const base = callbacks.current.text.trimEnd()
    if (base.length >= 10000) { setError('El texto alcanzó el límite de 10 000 caracteres. Revísalo antes de añadir más.'); return }
    let receivedText = false
    try {
      const session = new Constructor()
      stopping.current = false
      current.current = session
      session.lang = 'es-PE'; session.continuous = true; session.interimResults = true; session.maxAlternatives = 1
      setPhase('permission'); callbacks.current.onBusy(true)
      timers.current.push(setTimeout(() => {
        if (current.current === session) finish('No se pudo iniciar la voz. Revisa el permiso del micrófono o continúa escribiendo.')
      }, 20000))
      session.onstart = () => {
        if (current.current !== session || stopping.current) return
        clearTimers(); setPhase('listening')
        ticker.current = setInterval(() => setSeconds(value => value + 1), 1000)
        timers.current.push(setTimeout(() => {
          if (current.current === session) { setNotice('Se alcanzaron los 2 minutos. Revisa el texto; puedes iniciar otra captura.'); stop() }
        }, 120000))
      }
      session.onresult = event => {
        if (current.current !== session) return
        // La lista es acumulativa: reemplazar esta captura, no añadir repetidamente sus resultados.
        const words = Array.from(event.results).map(result => result[0].transcript.trim()).filter(Boolean).join(' ')
        if (!words) return
        receivedText = true
        const combined = [base, words].filter(Boolean).join('\n\n')
        callbacks.current.onText(combined.slice(0, 10000))
        if (combined.length > 10000) {
          finish('Se alcanzó el límite de 10 000 caracteres. El texto que excedía el límite no se añadió. Revisa lo capturado.')
        }
      }
      session.onerror = event => {
        if (current.current === session) finish(speechErrors[event.error] ?? 'La voz no está disponible ahora. Tu texto sigue aquí; puedes escribir.')
      }
      session.onend = () => {
        if (current.current !== session) return
        release(false); setPhase('idle'); callbacks.current.onBusy(false)
        if (!receivedText) setError('No se obtuvo texto. Puedes volver a intentar o escribir.')
        else setNotice('Revisa el texto obtenido. Puede contener errores; nada se guarda como relato hasta que confirmes y continúes.')
      }
      session.start()
    } catch {
      finish('No se pudo iniciar la voz en este navegador. Tu texto sigue aquí; puedes escribir.')
    }
  }
  function write() { release(); callbacks.current.onBusy(false); callbacks.current.onWrite() }

  return <section className="voice-panel" aria-label="Captura de voz">
    <p className="voice-explanation">VERA no guarda archivos de audio. El navegador puede enviar tu voz a su proveedor para transcribirla. La disponibilidad depende del navegador y de la conexión.</p>
    {!supported ? <p role="status">La voz no está disponible en este navegador o conexión. Puedes contar lo ocurrido por escrito.</p> : <>
      <div className="voice-controls">
        {phase === 'idle' ? <button type="button" onClick={start}>Iniciar voz</button> :
          <button type="button" disabled={phase === 'transcribing'} onClick={stop}>{phase === 'transcribing' ? 'Transcribiendo…' : 'Detener y revisar'}</button>}
        <p role="status" aria-live="polite">{phase === 'permission' ? 'Esperando permiso del micrófono…' : phase === 'listening' ? 'Micrófono activo · Escuchando…' : phase === 'transcribing' ? 'Finalizando la transcripción…' : 'Habla a tu ritmo. Hasta 2 minutos por captura.'}</p>
        {phase === 'listening' && <span className="voice-timer" aria-label="Tiempo de captura">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}
      </div>
      <p className="small">Al iniciar, permites que el navegador procese tu voz. Usa solo datos ficticios durante la demostración.</p>
    </>}
    {notice && <p className="voice-notice">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <button type="button" className="secondary" onClick={write}>Seguir escribiendo</button>
  </section>
}
