// The public page at /delete-account.
//
// Google Play requires a URL anyone can open — without installing the app and
// without signing in — that names the app, gives the steps to delete an
// account, and says what is deleted and what is kept.
//
// Everything below is taken from what api/_lib/delete-account.js actually
// does. If that changes, this changes with it: a deletion promise that is not
// true is worse than no page at all.

const CONTACT = 'teena.anie9@gmail.com'

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="font-black text-sm" style={{ color: '#7a4900' }}>{title}</h2>
      <div className="text-sm space-y-2" style={{ color: '#4a4a3d' }}>{children}</div>
    </section>
  )
}

export default function DeleteAccountInfo() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#FFFEF8' }}>
      <div className="w-full max-w-2xl mx-auto">

        <div className="px-5 py-4" style={{ borderBottom: '1px solid #ebe3d3' }}>
          <span className="font-black" style={{ color: '#7a4900' }}>
            Deleting your Pippy account
          </span>
        </div>

        <div className="px-5 py-4 space-y-5">
          <p className="text-sm" style={{ color: '#4a4a3d' }}>
            Pippy is a pet health record app, published by Teena Emmanuel. You can delete
            your account and everything in it yourself, at any time, from inside the app.
            You do not need to ask anyone.
          </p>

          <Section title="How to delete your account">
            <ol className="list-decimal pl-5 space-y-1">
              <li>Open Pippy and sign in.</li>
              <li>Open the menu and choose <strong>Delete my account</strong>, at the bottom.</li>
              <li>Read what will be removed, then confirm.</li>
            </ol>
            <p>
              The deletion happens immediately. There is no waiting period and nothing is
              kept in a recycle bin — once it is done, it cannot be undone, and Pippy
              cannot restore it for you.
            </p>
          </Section>

          <Section title="What is deleted">
            <p>Everything attached to your account, permanently:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Your sign-in details — your email address or phone number</li>
              <li>Every pet you have added, and their names, breeds, dates of birth and photos</li>
              <li>Vaccinations, medicines, medical records, allergies, weight logs and bills</li>
              <li>Reminders, boarding trips and the photo journal</li>
              <li>Photographs you uploaded, removed from storage as well as from the record</li>
              <li>Notification subscriptions and your usage history</li>
            </ul>
          </Section>

          <Section title="What is kept, and for how long">
            <p>
              Nothing of yours is kept for Pippy's own use. Two things can outlive the
              account, and both are listed here rather than buried:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Records you shared with someone else.</strong> If you shared a pet
                with a boarder, sitter or vet, and they saved a note about that pet, the
                note belongs to their account and stays with them. Your pet's record is
                still deleted.
              </li>
              <li>
                <strong>Anonymous technical logs.</strong> Error reports and server logs,
                which have had anything identifying stripped out before they are written,
                and which cannot be traced back to you. These are kept up to 90 days and
                then rotate away.
              </li>
            </ul>
            <p>
              Backups are held by our hosting provider for a short period as part of normal
              operation, and your data disappears from those as they roll forward.
            </p>
          </Section>

          <Section title="If you cannot open the app">
            <p>
              Email <strong>{CONTACT}</strong> from the address on your Pippy account and
              ask for it to be deleted. Please say that you want your account deleted so it
              is not mistaken for a support question. It will be done by hand and you will
              get a reply confirming it.
            </p>
          </Section>

          <Section title="Deleting some data without deleting your account">
            <p>
              You do not have to delete everything. Inside the app you can remove a single
              pet, a vaccination, a medicine, a bill, a photo or a reminder at any time,
              and a deleted record is gone rather than hidden. Deleting a pet removes that
              pet's whole history with it.
            </p>
          </Section>

          <p className="text-xs pt-2" style={{ color: '#73775b', borderTop: '1px solid #ebe3d3' }}>
            Questions about any of this: {CONTACT}
          </p>
        </div>
      </div>
    </div>
  )
}
