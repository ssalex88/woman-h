import { expect, test } from '@playwright/test'

test('HU-02: fechas explícitas, persistencia, edición y aislamiento de relatos', async ({ page }) => {
  const title = `Relatos ficticios HU-02 ${Date.now()}`
  async function login(email: string) {
    await page.getByLabel('Correo electrónico').fill(email)
    await page.getByLabel('Contraseña').fill(process.env.DEMO_PASSWORD || 'Vera-Ficticia-2026!')
    await page.getByRole('button', {name: 'Ingresar a mi espacio'}).click()
    await page.getByRole('link', {name: 'Mis registros', exact:true}).click()
    await expect(page.getByRole('heading', {name: 'Mis registros'})).toBeVisible()
  }
  await page.goto('/')
  await login('ana@example.test')
  await page.getByRole('button', {name: 'Nuevo registro', exact: true}).click()
  await page.getByLabel('Título', {exact: true}).fill(title)
  await page.getByLabel('Descripción inicial').fill('Contexto ficticio de prueba')
  const recordResponse = page.waitForResponse(r => r.url().endsWith('/api/records') && r.request().method() === 'POST')
  await page.getByRole('button', {name: 'Crear registro', exact: true}).click()
  const record = await (await recordResponse).json()
  const path = `/api/records/${record.id}/accounts`
  await expect(page.getByText('Aún no hay relatos en este registro.')).toBeVisible()
  await page.getByRole('button', {name: 'Añadir relato', exact: true}).click()
  await page.getByLabel('Descripción del hecho').fill('Hecho ficticio de fecha desconocida')
  const unknownResponse = page.waitForResponse(r => r.url().endsWith(path) && r.request().method() === 'POST')
  await page.getByRole('button', {name: 'Guardar relato', exact: true}).click()
  const unknown = await (await unknownResponse).json()
  expect(unknown.event_date).toBeNull()
  expect(unknown.approximate_date).toBeNull()
  expect(unknown.place).toBeNull()
  expect(unknown.mentioned_people).toBeNull()
  await expect(page.getByText('Fecha desconocida', {exact: true})).toBeVisible()
  for (const kind of ['approximate', 'exact']) {
    await page.getByRole('button', {name: 'Añadir relato', exact: true}).click()
    await page.getByLabel('Descripción del hecho').fill(`Hecho ficticio ${kind}`)
    await page.getByLabel('Fecha del hecho', {exact: true}).selectOption(kind)
    if (kind === 'approximate') {
      await page.getByLabel('Referencia de fecha aproximada').fill('A mediados de marzo de 2025')
    } else {
      await page.getByLabel('Fecha exacta', {exact: true}).fill('2025-03-14')
    }
    await page.getByLabel('Lugar (opcional)').fill('Lugar ficticio')
    await page.getByLabel('Personas mencionadas (opcional)').fill('Persona ficticia')
    await page.getByRole('button', {name: 'Guardar relato', exact: true}).click()
    await expect(page.getByText(kind === 'approximate' ? 'Fecha aproximada' : 'Fecha exacta', {exact: true})).toBeVisible()
  }
  await page.reload()
  await expect(page.getByText('Fecha aproximada', {exact: true})).toBeVisible()
  await expect(page.getByText('Fecha exacta', {exact: true})).toBeVisible()
  await page.getByRole('button', {name: 'Editar relato 1', exact: true}).click()
  await page.getByLabel('Descripción del hecho').fill('Relato ficticio corregido')
  await page.getByRole('button', {name: 'Guardar cambios del relato'}).click()
  await expect(page.getByText('Relato ficticio corregido', {exact: true})).toBeVisible()
  const stored = await (await page.request.get(`${path}/${unknown.id}`)).json()
  expect(stored.created_at).toBe(unknown.created_at)
  expect(stored.event_date).toBeNull()
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  for (const email of ['bea@example.test', 'admin@example.test']) {
    await page.getByRole('button', {name: 'Cerrar sesión'}).click()
    await login(email)
    expect((await page.request.get(path)).status()).toBe(404)
    expect((await page.request.get(`${path}/${unknown.id}`)).status()).toBe(404)
    const options = {headers: {'Origin': 'http://localhost:5173', 'X-VERA-Request': '1'},
      data: {description: 'Intento ficticio ajeno', date_kind: 'unknown'}}
    expect((await page.request.post(path, options)).status()).toBe(404)
    expect((await page.request.put(`${path}/${unknown.id}`, options)).status()).toBe(404)
  }
  await page.getByRole('button', {name: 'Cerrar sesión'}).click()
})
