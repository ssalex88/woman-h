import { expect, test, type Page } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/')
  await page.getByLabel('Correo electrónico').fill('ana@example.test')
  await page.getByLabel('Contraseña').fill(process.env.DEMO_PASSWORD || 'Vera-Ficticia-2026!')
  await page.getByRole('button', {name:'Ingresar a mi espacio'}).click()
  await expect(page.getByLabel('Te leemos')).toBeVisible()
}

// Doble exclusivamente de prueba: API, autenticación y persistencia son reales.
async function speechDouble(page: Page) {
  await page.addInitScript(() => {
    class Recognition {
      onstart?: () => void; onend?: () => void
      onresult?: (event: unknown) => void; onerror?: (event: unknown) => void
      start() { Object.assign(window, {testSpeech:this}); this.onstart?.() }
      stop() {}
      abort() {}
    }
    Object.assign(window, {SpeechRecognition:Recognition})
  })
}
async function emit(page: Page, event: 'onresult' | 'onend' | 'onerror', value?: unknown) {
  await page.evaluate(({event,value}) => {
    const session = (window as unknown as {testSpeech:Record<string, (value:unknown) => void>}).testSpeech
    session[event]?.(value)
  }, {event,value})
}

test('HU-05: voz, detener, revisar y guardar usando la API real', async ({page}) => {
  await speechDouble(page); await login(page)
  const text = `Relato ficticio por voz ${Date.now()}`
  let saves = 0
  page.on('request', request => { if (request.url().endsWith('/api/start') && request.method() === 'POST') saves++ })
  await page.getByRole('button', {name:'Contarlo por voz'}).click()
  await page.getByRole('button', {name:'Iniciar voz'}).click()
  await expect(page.getByText('Micrófono activo · Escuchando…')).toBeVisible()
  await emit(page, 'onresult', {results:[{0:{transcript:text},length:1,isFinal:true}]})
  await page.screenshot({path:test.info().outputPath('voz-captura.png'),fullPage:true})
  await page.getByRole('button', {name:'Detener y revisar'}).click()
  await expect(page.getByText('Finalizando la transcripción…')).toBeVisible()
  await page.screenshot({path:test.info().outputPath('voz-transcribiendo.png'),fullPage:true})
  await emit(page, 'onend')
  await expect(page.getByRole('button', {name:'Continuar',exact:true})).toBeDisabled()
  expect(saves).toBe(0)
  await page.reload()
  await expect(page.getByLabel('Te leemos')).toHaveValue(text)
  await expect(page.getByRole('checkbox')).not.toBeChecked()
  await page.getByLabel('Te leemos').fill(text + ' corregido')
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:test.info().outputPath('voz-revision-movil.png'),fullPage:true})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', {name:'Continuar',exact:true}).click()
  await page.getByRole('button', {name:'Continuar sin archivos',exact:true}).click()
  await expect(page.getByRole('heading', {name:'Relatos de hechos'})).toBeVisible()
  await expect(page.getByText(text + ' corregido', {exact:true})).toHaveCount(2)
  expect(saves).toBe(1)
})

test('HU-05: permiso denegado y fallo de red conservan la escritura', async ({page}) => {
  await speechDouble(page); await login(page)
  await page.getByLabel('Te leemos').fill('Avance ficticio antes de hablar')
  await page.getByRole('button', {name:'Contarlo por voz'}).click()
  await page.getByRole('button', {name:'Iniciar voz'}).click()
  await emit(page, 'onerror', {error:'not-allowed'})
  await expect(page.getByRole('alert')).toContainText('No se permitió el micrófono')
  await page.screenshot({path:test.info().outputPath('voz-permiso-denegado.png'),fullPage:true})
  await page.getByRole('button', {name:'Iniciar voz'}).click()
  await emit(page, 'onerror', {error:'network'})
  await expect(page.getByRole('alert')).toContainText('servicio de voz')
  await page.getByRole('button', {name:'Seguir escribiendo'}).click()
  await expect(page.getByLabel('Te leemos')).toHaveValue('Avance ficticio antes de hablar')
  await expect(page.getByLabel('Te leemos')).toBeEnabled()
})

test('HU-05: navegador sin reconocimiento ofrece alternativa inmediata', async ({page}) => {
  await page.addInitScript(() => Object.assign(window, {SpeechRecognition:undefined,webkitSpeechRecognition:undefined}))
  await login(page)
  await page.getByRole('button', {name:'Contarlo por voz'}).click()
  await expect(page.getByText(/La voz no está disponible en este navegador/)).toBeVisible()
  await page.screenshot({path:test.info().outputPath('voz-no-compatible.png'),fullPage:true})
  await page.getByRole('button', {name:'Seguir escribiendo'}).click()
  await expect(page.getByLabel('Te leemos')).toBeEnabled()
})
