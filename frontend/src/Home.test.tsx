// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { PrivateWorkspace, clearStartDraft } from './Home'

afterEach(() => { cleanup(); sessionStorage.clear(); window.location.hash = ''; vi.restoreAllMocks(); vi.unstubAllGlobals() })
const onExpired = () => {}

test('conserva el texto al navegar y recargar, aislado por cuenta', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([])))
  const user = userEvent.setup()
  const view = render(<PrivateWorkspace userId="ana" route="inicio" onExpired={onExpired} />)
  await user.type(screen.getByLabelText('Te leemos'), 'Texto ficticio pendiente')
  view.rerender(<PrivateWorkspace userId="ana" route="registros" onExpired={onExpired} />)
  view.rerender(<PrivateWorkspace userId="ana" route="inicio" onExpired={onExpired} />)
  expect(screen.getByLabelText('Te leemos')).toHaveValue('Texto ficticio pendiente')
  view.unmount()
  const restored = render(<PrivateWorkspace userId="ana" route="inicio" onExpired={onExpired} />)
  expect(screen.getByLabelText('Te leemos')).toHaveValue('Texto ficticio pendiente')
  restored.unmount()
  render(<PrivateWorkspace userId="bea" route="inicio" onExpired={onExpired} />)
  expect(screen.getByLabelText('Te leemos')).toHaveValue('')
  clearStartDraft('ana')
  expect(sessionStorage.getItem('vera:start:ana')).toBeNull()
})

test('continuar no pide título ni fecha y conserva clave y texto para reintentar', async () => {
  const bodies: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    if (options.method === 'POST') {
      bodies.push(options.body as string)
      return bodies.length === 1 ? Response.json({detail:'Fallo'}, {status:503}) : Response.json({record_id:'registro', account_id:'relato'})
    }
    return Response.json([])
  }))
  render(<PrivateWorkspace userId="ana" route="inicio" onExpired={onExpired} />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Te leemos'), 'Relato ficticio')
  await user.click(screen.getByRole('button', {name:'Continuar'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu texto sigue aquí')
  expect(screen.getByLabelText('Te leemos')).toHaveValue('Relato ficticio')
  await user.click(screen.getByRole('button', {name:'Continuar'}))
  expect(bodies[0]).toBe(bodies[1])
  expect(Object.keys(JSON.parse(bodies[0])).sort()).toEqual(['entry_id','text'])
  expect(window.location.hash).toBe('#/registros/registro/archivos')
  expect(sessionStorage.getItem('vera:start:ana')).toBeNull()
})

test('muestra carga, error y vacío de registros sin perder el editor', async () => {
  let resolve!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>(r => {resolve = r}))
    .mockResolvedValueOnce(Response.json([])))
  render(<PrivateWorkspace userId="ana" route="inicio" onExpired={onExpired} />)
  expect(screen.getByRole('status')).toHaveTextContent('Cargando tus registros')
  await userEvent.type(screen.getByLabelText('Te leemos'), 'Texto ficticio')
  resolve(Response.json({detail:'Fallo'}, {status:503}))
  expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar tus registros')
  await userEvent.click(screen.getByRole('button', {name:'Reintentar registros'}))
  expect(await screen.findByText('Este espacio empieza contigo')).toBeInTheDocument()
  expect(screen.getByLabelText('Te leemos')).toHaveValue('Texto ficticio')
})

test('informa cuando el navegador no permite conservar el borrador', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([])))
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Sin espacio') })
  render(<PrivateWorkspace userId="ana" route="inicio" onExpired={onExpired} />)
  await userEvent.type(screen.getByLabelText('Te leemos'), 'Texto ficticio')
  expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar el borrador')
})
