import { X } from 'lucide-react'

// Privacy notice and terms of use.
//
// Written from what the app ACTUALLY does — every processor named here was
// found in the code, not assumed. If a feature changes, this changes with it;
// a notice that describes an older version of the app is worse than none,
// because it is a statement that happens to be untrue.
//
// It is not legal advice and has not been reviewed by a lawyer. It is an honest
// description of the data flows, which is the part an engineer can get right.

const UPDATED = '22 September 2026'
const CONTACT = 'teena.anie9@gmail.com'

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h3 className="font-black text-sm" style={{ color: '#7a4900' }}>{title}</h3>
      <div className="text-sm space-y-2" style={{ color: '#4a4a3d' }}>{children}</div>
    </section>
  )
}

function Row({ who, what, why }) {
  return (
    <tr>
      <td className="py-1.5 pr-3 align-top font-bold whitespace-nowrap" style={{ color: '#7a4900' }}>{who}</td>
      <td className="py-1.5 pr-3 align-top">{what}</td>
      <td className="py-1.5 align-top" style={{ color: '#73775b' }}>{why}</td>
    </tr>
  )
}

export default function PrivacyNotice({ onClose, initialTab = 'privacy' }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ backgroundColor: '#FFFEF8', maxHeight: '90vh' }}>

        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #ebe3d3' }}>
          <span className="font-black" style={{ color: '#7a4900' }}>Privacy &amp; Terms</span>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5" style={{ color: '#73775b' }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <p className="text-xs" style={{ color: '#73775b' }}>Last updated {UPDATED}</p>

          <Section title="What Pippy stores">
            <p>
              Your email address or phone number, used to sign you in. Whatever you
              record about your pets: names, breeds, dates of birth, weights, photos,
              vaccinations, medicines, allergies, bills, boarding notes, reminders, and
              the photo journal you keep of a condition over time. If you save your own
              vet, groomer or boarder, their contact details are stored too.
            </p>
            <p>
              Pet health records are the most sensitive thing here, and they are treated
              that way: every record is readable only by you and anyone you explicitly
              share a pet with. Photos live in a private store and are served through
              short-lived links.
            </p>
          </Section>

          <Section title="Who else sees it">
            <p>Pippy is built on other people's services. These are all of them:</p>
            <table className="w-full text-xs border-collapse">
              <tbody>
                <Row who="Supabase" what="Your account and all your records" why="Database and sign-in" />
                <Row who="Vercel" what="Requests to the app" why="Hosting" />
                <Row who="OpenAI" what="Document text, voice recordings, and the pet details you ask it to summarise" why="Scanning documents, health briefs, voice notes" />
                <Row who="Resend" what="Your email address" why="Reminder emails" />
                <Row who="Twilio" what="Your phone number" why="Reminder SMS, when enabled" />
                <Row who="Google" what="Voice audio, on some browsers" why="Speech recognition. Off on Apple devices" />
                <Row who="Microsoft" what="Session recordings — only if you agree" why="Clarity analytics. Off unless you opt in" />
              </tbody>
            </table>
            <p>
              Pippy does not sell your data, and does not use it for advertising.
              OpenAI does not train its models on data sent through its API.
            </p>
          </Section>

          <Section title="Analytics">
            <p>
              Analytics is off until you turn it on, and you are asked once. If you agree,
              Microsoft Clarity records how the app is used. Even then the app tells
              Clarity to mask page content, so a recording shows layout and taps rather
              than your pet's records. You can decline and never be asked again.
            </p>
          </Section>

          <Section title="How long it is kept">
            <p>
              Your records stay until you delete them or delete your account. There is no
              automatic expiry — a pet's vaccination history is only useful if it is kept.
            </p>
          </Section>

          <Section title="Deleting everything">
            <p>
              Settings → Delete my account removes your pets and their records, your saved
              providers, your photos, and your sign-in. It is immediate and cannot be
              undone. If any part of it fails, nothing is deleted and you are told — a
              half-finished erasure is worse than none.
            </p>
            <p>
              Deleting a single pet removes that pet's records and photos, and nothing else.
            </p>
          </Section>

          <Section title="Your rights">
            <p>
              You can see everything Pippy holds about you inside the app, correct it by
              editing it, and erase it by deleting your account. For anything else — a copy
              of your data, or a question about how it is handled — email {CONTACT}.
            </p>
          </Section>

          <Section title="The provider directory">
            <p>
              Pippy lists vets, groomers, boarders and pet shops. That information comes
              from public business listings and from businesses that registered themselves.
              It is provided to help you find somewhere, not as a recommendation, and
              Pippy does not verify anyone's qualifications, licensing or insurance. If a
              listing about your business is wrong, email {CONTACT} and it will be
              corrected or removed.
            </p>
          </Section>

          <Section title="Pippy is not a vet">
            <p className="font-bold" style={{ color: '#c0392b' }}>
              Nothing in Pippy is veterinary advice, diagnosis or treatment.
            </p>
            <p>
              Summaries, reminders and anything generated from a document or a voice note
              are produced automatically and can be wrong, incomplete or out of date.
              Photos in the journal are stored for you to show a vet — they are never
              interpreted. Always ask a qualified veterinarian, and in an emergency go
              straight to one rather than opening this app.
            </p>
          </Section>

          <Section title="Using Pippy">
            <p>
              Keep your own records accurate; Pippy shows back what you put in. Record only
              pets you are responsible for, and only share a pet with people you intend to
              give access to — anyone you add as an editor can change and delete records.
              Do not use Pippy to store anyone else's personal information without a reason
              to hold it.
            </p>
            <p>
              Pippy is offered as it is, without any guarantee that it will be available or
              that reminders will arrive — they depend on email and SMS providers outside
              its control. Do not rely on it as the only record of anything that matters.
              Keep your own copy of anything you cannot afford to lose.
            </p>
          </Section>

          <Section title="Changes">
            <p>
              If what Pippy does with data changes, this page changes with it, and the date
              at the top changes too.
            </p>
          </Section>

          <p className="text-xs pt-2" style={{ color: '#73775b', borderTop: '1px solid #ebe3d3' }}>
            This describes how Pippy actually handles data. It has not been reviewed by a
            lawyer, and it is not a substitute for advice on what your obligations are
            where you operate. Questions: {CONTACT}
          </p>
        </div>

        <div className="px-5 py-4 flex-shrink-0" style={{ borderTop: '1px solid #ebe3d3' }}>
          <button type="button" onClick={onClose}
            className="w-full py-2.5 rounded-2xl font-black text-sm"
            style={{ backgroundColor: '#f2b83d', color: '#7a4900' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
