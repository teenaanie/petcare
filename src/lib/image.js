// src/lib/image.js
// Shrink a photo before it leaves the device.
//
// A modern phone camera produces 3–6MB per shot. A condition thread can easily
// hold a dozen over a few weeks, and every one of them is uploaded, stored,
// signed and downloaded again on each view. Compressing first turns that into
// roughly 250KB a photo with no visible loss at the sizes anyone actually looks
// at — which is the difference between a feature that works on Indian mobile
// data and one that does not.
//
// The same approach the document scanner already uses, extracted so the journal
// does not carry a second copy of it.

const MAX_EDGE = 1600   // a little larger than the scanner's 1280: a vet may
                        // want to zoom into a lesion, and detail is the point
const QUALITY  = 0.82

/** File -> compressed JPEG Blob. Returns the original if it cannot be decoded. */
export async function compressImage(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })

  const blob = await new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(b => resolve(b || file), 'image/jpeg', quality)
    }
    // HEIC from an iPhone, or anything the browser will not decode. Uploading
    // the original is better than losing the photo.
    img.onerror = () => resolve(file)
    img.src = dataUrl
  })

  return blob
}
