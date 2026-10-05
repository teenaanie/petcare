import webHandler from '../netlify/functions/notify-provider-feedback.js'
import { toVercel } from './_adapt.js'

export default toVercel(webHandler)
