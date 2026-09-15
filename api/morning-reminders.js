import webHandler from '../netlify/functions/morning-reminders.js'
import { toVercel } from './_adapt.js'

export default toVercel(webHandler)
