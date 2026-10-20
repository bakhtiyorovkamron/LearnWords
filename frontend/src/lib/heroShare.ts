import { heroSvgDocument } from './heroArt'

const W = 1080, H = 1920

/** Story-format picture (1080×1920): the hero of `stage`, the stage name and yodla.fun. */
export async function renderHeroCard(stage: number, stageName: string): Promise<Blob> {
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(heroSvgDocument(stage, 'happy'))
  await img.decode()
  await Promise.all([
    // with the text, so the right unicode-range subset (Cyrillic, ʻ) is fetched too
    document.fonts?.load('800 80px Unbounded', stageName),
    document.fonts?.load('600 44px Inter', 'yodla.fun'),
  ]).catch(() => undefined)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  // Brand background, same as the hero card: dark green with a soft lime glow.
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#14452F')
  bg.addColorStop(1, '#0B2B1C')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, 900, 0, W / 2, 900, 620)
  glow.addColorStop(0, 'rgba(207,250,77,0.18)')
  glow.addColorStop(1, 'rgba(207,250,77,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  const heroW = 880, heroH = heroW * 380 / 300
  ctx.drawImage(img, (W - heroW) / 2, 260, heroW, heroH)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#CFFA4D'
  let size = 84
  do {
    ctx.font = `800 ${size}px Unbounded, Inter, system-ui, sans-serif`
    size -= 4
  } while (ctx.measureText(stageName).width > W - 120 && size > 40)
  ctx.fillText(stageName, W / 2, 1530)

  ctx.fillStyle = '#A9C4B3'
  ctx.font = '600 44px Inter, system-ui, sans-serif'
  ctx.fillText('yodla.fun', W / 2, 1760)

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas is empty'))), 'image/png'))
}

/** Shares the picture via the Web Share API, or downloads it where sharing files isn't supported. */
export async function shareHeroCard(stage: number, stageName: string): Promise<void> {
  const blob = await renderHeroCard(stage, stageName)
  const file = new File([blob], 'yodla-hero.png', { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: stageName, text: 'yodla.fun' })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e // the user closed the share sheet — fine
    }
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
