// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { Accounts } from './Accounts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const onExpired = () => {}

test('guarda sin fecha ni archivos, muestra incertidumbre y edita sin inventar valores', async () => {
  let accounts: object[] = []
  const writes: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    if (options.method) {
      const data = JSON.parse(options.body as string)
      writes.push(data)
      accounts = [{...data, id: 'uno', created_at: '2026-09-24T12:00:00Z'}]
      return Response.json(accounts[0])
    }
    return Response.json(accounts)
  }))
  render(<Accounts recordId="registro" onExpired={onExpired} />)
  const user = userEvent.setup()
  expect(await screen.findByText('Aún no hay relatos en este registro.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', {name: 'Añadir relato'}))
  await user.type(screen.getByLabelText('Descripción del hecho'), 'Relato ficticio')
  await user.click(screen.getByRole('button', {name: 'Guardar relato'}))
  expect(await screen.findByText('Fecha desconocida')).toBeInTheDocument()
  expect(writes[0]).toMatchObject({event_date: null, approximate_date: null, place: null, mentioned_people: null})
  expect(writes[0]).not.toHaveProperty('created_at')
  await user.click(screen.getByRole('button', {name: 'Editar relato 1'}))
  await user.selectOptions(screen.getByLabelText('Fecha del hecho'), 'approximate')
  await user.type(screen.getByLabelText('Referencia de fecha aproximada'), 'A mediados de marzo')
  await user.click(screen.getByRole('button', {name: 'Guardar cambios del relato'}))
  expect(await screen.findByText('Fecha aproximada')).toBeInTheDocument()
  expect(writes[1]).toMatchObject({event_date: null, approximate_date: 'A mediados de marzo'})
  await user.click(screen.getByRole('button', {name: 'Editar relato 1'}))
  await user.selectOptions(screen.getByLabelText('Fecha del hecho'), 'exact')
  await user.type(screen.getByLabelText('Fecha exacta'), '2025-03-01')
  await user.click(screen.getByRole('button', {name: 'Guardar cambios del relato'}))
  expect(await screen.findByText('Fecha exacta')).toBeInTheDocument()
  expect(writes[2]).toMatchObject({event_date: '2025-03-01', approximate_date: null})
})

test('conserva la descripción al fallar el guardado', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => options.method
    ? Response.json({detail: 'Error al guardar'}, {status: 503}) : Response.json([])))
  render(<Accounts recordId="registro" onExpired={onExpired} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', {name: 'Añadir relato'}))
  await user.type(screen.getByLabelText('Descripción del hecho'), 'Texto ficticio conservado')
  await user.click(screen.getByRole('button', {name: 'Guardar relato'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('Error al guardar')
  expect(screen.getByLabelText('Descripción del hecho')).toHaveValue('Texto ficticio conservado')
})

test('muestra carga, error y recuperación de la lista de relatos', async () => {
  let resolve!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    .mockResolvedValueOnce(Response.json([])))
  render(<Accounts recordId="registro" onExpired={onExpired} />)
  expect(screen.getByRole('status')).toHaveTextContent('Cargando relatos')
  resolve(Response.json({detail: 'Error de consulta'}, {status: 503}))
  expect(await screen.findByRole('alert')).toHaveTextContent('Error de consulta')
  await userEvent.click(screen.getByRole('button', {name: 'Reintentar relatos'}))
  expect(await screen.findByText('Aún no hay relatos en este registro.')).toBeInTheDocument()
})
