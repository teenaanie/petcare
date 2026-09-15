import webHandler from '../netlify/functions/analyze-document.js'
import { toVercel } from './_adapt.js'

export default toVercel(webHandler)
