// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { Files } from './Files'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const expired = () => {}
const limits = {items: [], max_upload_bytes: 1024, accepted_extensions: ['.png', '.jpg', '.jpeg', '.webp', '.pdf']}

test('carga multipart sin forzar Content-Type y permite editar vínculos', async () => {
  const writes: RequestInit[] = []
  const attachment = {id: 'archivo', filename: 'captura.png', description: null, media_type: 'image/png', size: 24, account_ids: ['relato']}
  let uploaded = false
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (options.method) { writes.push(options); uploaded = true; return Response.json(attachment) }
    if (url.endsWith('/accounts')) return Response.json([{id: 'relato', description: 'Hecho ficticio'}])
    return Response.json({...limits, items: uploaded ? [attachment] : []})
  }))
  render(<Files recordId="registro" onExpired={expired} />)
  const user = userEvent.setup()
  expect(await screen.findByText('Aún no hay archivos en este registro.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', {name: 'Añadir archivo'}))
  await user.upload(screen.getByLabelText('Archivo', {exact: true}), new File(['ficticio'], 'captura.png', {type: 'image/png'}))
  await user.click(await screen.findByRole('checkbox', {name: /Hecho ficticio/}))
  await user.click(screen.getByRole('button', {name: 'Subir archivo'}))
  expect(await screen.findByRole('heading', {name: 'captura.png'})).toBeInTheDocument()
  expect(writes[0].body).toBeInstanceOf(FormData)
  expect((writes[0].body as FormData).get('account_ids')).toBe('["relato"]')
  expect(writes[0].headers).not.toHaveProperty('Content-Type')
  await user.click(screen.getByRole('button', {name: 'Editar vínculos'}))
  const checkbox = await screen.findByRole('checkbox', {name: /Hecho ficticio/})
  expect(checkbox).toBeChecked()
  await user.click(checkbox)
  await user.click(screen.getByRole('button', {name: 'Guardar vínculos y descripción'}))
  expect(JSON.parse(writes[1].body as string).account_ids).toEqual([])
})

test('informa tamaño y formato inválidos y conserva campos ante rechazo del servidor', async () => {
  let writes = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (options.method) { writes++; return Response.json({detail: 'Archivo inválido o dañado'}, {status: 415}) }
    return Response.json(url.endsWith('/accounts') ? [] : limits)
  }))
  render(<Files recordId="registro" onExpired={expired} />)
  const user = userEvent.setup({applyAccept: false})
  await user.click(await screen.findByRole('button', {name: 'Añadir archivo'}))
  const input = screen.getByLabelText('Archivo', {exact: true})
  await user.upload(input, new File(['x'.repeat(1025)], 'grande.png', {type: 'image/png'}))
  await user.click(screen.getByRole('button', {name: 'Subir archivo'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('supera el límite')
  await user.upload(input, new File(['texto'], 'pagina.html', {type: 'text/html'}))
  await user.click(screen.getByRole('button', {name: 'Subir archivo'}))
  expect(screen.getByRole('alert')).toHaveTextContent('Formato no admitido')
  expect(writes).toBe(0)
  await user.upload(input, new File(['falso'], 'falso.png', {type: 'image/png'}))
  await user.type(screen.getByLabelText('Descripción del archivo (opcional)'), 'Descripción ficticia conservada')
  await user.click(screen.getByRole('button', {name: 'Subir archivo'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('Archivo inválido o dañado')
  expect(screen.getByLabelText('Descripción del archivo (opcional)')).toHaveValue('Descripción ficticia conservada')
})

test('una vista previa autorizada libera su URL temporal al cerrarla', async () => {
  const create = vi.fn(() => 'blob:temporal')
  const revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke })
  const attachment = {id: 'uno', filename: 'foto.png', description: null, media_type: 'image/png', size: 10, account_ids: []}
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/preview')
    ? new Response(new Blob(['PNG'], {type: 'image/png'})) : Response.json({...limits, items: [attachment]})))
  render(<Files recordId="registro" onExpired={expired} />)
  await userEvent.click(await screen.findByRole('button', {name: 'Ver vista previa'}))
  expect(await screen.findByRole('img', {name: 'Vista previa de foto.png'})).toHaveAttribute('src', 'blob:temporal')
  await userEvent.click(screen.getByRole('button', {name: 'Cerrar vista previa'}))
  expect(revoke).toHaveBeenCalledWith('blob:temporal')
})
