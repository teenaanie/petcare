import { useState, useEffect } from 'react'
import { Users, UserPlus, Trash2, X, Loader2, AlertCircle, Copy, Check } from 'lucide-react'
import { supabase } from '../lib/supabase.js'

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function getMembers(petId) {
  const { data, error } = await supabase
    .from('pet_members')
    .select('id, email, role, created_at')
    .eq('pet_id', petId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

async function inviteMember(petId, email, role = 'viewer') {
  // The invite is stored against the email alone. There used to be a lookup
  // here against profiles to resolve a user_id first, but profiles holds only
  // (id, is_admin, created_at) — it has no email column, so that query failed
  // every single time and its error was discarded. Access is granted by
  // matching the email anyway: see is_pet_member() in supabase/pet_members.sql.
  const { error } = await supabase.from('pet_members').insert({
    pet_id: petId,
    email,
    role,
  })
  if (error) throw error
}

// Postgres errors are written for whoever wrote the schema, not for the person
// trying to share their dog with their sister.
function friendly(message = '') {
  if (/permission denied|row-level security|violates row-level/i.test(message)) {
    return "You don't have permission to change who can see this pet — only its owner can."
  }
  if (/duplicate key|unique constraint/i.test(message)) {
    return 'That email already has access to this pet.'
  }
  if (/does not exist|schema cache|column/i.test(message)) {
    return 'Sharing isn\'t set up on this database yet. Run supabase/pet_members.sql in the Supabase SQL editor.'
  }
  return message
}

async function removeMember(memberId) {
  const { error } = await supabase.from('pet_members').delete().eq('id', memberId)
  if (error) throw error
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PetSharing({ pet, onClose }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [email, setEmail]     = useState('')
  const [role, setRole]       = useState('viewer')
  const [inviting, setInviting] = useState(false)
  const [inviteErr, setInviteErr] = useState(null)
  const [copied, setCopied]   = useState(false)

  function load() {
    setLoading(true)
    getMembers(pet.id)
      .then(setMembers)
      .catch(e => setError(friendly(e.message)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [pet.id])

  async function handleInvite(e) {
    e.preventDefault()
    if (!email.trim()) return
    setInviting(true)
    setInviteErr(null)
    try {
      await inviteMember(pet.id, email.trim().toLowerCase(), role)
      setEmail('')
      load()
    } catch (err) {
      setInviteErr(friendly(err.message))
    } finally {
      setInviting(false)
    }
  }

  async function handleRemove(id) {
    if (!confirm('Remove this person from the pet?')) return
    await removeMember(id).catch(e => alert(friendly(e.message)))
    load()
  }

  async function copyLink() {
    const link = `${window.location.origin}?pet=${pet.id}`
    await navigator.clipboard.writeText(link).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-sm rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ backgroundColor: '#FFFEF8', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #ebe3d3' }}>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5" style={{ color: '#7a4900' }} />
            <span className="font-black" style={{ color: '#7a4900' }}>Share {pet.name}</span>
          </div>
          <button onClick={onClose}>
            <X className="w-5 h-5" style={{ color: '#73775b' }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Invite form */}
          <form onSubmit={handleInvite} className="space-y-3">
            <label className="text-xs font-black uppercase tracking-wider" style={{ color: '#73775b' }}>
              Invite someone by email
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                className="input flex-1 text-sm"
                placeholder="family@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              <select className="input text-sm w-28" value={role} onChange={e => setRole(e.target.value)}>
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
            </div>
            {inviteErr && (
              <p className="text-xs" style={{ color: '#c0392b' }}>{inviteErr}</p>
            )}
            <button type="submit" disabled={inviting}
              className="btn-primary w-full gap-2 text-sm"
              style={{ opacity: inviting ? 0.6 : 1 }}>
              {inviting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Inviting…</>
                : <><UserPlus className="w-4 h-4" /> Send Invite</>}
            </button>
          </form>

          {/* Role note */}
          <p className="text-xs px-3 py-2 rounded-xl" style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
            💡 <strong>Viewer</strong> can see records. <strong>Editor</strong> can also add and edit.
            The invitee must sign up with the same email.
          </p>

          {/* Members list */}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6" style={{ color: '#73775b' }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-sm p-3 rounded-xl"
              style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: '#73775b' }}>
              No one else has access yet.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-black uppercase tracking-wider" style={{ color: '#73775b' }}>
                People with access
              </p>
              {members.map(m => (
                <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl"
                  style={{ backgroundColor: '#fff9e0' }}>
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: '#7a4900' }}>{m.email}</p>
                    <p className="text-xs capitalize" style={{ color: '#73775b' }}>{m.role}</p>
                  </div>
                  <button onClick={() => handleRemove(m.id)}
                    className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
