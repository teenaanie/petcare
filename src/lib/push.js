// push.js — browser push notification subscribe/unsubscribe helpers.

import { supabase, isConfigured } from './supabase.js'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export const pushSupported =
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

export async function getPushSubscriptionStatus() {
  if (!pushSupported) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  return sub ? 'subscribed' : 'unsubscribed'
}

export async function subscribeToPush() {
  if (!pushSupported) throw new Error('Push notifications are not supported on this browser.')
  if (!VAPID_PUBLIC_KEY) throw new Error('Push notifications are not configured (missing VAPID key).')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission denied.')

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  if (isConfigured) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('You must be signed in to enable notifications.')
    const json = sub.toJSON()
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    }, { onConflict: 'endpoint' })
    if (error) throw error
  }

  return sub
}

export async function unsubscribeFromPush() {
  if (!pushSupported) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  if (isConfigured) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  }
}
