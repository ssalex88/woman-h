// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { App } from './App'

afterEach(() => { cleanup(); sessionStorage.clear(); window.location.hash = ''; vi.restoreAllMocks(); vi.unstubAllGlobals() })
beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}) })

test('inicia sesión, consulta el espacio autorizado y cierra la sesión', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    calls.push(url)
    if (url.endsWith('/health')) return Response.json({demo: true})
    if (url.endsWith('/me')) return Response.json({detail: 'Inicia sesión'}, {status: 401})
    if (url.endsWith('/login')) {
      expect(JSON.parse(options!.body as string)).toEqual({email: 'ana@example.test', password: 'ficticia'})
      return Response.json({id: 'ana', name: 'Ana Demo', email: 'ana@example.test', memberships: []})
    }
    if (url.endsWith('/context')) return Response.json({name: 'Ana Demo'})
    if (url.endsWith('/records')) return Response.json([])
    return new Response(null, {status: 204})
  }))
  render(<App />)
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Correo electrónico'), 'ana@example.test')
  await user.type(screen.getByLabelText('Contraseña'), 'ficticia')
  await user.click(screen.getByRole('button', {name: 'Ingresar a mi espacio'}))
  expect(await screen.findByRole('heading', {name: '¿Quieres contar qué ocurrió?'})).toBeInTheDocument()
  expect(calls).toContain('/api/private/ana/context')
  expect(screen.queryByRole('button', {name: /VERA Institutional/})).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', {name: 'Cerrar sesión'}))
  expect(await screen.findByLabelText('Contraseña')).toHaveValue('')
  expect(screen.queryByRole('heading', {name: '¿Quieres contar qué ocurrió?'})).not.toBeInTheDocument()
})

test('un fallo de conexión se comunica sin mostrar una sesión simulada', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  render(<App />)
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar con VERA')
  expect(screen.queryByText('ACCESO VERIFICADO')).not.toBeInTheDocument()
})
