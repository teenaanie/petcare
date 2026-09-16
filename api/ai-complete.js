import webHandler from '../netlify/functions/ai-complete.js'
import { toVercel } from './_adapt.js'

export default toVercel(webHandler)
