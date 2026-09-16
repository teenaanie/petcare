import webHandler from '../netlify/functions/delete-account.js'
import { toVercel } from './_adapt.js'

export default toVercel(webHandler)
