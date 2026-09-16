import webHandler from '../netlify/functions/transcribe.js'
import { toVercel } from './_adapt.js'

export default toVercel(webHandler)
