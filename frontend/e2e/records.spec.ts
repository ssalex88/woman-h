import { expect, test } from '@playwright/test'

test('HU-01: crear, recargar, editar y bloquear el acceso directo de otra persona y de administración', async ({ page }) => {
  const password = process.env.DEMO_PASSWORD || 'Vera-Ficticia-2026!'
  const title = `Registro ficticio HU-01 ${Date.now()}`
  const description = 'Descripción ficticia para verificar persistencia y privacidad.'
  async function login(email: string) {
    await page.getByLabel('Correo electrónico').fill(email)
    await page.getByLabel('Contraseña').fill(password)
    await page.getByRole('button', {name: 'Ingresar a mi espacio'}).click()
    await page.getByRole('link', {name: 'Mis registros', exact:true}).click()
    await expect(page.getByRole('heading', {name: 'Mis registros'})).toBeVisible()
  }
  await page.goto('/')
  await login('ana@example.test')
  await page.getByRole('button', {name: 'Nuevo registro', exact: true}).click()
  await page.getByLabel('Título', {exact: true}).fill(title)
  await page.getByLabel('Descripción inicial').fill(description)
  const created = page.waitForResponse(response => response.url().endsWith('/api/records') && response.request().method() === 'POST')
  await page.getByRole('button', {name: 'Crear registro', exact: true}).click()
  const response = await created
  expect(response.status()).toBe(201)
  const record = await response.json()
  expect(record.status).toBe('private_draft')
  await expect(page.getByRole('heading', {name: title, exact: true})).toBeVisible()
  await page.reload()
  await expect(page.getByText(description, {exact: true})).toBeVisible()
  await page.getByRole('button', {name: 'Editar registro', exact: true}).click()
  await page.getByLabel('Título', {exact: true}).fill(`${title} editado`)
  await page.getByRole('button', {name: 'Guardar cambios'}).click()
  await expect(page.getByRole('heading', {name: `${title} editado`, exact: true})).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', {name: `${title} editado`, exact: true})).toBeVisible()
  for (const email of ['bea@example.test', 'admin@example.test']) {
    await page.getByRole('button', {name: 'Cerrar sesión'}).click()
    await login(email)
    const listed = await page.request.get('/api/records')
    expect((await listed.json()).some((item: {id: string}) => item.id === record.id)).toBe(false)
    expect((await page.request.get(`/api/records/${record.id}`)).status()).toBe(404)
    const denied = await page.request.put(`/api/records/${record.id}`, {
      headers: {'Origin': 'http://localhost:5173', 'X-VERA-Request': '1'},
      data: {title: 'Cambio no autorizado', description},
    })
    expect(denied.status()).toBe(404)
    await expect(page.getByRole('button', {name: `${title} editado`, exact: true})).toHaveCount(0)
  }
  await page.getByRole('button', {name: /VERA Institutional/}).click()
  await expect(page.getByRole('heading', {name: 'Institución Aurora · ficticia'})).toBeVisible()
  await expect(page.getByText(`${title} editado`, {exact: true})).toHaveCount(0)
  await page.getByRole('button', {name: 'Cerrar sesión'}).click()
  await login('ana@example.test')
  await page.getByRole('button', {name: `${title} editado`, exact: true}).click()
  await expect(page.getByText(description, {exact: true})).toBeVisible()
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', {name: 'Cerrar sesión'}).click()
})
