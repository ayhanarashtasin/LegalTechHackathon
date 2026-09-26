/**
 * Client-side image helper for responsive legal-aid document uploads.
 * Downscales camera and smartphone photos to crisp, readable web-ready JPEGs
 * (~100KB-250KB) to ensure rapid uploads over mobile 2G/3G connections and low memory use.
 */
export async function processImageFile(file, maxDimension = 1200, quality = 0.82) {
  if (!file) return null

  // If it's a PDF or non-image document, read as raw data URL
  if (!file.type.startsWith('image/')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve({
        filename: file.name,
        dataUrl: reader.result,
        size: file.size,
        type: file.type,
      })
      reader.onerror = () => reject(new Error('Failed to read file.'))
      reader.readAsDataURL(file)
    })
  }

  // If it is an image, load into an Image and scale via Canvas
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        let width = img.width
        let height = img.height

        // Downscale proportionally if larger than maxDimension
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width)
            width = maxDimension
          } else {
            width = Math.round((width * maxDimension) / height)
            height = maxDimension
          }
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)

        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality)
        resolve({
          filename: file.name.replace(/\.[^/.]+$/, '.jpg'),
          dataUrl: compressedDataUrl,
          size: Math.round((compressedDataUrl.length * 3) / 4), // Approximate byte size from base64
          type: 'image/jpeg',
          width,
          height,
        })
      }
      img.onerror = () => {
        // Fallback to raw data URL if canvas decoding fails
        resolve({
          filename: file.name,
          dataUrl: e.target.result,
          size: file.size,
          type: file.type,
        })
      }
      img.src = e.target.result
    }
    reader.onerror = () => reject(new Error('Failed to read image file.'))
    reader.readAsDataURL(file)
  })
}
