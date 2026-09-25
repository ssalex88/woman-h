// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { Records } from './Records'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const expired = vi.fn()

test('lista vacía, creación, detalle y edición; conserva los campos si falla guardar', async () => {
  let record: Record<string, string> | null = null
  let fail = true
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith('/accounts')) return Response.json([])
    if (url.endsWith('/files')) return Response.json({items: [], max_upload_bytes: 10485760, accepted_extensions: ['.png', '.pdf']})
    if (options.method === 'POST' || options.method === 'PUT') {
      if (fail) { fail = false; return Response.json({detail: 'Error al guardar'}, {status: 503}) }
      record = { ...JSON.parse(options.body as string), id: 'uno', status: 'private_draft', created_at: '2026-09-24T12:00:00Z' }
      return Response.json(record, {status: 201})
    }
    return Response.json(url.endsWith('/records') ? record ? [record] : [] : record)
  }))
  render(<Records onExpired={expired} />)
  const user = userEvent.setup()
  expect(await screen.findByText('Aún no tienes registros')).toBeInTheDocument()
  await user.click(screen.getByRole('button', {name: 'Nuevo registro'}))
  await user.type(screen.getByLabelText('Título'), 'Mi registro ficticio')
  await user.type(screen.getByLabelText('Descripción inicial'), '<script>dato ficticio</script>')
  await user.click(screen.getByRole('button', {name: 'Crear registro'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('Error al guardar')
  expect(screen.getByLabelText('Título')).toHaveValue('Mi registro ficticio')
  await user.click(screen.getByRole('button', {name: 'Crear registro'}))
  expect(await screen.findByRole('heading', {name: 'Mi registro ficticio'})).toBeInTheDocument()
  expect(screen.getByText('<script>dato ficticio</script>')).toBeInTheDocument()
  expect(document.querySelector('script')).toBeNull()
  await user.click(screen.getByRole('button', {name: 'Editar registro'}))
  await user.clear(screen.getByLabelText('Título'))
  await user.type(screen.getByLabelText('Título'), 'Título actualizado')
  await user.click(screen.getByRole('button', {name: 'Guardar cambios'}))
  expect(await screen.findByRole('heading', {name: 'Título actualizado'})).toBeInTheDocument()
  await user.click(screen.getByRole('button', {name: 'Volver a mis registros'}))
  expect(await screen.findByRole('button', {name: 'Título actualizado'})).toBeInTheDocument()
})

test('muestra carga y permite reintentar un error de lista', async () => {
  let resolve!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    .mockResolvedValueOnce(Response.json([])))
  render(<Records onExpired={expired} />)
  expect(screen.getByRole('status')).toHaveTextContent('Cargando tus registros')
  resolve(Response.json({detail: 'No se pudo cargar'}, {status: 500}))
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar')
  await userEvent.click(screen.getByRole('button', {name: 'Reintentar'}))
  expect(await screen.findByText('Aún no tienes registros')).toBeInTheDocument()
})

test('una sesión expirada se comunica al contenedor', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({detail: 'Sesión vencida'}, {status: 401})))
  render(<Records onExpired={expired} />)
  await vi.waitFor(() => expect(expired).toHaveBeenCalled())
})

test('un detalle inaccesible muestra error y permite volver a la lista', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/records')
    ? Response.json([{id: 'uno', title: 'Registro ficticio', created_at: '2026-09-24T12:00:00Z'}])
    : Response.json({detail: 'Registro no encontrado'}, {status: 404})))
  render(<Records onExpired={expired} />)
  await userEvent.click(await screen.findByRole('button', {name: 'Registro ficticio'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('Registro no encontrado')
  expect(screen.queryByRole('button', {name: 'Editar registro'})).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', {name: 'Volver a mis registros'}))
  expect(await screen.findByRole('heading', {name: 'Mis registros'})).toBeInTheDocument()
})
