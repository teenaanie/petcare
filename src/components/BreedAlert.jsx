import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'

// ── Breed health lookup ───────────────────────────────────────────────────────
// Format: 'Breed Name (lowercase)' → array of known health concerns

const BREED_HEALTH = {
  // Dogs
  'labrador retriever':   ['Hip & elbow dysplasia', 'Obesity tendency', 'Exercise-induced collapse (EIC)', 'Progressive retinal atrophy'],
  'labrador':             ['Hip & elbow dysplasia', 'Obesity tendency', 'Exercise-induced collapse (EIC)', 'Progressive retinal atrophy'],
  'golden retriever':     ['Hip dysplasia', 'Cancer (higher breed risk)', 'Heart disease (SAS)', 'Skin allergies'],
  'german shepherd':      ['Hip & elbow dysplasia', 'Degenerative myelopathy', 'Bloat (GDV)', 'Perianal fistulas'],
  'bulldog':              ['Brachycephalic airway syndrome', 'Hip dysplasia', 'Skin fold dermatitis', 'Eye issues (cherry eye)'],
  'french bulldog':       ['Brachycephalic airway syndrome', 'Spinal issues (IVDD)', 'Skin allergies', 'Heat sensitivity'],
  'poodle':               ['Hip dysplasia', 'Progressive retinal atrophy', 'Sebaceous adenitis', 'Addison\'s disease'],
  'beagle':               ['Hip dysplasia', 'Epilepsy', 'Hypothyroidism', 'Intervertebral disc disease'],
  'rottweiler':           ['Hip & elbow dysplasia', 'Osteosarcoma (bone cancer)', 'Heart disease', 'Bloat (GDV)'],
  'yorkshire terrier':    ['Tracheal collapse', 'Patellar luxation', 'Portosystemic shunt', 'Dental disease'],
  'yorkshire':            ['Tracheal collapse', 'Patellar luxation', 'Portosystemic shunt', 'Dental disease'],
  'dachshund':            ['Intervertebral disc disease (IVDD)', 'Obesity', 'Cushing\'s disease', 'Patellar luxation'],
  'boxer':                ['Heart disease (DCM, AS)', 'Cancer (higher risk)', 'Brachycephalic syndrome', 'Hip dysplasia'],
  'shih tzu':             ['Brachycephalic syndrome', 'Eye problems (corneal ulcers)', 'Hip dysplasia', 'Dental disease'],
  'doberman':             ['Dilated cardiomyopathy (DCM)', 'Wobbler syndrome', 'Hip dysplasia', 'Von Willebrand disease'],
  'dobermann':            ['Dilated cardiomyopathy (DCM)', 'Wobbler syndrome', 'Hip dysplasia', 'Von Willebrand disease'],
  'great dane':           ['Bloat (GDV) — life-threatening', 'Hip dysplasia', 'Dilated cardiomyopathy', 'Wobbler syndrome'],
  'siberian husky':       ['Hip dysplasia', 'Progressive retinal atrophy', 'Zinc-responsive dermatosis', 'Hypothyroidism'],
  'husky':                ['Hip dysplasia', 'Progressive retinal atrophy', 'Zinc-responsive dermatosis', 'Hypothyroidism'],
  'cavalier king charles': ['Mitral valve disease (MVD)', 'Syringomyelia', 'Hip dysplasia', 'Episodic falling'],
  'cavalier':             ['Mitral valve disease (MVD)', 'Syringomyelia', 'Hip dysplasia', 'Episodic falling'],
  'chihuahua':            ['Patellar luxation', 'Tracheal collapse', 'Heart disease', 'Dental disease'],
  'pug':                  ['Brachycephalic airway syndrome', 'Eye problems', 'Pug dog encephalitis', 'Hip dysplasia'],
  'border collie':        ['Hip dysplasia', 'Collie eye anomaly', 'Epilepsy', 'MDR1 drug sensitivity'],
  'australian shepherd':  ['Hip dysplasia', 'MDR1 drug sensitivity', 'Epilepsy', 'Collie eye anomaly'],
  'maltese':              ['Patellar luxation', 'Dental disease', 'Portosystemic shunt', 'White shaker syndrome'],
  'spitz':                ['Hip dysplasia', 'Patellar luxation', 'Eye issues', 'Hypothyroidism'],
  'indian spitz':         ['Hip dysplasia', 'Dental disease', 'Eye issues'],
  'indie':                ['Generally hardy — minimal breed-specific issues', 'Mange (sarcoptic/demodectic)', 'Tick fever'],
  'indian pariah':        ['Generally hardy — minimal breed-specific issues', 'Mange', 'Tick fever'],
  'mutt':                 ['Hybrid vigour — generally fewer breed-specific issues', 'Routine dental care important'],
  'mixed breed':          ['Hybrid vigour — generally fewer breed-specific issues', 'Routine dental care important'],
  'rajapalayam':          ['Sensitive to anesthesia (sighthound)', 'Skin allergies', 'Deafness (linked to white coat pigmentation)', 'Cold sensitivity — thin coat'],
  'kombai':               ['Hip dysplasia', 'Joint strain from high energy activity', 'Skin issues in humid climates', 'Generally hardy but needs regular vet checks'],
  'mudhol hound':         ['Sensitive to anesthesia (sighthound)', 'Thin skin — prone to cuts and injuries', 'Low body fat — cold and drug-dose sensitivity', 'Hip dysplasia (less common than Western breeds)'],
  'caravan hound':        ['Sensitive to anesthesia (sighthound)', 'Thin skin — prone to cuts and injuries', 'Low body fat — cold and drug-dose sensitivity', 'Hip dysplasia (less common than Western breeds)'],
  'chippiparai':          ['Sensitive to anesthesia (sighthound)', 'Corneal and eye issues', 'Lean build — prone to fractures', 'Low body fat — cold sensitivity'],
  'kanni':                ['Sensitive to anesthesia (sighthound)', 'Cold sensitivity — thin coat', 'Skin issues', 'Low body fat — affects drug dosing'],
  'bakharwal':            ['Hip & elbow dysplasia', 'Bloat (GDV) — deep-chested breed', 'Entropion (eyelid issue)', 'Heat sensitivity from heavy double coat'],
  'bakharwal dog':        ['Hip & elbow dysplasia', 'Bloat (GDV) — deep-chested breed', 'Entropion (eyelid issue)', 'Heat sensitivity from heavy double coat'],

  // Cats
  'persian':              ['Brachycephalic syndrome', 'Polycystic kidney disease (PKD)', 'Dental disease', 'Skin fold dermatitis'],
  'siamese':              ['Progressive retinal atrophy', 'Amyloidosis', 'Respiratory disease', 'Dental disease'],
  'maine coon':           ['Hypertrophic cardiomyopathy (HCM)', 'Hip dysplasia', 'Spinal muscular atrophy', 'PKD'],
  'ragdoll':              ['Hypertrophic cardiomyopathy (HCM)', 'Bladder stones', 'Obesity'],
  'bengal':               ['Progressive retinal atrophy (PRA-b)', 'Pyruvate kinase deficiency', 'Heart disease'],
  'british shorthair':    ['Hypertrophic cardiomyopathy (HCM)', 'PKD', 'Obesity tendency'],
  'scottish fold':        ['Osteochondrodysplasia (painful joint condition — breed-inherent)', 'Heart disease', 'Dental issues'],
  'sphynx':               ['Hypertrophic cardiomyopathy (HCM)', 'Skin issues (sunburn, infections)', 'Dental disease'],
  'abyssinian':           ['Progressive retinal atrophy', 'Renal amyloidosis', 'Pyruvate kinase deficiency'],
  'burmese':              ['Hypokalemia', 'Facial deformity (flat-faced lines)', 'Diabetes mellitus'],

  // Small animals
  'rabbit':               ['GI stasis (life-threatening)', 'Dental disease (overgrown teeth)', 'E. cuniculi', 'Uterine cancer (unspayed females)'],
  'hamster':              ['Wet tail (proliferative ileitis)', 'Diabetes (dwarf hamsters)', 'Heart disease', 'Tumours in older hamsters'],
  'guinea pig':           ['Scurvy (Vitamin C deficiency)', 'Dental disease', 'Respiratory infections', 'Urinary stones'],
}

function normalize(str) {
  return (str || '').toLowerCase().trim()
}

function getAlerts(species, breed) {
  const key = normalize(breed)
  if (BREED_HEALTH[key]) return BREED_HEALTH[key]

  // Partial match
  const match = Object.keys(BREED_HEALTH).find(k => key.includes(k) || k.includes(key))
  return match ? BREED_HEALTH[match] : null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BreedAlert({ pet }) {
  const [expanded, setExpanded] = useState(false)

  const alerts = getAlerts(pet.species, pet.breed)
  if (!alerts || alerts.length === 0) return null

  return (
    <div className="card mb-4" style={{ border: '1.5px solid #FDE68A', backgroundColor: '#FFFBEB' }}>
      <button
        className="w-full flex items-center justify-between gap-3 text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#FEF3C7' }}>
            <AlertTriangle className="w-4 h-4" style={{ color: '#D97706' }} />
          </div>
          <div>
            <p className="font-black text-sm" style={{ color: '#92400E' }}>
              {pet.breed} Health Watch
            </p>
            <p className="text-xs" style={{ color: '#B45309' }}>
              {alerts.length} known breed-specific concern{alerts.length > 1 ? 's' : ''}
            </p>
          </div>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 flex-shrink-0" style={{ color: '#D97706' }} />
          : <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: '#D97706' }} />}
      </button>

      {expanded && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid #FDE68A' }}>
          <ul className="space-y-1.5">
            {alerts.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm" style={{ color: '#78350F' }}>
                <span className="mt-0.5 flex-shrink-0">⚠️</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs mt-3 italic" style={{ color: '#B45309' }}>
            This is general breed information — not a diagnosis. Discuss with your vet at next check-up.
          </p>
        </div>
      )}
    </div>
  )
}
