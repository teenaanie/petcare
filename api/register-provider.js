import webHandler from '../netlify/functions/register-provider.js'
import { toVercel } from './_adapt.js'

export default toVercel(webHandler)
