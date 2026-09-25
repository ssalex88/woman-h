// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { PrivateWorkspace } from './Home'
import { VoiceCapture } from './VoiceCapture'
import type { SpeechResultEvent, SpeechSession } from './speech'

class Recognition implements SpeechSession {
  static last: Recognition
  lang = ''; continuous = false; interimResults = false; maxAlternatives = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onresult: ((event: SpeechResultEvent) => void) | null = null
  onerror: ((event: {error: string}) => void) | null = null
  start = vi.fn(() => { this.onstart?.() })
  stop = vi.fn()
  abort = vi.fn()
  constructor() { Recognition.last = this }
  result(text: string, isFinal = false) { this.onresult?.({results:[{0:{transcript:text}, isFinal, length:1}]}) }
}
const expired = () => {}
beforeEach(() => {
  vi.stubGlobal('SpeechRecognition', Recognition)
  vi.stubGlobal('webkitSpeechRecognition', undefined)
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => options.method ?
    Response.json({record_id:'guardado',account_id:'relato'}) : Response.json([])))
})
afterEach(() => { cleanup(); sessionStorage.clear(); window.location.hash=''; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

test('voz editable, resultados sin duplicados, revisión explícita y mismo guardado', async () => {
  render(<PrivateWorkspace userId="ana" route="inicio" onExpired={expired} />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Te leemos'), 'Texto previo ficticio.')
  await user.click(screen.getByRole('button', {name:'Contarlo por voz'}))
  await user.click(screen.getByRole('button', {name:'Iniciar voz'}))
  const engine = Recognition.last
  expect(engine.lang).toBe('es-PE')
  expect(screen.getByText('Micrófono activo · Escuchando…')).toBeInTheDocument()
  expect(screen.getByRole('button', {name:'Continuar'})).toBeDisabled()
  act(() => { engine.result('Relato'); engine.result('Relato ficticio por voz.', true) })
  expect(screen.getByLabelText('Te leemos')).toHaveValue('Texto previo ficticio.\n\nRelato ficticio por voz.')
  await user.click(screen.getByRole('button', {name:'Detener y revisar'}))
  expect(engine.stop).toHaveBeenCalledOnce()
  expect(screen.getByText('Finalizando la transcripción…')).toBeInTheDocument()
  act(() => engine.onend?.())
  expect(screen.getByRole('button', {name:'Continuar'})).toBeDisabled()
  expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
  await user.clear(screen.getByLabelText('Te leemos'))
  await user.type(screen.getByLabelText('Te leemos'), 'Relato ficticio revisado.')
  await user.click(screen.getByRole('checkbox', {name:'He revisado y corregido el texto.'}))
  await user.type(screen.getByLabelText('Te leemos'), ' Corrección.')
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', {name:'Continuar'}))
  const post = vi.mocked(fetch).mock.calls.find(([, options]) => options?.method === 'POST')!
  expect(JSON.parse(post[1]!.body as string)).toMatchObject({source:'voice',reviewed:true,text:'Relato ficticio revisado. Corrección.'})
})

test('permiso denegado permite escribir sin perder el avance', async () => {
  render(<PrivateWorkspace userId="ana" route="inicio" onExpired={expired} />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Te leemos'), 'Avance ficticio')
  await user.click(screen.getByRole('button', {name:'Contarlo por voz'}))
  await user.click(screen.getByRole('button', {name:'Iniciar voz'}))
  act(() => Recognition.last.onerror?.({error:'not-allowed'}))
  expect(screen.getByRole('alert')).toHaveTextContent('No se permitió el micrófono')
  expect(Recognition.last.abort).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', {name:'Seguir escribiendo'}))
  expect(screen.getByLabelText('Te leemos')).toHaveValue('Avance ficticio')
  expect(screen.getByLabelText('Te leemos')).toBeEnabled()
})

test('navegador incompatible ofrece escritura inmediata', async () => {
  vi.stubGlobal('SpeechRecognition', undefined)
  render(<PrivateWorkspace userId="ana" route="inicio" onExpired={expired} />)
  await userEvent.click(screen.getByRole('button', {name:'Contarlo por voz'}))
  expect(screen.getByText(/La voz no está disponible en este navegador/)).toBeInTheDocument()
  expect(screen.queryByRole('button', {name:'Iniciar voz'})).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', {name:'Seguir escribiendo'}))
  expect(screen.getByLabelText('Te leemos')).toBeEnabled()
})

test('la revisión sigue pendiente tras recargar o volver a Inicio', async () => {
  const view = render(<PrivateWorkspace userId="ana" route="inicio" onExpired={expired} />)
  await userEvent.click(screen.getByRole('button', {name:'Contarlo por voz'}))
  await userEvent.click(screen.getByRole('button', {name:'Iniciar voz'}))
  act(() => { Recognition.last.result('Transcripción ficticia'); Recognition.last.onend?.() })
  view.unmount()
  render(<PrivateWorkspace userId="ana" route="inicio" onExpired={expired} />)
  expect(screen.getByLabelText('Te leemos')).toHaveValue('Transcripción ficticia')
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(screen.getByRole('button', {name:'Continuar'})).toBeDisabled()
})

test('error de red conserva texto pendiente y desmontar aborta sin aceptar resultados tardíos', async () => {
  const onText = vi.fn()
  const view = render(<VoiceCapture text="Previo" onText={onText} onBusy={() => {}} onWrite={() => {}} />)
  await userEvent.click(screen.getByRole('button', {name:'Iniciar voz'}))
  const session = Recognition.last
  act(() => session.result('Texto ficticio'))
  expect(onText).toHaveBeenCalledWith('Previo\n\nTexto ficticio')
  act(() => session.onerror?.({error:'network'}))
  expect(screen.getByRole('alert')).toHaveTextContent('servicio de voz')
  await userEvent.click(screen.getByRole('button', {name:'Iniciar voz'}))
  const late = Recognition.last.onresult!
  view.unmount()
  expect(Recognition.last.abort).toHaveBeenCalledOnce()
  late({results:[{0:{transcript:'Resultado tardío'},length:1,isFinal:true}]})
  expect(onText).toHaveBeenCalledTimes(1)
})

test('se libera el micrófono si el servicio no finaliza', async () => {
  vi.useFakeTimers()
  render(<VoiceCapture text="" onText={() => {}} onBusy={() => {}} onWrite={() => {}} />)
  fireEvent.click(screen.getByRole('button', {name:'Iniciar voz'}))
  fireEvent.click(screen.getByRole('button', {name:'Detener y revisar'}))
  act(() => { vi.advanceTimersByTime(8000) })
  expect(Recognition.last.abort).toHaveBeenCalledOnce()
  expect(screen.getByRole('alert')).toHaveTextContent('tardó demasiado')
})
