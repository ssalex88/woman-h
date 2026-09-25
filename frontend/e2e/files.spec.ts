import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

test('HU-03: cargar, vincular, previsualizar y descargar originales privados', async ({ page }) => {
  const title = `Archivos ficticios HU-03 ${Date.now()}`
  const headers = {'Origin': 'http://localhost:5173', 'X-VERA-Request': '1'}
  async function login(email: string) {
    await page.getByLabel('Correo electrónico').fill(email)
    await page.getByLabel('Contraseña').fill(process.env.DEMO_PASSWORD || 'Vera-Ficticia-2026!')
    await page.getByRole('button', {name: 'Ingresar a mi espacio'}).click()
    await page.getByRole('link', {name: 'Mis registros', exact:true}).click()
    await expect(page.getByRole('heading', {name: 'Mis registros'})).toBeVisible()
  }
  await page.goto('/')
  await login('ana@example.test')
  const created = await page.request.post('/api/records', {headers, data: {title, description:'Contexto ficticio de archivos'}})
  const record = await created.json()
  const path = `/api/records/${record.id}/files`
  const event = await (await page.request.post(`/api/records/${record.id}/accounts`, {headers,
    data: {description:'Hecho ficticio vinculado', date_kind:'unknown'}})).json()
  await page.reload()
  await page.getByRole('button', {name:title, exact:true}).click()
  await expect(page.getByText('Aún no hay archivos en este registro.')).toBeVisible()
  await page.getByRole('button', {name:'Añadir archivo'}).click()
  await page.getByLabel('Archivo', {exact:true}).setInputFiles({name:'falso.png', mimeType:'image/png', buffer:Buffer.from('<html>Ficticio</html>')})
  await page.getByRole('button', {name:'Subir archivo', exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('Archivo inválido o dañado')
  await page.getByLabel('Archivo', {exact:true}).setInputFiles({name:'grande.png', mimeType:'image/png', buffer:Buffer.alloc(10485761)})
  await page.getByRole('button', {name:'Subir archivo', exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('supera el límite')
  await page.getByRole('button', {name:'Cancelar archivo'}).click()
  let firstId = ''
  for (const filename of ['captura.png','foto.jpg','documento.pdf']) {
    await page.getByRole('button', {name:'Añadir archivo'}).click()
    const fixture = fileURLToPath(new URL(`./fixtures/${filename}`, import.meta.url))
    const bytes = await readFile(fixture)
    await page.getByLabel('Archivo', {exact:true}).setInputFiles(fixture)
    await page.getByLabel('Descripción del archivo (opcional)').fill('Descripción ficticia de archivo')
    await page.getByRole('checkbox', {name:/Hecho ficticio vinculado/}).check()
    const response = page.waitForResponse(r => r.url().endsWith(path) && r.request().method() === 'POST')
    await page.getByRole('button', {name:'Subir archivo', exact:true}).click()
    const uploaded = await (await response).json()
    expect(uploaded.account_ids).toEqual([event.id])
    if (!firstId) firstId = uploaded.id
    const privatePath = fileURLToPath(new URL(`../../.private-storage/originals/${uploaded.id.replaceAll('-', '')}`, import.meta.url)).replaceAll('\\', '/')
    expect((await page.request.get(`/@fs/${privatePath}`)).status()).toBe(403)
    const card = page.getByRole('listitem').filter({has:page.getByRole('heading',{name:filename,exact:true})})
    await card.getByRole('button',{name:'Ver vista previa'}).click()
    const image = page.getByRole('img',{name:`Vista previa de ${filename}`})
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
    await page.getByRole('button',{name:'Cerrar vista previa'}).click()
    const downloadEvent = page.waitForEvent('download')
    await card.getByRole('button',{name:'Descargar original'}).click()
    const downloaded = await downloadEvent
    expect(await readFile((await downloaded.path())!)).toEqual(bytes)
  }
  await page.reload()
  const card = page.getByRole('listitem').filter({has:page.getByRole('heading',{name:'captura.png',exact:true})})
  await card.getByRole('button',{name:'Editar vínculos'}).click()
  await expect(page.getByRole('checkbox',{name:/Hecho ficticio vinculado/})).toBeChecked()
  await page.getByRole('checkbox',{name:/Hecho ficticio vinculado/}).uncheck()
  await page.getByRole('button',{name:'Guardar vínculos y descripción'}).click()
  await expect(card.getByText('Sin relatos vinculados')).toBeVisible()
  await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('region', {name:'Archivos privados'}).screenshot({path:test.info().outputPath('archivos-movil.png')})
  for (const email of ['bea@example.test','admin@example.test']) {
    await page.getByRole('button',{name:'Cerrar sesión'}).click()
    await login(email)
    expect((await page.request.get(path)).status()).toBe(404)
    for (const suffix of ['', '/content', '/preview']) {
      expect((await page.request.get(`${path}/${firstId}${suffix}`)).status()).toBe(404)
    }
    expect((await page.request.put(`${path}/${firstId}`, {headers,data:{description:'Cambio ajeno'}})).status()).toBe(404)
  }
  await page.getByRole('button',{name:'Cerrar sesión'}).click()
  expect((await page.request.get(`${path}/${firstId}/content`)).status()).toBe(401)
})
